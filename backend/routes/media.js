const express = require("express");

function createMediaRouter({ metadata }) {
  const router = express.Router();
  router.post("/api/info", async (req, res) =>
    res.json((await metadata.get(req.body?.url)).public),
  );
  return router;
}

module.exports = { createMediaRouter };
