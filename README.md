# GSD

Music and video, saved simply. GSD uses React, TypeScript and Vite for its interface, Express for a local download service, yt-dlp for extraction, FFmpeg for merging/audio conversion, and Electron for the Windows desktop app.

This is an implementation of the existing GSDM project. The original preview, audio/video workflow, yt-dlp integration, metadata caching, progress updates and FIFO queue have been retained and rebuilt around independent download jobs. The old request-bound download lifecycle and unreliable Windows pause signals have been removed.

## Install on Windows

Use the generated `GSD-Setup-2.0.0-x64.exe` installer in `release/`. It includes Electron's application runtime, standalone yt-dlp, FFmpeg/FFprobe and a Node runtime for yt-dlp's JavaScript challenges. End users do not need Node.js, Python, a terminal or separate media tools.

1. Run the installer and choose an installation folder.
2. Launch **GSD** from the Start menu or desktop shortcut.
3. Paste a supported single-media URL and select **Find media**.
4. Choose Audio or Video, an available format and source quality.
5. Choose a save folder with the native picker and start the download.

The build is unsigned. Windows may display a publisher/SmartScreen prompt. For signed distribution, enable `win.signExecutable` in `electron-builder.yml` and configure a code-signing certificate. Windows x64 is the packaged target; other platforms have not been packaged.

## Develop

Requirements: Windows x64, Node.js 24 or newer, npm, and network access for dependency/media-tool downloads. The lockfile pins the application dependency tree.

```powershell
npm ci
npm run prepare:tools
npm run dev
```

Open `http://127.0.0.1:5173`. The Vite development server proxies `/api` to the Express backend at port 3000. `npm run dev:server` and `npm run dev:ui` can also be run separately. The backend always defaults to loopback.

For the production browser interface:

```powershell
npm run build
npm run web
```

Open `http://127.0.0.1:3000`. The same built React interface is served by Express. Browser downloads use a save picker where the browser supports it, or the browser's configured download location. Browsers cannot grant a server arbitrary access to a local folder. Enable “Ask where to save each file” in browser settings when using the standard download fallback.

For the desktop app during development:

```powershell
npm run desktop
```

## Build a Windows installer

```powershell
npm ci
npm run build:win
```

`prepare:tools` downloads pinned Windows x64 media tools and Node, verifies SHA-256 digests, extracts FFmpeg and retains distribution notices. The installer bundles these files outside `app.asar` as executable resources. Do not omit this step or substitute shared FFmpeg executables without their required DLLs. The build downloads Electron and NSIS tooling on the first run.

`npm run build:unpacked` produces an unpacked application for local testing. The installer and unpacked app are generated under `release/`. Publishing is disabled in build commands. No commit, push or release upload is part of these commands.

A restricted build environment can direct caches to writable folders before installation/build:

```powershell
$env:electron_config_cache = Join-Path (Get-Location) 'work/electron-cache'
$env:ELECTRON_BUILDER_CACHE = Join-Path (Get-Location) 'work/builder-cache'
$env:TEMP = Join-Path (Get-Location) 'work/cache'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force $env:TEMP | Out-Null
```

If Electron is already extracted and the build environment cannot use its default cache, append `-- --config.electronDist=node_modules/electron/dist` to `npm run build:win` to package the installed Electron distribution.

## Structure

- `frontend/src/components/`: accessible media form, preview and download rows.
- `frontend/src/hooks/`: metadata and download state, SSE updates and recovery.
- `frontend/src/api/`: typed HTTP calls and streaming/file delivery.
- `backend/server.js`: Express API, session ownership, static interface and startup/shutdown.
- `backend/config.js`: paths, process limits and environment configuration.
- `backend/services/`: bounded job manager, metadata cache, actual source formats and yt-dlp execution.
- `backend/utils/`: process-tree termination, validation and errors.
- `backend/tests/`: queue, retry, cancellation, lifecycle and API regressions.
- `electron/`: isolated preload bridge, native folder grants and desktop lifecycle.
- `scripts/`: development launcher and verified tool preparation.
- `electron-builder.yml`: Windows packaging configuration.

Only Express, React and React DOM are application dependencies. Child processes keep extraction, conversion and download work off the interface thread. Downloads use exact source format IDs; MP3 requires audio extraction/conversion and FFmpeg. Native formats and compatible video/audio merges avoid transcoding. Quality options describe the actual source rather than an invented resolution or bitrate.

## Download lifecycle

