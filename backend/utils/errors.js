class ApiError extends Error {
  constructor(message, status = 400, code = 'BAD_REQUEST') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function mediaError(stderr) {
  const line = String(stderr || '').replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/).filter(line => line.includes('ERROR:')).pop();
  const text = (line || '').replace(/^.*?ERROR:\s*/, '').replace(/https?:\/\/\S+/g, '[source]').slice(0, 400);
  if (/unsupported url/i.test(text)) return 'This link is not supported by yt-dlp. Paste a direct media page link from a supported site.';
  if (/private|sign in|login|cookie|age.restricted|authentication|403|401/i.test(text)) return 'This source requires permission or sign-in, or has blocked this request. GSD cannot download it with the current session.';
  if (/DRM|protected/i.test(text)) return 'This media is protected by DRM and cannot be downloaded.';
  if (/requested format.*not available/i.test(text)) return 'The selected quality is no longer available. Analyze the link again and select an available format.';
  return text || 'The media download failed. Check the connection and retry, or analyze the link again.';
}

function validateUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new ApiError('Paste a valid HTTP or HTTPS media link.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || String(value).length > 4096) {
    throw new ApiError('Use an HTTP or HTTPS media link without embedded credentials.');
  }
  url.hash = '';
  return url.href;
}

function privateAddress(value) {
  let ip = value.toLowerCase().replace(/^::ffff:/, '');
  if (/^[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(ip) && value.toLowerCase().startsWith('::ffff:')) {
    const [high, low] = ip.split(':').map(part => parseInt(part, 16));
    ip = [high >> 8, high & 255, low >> 8, low & 255].join('.');
  }
  if (ip.includes(':')) return !/^[23][0-9a-f]{3}:/.test(ip);
  const p = ip.split('.').map(Number);
  return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
}

async function validatePublicUrl(value, allowPrivate = false) {
  const normalized = validateUrl(value);
  if (allowPrivate) return normalized;
  const host = new URL(normalized).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.') && !host.includes(':')) throw new ApiError('Use a public media link. Local network addresses are not supported.');
  let addresses;
  try { addresses = await require('node:dns').promises.lookup(host, { all: true }); }
  catch { throw new ApiError('This media hostname could not be found. Check the link and connection.', 422, 'INVALID_SOURCE'); }
  if (!addresses.length || addresses.some(entry => privateAddress(entry.address))) throw new ApiError('Use a public media link. Local network addresses are not supported.');
  return normalized;
}

module.exports = { ApiError, mediaError, validateUrl, validatePublicUrl, privateAddress };
