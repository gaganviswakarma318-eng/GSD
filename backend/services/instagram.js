const { runProcess } = require("../utils/processes");
const { ApiError, validatePublicUrl, validateUrl } = require("../utils/errors");
const { buildOptions, publicOption } = require("./yt-dlp/formats");

const INSTAGRAM_HOSTS = new Set([
  "instagram.com",
  "www.instagram.com",
  "m.instagram.com",
]);
const MAX_EXTRACTED_ITEMS = 100;
const MAX_PROFILE_HTML_BYTES = 5 * 1024 * 1024;
const MEDIA_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "avif"]);

function classifyInstagramUrl(value) {
  let url;
  try {
    url = new URL(validateUrl(value));
  } catch {
    throw new ApiError(
      "Paste a valid Instagram post, reel, story, highlight, or profile link.",
      400,
      "INVALID_INSTAGRAM_URL",
    );
  }

  if (
    url.protocol !== "https:" ||
    url.port ||
    !INSTAGRAM_HOSTS.has(url.hostname.toLowerCase())
  )
    throw new ApiError(
      "Paste a valid Instagram post, reel, story, highlight, or profile link.",
      400,
      "INVALID_INSTAGRAM_URL",
    );

  const parts = url.pathname.split("/").filter(Boolean);
  let type = null;
  if (parts[0] === "p" && parts[1]) type = "post";
  else if (["reel", "reels", "tv"].includes(parts[0]) && parts[1])
    type = "reel";
  else if (parts[0] === "stories" && parts[1] === "highlights" && parts[2])
    type = "highlight";
  else if (parts[0] === "stories" && parts[1]) type = "story";
  else if (
    parts.length === 1 &&
    !new Set([
      "accounts",
      "developer",
      "direct",
      "explore",
      "p",
      "reel",
      "reels",
      "stories",
      "tv",
    ]).has(parts[0].toLowerCase())
  )
    type = "profile";

  if (!type)
    throw new ApiError(
      "This Instagram link type is not supported. Use a post, reel, story, highlight, or public profile link.",
      422,
      "UNSUPPORTED_INSTAGRAM_URL",
    );

  return { url: url.href, type, username: type === "profile" ? parts[0] : null };
}

function buildInstagramArgs(config, url) {
  return [
    "--ignore-config",
    "--no-plugin-dirs",
    "--no-warnings",
    "--no-colors",
    "--socket-timeout",
    "30",
    "--retries",
    "1",
    "--no-js-runtimes",
    "--js-runtimes",
    `node:${config.tools.node}`,
    "--dump-single-json",
    "--skip-download",
    "--ignore-no-formats-error",
    "--playlist-end",
    String(MAX_EXTRACTED_ITEMS),
    "--",
    url,
  ];
}

function sourceError(stderr, type) {
  const lines = String(stderr || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split(/\r?\n/);
  const lastError =
    lines.filter((line) => line.includes("ERROR:")).pop() ||
    lines.filter(Boolean).pop() ||
    "";
  const text = lastError
    .replace(/^.*?ERROR:\s*/, "")
    .replace(/https?:\/\/\S+/g, "[source]")
    .slice(0, 400) || "";

  if (/private|login|sign.?in|authentication|401|403|registered users|followers/i.test(text))
    return new ApiError(
      `This Instagram ${type} is private or requires sign-in. GSD only accesses public content and does not use login cookies.`,
      403,
      "INSTAGRAM_PRIVATE",
    );
  if (/HTTP Error 429|\b429\b|too many requests|rate.?limit/i.test(text))
    return new ApiError(
      "Instagram is temporarily limiting requests. Wait a little while, then try again.",
      429,
      "INSTAGRAM_RATE_LIMIT",
    );
  if (/timed out|connection|network|temporary failure|HTTP Error 5\d\d/i.test(text))
    return new ApiError(
      "Instagram could not be reached. Check the connection and try again.",
      503,
      "INSTAGRAM_NETWORK",
    );
  if (/not found|does not exist|expired|unavailable|HTTP Error (404|410)|\b(404|410)\b/i.test(text))
    return new ApiError(
      "This Instagram link may have expired or the content is no longer available.",
      422,
      "INSTAGRAM_EXPIRED",
    );
  if (/unsupported url|no suitable extractor/i.test(text))
    return new ApiError(
      "This Instagram content type is not supported by the installed extractor.",
      422,
      "INSTAGRAM_UNSUPPORTED",
    );
  return new ApiError(
    text
      ? `Instagram extraction failed: ${text}`
      : "Instagram returned no accessible media. The link may be private, expired, or unsupported.",
    422,
    "INSTAGRAM_EXTRACTION_FAILED",
  );
}

function isInstagramMediaUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (INSTAGRAM_HOSTS.has(host) ||
        host.endsWith(".cdninstagram.com") ||
        host.endsWith(".fbcdn.net") ||
        host.endsWith(".fbsbx.com"))
    );
  } catch {
    return false;
  }
}

