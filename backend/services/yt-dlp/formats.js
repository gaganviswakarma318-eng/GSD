const crypto = require('node:crypto');
const { thumbnailSupport } = require('../ffmpeg/thumbnail');

function bytes(format) { return Number(format.filesize || format.filesize_approx) || undefined; }
function audio(format) { return format.acodec && format.acodec !== 'none'; }
function video(format) { return format.vcodec && format.vcodec !== 'none'; }
function compatibleAudio(format) { return audio(format) && /^(mp4a|aac|alac|mp3)/i.test(format.acodec); }
function safeId(format) { return /^[a-zA-Z0-9_.:-]+$/.test(String(format.format_id)); }

function buildOptions(info, tools = { ffmpeg: true }) {
  const formats = (Array.isArray(info.formats) ? info.formats : [info]).filter(f => f && f.url && !f.has_drm && safeId(f));
  const options = [];
  const add = (option) => {
    option.thumbnailSupport = thumbnailSupport(option.format);
    option.id = crypto.createHash('sha256').update([option.type, option.format, option.selector, option.quality].join('|')).digest('hex').slice(0, 24);
    options.push(option);
  };
  const audios = formats.filter(f => audio(f) && !video(f)).sort((a, b) => (Number(b.abr) || Number(b.tbr) || 0) - (Number(a.abr) || Number(a.tbr) || 0));
  const audioByExt = new Map();
  for (const f of audios) {
    if (!/^[a-z0-9]{2,8}$/.test(f.ext) || audioByExt.has(f.ext)) continue;
    audioByExt.set(f.ext, f);
    const rate = Math.round(Number(f.abr) || Number(f.tbr) || 0);
    add({ type: 'audio', format: f.ext, quality: rate ? `${rate} kbps` : 'Source quality', label: `${f.ext.toUpperCase()} · ${rate ? `${rate} kbps` : 'Source quality'}`, requiresConversion: false, estimatedSize: bytes(f), selector: String(f.format_id) });
  }
  const bestAudio = audios[0] || formats.filter(audio).sort((a, b) => (Number(b.abr) || 0) - (Number(a.abr) || 0))[0];
  if (tools.ffmpeg && bestAudio && !audioByExt.has('mp3')) {
    add({ type: 'audio', format: 'mp3', quality: 'VBR quality 2', label: 'MP3 · high quality (convert source)', requiresConversion: true, selector: String(bestAudio.format_id), extractAudio: true });
  }
  const mp4Audio = audios.find(compatibleAudio);
  const webmAudio = audios.find(f => /^(opus|vorbis)/i.test(f.acodec));
  const candidates = new Map();
  for (const f of formats.filter(video)) {
    if (!/^[a-z0-9]{2,8}$/.test(f.ext)) continue;
    let ext = f.ext, selector = String(f.format_id), merged = false, size = bytes(f);
    if (!audio(f)) {
      if (!tools.ffmpeg) continue;
      const companion = ext === 'mp4' ? mp4Audio : ext === 'webm' ? webmAudio : bestAudio && !video(bestAudio) ? bestAudio : null;
      if (!companion) continue;
      selector += `+${companion.format_id}`;
      merged = true;
      size = size && bytes(companion) ? size + bytes(companion) : undefined;
    }
    const height = Number(f.height) || 0;
    const fps = Number(f.fps) || 0;
    const quality = height ? `${height}p${fps > 30 ? ` ${Math.round(fps)}fps` : ''}` : (f.format_note || 'Source quality');
    const key = `${ext}:${height}:${fps > 30 ? Math.round(fps) : 0}`;
    const rank = Number(f.tbr) || 0;
    const previous = candidates.get(key);
    if (!previous || rank > previous.rank) candidates.set(key, { type: 'video', format: ext, quality, label: `${ext.toUpperCase()} · ${quality}`, requiresConversion: false, estimatedSize: size, selector, merged, height, rank });
  }
  for (const option of [...candidates.values()].sort((a, b) => b.height - a.height || a.format.localeCompare(b.format))) {
    delete option.rank; delete option.height;
    add(option);
  }
  return options;
}

function publicOption({ selector, extractAudio, merged, ...option }) { return option; }
module.exports = { buildOptions, publicOption };
