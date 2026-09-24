import { zlibSync } from 'fflate';

/** Minimal indexed-colour PNG encoder (colour type 3). Deterministic output. */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * @param w width  @param h height
 * @param idx w*h palette indices
 * @param palette RGB hex strings; index 0 is transparent when `transparent0` is set
 */
export function encodeIndexedPng(
  w: number,
  h: number,
  idx: Uint8Array,
  palette: string[],
  transparent0 = true,
  level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 6,
): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // indexed
  const plte = new Uint8Array(palette.length * 3);
  palette.forEach((hex, i) => {
    const n = parseInt(hex.slice(1), 16);
    plte[i * 3] = (n >> 16) & 255;
    plte[i * 3 + 1] = (n >> 8) & 255;
    plte[i * 3 + 2] = n & 255;
  });
  const raw = new Uint8Array((w + 1) * h);
  for (let y = 0; y < h; y++) raw.set(idx.subarray(y * w, y * w + w), y * (w + 1) + 1);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    ...(transparent0 ? [chunk('tRNS', new Uint8Array([0]))] : []),
    chunk('IDAT', zlibSync(raw, { level })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((a, p) => a + p.length, 0);
  const png = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    png.set(p, o);
    o += p.length;
  }
  return png;
}

/** Scale an index buffer by an integer factor. */
export function scaleIndexed(src: Uint8Array, size: number, scale: number): Uint8Array {
  const n = size * scale;
  const out = new Uint8Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      out[y * n + x] = src[Math.floor(y / scale) * size + Math.floor(x / scale)]!;
  return out;
}
