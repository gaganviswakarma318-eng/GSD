const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const { ApiError } = require("./utils/errors");
const { createLocalSecurityMiddleware } = require("./middleware/localSecurity");
const { createHealthRouter } = require("./routes/health");
const { createMediaRouter } = require("./routes/media");
const { createInstagramRouter } = require("./routes/instagram");
const { createDownloadsRouter } = require("./routes/downloads");

function createApp({
  config,
  availability,
  metadata,
  manager,
  instagram,
  sessions,
  streams,
  getOrigin,
  getPort,
}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    createLocalSecurityMiddleware({ config, getOrigin, getPort, sessions }),
  );
  app.use(express.json({ limit: "16kb" }));
  app.use(createHealthRouter({ availability, config, manager }));
  app.use(createMediaRouter({ metadata }));
  app.use(createInstagramRouter({ instagram, manager }));
  app.use(createDownloadsRouter({ manager, sessions, streams }));
  app.use("/api", (req, res) =>
    res
      .status(404)
      .json({ error: "API endpoint not found.", code: "NOT_FOUND" }),
  );
  app.use(express.static(config.frontendPath, { index: "index.html" }));
  app.get(
    [
      "/",
      "/home",
      "/universal",
      "/instagram",
      "/clip",
      "/processing",
      "/library",
      "/settings",
    ],
    (req, res) => {
      const index = path.join(config.frontendPath, "index.html");
      if (fs.existsSync(index)) return res.sendFile(index);
      return res
        .status(503)
        .send(
          "GSD frontend is not built. Run npm run build, then start GSD again.",
        );
    },
  );
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
  return app;
}

module.exports = { createApp };
