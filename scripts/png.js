// Minimal PNG reader / writer (no dependencies) for the visual comparisons: reads the 8-bit,
// non-interlaced RGB / RGBA PNGs that Chrome writes, and writes RGBA PNGs (diff images).
import { inflateSync, deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 }; // grey, RGB, grey+alpha, RGBA

/** @returns {{ width: number, height: number, data: Uint8Array }} RGBA, 4 bytes per pixel */
export function decodePng(buf) {
  if (!Buffer.from(buf.subarray(0, 8)).equals(SIGNATURE)) throw new Error('Not a PNG file');
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colorType, , , interlace] = body.subarray(8, 13);
      channels = CHANNELS[colorType];
      if (depth !== 8 || !channels || interlace) {
        throw new Error(`Unsupported PNG (bit depth ${depth}, colour type ${colorType}, interlace ${interlace})`);
      }
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? px[row + x - channels] : 0;
      const b = y > 0 ? px[row - stride + x] : 0;
      const c = x >= channels && y > 0 ? px[row - stride + x - channels] : 0;
      let v = raw[src + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`Bad PNG filter ${filter} in row ${y}`);
      px[row + x] = v & 255;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i += 1, j += channels) {
    const grey = channels <= 2;
    data[i * 4] = px[j];
    data[i * 4 + 1] = grey ? px[j] : px[j + 1];
    data[i * 4 + 2] = grey ? px[j] : px[j + 2];
    data[i * 4 + 3] = channels === 4 ? px[j + 3] : channels === 2 ? px[j + 1] : 255;
  }
  return { width, height, data };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** RGBA pixels → PNG bytes. */
export function encodePng({ width, height, data }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Compares two equally sized images. A pixel differs when any colour channel differs by more than
 * `tolerance` (0–255). Returns the share of differing pixels, the mean absolute channel difference,
 * and a diff image: the first image dimmed to grey, differing pixels in red.
 */
export function diffImages(a, b, { tolerance = 32 } = {}) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`Image sizes differ: ${a.width}×${a.height} vs ${b.width}×${b.height}`);
  }
  const n = a.width * a.height;
  const out = new Uint8Array(n * 4);
  let differing = 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    const dr = Math.abs(a.data[o] - b.data[o]);
    const dg = Math.abs(a.data[o + 1] - b.data[o + 1]);
    const db = Math.abs(a.data[o + 2] - b.data[o + 2]);
    sum += dr + dg + db;
    const grey = Math.round((a.data[o] + a.data[o + 1] + a.data[o + 2]) / 3 * 0.35);
    if (Math.max(dr, dg, db) > tolerance) {
      differing += 1;
      out.set([255, 40, 40, 255], o);
    } else out.set([grey, grey, grey, 255], o);
  }
  return {
    differing: differing / n,
    meanDiff: sum / (n * 3),
    image: { width: a.width, height: a.height, data: out },
  };
}