A metadata lookup is cached and identical pending lookups share one operation. Each job records its selected option, owner session, attempt, progress and final file independently of HTTP requests. SSE reconnects receive a current snapshot. Refreshing the page restores jobs owned by the same session while the backend is still running.

Two jobs run concurrently by default and at most 20 wait in FIFO order. Each attempt uses a unique temporary directory. Cancellation terminates the process tree on Windows (including FFmpeg), waits for exit and removes only that attempt's files. Retry reuses the job ID, refreshes metadata, resets progress and joins the bounded queue; the same progress/file routes remain valid.

Active and queued jobs have no idle expiration. Finished browser files remain available for one hour for delivery, then expire. Successful file delivery removes temporary artifacts; interrupted delivery can be retried within the retention period. Desktop downloads are copied to an exclusively created destination filename so existing files are never overwritten, then temporary files are removed. Failed/cancelled attempts are cleaned up. Shutdown cancels pending work and removes this instance's temporary workspace. The job list is in memory; application restart does not resume jobs or restore history.

Pause/resume is intentionally unavailable because suspending yt-dlp/FFmpeg with Unix process signals is unreliable on Windows. Cancel and retry are supported.

## Configuration

| Setting | Purpose |
| --- | --- |
| `PORT` | Browser backend port (default 3000); desktop always selects an available port. |
| `GSD_CONCURRENCY` | Active downloads, from 1 to 4 (default 2). |
| `GSD_MAX_PENDING` | Waiting jobs, from 1 to 100 (default 20). |
| `GSD_TEMP_DIR` | Writable temporary root for browser mode. |
| `GSD_BINARIES_DIR` | Development tools directory. |
| `GSD_YTDLP_PATH` | Explicit yt-dlp executable override. |
| `GSD_FFMPEG_PATH` | Explicit FFmpeg executable override. |
| `GSD_FFPROBE_PATH` | Explicit FFprobe executable override. |
| `GSD_NODE_PATH` | Explicit JavaScript runtime executable override. |

Desktop paths use packaged resources for executables and writable app/temp directories for runtime files. Startup waits for tool checks and backend readiness before opening the interface. A failed startup shows a native error message. Closing the app stops its backend and media processes. The native bridge exposes folder selection and revealing files saved by completed jobs, without exposing filesystem or shell APIs to the renderer.

This is a local application, not a public multi-user download service. Session cookies and same-origin checks protect local job actions. Public deployment, remote access, authentication, durable storage and operation behind a reverse proxy require a separate deployment design.

## Verification

```powershell
npm run typecheck
npm test
npm run build
npm run test:media
npm run build:win
npm run smoke:desktop -- --capture
```

`test:media` runs the real bundled yt-dlp, FFmpeg and FFprobe against generated local media. Its private-URL allowance is scoped to the in-process test server; normal GSD rejects local network media URLs. It verifies concurrent MP4/MP3 downloads, source preservation, browser delivery acknowledgments, queueing, cancellation, retry delivery, directory collision avoidance, session ownership and SSE updates. Unit tests use a virtual clock for long-running sessions and expiry; they do not wait for days.

`smoke:desktop` exercises the packaged app; use `node scripts/smoke-desktop.cjs --dev --capture` to test the development Electron entry. It checks bundled tool startup, an available localhost port, backend readiness, secure preload bridge, rendered interface and clean shutdown. Screenshots and JSON/log reports are written to ignored `work/` folders.

See `VERIFICATION.md` for the checks performed for this implementation and any remaining limits.

## Maintenance

Update tool pins and hashes in the preparation manifest/script together, from the upstream release manifests; run preparation again and rebuild the installer. yt-dlp extractors can break when media providers change. Do not overwrite executables inside an installed application while a download is active. Ship updates as a newly built installer. Keep Electron on a supported security release and refresh the npm lockfile deliberately.

Upstream references: [yt-dlp usage and supported sites](https://github.com/yt-dlp/yt-dlp), [FFmpeg Windows build sources](https://ffmpeg.org/download.html#build-windows), [Node releases](https://nodejs.org/en/download), and [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).

Unsupported, removed, private, region-restricted, DRM-protected, live/upcoming or authentication-required media can fail even if a site has an extractor. This app does not bypass DRM or handle account cookies. Playlists are not supported. Download media you own or have permission to save.

Third-party tool notices and source links are included in the installed resources. See `build/THIRD-PARTY-NOTICES.md` and the prepared tool notices for distribution details. The application package retains the original repository's ISC license declaration.
