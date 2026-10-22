/* Small code-native GSD mark: a download arrow in a rounded charcoal tile. */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const palette = { tile: [27, 37, 30], ink: [213, 245, 120] };

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4); data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), output.length - 4);
  return output;
}
function png(size) {
  const scan = Buffer.alloc(size * (size * 4 + 1));
  const inside = (x, y) => {
    const radius = 0.2;
    const cornerX = Math.max(radius - x, x - (1 - radius), 0);
    const cornerY = Math.max(radius - y, y - (1 - radius), 0);
    return cornerX * cornerX + cornerY * cornerY < radius * radius;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let alpha = 0; let red = 0; let green = 0; let blue = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const px = (x + (sx + 0.5) / 4) / size; const py = (y + (sy + 0.5) / 4) / size;
      if (!inside(px, py)) continue;
      const stem = px >= 0.448 && px <= 0.552 && py >= 0.23 && py <= 0.58;
      const arrow = py >= 0.43 && py <= 0.68 && Math.abs(px - 0.5) <= 0.68 - py && Math.abs(px - 0.5) >= Math.max(0, 0.54 - py);
      const tray = (py >= 0.735 && py <= 0.825 && px >= 0.25 && px <= 0.75) || ((px >= 0.25 && px <= 0.335 || px >= 0.665 && px <= 0.75) && py >= 0.645 && py <= 0.81);
      const color = stem || arrow || tray ? palette.ink : palette.tile;
      red += color[0]; green += color[1]; blue += color[2]; alpha++;
    }
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    if (alpha) {
      scan[offset] = red / alpha; scan[offset + 1] = green / alpha; scan[offset + 2] = blue / alpha; scan[offset + 3] = alpha / 16 * 255;
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(scan)), chunk('IEND', Buffer.alloc(0))]);
}
const sizes = [16, 32, 48, 64, 128, 256];
const images = sizes.map(png);
const directory = Buffer.alloc(6 + 16 * sizes.length);
directory.writeUInt16LE(1, 2); directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
sizes.forEach((size, index) => {
  const entry = 6 + index * 16;
  directory[entry] = size === 256 ? 0 : size; directory[entry + 1] = directory[entry];
  directory.writeUInt16LE(1, entry + 4); directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(images[index].length, entry + 8); directory.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
});
const folder = path.resolve(__dirname, '..', 'build');
fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(path.join(folder, 'icon.ico'), Buffer.concat([directory, ...images]));
fs.writeFileSync(path.join(folder, 'icon.png'), images[5]);
console.log('Created build/icon.ico and build/icon.png.');
