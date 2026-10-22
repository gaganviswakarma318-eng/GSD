# Verification — GSD 2.0.0

Validated on Windows x64 on 22 October 2026.

## Automated checks

- `npm run typecheck`: passed, strict TypeScript for the React application.
- `npm test`: 17 passed, 0 failed. Covers bounded FIFO concurrency, pending limits, queued/active cancellation, slot retention until processes stop, retries with stable IDs/subscriptions, long-running active sessions with a virtual clock, terminal expiry, isolated temporary directories, native filename collisions, manual delivery acknowledgments and transfer races, Windows-safe filenames, source-derived formats, conversion arguments, progress parsing, unsafe URL rejection, metadata caching/deduplication/concurrency, real Windows child/grandchild process termination, initial cookie establishment, denied file handles, disk-write failures and acknowledgment retries.
- `npm run build`: passed. Vite production bundle: about 250 kB JavaScript (78 kB gzip) and 23 kB CSS (6 kB gzip).
- JavaScript syntax checks: passed for backend, Electron and build/development scripts.
- `npm audit --omit=dev`: 0 reported vulnerabilities at verification time.
- `npm run prepare:tools`: passed. Pinned upstream SHA-256 checks for yt-dlp 2026.10.21, FFmpeg/FFprobe 9.0.2 and Node 24.22.1. Package integrity hook verifies prepared executable hashes before packaging.

## Real media integration

`npm run test:media` passed using the actual bundled Windows executables and a generated three-second H.264/AAC MP4 served by an in-process local fixture server. Local-address allowance exists only in this test server's configuration.

Verified:

1. Real yt-dlp metadata extraction and FFprobe enrichment of source streams.
2. Actual MP4 source and MP3 conversion options, without invented qualities.
3. Simultaneous MP4 and MP3 downloads.
4. MP4 output byte-for-byte identical to the original; FFprobe confirms the converted audio is MP3.
5. SSE completion and owner-wide updates throughout queueing, cancellation and retry.
6. Browser file delivery with explicit acknowledgment after a committed disk write.
7. Two concurrent directory saves with separate names; an existing file remains unchanged.
8. A real two-slot FIFO queue, queued cancellation and active Windows yt-dlp process cancellation.
9. Cancellation waits for termination, cleans the attempt and releases its slot.
10. Retry keeps the ID, increments the attempt, refreshes metadata, restores progress and delivers a valid resulting file.
11. Session isolation and cross-origin rejection.

Online extractor check: the bundled yt-dlp successfully retrieved title, thumbnail, duration and 61 source formats for the official Blender Foundation Big Buck Bunny YouTube video (`aqz-KE-bpKQ`). This was a metadata check; its full download was not part of the fixture tests. An older upstream test-video ID was unavailable and correctly returned a source error.

## Desktop and packaging

Normal sandboxed Electron development startup passed with all bundled tools, dynamic localhost backend, loaded React interface, isolated preload bridge and a clean shutdown. Desktop (1180×840) and narrow (400×760) screenshots were visually checked. The narrow layout scrolls without horizontal clipping.

`npm run build:win -- --config.electronDist=node_modules/electron/dist` passed and produced `release/GSD-Setup-2.0.0-x64.exe` (210,466,023 bytes). The local Electron distribution override reused the verified npm-installed runtime; the application remains fully self-contained for end users.

The final installer was silently installed into a unique test directory. Setup exited 0 and created the application, Desktop/Start menu shortcuts and its uninstall registry entry. The installed executable then passed its smoke test with `packaged: true`, all four bundled tools, normal renderer sandbox settings, a ready API/interface, working preload bridge and clean shutdown. Its localhost port closed and its jobs directory was empty afterward. Silent uninstall exited 0; the installation folder, generated shortcuts and uninstall registry entry were removed. The installer wizard's interactive clicks were not manually exercised.

Eleven backend/Electron source files, including the Windows cancellation helper, were compared byte-for-byte with their packaged ASAR entries and matched the final workspace sources. All expected frontend assets and tool notices were packaged.

The browser interface was separately exercised against a real public YouTube URL: entering a link, requesting metadata, showing its thumbnail/title, inspecting source video resolutions, switching to Audio and selecting MP3 with the correct conversion note all passed. A preview is saved in `docs/gsd-preview.png`.

Detailed test evidence is retained in the local checkout's ignored `work/media-integration/result.json`, `work/installer-test-1792687015008/result.json` and `work/desktop-smoke-1792687133469/result.json`. These intermediate logs are excluded from the distributable source archive.

Earlier restricted-sandbox attempts could not launch Chromium or reach loopback. After the execution environment permitted normal Windows process/network operations, the same app launched with `sandbox: true`, `contextIsolation: true` and `nodeIntegration: false`. No sandbox-disabling launch flags are used by GSD.

## Practical limits

- The installer is unsigned. Signing and publisher reputation were not verified.
- Not every yt-dlp extractor/provider was tested. Private, sign-in-required, DRM, live/upcoming and region-restricted sources are not supported by this interface; providers can change their extraction behavior.
- Long-running session retention was exercised with a virtual clock, alongside real short downloads; no multi-day wall-clock download was performed.
- Pause/resume and persistent restart recovery are not implemented. Cancellation/retry work; active jobs/history are in memory.
- The native folder dialog and browser-specific save prompts still depend on the OS/browser. Automated integration covers the resulting directory grants and file writes; it does not claim every browser/OS dialog was manually exercised.
- Full Windows ARM64, macOS and Linux installation are unverified. This installer targets Windows x64.

No commits, pushes, publishing or remote repository mutations were performed.
