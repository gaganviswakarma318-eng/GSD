const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");
const { createConfig } = require("./config");
const { ApiError } = require("./utils/errors");
const { probeTools } = require("./utils/processes");
const { MetadataService } = require("./services/metadata");
const { DownloadManager } = require("./services/downloadManager");
const { PreviewManager } = require("./services/previewManager");

async function startServer(options = {}) {
  const config = createConfig(options);
  if (!["127.0.0.1", "localhost", "::1"].includes(config.host))
    throw new Error("GSD must bind to a localhost address.");
  const availability = options.availability || (await probeTools(config.tools));
  const metadata =
    options.metadata || new MetadataService(config, availability);
  const manager =
    options.manager ||
    new DownloadManager(config, metadata, options.managerDependencies);
  const previewManager =
    options.previewManager || new PreviewManager(config, metadata);
  await manager.initialize();
  await previewManager.initialize();
  const app = express();
  const server = http.createServer(app);
  const sessions = new Map();
  const streams = new Set();
  let origin;
  let closing;
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    const host = req.headers.host;
    const port = server.address()?.port;
    if (
      ![
        `${config.host}:${port}`,
        `127.0.0.1:${port}`,
        `localhost:${port}`,
        `[::1]:${port}`,
      ].includes(host)
    )
      return res
        .status(403)
        .json({ error: "Invalid localhost host.", code: "FORBIDDEN" });
    if (req.path.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store");
      const requestOrigin = req.headers.origin;
      const allowed = new Set([
        origin,
        `http://localhost:${port}`,
        `http://127.0.0.1:${port}`,
        `http://[::1]:${port}`,
      ]);
      if (
        (requestOrigin && !allowed.has(requestOrigin)) ||
        req.headers["sec-fetch-site"] === "cross-site"
      )
        return res.status(403).json({
          error: "Cross-site requests are not allowed.",
          code: "FORBIDDEN",
        });
      if (
        !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        !req.is("application/json")
      )
        return res
          .status(415)
          .json({ error: "Send application/json.", code: "BAD_CONTENT_TYPE" });
      const cookie = /(?:^|;\s*)gsd_session=([a-f0-9]{64})(?:;|$)/.exec(
        req.headers.cookie || "",
      );
      let sessionId = cookie?.[1];
      if (!sessionId || !sessions.has(sessionId)) {
        sessionId = crypto.randomBytes(32).toString("hex");
        sessions.set(sessionId, Date.now());
      }
      sessions.set(sessionId, Date.now());
      res.setHeader(
        "Set-Cookie",
        `gsd_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/`,
      );
      req.sessionId = sessionId;
    }
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  app.get("/api/health", (req, res) =>
    res.json({
      name: "GSD",
      ready: true,
      tools: availability,
      concurrency: config.concurrency,
      maxPending: config.maxPending,
      active: manager.active.size,
      queued: manager.queue.length,
    }),
  );
  app.post("/api/info", async (req, res) =>
    res.json((await metadata.get(req.body?.url)).public),
  );
  app.post("/api/previews", async (req, res) =>
    res.status(202).json(await previewManager.create(req.body?.url, req.sessionId)),
  );
  app.get("/api/previews/:id/file", (req, res, next) => {
    const record = previewManager.beginDelivery(req.params.id, req.sessionId);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      void previewManager
        .finishDelivery(record)
        .catch((error) => console.error("GSD preview cleanup:", error.message));
    };
    res.once("close", finish);
    res.once("error", finish);
    res.sendFile(record.filePath, { dotfiles: "deny" }, (error) => {
      finish();
      if (error && !res.headersSent && !res.destroyed)
        next(
          new ApiError(
            "Unable to play the video preview. Try preparing it again.",
            500,
            "PREVIEW_DELIVERY_ERROR",
          ),
        );
    });
  });
  app.get("/api/previews/:id", (req, res) =>
    res.json(previewManager.get(req.params.id, req.sessionId)),
  );
  app.delete("/api/previews/:id", async (req, res) =>
    res.json(await previewManager.remove(req.params.id, req.sessionId)),
  );
  app.get("/api/jobs", (req, res) => res.json(manager.list(req.sessionId)));
  app.post("/api/jobs", async (req, res) =>
    res.status(201).json(await manager.create(req.body || {}, req.sessionId)),
  );
  app.get("/api/jobs/:id", (req, res) =>
    res.json(manager.view(manager.owned(req.params.id, req.sessionId))),
  );
  app.post("/api/jobs/:id/cancel", async (req, res) =>
    res.json(await manager.cancel(req.params.id, req.sessionId)),
  );
  app.post("/api/jobs/:id/retry", async (req, res) =>
    res.json(await manager.retry(req.params.id, req.sessionId)),
  );
  app.post("/api/jobs/:id/delivered", async (req, res) =>
    res.json(await manager.acknowledgeDelivery(req.params.id, req.sessionId)),
  );
  app.get("/api/events", (req, res) => {
    if (streams.size >= 100)
      throw new ApiError(
        "Too many progress connections. Close another GSD tab.",
        429,
      );
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    streams.add(res);
    const send = (value) => {
      if (!res.writableEnded && !res.destroyed) {
        if (res.writableLength > 256 * 1024) return res.end();
        res.write(`data: ${JSON.stringify(value)}\n\n`);
      }
    };
    const changed = (owner, job) => {
      if (owner === req.sessionId) send(job);
    };
    res.write("retry: 1500\n\n");
    send(manager.list(req.sessionId));
    manager.events.on("change", changed);
    const heartbeat = setInterval(() => {
      sessions.set(req.sessionId, Date.now());
      res.write(": heartbeat\n\n");
    }, 15000);
    const cleanup = () => {
      clearInterval(heartbeat);
      manager.events.off("change", changed);
      streams.delete(res);
    };
    res.once("close", cleanup);
    res.once("error", cleanup);
  });
  app.get("/api/jobs/:id/events", (req, res) => {
    const record = manager.owned(req.params.id, req.sessionId);
    if (streams.size >= 100)
      throw new ApiError(
        "Too many progress connections. Close another GSD tab.",
        429,
      );
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    streams.add(res);
    const send = (value) => {
      if (!res.writableEnded && !res.destroyed) {
        // Disconnect slow clients; EventSource reconnects with a fresh snapshot.
        if (res.writableLength > 256 * 1024) return res.end();
        res.write(`data: ${JSON.stringify(value)}\n\n`);
      }
    };
    res.write("retry: 1500\n\n");
    send(manager.view(record));
    manager.events.on(record.id, send);
    const heartbeat = setInterval(() => {
      sessions.set(req.sessionId, Date.now());
      res.write(": heartbeat\n\n");
    }, 15000);
    const cleanup = () => {
      clearInterval(heartbeat);
      manager.events.off(record.id, send);
      streams.delete(res);
    };
    res.once("close", cleanup);
    res.once("error", cleanup);
  });
  const deliverArtifact = (kind) => (req, res, next) => {
    const record = manager.beginDelivery(req.params.id, req.sessionId, kind);
    const manualAcknowledgement =
      req.method === 'HEAD' || (kind === 'media' && req.headers["x-gsd-delivery-ack"] === "manual");
    let settled = false;
    const finish = (success) => {
      if (settled) return;
      settled = true;
      void manager
        .finishDelivery(record, success && !manualAcknowledgement, kind)
        .catch((error) => console.error("GSD file cleanup:", error.message));
    };
    res.once("close", () => finish(res.writableFinished));
    res.download(
      kind === 'thumbnail' ? record.sidecarPath : record.filePath,
      kind === 'thumbnail' ? record.sidecarFilename : record.filename,
      { dotfiles: "deny" },
      (error) => {
        finish(!error);
        if (error && !res.headersSent && !res.destroyed)
          next(
            new ApiError(
              "Unable to deliver the file. Retry saving it before it expires.",
              500,
              "DELIVERY_ERROR",
            ),
          );
      },
    );
  };
  app.get("/api/jobs/:id/file", deliverArtifact('media'));
  app.get("/api/jobs/:id/thumbnail", deliverArtifact('thumbnail'));
  app.use("/api", (req, res) =>
    res
      .status(404)
      .json({ error: "API endpoint not found.", code: "NOT_FOUND" }),
  );
  app.use(express.static(config.frontendPath, { index: "index.html" }));
  app.get(["/", "/clip"], (req, res) => {
    const index = path.join(config.frontendPath, "index.html");
    if (fs.existsSync(index)) return res.sendFile(index);
    return res
      .status(503)
      .send(
        "GSD frontend is not built. Run npm run build, then start GSD again.",
      );
  });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status =
      error.status || (error.type === "entity.parse.failed" ? 400 : 500);
    if (status >= 500) console.error("GSD API:", error.message);
    res.status(status).json({
      error:
        status === 500 && !(error instanceof ApiError)
          ? "GSD could not complete this request. Check the media tools and try again."
          : error.message,
      code: error.code || "SERVER_ERROR",
    });
  });
  server.requestTimeout = 120000;
  server.headersTimeout = 30000;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, config.host, resolve);
    });
  } catch (error) {
    await Promise.all([metadata.close(), manager.close(), previewManager.close()]);
    throw error;
  }
  origin = `http://${config.host === "::1" ? "[::1]" : config.host}:${server.address().port}`;
  const sessionSweeper = setInterval(() => {
    for (const [id, lastSeen] of sessions)
      if (
        Date.now() - lastSeen > 7 * 24 * 60 * 60 * 1000 &&
        !manager.hasActive(id)
      )
        sessions.delete(id);
  }, 60 * 1000);
  sessionSweeper.unref();
  const close = () => {
    if (closing) return closing;
    closing = (async () => {
      clearInterval(sessionSweeper);
      for (const stream of streams) stream.end();
      const stopped = new Promise((resolve) => server.close(resolve));
      server.closeIdleConnections?.();
      await Promise.all([
        metadata.close(),
        manager.close(),
        previewManager.close(),
      ]);
      server.closeAllConnections?.();
      await stopped;
    })();
    return closing;
  };
  return {
    app,
    server,
    url: origin,
    manager,
    metadata,
    previewManager,
    close,
    config,
  };
}

if (require.main === module) {
  startServer()
    .then((instance) => {
      console.log(`GSD is ready at ${instance.url}`);
      const shutdown = () => {
        void instance.close().then(() => process.exit(0));
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    })
    .catch((error) => {
      console.error(`GSD could not start: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { startServer };
