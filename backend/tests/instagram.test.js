const test = require("node:test");
const assert = require("node:assert/strict");
const { createConfig } = require("../config");
const {
  InstagramExtractor,
  buildInstagramArgs,
  classifyInstagramUrl,
  isInstagramMediaUrl,
  profilePictureFromHtml,
  sourceError,
} = require("../services/instagram");

const publicImage = "https://scontent.cdninstagram.com/photo.jpg";
const publicVideo = "https://scontent.cdninstagram.com/reel.mp4";
const videoFormat = {
  format_id: "video",
  url: publicVideo,
  ext: "mp4",
  vcodec: "avc1",
  acodec: "mp4a.40.2",
  height: 720,
  filesize: 500,
};

async function inspectFixture(url, payload) {
  const extractor = new InstagramExtractor(
    createConfig({
      allowPrivateUrls: true,
      tools: { ytDlp: "fixture-ytdlp", node: process.execPath },
    }),
    { ytDlp: true, ffmpeg: false },
    {
      processRunner: async () => ({
        code: 0,
        stderr: "",
        stdout: JSON.stringify(payload),
      }),
    },
  );
  const result = await extractor.inspect(url);
  await extractor.close();
  return result;
}

test("Instagram URLs are classified only on approved HTTPS hosts", () => {
  assert.equal(classifyInstagramUrl("https://www.instagram.com/p/ABC/").type, "post");
  assert.equal(classifyInstagramUrl("https://instagram.com/reel/ABC/").type, "reel");
  assert.equal(classifyInstagramUrl("https://instagram.com/stories/user/1/").type, "story");
  assert.equal(classifyInstagramUrl("https://instagram.com/stories/highlights/1/").type, "highlight");
  assert.equal(classifyInstagramUrl("https://instagram.com/public.creator/").type, "profile");
  assert.throws(
    () => classifyInstagramUrl("http://instagram.com/p/ABC/"),
    (error) => error.code === "INVALID_INSTAGRAM_URL",
  );
  assert.throws(
    () => classifyInstagramUrl("https://example.com/p/ABC/"),
    (error) => error.code === "INVALID_INSTAGRAM_URL",
  );
});

test("Instagram media URL checks reject non-Instagram and insecure hosts", () => {
  assert.equal(isInstagramMediaUrl(publicImage), true);
  assert.equal(isInstagramMediaUrl("https://evil.example/photo.jpg"), false);
  assert.equal(isInstagramMediaUrl("http://scontent.cdninstagram.com/photo.jpg"), false);
  assert.equal(isInstagramMediaUrl("https://user@scontent.cdninstagram.com/photo.jpg"), false);
});

test("Instagram extraction is cookie-free and exposes carousel photos and videos", async () => {
  const config = createConfig({
    allowPrivateUrls: true,
    cookiesFromBrowser: "firefox",
    tools: { ytDlp: "fixture-ytdlp", node: process.execPath },
  });
  let args;
  const extractor = new InstagramExtractor(
    config,
    { ytDlp: true, ffmpeg: false },
    {
      processRunner: async (_command, commandArgs) => {
        args = commandArgs;
        return {
          code: 0,
          stderr: "",
          stdout: JSON.stringify({
            title: "Carousel",
            channel: "Public creator",
            entries: [
              {
                id: "photo",
                title: "Photo",
                display_url: publicImage,
              },
              {
                id: "video",
                title: "Video",
                duration: 7,
                formats: [videoFormat],
              },
            ],
          }),
        };
      },
    },
  );
  const result = await extractor.inspect("https://www.instagram.com/p/ABC/");
  assert.ok(args.includes("--ignore-config"));
  assert.ok(!args.includes("--cookies-from-browser"));
  assert.equal(result.contentType, "carousel");
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].kind, "image");
  assert.equal(result.items[0].options[0].type, "image");
  assert.equal(result.items[1].kind, "video");
  assert.equal(result.items[1].options[0].type, "video");
  assert.equal(result.items[1].options[0].quality, "720p");

  const prepared = await extractor.prepareDownload(
    result.url,
    result.items[0].id,
    result.items[0].options[0].id,
  );
  assert.equal(prepared.info.raw.formats[0].url, publicImage);
  await extractor.close();
});

