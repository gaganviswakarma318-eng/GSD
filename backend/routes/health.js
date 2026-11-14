const express = require("express");

function createHealthRouter({ availability, config, manager }) {
  const router = express.Router();
  router.get("/api/health", (req, res) =>
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
  return router;
}

module.exports = { createHealthRouter };
