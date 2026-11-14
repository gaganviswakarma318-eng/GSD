const express = require("express");
const { ApiError } = require("../utils/errors");
const { MAX_EXTRACTED_ITEMS } = require("../services/instagram");

function requestAbortController(req, res) {
  const controller = new AbortController();
  const onAborted = () => controller.abort();
  const onClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  req.once("aborted", onAborted);
  res.once("close", onClose);
  return {
    signal: controller.signal,
    close() {
      req.off("aborted", onAborted);
      res.off("close", onClose);
    },
  };
}

function createInstagramRouter({ instagram, manager }) {
  const router = express.Router();
  router.post("/api/instagram/info", async (req, res) => {
    const request = requestAbortController(req, res);
    try {
      res.json(await instagram.inspect(req.body?.url, request.signal));
    } finally {
      request.close();
    }
  });
  router.post("/api/instagram/jobs", async (req, res) => {
    const { url, items, saveToken } = req.body || {};
    if (
      typeof url !== "string" ||
      !Array.isArray(items) ||
      items.length < 1 ||
      items.length > MAX_EXTRACTED_ITEMS ||
      items.some(
        (item) =>
          !item ||
          typeof item.itemId !== "string" ||
          item.itemId.length > 300 ||
          typeof item.optionId !== "string" ||
          item.optionId.length > 100,
      )
    )
      throw new ApiError(
        "Choose at least one valid Instagram media item to download.",
        400,
        "INVALID_INSTAGRAM_SELECTION",
      );
    const request = requestAbortController(req, res);
    try {
      const extracted = await instagram.extract(url, request.signal);
      const jobs = [];
      const errors = [];
      for (const selection of items) {
        if (request.signal.aborted) break;
        try {
          const prepared = await instagram.prepareDownload(
            extracted.url,
            selection.itemId,
            selection.optionId,
            extracted,
          );
          const job = await manager.createFromInfo(
            prepared.info,
            {
              url: extracted.url,
              optionId: selection.optionId,
              saveToken,
              embedThumbnail: false,
              thumbnailSidecar: false,
            },
            req.sessionId,
            {
              source: "instagram",
              refreshMetadata: prepared.refresh,
            },
          );
          jobs.push(job);
        } catch (error) {
          errors.push({
            itemId: selection.itemId,
            error:
              error instanceof ApiError
                ? error.message
                : "This Instagram item could not be queued.",
          });
        }
      }
      if (!request.signal.aborted)
        res.status(errors.length ? 207 : 201).json({ jobs, errors });
    } finally {
      request.close();
    }
  });
  return router;
}

module.exports = { createInstagramRouter, requestAbortController };