function mediaThumbnail(raw) {
  const candidates = [
    ...(Array.isArray(raw.thumbnails) ? raw.thumbnails : []),
    raw.thumbnail,
    raw.display_url,
    raw.display_src,
  ]
    .map((item) =>
      typeof item === "string"
        ? { url: item }
        : item && typeof item.url === "string"
          ? item
          : null,
    )
    .filter((item) => item && isInstagramMediaUrl(item.url));
  candidates.sort(
    (left, right) =>
      (Number(right.width) || 0) * (Number(right.height) || 0) -
      (Number(left.width) || 0) * (Number(left.height) || 0),
  );
  return candidates[0]?.url || null;
}

function extensionFromUrl(value) {
  const pathname = new URL(value).pathname;
  const extension = /\.([a-z0-9]{2,5})$/i.exec(pathname)?.[1]?.toLowerCase();
  return extension && MEDIA_EXTENSIONS.has(extension) ? extension : "jpg";
}

function imageOption(index, extension) {
  const selector = `instagram-image-${index}`;
  return {
    id: `instagram-image-${index}`,
    type: "image",
    format: extension,
    quality: "Original",
    label: `${extension.toUpperCase()} · original`,
    requiresConversion: false,
    thumbnailSupport: {
      supported: false,
      method: null,
      reason: "The image itself is saved at the source quality.",
    },
    selector,
  };
}

function imageInfo(raw, sourceUrl, index, title, creator, thumbnail) {
  const extension = extensionFromUrl(thumbnail);
  const option = imageOption(index, extension);
  const format = {
    format_id: option.selector,
    url: thumbnail,
    ext: extension,
    protocol: "https",
    vcodec: "none",
    acodec: "none",
  };
  const downloadable = {
    ...raw,
    _type: "video",
    id: String(raw.id || `instagram-image-${index}`),
    title,
    thumbnail,
    webpage_url: sourceUrl,
    url: thumbnail,
    ext: extension,
    formats: [format],
  };
  return {
    kind: "image",
    info: {
      raw: downloadable,
      options: [option],
      public: {
        url: sourceUrl,
        title,
        thumbnail,
        duration: null,
        extractor: "Instagram",
        creator: creator || null,
      },
    },
  };
}

function htmlAttribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ).exec(tag)?.slice(1).find(Boolean) || "";
}

function decodeHtmlUrl(value) {
  return value
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"');
}

function profilePictureFromHtml(html) {
  const jsonPatterns = [
    /"profile_pic_url_hd"\s*:\s*"((?:\\.|[^"\\])+)"/i,
    /"profile_pic_url"\s*:\s*"((?:\\.|[^"\\])+)"/i,
  ];
  for (const pattern of jsonPatterns) {
    const value = pattern.exec(html)?.[1];
    if (value) {
      const url = decodeHtmlUrl(value);
      if (isInstagramMediaUrl(url)) return url;
    }
  }

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    if (htmlAttribute(tag, "property").toLowerCase() !== "og:image") continue;
    const value = decodeHtmlUrl(htmlAttribute(tag, "content"));
    if (isInstagramMediaUrl(value)) return value;
  }
  return null;
}

