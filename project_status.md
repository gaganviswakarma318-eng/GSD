# Project Status

## Clip Downloader

- **Goal:** Add a clip-download workflow alongside the existing full-media downloader, with responsive forms and clip jobs handled by the existing queue and delivery lifecycle.
- **Progress:** Implemented and verified with backend unit tests, a production build, responsive browser checks and real local yt-dlp/FFmpeg clip extraction.
- **Design decisions:** Reuse the current metadata lookup, format choices, save-location behavior, job queue, yt-dlp runner, progress events, cancellation, retry and delivery paths. Represent a clip as validated start/end seconds on the job and use yt-dlp section downloading with FFmpeg for extraction.
- **Known limitations:** Clip cutting depends on source support and FFmpeg. Accurate cut boundaries may require re-encoding and take longer than a full-format download.
