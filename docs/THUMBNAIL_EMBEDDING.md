# Automatic thumbnail embedding

The existing local Node backend performs all artwork work. Electron and the browser interface use the same backend; no executable runs in a browser renderer. GSD is not a Chrome extension and has no Manifest V3 component.

## Controls and compatibility

Choose a media format after analyzing a link. **Embed Thumbnail** starts enabled for compatible formats and can be switched off. The format description explains support. Unsupported formats offer an unchecked **Save thumbnail separately** control. A missing thumbnail does not prevent downloading.

| Container | Artwork storage | Display considerations |
| --- | --- | --- |
| MP3 | ID3v2.3 APIC/front cover | Widely supported by music libraries and players. |
| M4A, M4B | MP4 cover artwork (`covr` through an attached picture) | Suitable for compatible music/audiobook library views. |
| MP4, M4V | MP4-family attached cover picture | Players may show the artwork in media information; video galleries can still choose a frame. |
| FLAC | Embedded picture block | Requires a player that reads FLAC pictures. |
| MKV, MKA | JPEG/PNG attachment named `cover.jpg`/`cover.png` | Requires Matroska attachment support; file-manager support is less consistent. |
| WebM, MOV, Ogg/Opus, WAV, raw AAC and other formats | Optional JPEG/PNG sidecar | These containers are not modified by this feature. Some formats have other artwork conventions that GSD does not implement. |

