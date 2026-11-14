const http = require("node:http");
const { createApp } = require("./app");
const { createConfig } = require("./config");
const { probeTools } = require("./utils/processes");
const { MetadataService } = require("./services/yt-dlp/metadata");
const { DownloadManager } = require("./services/downloadManager");
const { InstagramExtractor } = require("./services/instagram");

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
  const instagram =
    options.instagram ||
    new InstagramExtractor(config, availability, options.instagramDependencies);
  await manager.initialize();
  const sessions = new Map();
  const streams = new Set();
  let origin;
  let server;
  let closing;
  const app = createApp({
    config,
    availability,
    metadata,
    manager,
    instagram,
    sessions,
    streams,
    getOrigin: () => origin,
    getPort: () => server?.address()?.port,
  });
  server = http.createServer(app);
  server.requestTimeout = 120000;
  server.headersTimeout = 30000;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, config.host, resolve);
    });
  } catch (error) {
    await Promise.all([metadata.close(), manager.close(), instagram.close()]);
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
      await Promise.all([metadata.close(), manager.close(), instagram.close()]);
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
    instagram,
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
