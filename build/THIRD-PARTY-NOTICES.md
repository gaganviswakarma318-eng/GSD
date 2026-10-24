# GSD bundled media tools

The Windows package contains unmodified executables from the pinned releases in `tool-versions.json`. Preparation checks SHA-256 against both the checked-in pin and the upstream checksum manifest or GitHub release digest. Executables, their version/hash manifest, and accompanying license texts are installed under `resources/binaries/`.

| Tool               | Release                                   | Upstream notices and source                                                                                                                                  |
| ------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| yt-dlp             | 2026.10.21                                | [yt-dlp source and license](https://github.com/yt-dlp/yt-dlp/tree/2026.10.21)                                                                                |
| FFmpeg and FFprobe | 9.0.2, Gyan Essentials static GPLv3 build | [Gyan build information and linked libraries](https://www.gyan.dev/ffmpeg/builds/), [FFmpeg source release](https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz) |
| Node.js            | 24.22.1                                   | [Node source release](https://nodejs.org/dist/v24.22.1/), [license and bundled dependency notices](https://github.com/nodejs/node/blob/v24.22.1/LICENSE)     |

FFmpeg runs as a separate child process. Its original license and readme are copied from the downloaded archive. `ffmpeg -buildconf` identifies the configuration and external libraries of the exact binary. When distributing a release publicly, retain the corresponding tool sources, build configuration, and dependency notices alongside the release in accordance with their licenses. The upstream binaries remain subject to their own licenses; GSD's license declaration does not replace them.

Electron's license and Chromium notices are retained by electron-builder. Node's license includes its dependency notices. Application dependency licenses remain in the package. Generated icons in this repository are original code-native GSD assets created by `scripts/create-icon.cjs`.
