const crypto = require("node:crypto");

function createLocalSecurityMiddleware({ config, getOrigin, getPort, sessions }) {
  return (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    const port = getPort();
    if (
      ![
        `${config.host}:${port}`,
        `127.0.0.1:${port}`,
        `localhost:${port}`,
        `[::1]:${port}`,
      ].includes(req.headers.host)
    )
      return res
        .status(403)
        .json({ error: "Invalid localhost host.", code: "FORBIDDEN" });
    if (req.path.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store");
      const requestOrigin = req.headers.origin;
      const allowed = new Set([
        getOrigin(),
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
  };
}

module.exports = { createLocalSecurityMiddleware };