test("public photo links return a real image preview and original-image option", async () => {
  const result = await inspectFixture(
    "https://www.instagram.com/p/PHOTO/",
    {
      id: "photo",
      title: "Public photo",
      display_url: publicImage,
    },
  );
  assert.equal(result.contentType, "photo");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].thumbnail, publicImage);
  assert.equal(result.items[0].options[0].type, "image");
});

test("public reel links return a playable-media format and source quality", async () => {
  const result = await inspectFixture(
    "https://www.instagram.com/reel/REEL/",
    {
      id: "reel",
      title: "Public reel",
      duration: 12,
      thumbnail: publicImage,
      formats: [videoFormat],
    },
  );
  assert.equal(result.contentType, "reel");
  assert.equal(result.items[0].kind, "video");
  assert.equal(result.items[0].options[0].type, "video");
  assert.equal(result.items[0].options[0].quality, "720p");
});

test("public story links show the accessible story media", async () => {
  const result = await inspectFixture(
    "https://www.instagram.com/stories/public.creator/123/",
    {
      id: "story",
      title: "Public story",
      thumbnail: publicImage,
    },
  );
  assert.equal(result.contentType, "story");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].thumbnail, publicImage);
  assert.equal(result.items[0].options[0].type, "image");
});

test("public highlight links show each accessible story separately", async () => {
  const result = await inspectFixture(
    "https://www.instagram.com/stories/highlights/123/",
    {
      id: "highlight",
      title: "Public highlight",
      entries: [
        { id: "story-1", title: "Story 1", thumbnail: publicImage },
        { id: "story-2", title: "Story 2", thumbnail: publicImage },
      ],
    },
  );
  assert.equal(result.contentType, "highlight");
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map((item) => item.title), ["Story 1", "Story 2"]);
});

test("Instagram profile pictures are parsed only from public page metadata", async () => {
  const html = `<meta property="og:image" content="${publicImage}">`;
  const extractor = new InstagramExtractor(
    createConfig({ allowPrivateUrls: true }),
    { ytDlp: false, ffmpeg: false },
    { fetchImpl: async () => new Response(html, { status: 200 }) },
  );
  const result = await extractor.inspect("https://www.instagram.com/public.creator/");
  assert.equal(result.contentType, "profile");
  assert.equal(result.creator, "public.creator");
  assert.equal(result.items[0].thumbnail, publicImage);
  await extractor.close();
});

test("Instagram failures explain inaccessible content without suggesting cookie bypass", () => {
  const error = sourceError("ERROR: login required", "story");
  assert.equal(error.code, "INSTAGRAM_PRIVATE");
  assert.match(error.message, /only accesses public content/);
  assert.doesNotMatch(error.message, /GSD_COOKIES_FROM_BROWSER/);
  assert.equal(sourceError("ERROR: HTTP Error 429: Too Many Requests", "reel").code, "INSTAGRAM_RATE_LIMIT");
  assert.equal(sourceError("ERROR: HTTP Error 404: Not Found", "post").code, "INSTAGRAM_EXPIRED");
});

test("Instagram downloader arguments ignore user yt-dlp configuration and browser cookies", () => {
  const args = buildInstagramArgs(
    createConfig({
      cookiesFromBrowser: "firefox",
      tools: { node: "/node" },
    }),
    "https://www.instagram.com/p/ABC/",
  );
  assert.ok(args.includes("--ignore-config"));
  assert.ok(args.includes("node:/node"));
  assert.ok(!args.includes("--cookies-from-browser"));
});

test("profile-picture extraction ignores untrusted page image URLs", () => {
  assert.equal(
    profilePictureFromHtml('<meta property="og:image" content="https://evil.example/p.jpg">'),
    null,
  );
});
