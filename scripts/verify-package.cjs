const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createReadStream } = require('node:fs');
const pins = require('../build/tool-versions.json');

module.exports = async function verifyPackage(context) {
  const root = context.packager.projectDir;
  const binaries = path.join(root, 'backend', 'binaries');
  const manifest = JSON.parse(await fs.readFile(path.join(binaries, 'versions.json'), 'utf8').catch(() => { throw new Error('Bundled tool manifest missing. Run npm run prepare:tools before packaging.'); }));
  if (process.platform === 'linux') {
    if (manifest.platform !== 'linux-x64' ||
      manifest.linuxYtDlp?.version !== pins.linuxYtDlp.version ||
      manifest.linuxYtDlp?.sha256 !== pins.linuxYtDlp.sha256 ||
      manifest.linuxNode?.version !== pins.linuxNode.version ||
      manifest.linuxNode?.sha256 !== pins.linuxNode.sha256) {
      throw new Error('The prepared Linux tools differ from build/tool-versions.json. Run npm run prepare:tools:linux.');
    }
    for (const name of ['yt-dlp', 'node']) {
      const file = path.join(binaries, name);
      const hash = crypto.createHash('sha256');
      for await (const bytes of createReadStream(file)) hash.update(bytes);
      if (hash.digest('hex') !== manifest.files[name]) throw new Error(`Bundled ${name} was modified after preparation. Run npm run prepare:tools:linux.`);
      const stat = await fs.stat(file);
      if ((stat.mode & 0o111) === 0) throw new Error(`Bundled ${name} is not executable. Run npm run prepare:tools:linux.`);
    }
    await Promise.all([
      fs.access(path.join(root, 'dist', 'frontend', 'index.html')),
      fs.access(path.join(root, 'build', 'icon.png')),
      fs.access(path.join(binaries, 'licenses', 'THIRD-PARTY-NOTICES.txt')),
      fs.access(path.join(binaries, 'licenses', 'Node-LICENSE.txt')),
      fs.access(path.join(binaries, 'licenses', 'yt-dlp-LICENSE.txt')),
    ]);
    return;
  }
  for (const name of ['ytDlp', 'ffmpeg', 'node']) {
    if (manifest[name]?.version !== pins[name].version || manifest[name]?.sha256 !== pins[name].sha256) throw new Error(`The prepared ${name} release differs from build/tool-versions.json. Run npm run prepare:tools.`);
  }
  for (const name of ['yt-dlp.exe', 'ffmpeg.exe', 'ffprobe.exe', 'node.exe']) {
    const hash = crypto.createHash('sha256');
    for await (const bytes of createReadStream(path.join(binaries, name))) hash.update(bytes);
    if (hash.digest('hex') !== manifest.files[name]) throw new Error(`Bundled ${name} was modified after preparation. Run npm run prepare:tools.`);
  }
  await Promise.all([
    fs.access(path.join(root, 'dist', 'frontend', 'index.html')),
    fs.access(path.join(root, 'build', 'icon.ico')),
    fs.access(path.join(root, 'backend', 'utils', 'kill-tree.ps1')),
    fs.access(path.join(binaries, 'licenses', 'THIRD-PARTY-NOTICES.txt')),
    fs.access(path.join(binaries, 'licenses', 'Node-LICENSE.txt')),
    fs.access(path.join(binaries, 'licenses', 'yt-dlp-LICENSE.txt')),
  ]);
};
