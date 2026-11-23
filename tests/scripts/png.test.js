import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { decodePng, encodePng, diffImages } from '../../scripts/png.js';

const image = (width, height, fill) => {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) data.set(fill(i % width, Math.floor(i / width)), i * 4);
  return { width, height, data };
};

describe('png helper (visual comparisons)', () => {
  it('round-trips RGBA pixels', () => {
    const img = image(7, 5, (x, y) => [x * 30, y * 50, (x * y) % 256, 255 - x]);
    const back = decodePng(encodePng(img));
    expect(back.width).toBe(7);
    expect(back.height).toBe(5);
    expect(Array.from(back.data)).toEqual(Array.from(img.data));
  });

  it('reads RGB PNGs with every scanline filter (as Chrome writes them)', () => {
    const width = 4;
    const height = 5;
    const rgb = (x, y) => [10 + x * 40, 20 + y * 30, 200 - x * 10 - y * 5];
    // Hand-filter each row with filter type = row index (0 none, 1 sub, 2 up, 3 average, 4 Paeth).
    const rows = [];
    const px = (x, y) => (x < 0 || y < 0 ? [0, 0, 0] : rgb(x, y));
    for (let y = 0; y < height; y += 1) {
      const row = [y];
      for (let x = 0; x < width; x += 1) {
        for (let c = 0; c < 3; c += 1) {
          const v = rgb(x, y)[c];
          const a = px(x - 1, y)[c];
          const b = px(x, y - 1)[c];
          const cc = px(x - 1, y - 1)[c];
          const p = a + b - cc;
          const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - cc) ? a : Math.abs(p - b) <= Math.abs(p - cc) ? b : cc;
          const pred = [0, a, b, (a + b) >> 1, paeth][y];
          row.push((v - pred + 256) & 255);
        }
      }
      rows.push(...row);
    }
    const encoded = encodePng(image(width, height, () => [0, 0, 0, 255]));
    // Swap in an RGB header and the hand-filtered data, keeping the encoder's chunk framing.
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr.set([8, 2, 0, 0, 0], 8);
    const chunk = (type, body) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(body.length, 0);
      head.write(type, 4, 'latin1');
      return Buffer.concat([head, body, Buffer.alloc(4)]); // the decoder does not check CRCs
    };
    const png = Buffer.concat([encoded.subarray(0, 8), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))]);
    const back = decodePng(png);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const o = (y * width + x) * 4;
        expect([...back.data.subarray(o, o + 4)]).toEqual([...rgb(x, y), 255]);
      }
    }
  });

  it('refuses what it cannot read', () => {
    expect(() => decodePng(Buffer.from('not a png at all'))).toThrow(/Not a PNG/);
  });

  it('diffs images: share of differing pixels, mean difference, red diff image', () => {
    const a = image(10, 10, () => [100, 100, 100, 255]);
    const b = image(10, 10, (x) => (x < 2 ? [200, 100, 100, 255] : [110, 100, 100, 255]));
    const d = diffImages(a, b, { tolerance: 32 });
    expect(d.differing).toBeCloseTo(0.2);
    expect(d.meanDiff).toBeCloseTo((0.2 * 100 + 0.8 * 10) / 3);
    expect([...d.image.data.subarray(0, 4)]).toEqual([255, 40, 40, 255]);
    expect(d.image.data[5 * 4]).toBe(d.image.data[5 * 4 + 1]); // grey where they agree
    expect(() => diffImages(a, image(5, 5, () => [0, 0, 0, 255]))).toThrow(/sizes differ/);
  });
});
