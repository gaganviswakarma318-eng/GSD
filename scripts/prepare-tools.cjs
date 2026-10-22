/* Downloads only pinned upstream releases. No executable is run before its SHA-256 passes. */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createReadStream, createWriteStream } = require('node:fs');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const pins = require('../build/tool-versions.json');
const root = path.resolve(__dirname, '..');
const cache = path.join(root, 'work', 'tool-downloads');
const destination = path.join(root, 'backend', 'binaries');
const runFile = promisify(execFile);

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}

async function download(url, file) {
  const temporary = `${file}.partial`;
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60_000), headers: { 'User-Agent': 'GSD-build/1.0' } });
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status} ${url}`);
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}

async function verifiedDownload(name, pin) {
  const file = path.join(cache, path.basename(new URL(pin.url).pathname));
  try { if (await sha256(file) === pin.sha256) return file; } catch { /* Not cached. */ }
  console.log(`Downloading ${name} ${pin.version} from its pinned upstream release...`);
  // Verify the fixed digest against upstream's checksum file as well as the downloaded bytes.
  const response = await fetch(pin.manifest, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Cannot fetch ${name} checksum manifest: HTTP ${response.status}`);
  const manifest = await response.text();
  const line = pin.manifestType === 'github-release'
    ? JSON.parse(manifest).assets.find((asset) => asset.name === pin.manifestName)?.digest || ''
    : manifest.split(/\r?\n/).find((entry) => entry.includes(pin.manifestName)) || manifest.trim();
  if (!line.toLowerCase().includes(pin.sha256)) throw new Error(`${name}: pinned SHA-256 disagrees with upstream. Review build/tool-versions.json before upgrading.`);
  await fs.writeFile(path.join(cache, `${name}-${pin.version}-SHA256.txt`), manifest);
  await download(pin.url, file);
  if (await sha256(file) !== pin.sha256) {
    await fs.rm(file, { force: true });
    throw new Error(`${name} SHA-256 mismatch. The download was removed; rerun to download again.`);
  }
  return file;
}

async function find(fileName, directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) return file;
    if (entry.isDirectory()) { const found = await find(fileName, file); if (found) return found; }
  }
  return undefined;
}

async function license(pin, file) {
  const target = path.join(destination, 'licenses', file);
  try { await fs.access(target); return; } catch { /* first preparation */ }
  await download(pin.license, target);
}

async function prepare() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This preparation targets Windows x64. Build the Windows installer on Windows x64.');
  await fs.mkdir(cache, { recursive: true });
  await fs.mkdir(path.join(destination, 'licenses'), { recursive: true });
  const [ytDlp, ffmpeg, node] = await Promise.all([
    verifiedDownload('yt-dlp', pins.ytDlp), verifiedDownload('FFmpeg', pins.ffmpeg), verifiedDownload('Node', pins.node),
  ]);
  await fs.copyFile(ytDlp, path.join(destination, 'yt-dlp.exe'));
  await fs.copyFile(node, path.join(destination, 'node.exe'));
  const extractRoot = await fs.mkdtemp(path.join(cache, `ffmpeg-${pins.ffmpeg.version}-`));
  try {
    const quoted = (value) => `'${value.replaceAll("'", "''")}'`;
    await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory(${quoted(ffmpeg)}, ${quoted(extractRoot)})`], { windowsHide: true, timeout: 5 * 60_000, maxBuffer: 1024 * 1024 });
    for (const name of ['ffmpeg.exe', 'ffprobe.exe']) {
      const file = await find(name, extractRoot);
      if (!file) throw new Error(`The pinned FFmpeg archive does not contain ${name}.`);
      await fs.copyFile(file, path.join(destination, name));
    }
    for (const name of ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'README.txt']) {
      const file = await find(name, extractRoot);
      if (file) await fs.copyFile(file, path.join(destination, 'licenses', `FFmpeg-${name.replaceAll('.', '-')}.txt`));
    }
  } finally {
    const relative = path.relative(path.resolve(cache), path.resolve(extractRoot));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe extraction cleanup path.');
    await fs.rm(extractRoot, { recursive: true, force: true });
  }
  await Promise.all([license(pins.ytDlp, 'yt-dlp-LICENSE.txt'), license(pins.node, 'Node-LICENSE.txt')]);
  await fs.writeFile(path.join(destination, 'licenses', 'THIRD-PARTY-NOTICES.txt'), `GSD bundles these unmodified Windows x64 tools:\n\nyt-dlp ${pins.ytDlp.version}\n${pins.ytDlp.url}\nSource and license: ${pins.ytDlp.source}\n\nFFmpeg and FFprobe ${pins.ffmpeg.version}, Gyan Essentials GPL static build\n${pins.ffmpeg.url}\nBuild documentation and corresponding sources: ${pins.ffmpeg.source}\nFFmpeg upstream sources: https://ffmpeg.org/releases/ffmpeg-${pins.ffmpeg.version}.tar.xz\nFFmpeg GPL license accompanies this build. See the build configuration (-buildconf) for linked libraries.\n\nNode.js ${pins.node.version}\n${pins.node.url}\nSource, license and bundled dependency notices: ${pins.node.source}\n\nElectron and application package dependency license notices are retained in the installed application.\n`);
  const files = {};
  for (const name of ['yt-dlp.exe', 'ffmpeg.exe', 'ffprobe.exe', 'node.exe']) files[name] = await sha256(path.join(destination, name));
  await fs.writeFile(path.join(destination, 'versions.json'), `${JSON.stringify({ ...pins, files }, null, 2)}\n`);
  console.log('Verified bundled tools prepared in backend/binaries.');
}

prepare().catch((error) => { console.error(`GSD media tool preparation failed: ${error.message}`); process.exitCode = 1; });
