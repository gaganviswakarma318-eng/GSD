const express = require("express");
const { ApiError } = require("../utils/errors");

function createDownloadsRouter({ manager, sessions, streams }) {
  const router = express.Router();
  router.get("/api/jobs", (req, res) => res.json(manager.list(req.sessionId)));
  router.post("/api/jobs", async (req, res) =>
    res.status(201).json(await manager.create(req.body || {}, req.sessionId)),
  );
  router.get("/api/jobs/:id", (req, res) =>
    res.json(manager.view(manager.owned(req.params.id, req.sessionId))),
  );
  router.post("/api/jobs/:id/cancel", async (req, res) =>
    res.json(await manager.cancel(req.params.id, req.sessionId)),
  );
  router.post("/api/jobs/:id/retry", async (req, res) =>
    res.json(await manager.retry(req.params.id, req.sessionId)),
  );
  router.post("/api/jobs/:id/delivered", async (req, res) =>
    res.json(await manager.acknowledgeDelivery(req.params.id, req.sessionId)),
  );
  router.get("/api/events", (req, res) => {
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
  router.get("/api/jobs/:id/events", (req, res) => {
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
      req.method === "HEAD" ||
      (kind === "media" &&
        req.headers["x-gsd-delivery-ack"] === "manual");
    let settled = false;
    const finish = (success) => {
      if (settled) return;
      settled = true;
      void manager
        .finishDelivery(record, success && !manualAcknowledgement, kind)
        .catch((error) =>
          console.error("GSD file cleanup:", error.message),
        );
    };
    res.once("close", () => finish(res.writableFinished));
    res.download(
      kind === "thumbnail" ? record.sidecarPath : record.filePath,
      kind === "thumbnail" ? record.sidecarFilename : record.filename,
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
  router.get("/api/jobs/:id/file", deliverArtifact("media"));
  router.get("/api/jobs/:id/thumbnail", deliverArtifact("thumbnail"));
  return router;
}

module.exports = { createDownloadsRouter };
