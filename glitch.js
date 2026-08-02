// Applies the connector's address/data masks to a video frame — but first
// re-encodes the frame as NES-style CHR data, because that's what actually
// makes bit-level corruption look like fine TV-static noise instead of
// smooth color banding.
//
// NES pattern-table tiles are 2 bits per pixel: an 8x8 tile is 16 bytes —
// 8 "plane 0" bytes (one per row) followed by 8 "plane 1" bytes — and each
// byte packs one bit per pixel across that row (bit7 = leftmost pixel).
// A pixel's 2-bit value comes from combining the same bit position from
// both planes. Because one byte controls 8 pixels via individual BITS
// (not just "this whole block is now something else"), corrupting that
// byte flips/zeroes individual pixels within the row — which is what
// produces fine per-pixel noise, unlike masking bits of a smooth RGB
// value (barely visible) or aliasing whole 8x8 blocks (looks blocky).
//
// Per frame:
//   1. Downsample the source frame to RENDER_W x RENDER_H and quantize
//      each pixel's luma to a 2-bit level, packing it into a synthetic
//      CHR buffer exactly like real pattern-table data.
//   2. For every screen pixel, compute the CHR address that would fetch
//      it (tileIndex*16 + fineY [+8 for plane 1]) and AND-mask it with
//      the connector's addrMask — a dead address pin forces that bit to
//      0, so the fetch silently lands on the wrong tile/row/plane
//      ("address aliasing", e.g. a dead plane-select bit collapses both
//      planes onto the same data, crushing color depth).
//   3. Mask each fetched byte with dataMask, OR'd with whatever byte was
//      last latched on the bus — a dead data pin doesn't go blank, it
//      echoes stale "open bus" data, which is what bleeds noise from one
//      tile into the next as the beam scans across.
//   4. Decode the (possibly corrupted) 2bpp pixel back to a gray level.

export const RENDER_W = 256;
export const RENDER_H = 240;
const TILE = 8;
const TILES_X = RENDER_W / TILE;          // 32
const TILES_Y = RENDER_H / TILE;          // 30
const CHR_SIZE = TILES_X * TILES_Y * 16;  // 15360 bytes -> fits in 14 modeled addr bits

const chrBuf = new Uint8Array(CHR_SIZE);

// Persistent 8-bit bus latch (the "open bus" value data pins fall back to).
let openBus = 0;

export function resetBus() {
  openBus = 0;
}

function fetchByte(trueByte, mask) {
  const v = (trueByte & mask) | (openBus & (~mask & 0xFF));
  openBus = v;
  return v;
}

// Downsample srcData (RGBA, RENDER_W x RENDER_H) into the synthetic CHR buffer.
function buildChr(srcData) {
  const rowBytes = RENDER_W * 4;
  for (let ty = 0; ty < TILES_Y; ty++) {
    for (let tx = 0; tx < TILES_X; tx++) {
      const tileBase = (ty * TILES_X + tx) * 16;
      for (let fy = 0; fy < TILE; fy++) {
        let plane0 = 0, plane1 = 0;
        const py = ty * TILE + fy;
        for (let fx = 0; fx < TILE; fx++) {
          const px = tx * TILE + fx;
          const si = py * rowBytes + px * 4;
          const luma = (srcData[si] * 299 + srcData[si + 1] * 587 + srcData[si + 2] * 114) / 1000;
          const level = luma >> 6; // 0..3
          const shift = 7 - fx;
          plane0 |= (level & 1) << shift;
          plane1 |= ((level >> 1) & 1) << shift;
        }
        chrBuf[tileBase + fy] = plane0;
        chrBuf[tileBase + 8 + fy] = plane1;
      }
    }
  }
}

const PALETTE = [
  [12, 12, 16],
  [90, 88, 96],
  [176, 168, 176],
  [248, 240, 244],
];

// srcData/dstData are Uint8ClampedArray RGBA buffers of size RENDER_W*RENDER_H*4.
export function applyGlitch(srcData, dstData, addrMask, dataMask) {
  buildChr(srcData);
  const rowBytes = RENDER_W * 4;
  const mask13 = addrMask & 0x1FFF; // A0-A12; CHR_SIZE fits in 14 bits, plane bit is A3

  for (let tileRow = 0; tileRow < TILES_Y; tileRow++) {
    for (let fineY = 0; fineY < TILE; fineY++) {
      const y = tileRow * TILE + fineY;
      const di0 = y * rowBytes;
      for (let tileCol = 0; tileCol < TILES_X; tileCol++) {
        const tileIndex = tileRow * TILES_X + tileCol;
        const addr0 = tileIndex * 16 + fineY;
        const addr1 = addr0 + 8;
        const maskedAddr0 = addr0 & mask13;
        const maskedAddr1 = addr1 & mask13;
        const byte0 = fetchByte(chrBuf[maskedAddr0], dataMask);
        const byte1 = fetchByte(chrBuf[maskedAddr1], dataMask);

        const xBase = tileCol * TILE;
        for (let fx = 0; fx < TILE; fx++) {
          const shift = 7 - fx;
          const level = ((byte0 >> shift) & 1) | (((byte1 >> shift) & 1) << 1);
          const [r, g, b] = PALETTE[level];
          const di = di0 + (xBase + fx) * 4;
          dstData[di] = r;
          dstData[di + 1] = g;
          dstData[di + 2] = b;
          dstData[di + 3] = 255;
        }
      }
    }
  }
}