VLC reads ID3 attached pictures and MP4 `covr` artwork in its [metadata reader](https://github.com/videolan/vlc/blob/master/modules/meta_engine/taglib.cpp). Apple's [iTunes artwork guide](https://support.apple.com/en-euro/guide/itunes/itns3027/windows) describes artwork for music and video libraries. Windows' [thumbnail guidance](https://learn.microsoft.com/en-us/windows/apps/develop/files/thumbnails) distinguishes album art from video thumbnails. Android and iOS visibility depends on the app, supported codec and library import path; the feature does not guarantee that every gallery, Files app or player displays video cover art. These are compatibility expectations, not results from device testing.

## Processing and recovery

1. Existing yt-dlp metadata extraction supplies the source information and thumbnail candidates. Download attempts reuse `--load-info-json`; there is no second extractor lookup just for artwork.
2. The existing downloader obtains the exact selected source streams, merges them or converts to MP3 as requested.
3. A separate yt-dlp thumbnail-only operation obtains the highest ranked available thumbnail, with lower candidates as fallbacks. It does not download every thumbnail. Turning artwork and sidecar off skips this operation.
4. JPEG and PNG are retained; FFmpeg converts other decodable images to PNG without resizing or cropping. FFprobe checks image validity.
5. FFmpeg writes a separate candidate using stream copy, copies metadata and chapters, and fills absent title/artist/album information from extraction metadata. Existing values take priority. The original file is retained until the candidate passes validation and replaces it.
6. Thumbnail failure is nonfatal: the original downloaded media remains available and the finished job shows a warning. Missing tools, missing/corrupt artwork and remux failures follow this path. Cancellation propagates to the existing process-tree terminator and cancels the whole job.
7. Temporary images and candidate outputs are removed. Browser media delivery and optional sidecar delivery are tracked independently, so saving the media does not prematurely delete the image. The existing retention period applies if a sidecar is not saved. Desktop files use exclusive copies and never overwrite existing files; a sidecar copy failure warns without discarding saved media.

The existing progress component shows downloading, merging, audio conversion, processing thumbnail, embedding thumbnail and finalization. The manager cannot expose the file as completed until the runner and destination copy finish. Per-stage logs avoid source URLs and credentials.

The thumbnail implementation follows [yt-dlp's cover-art methods](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/postprocessor/embedthumbnail.py), [FFmpeg stream-copy and attached-picture options](https://ffmpeg.org/ffmpeg.html), and [Matroska attachment conventions](https://www.matroska.org/technical/attachments.html). It intentionally keeps unsupported containers in their original format.

MOV is deliberately sidecar-only: the bundled FFmpeg MOV muxer dropped the cover during a real test. GSD does not silently convert MOV to MP4 to work around this limitation.

## Files changed for this feature

Existing staged workspace changes were preserved. This list describes only the thumbnail feature changes.

| File | Change |
| --- | --- |
| `backend/services/thumbnail.js` | Container capability, cached-thumbnail retrieval, image validation/conversion, safe cover embedding and nonfatal recovery. |
| `backend/services/formats.js` | Exposes artwork capability on each existing format option. |
| `backend/services/downloader.js` | Runs artwork after media processing, reads structured yt-dlp postprocessor stages, removes source-info temporary file and returns artwork results. |
| `backend/services/downloadManager.js` | Validates/persists settings across queue/retry, carries stages/warnings, copies desktop sidecars and tracks independent browser artifact delivery. |
| `backend/server.js` | Adds the session-owned thumbnail delivery route using existing transfer protection. |
| `frontend/src/types.ts` | Types format support, thumbnail settings and job artwork results. |
| `frontend/src/api/client.ts` | Sends settings and builds the separate-thumbnail download action. |
| `frontend/src/hooks/useDownloads.ts` | Threads settings into existing job creation. |
| `frontend/src/App.tsx` | Connects controls, tool availability, thumbnail delivery and accessible completion warnings. |
| `frontend/src/components/DownloadComposer.tsx` | Adds default-on embedding control, capability text and unsupported-format sidecar choice. |
| `frontend/src/components/DownloadCard.tsx` | Shows processing stages, warnings, embedded-art result and sidecar save action/path. |
| `frontend/src/components/QueuePanel.tsx` | Passes the thumbnail save action to existing download cards. |
| `frontend/src/styles.css` | Styles the new controls and warnings using the existing design and theme. |
| `backend/tests/thumbnail.test.js` | Exercises capability, safe processing, fallback, cancellation and cleanup. |
| `backend/tests/downloadManager.test.js` | Checks settings, processing completion gate, independent sidecar delivery and destination collision behavior. |
| `backend/tests/downloader.test.js` | Verifies finalization and structured merging/conversion stages without changing existing download-progress expectations. |
| `frontend/tests/client.test.cjs` | Verifies thumbnail settings in API requests. |
| `frontend/tests/progress.test.cjs` | Verifies stage/warning rendering, controls and sidecar availability. |
| `frontend/tests/thumbnail.test.cjs` | Exercises supported-format defaults, opt-out, sidecar choice and missing-tool messages through the actual composer. |
| `tests/media.integration.cjs` | Uses real yt-dlp, FFmpeg and FFprobe to validate artwork and source preservation. |
| `README.md`, `VERIFICATION.md`, `docs/THUMBNAIL_EMBEDDING.md` | Describe behavior, compatibility, checks and manual testing. |

## Test locally

Use the existing prepared tools under `backend/binaries` (or the existing `GSD_*_PATH` overrides).

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:media
npm.cmd run desktop
```

The media suite uses generated local fixtures, not external media providers. It checks actual attached pictures/attachments, picture dimensions, unchanged audio/video stream hashes, existing metadata, unsupported-format preservation, optional sidecar delivery, missing/corrupt artwork, disabled artwork and cancellation. Unit tests cover injected tool failures and manager lifecycle races.

For a manual check, use a permitted public media page with artwork and select MP3, M4A and MP4 in turn. Leave **Embed Thumbnail** enabled; wait for finalization and confirm the finished row reports embedded artwork. Inspect each file in a compatible player, then repeat with the checkbox off. For WebM, enable **Save thumbnail separately** and confirm a separate image appears beside desktop media or via **Save thumbnail** in the browser. Cancel a job during artwork processing and confirm it stops before the next queued job takes its slot.

To inspect a result directly:

```powershell
backend/binaries/ffprobe.exe -v error -show_streams -show_format -of json 'path/to/download.mp4'
```

MP3/M4A/MP4 should expose an image stream with `disposition.attached_pic: 1`; MKV should expose an attachment with a cover filename and image MIME type. Container inspection verifies storage independently from player display.