async function readLimitedText(response, maxBytes) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes)
    throw new ApiError(
      "Instagram returned an unexpectedly large profile page.",
      502,
      "INSTAGRAM_RESPONSE_TOO_LARGE",
    );
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ApiError(
          "Instagram returned an unexpectedly large profile page.",
          502,
          "INSTAGRAM_RESPONSE_TOO_LARGE",
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

class InstagramExtractor {
  constructor(
    config,
    availability,
    { processRunner = runProcess, fetchImpl = globalThis.fetch } = {},
  ) {
    this.config = config;
    this.availability = availability;
    this.processRunner = processRunner;
    this.fetchImpl = fetchImpl;
    this.controllers = new Set();
    this.pending = new Set();
    this.validatedHosts = new Map();
    this.closed = false;
  }

  async withController(externalSignal, operation) {
    if (this.closed)
      throw new ApiError("GSD is shutting down.", 503, "SERVER_CLOSING");
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (externalSignal?.aborted) abort();
    else externalSignal?.addEventListener("abort", abort, { once: true });
    this.controllers.add(controller);
    const pending = Promise.resolve().then(() => operation(controller.signal));
    this.pending.add(pending);
    try {
      return await pending;
    } finally {
      this.controllers.delete(controller);
      this.pending.delete(pending);
      externalSignal?.removeEventListener("abort", abort);
    }
  }

  async inspect(value, signal) {
    const extracted = await this.extract(value, signal);
    return {
      url: extracted.url,
      contentType: extracted.contentType,
      title: extracted.title,
      creator: extracted.creator,
      items: extracted.items.map((item) => ({
        id: item.id,
        index: item.index,
        kind: item.kind,
        title: item.info.public.title,
        thumbnail: item.info.public.thumbnail,
        duration: item.info.public.duration,
        options: item.info.options.map(publicOption),
        error: item.error || null,
      })),
    };
  }

  async extract(value, signal) {
    const descriptor = classifyInstagramUrl(value);
    const url = await validatePublicUrl(
      descriptor.url,
      this.config.allowPrivateUrls,
    );
    if (!this.availability.ytDlp && descriptor.type !== "profile")
      throw new ApiError(
        "Instagram extraction requires yt-dlp. Reinstall GSD or configure GSD_YTDLP_PATH.",
        503,
        "MISSING_TOOL",
      );

    return this.withController(signal, async (controllerSignal) => {
      if (descriptor.type === "profile")
        return this.extractProfile(descriptor, url, controllerSignal);
      return this.extractMedia(descriptor, url, controllerSignal);
    });
  }

  async extractMedia(descriptor, url, signal) {
    let result;
    try {
      result = await this.processRunner(
        this.config.tools.ytDlp,
        buildInstagramArgs(this.config, url),
        { signal, timeoutMs: 120000, maxOutput: 32 * 1024 * 1024 },
      );
    } catch (error) {
      if (signal.aborted || error.name === "AbortError") throw error;
      if (/timed out|timeout|connection|network/i.test(error.message || ""))
        throw sourceError(error.message, descriptor.type);
      throw new ApiError(
        "Instagram extraction failed. Check the connection and try again.",
        503,
        "INSTAGRAM_NETWORK",
      );
    }
    if (result.code !== 0) throw sourceError(result.stderr, descriptor.type);

    let raw;
    try {
      raw = JSON.parse(result.stdout);
    } catch {
      throw new ApiError(
        "Instagram returned invalid media information. The link may be private, expired, or unsupported.",
        422,
        "INSTAGRAM_EXTRACTION_FAILED",
      );
    }
    const entries = Array.isArray(raw.entries) ? raw.entries : [raw];
    if (!entries.length)
      throw sourceError("Instagram returned no accessible media.", descriptor.type);
    if (entries.length > MAX_EXTRACTED_ITEMS)
      throw new ApiError(
        `This Instagram collection contains more than ${MAX_EXTRACTED_ITEMS} items. Select a smaller public collection.`,
        422,
        "INSTAGRAM_TOO_MANY_ITEMS",
      );

    const parentTitle = String(raw.title || `Instagram ${descriptor.type}`)
      .trim()
      .slice(0, 300);
    const creator = String(raw.channel || raw.uploader || raw.creator || "")
      .trim()
      .slice(0, 120);
    const items = [];
    for (const [index, entry] of entries.entries()) {
      if (!entry || typeof entry !== "object") continue;
      const fallbackTitle =
        entries.length > 1 ? `${parentTitle} · item ${index + 1}` : parentTitle;
      const title =
        String(entry.title || fallbackTitle || `Instagram item ${index + 1}`)
          .trim()
          .slice(0, 300);
      const thumbnail = mediaThumbnail(entry);
      const videoOptions = buildOptions(entry, {
        ffmpeg: this.availability.ffmpeg,
      });
      const looksLikeVideo =
        videoOptions.some((option) => option.type === "video") ||
        (Array.isArray(entry.formats) &&
          entry.formats.some(
            (format) => format.vcodec && format.vcodec !== "none",
          )) ||
        Number(entry.duration) > 0;
      let normalized;
      if (looksLikeVideo) {
        normalized = {
          kind: "video",
          info: {
            raw: { ...entry, webpage_url: url },
            options: videoOptions,
            public: {
              url,
              title,
              thumbnail,
              duration: Number(entry.duration) || null,
              extractor: "Instagram",
              creator: creator || null,
            },
          },
          error: videoOptions.length
            ? null
            : "No downloadable video format was returned for this item.",
        };
      } else if (thumbnail) {
        normalized = imageInfo(entry, url, index, title, creator, thumbnail);
      } else {
        normalized = {
          kind: "image",
          info: {
            raw: entry,
            options: [],
            public: {
              url,
              title,
              thumbnail: null,
              duration: null,
              extractor: "Instagram",
              creator: creator || null,
            },
          },
          error: "Instagram did not expose a downloadable image for this item.",
        };
      }
      const stableId = String(entry.id || entry.display_id || index);
      items.push({
        id: `${index}:${stableId}`,
        index,
        kind: normalized.kind,
        info: normalized.info,
        error: normalized.error || null,
      });
    }
    if (!items.some((item) => item.info.options.length))
      throw sourceError("Instagram returned no downloadable media.", descriptor.type);

    const contentType =
      descriptor.type === "story" || descriptor.type === "highlight"
        ? descriptor.type
        : items.length > 1
          ? "carousel"
          : items[0].kind === "video"
            ? descriptor.type === "reel"
              ? "reel"
              : "video"
            : "photo";
    return { url, contentType, title: parentTitle, creator, items };
  }

  async extractProfile(descriptor, url, signal) {
    if (typeof this.fetchImpl !== "function")
      throw new ApiError(
        "Profile-picture extraction is unavailable in this runtime.",
        503,
        "INSTAGRAM_PROFILE_UNAVAILABLE",
      );
    const controller = signal;
    const timer = setTimeout(() => {
      if (!controller.aborted) this.controllers.forEach((value) => {
        if (value.signal === controller) value.abort();
      });
    }, 15000);
    try {
      let target = url;
      let response;
      for (let redirect = 0; redirect <= 3; redirect++) {
        response = await this.fetchImpl(target, {
          headers: { Accept: "text/html" },
          redirect: "manual",
          signal,
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get("location");
        if (!location || redirect === 3)
          throw new ApiError(
            "Instagram redirected the profile request unexpectedly.",
            502,
            "INSTAGRAM_REDIRECT",
          );
        const next = new URL(location, target);
        if (
          next.protocol !== "https:" ||
          !INSTAGRAM_HOSTS.has(next.hostname.toLowerCase())
        )
          throw new ApiError(
            "Instagram redirected the profile request outside Instagram.",
            502,
            "INSTAGRAM_REDIRECT",
          );
        target = await validatePublicUrl(
          next.href,
          this.config.allowPrivateUrls,
        );
      }
      if (response.status === 401 || response.status === 403)
        throw sourceError(`HTTP Error ${response.status}: login required`, "profile");
      if (!response.ok)
        throw sourceError(`HTTP Error ${response.status}`, "profile");
      if (/\/accounts\/login/i.test(new URL(response.url || target).pathname))
        throw sourceError("Instagram redirected to login", "profile");
      const html = await readLimitedText(response, MAX_PROFILE_HTML_BYTES);
      const thumbnail = profilePictureFromHtml(html);
      if (!thumbnail)
        throw new ApiError(
          "Instagram did not expose a public profile picture without signing in.",
          422,
          "INSTAGRAM_PROFILE_UNAVAILABLE",
        );
      const { username } = descriptor;
      const title = `${username} profile picture`;
      const raw = { id: username, title, extractor_key: "Instagram" };
      const normalized = imageInfo(
        raw,
        url,
        "profile",
        title,
        username,
        thumbnail,
      );
      const item = {
        id: "profile-picture",
        index: 0,
        kind: "image",
        info: normalized.info,
        error: null,
      };
      return {
        url,
        contentType: "profile",
        title,
        creator: username,
        items: [item],
      };
    } catch (error) {
      if (signal.aborted || error.name === "AbortError") throw error;
      if (error instanceof ApiError) throw error;
      if (/timed out|timeout|connection|network/i.test(error.message || ""))
        throw sourceError(error.message, "profile");
      throw new ApiError(
        "Could not read the public Instagram profile. It may be private or require sign-in.",
        422,
        "INSTAGRAM_PROFILE_UNAVAILABLE",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async buildDownloadInfo(item, optionId) {
    const option = item.info.options.find((value) => value.id === optionId);
    if (!option)
      throw new ApiError(
        "This Instagram format is no longer available. Analyze the link again.",
        422,
        "INSTAGRAM_FORMAT_EXPIRED",
      );
    const formatIds = option.selector.split("+");
    const sourceFormats = Array.isArray(item.info.raw.formats)
      ? item.info.raw.formats
      : [];
    const formats = sourceFormats.filter((format) =>
      formatIds.includes(String(format.format_id)),
    );
    if (formats.length !== formatIds.length)
      throw new ApiError(
        "Instagram changed the available media format. Analyze the link again.",
        422,
        "INSTAGRAM_FORMAT_EXPIRED",
      );
    for (const format of formats) await this.validateMediaUrl(format.url);
    return {
      ...item.info,
      raw: { ...item.info.raw, formats },
      options: [option],
    };
  }

  async validateMediaUrl(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new ApiError(
        "Instagram returned an invalid media URL. Analyze the link again.",
        422,
        "INSTAGRAM_INVALID_MEDIA_URL",
      );
    }
    if (!isInstagramMediaUrl(value))
      throw new ApiError(
        "Instagram returned a media URL outside its supported public media hosts.",
        422,
        "INSTAGRAM_INVALID_MEDIA_URL",
      );
    const cached = this.validatedHosts.get(url.hostname);
    if (cached && cached > Date.now()) return;
    await validatePublicUrl(
      `${url.protocol}//${url.host}/`,
      this.config.allowPrivateUrls,
    );
    this.validatedHosts.set(url.hostname, Date.now() + 5 * 60 * 1000);
  }

  async prepareDownload(url, itemId, optionId, extracted) {
    const current =
      extracted || (await this.extract(url));
    const item = current.items.find((value) => value.id === itemId);
    if (!item)
      throw new ApiError(
        "This Instagram item is no longer available. Analyze the link again.",
        422,
        "INSTAGRAM_ITEM_EXPIRED",
      );
    const info = await this.buildDownloadInfo(item, optionId);
    const refresh = async (signal) => {
      const latest = await this.extract(url, signal);
      const freshItem = latest.items.find((value) => value.id === itemId);
      if (!freshItem)
        throw new ApiError(
          "This Instagram item is no longer available. Analyze the link again.",
          422,
          "INSTAGRAM_ITEM_EXPIRED",
        );
      return this.buildDownloadInfo(freshItem, optionId);
    };
    return { info, refresh };
  }

  async close() {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    await Promise.allSettled([...this.pending]);
  }
}

module.exports = {
  InstagramExtractor,
  MAX_EXTRACTED_ITEMS,
  buildInstagramArgs,
  classifyInstagramUrl,
  isInstagramMediaUrl,
  profilePictureFromHtml,
  sourceError,
};
