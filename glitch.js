// Applies the connector's address/data masks to a video frame.
//
// Address corruption: the PPU address bus's low 8 bits (A0-A7) are treated
// as the X coordinate directly (RENDER_W is 256 = 2^8, so this lines up
// exactly). AND-masking those bits — the effect of a broken address pin —
// forces some low bits of X to 0, so column x ends up sampling column
// (x & addrMask) instead: a whole vertical strip silently displays its
// neighboring strip's content. Because the mask is fixed for the frame,
// the misread is identical top-to-bottom, which is what makes it read as
// a clean vertical band rather than per-pixel static.
//
// Data corruption: each fetched byte (one per color channel, as three
// sequential bus transactions) is masked with dataMask and OR'd with
// whatever was last latched on the bus. Broken data pins don't go blank,
// they echo stale "open bus" values — that's what produces the posterized
// look and the color bleed trailing across pixels.

export const RENDER_W = 256;
export const RENDER_H = 240;

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

// srcData/dstData are Uint8ClampedArray RGBA buffers of size RENDER_W*RENDER_H*4.
export function applyGlitch(srcData, dstData, addrMask, dataMask) {
  const rowBytes = RENDER_W * 4;
  const xMask = addrMask & 0xFF;       // A0-A7 -> X coordinate bits
  const yMask = (addrMask >> 8) & 0x3F; // A8-A13 -> coarse Y bits (6 bits -> 64-row groups)
  const yGroupMask = yMask === 0x3F ? 0xFF : (yMask << 2) | 0x03; // widen 6 bits back over 0..239

  for (let y = 0; y < RENDER_H; y++) {
    const srcY = Math.min(RENDER_H - 1, y & (yGroupMask | 3));
    for (let x = 0; x < RENDER_W; x++) {
      const srcX = x & (xMask | (256 - RENDER_W)); // keep in-range even if xMask has high bits
      const si = srcY * rowBytes + (srcX & 0xFF) * 4;
      const di = y * rowBytes + x * 4;

      dstData[di]     = fetchByte(srcData[si], dataMask);
      dstData[di + 1] = fetchByte(srcData[si + 1], dataMask);
      dstData[di + 2] = fetchByte(srcData[si + 2], dataMask);
      dstData[di + 3] = 255;
    }
  }
}
