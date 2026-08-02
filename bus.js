// Famicom 60-pin cartridge edge connector: contact-quality model.
//
// Ported from goroman's claude-famicom-emu (web/main.js contactQuality/
// applyContacts + core/nes.cpp updatePins). There, tilting the cartridge
// lifts one side of the connector; pins near the lifted edge lose contact
// first, and flaky pins are re-rolled every frame. Broken PPU address
// pins get AND-masked to 0 (the CPU/PPU reads the wrong CHR address —
// "address aliasing"); broken PPU data pins fall through to whatever
// value was last latched on the bus ("open bus").
//
// This module reproduces exactly that pin table and math, but instead of
// driving a real CHR ROM read it produces an address mask + data mask
// that glitch.js applies to video frames.

const TILT_MAX = 6; // degrees, matches the original cartridge slider range

// PPU address pins (A0..A13) and PPU data pins (D0..D7), with each pin's
// column across the connector (0..29 — front and back rows share a column)
// and which bit of the mask it controls. Taken from the pinout comments
// and updatePins() in core/nes.cpp.
const ADDR_PINS = [
  { pin: 25, col: 24, bit: 0 },  { pin: 24, col: 23, bit: 1 },
  { pin: 23, col: 22, bit: 2 },  { pin: 22, col: 21, bit: 3 },
  { pin: 21, col: 20, bit: 4 },  { pin: 20, col: 19, bit: 5 },
  { pin: 19, col: 18, bit: 6 },
  { pin: 50, col: 19, bit: 7 },  { pin: 51, col: 20, bit: 8 },
  { pin: 52, col: 21, bit: 9 },  { pin: 53, col: 22, bit: 10 },
  { pin: 54, col: 23, bit: 11 }, { pin: 55, col: 24, bit: 12 },
  { pin: 56, col: 25, bit: 13 },
];

const DATA_PINS = [
  { pin: 26, col: 25, bit: 0 }, { pin: 27, col: 26, bit: 1 },
  { pin: 28, col: 27, bit: 2 }, { pin: 29, col: 28, bit: 3 },
  { pin: 60, col: 29, bit: 4 }, { pin: 59, col: 28, bit: 5 },
  { pin: 58, col: 27, bit: 6 }, { pin: 57, col: 26, bit: 7 },
];

const ALL_PINS = ADDR_PINS.concat(DATA_PINS);

export class ConnectorBus {
  constructor() {
    this.tilt = 0;          // -TILT_MAX .. +TILT_MAX degrees
    this.manualOff = new Set(); // pins forced off by clicking
    this.addrMask = 0x3FFF; // A0-A13, all good = no masking
    this.dataMask = 0xFF;   // D0-D7, all good = no masking
    this.recompute();
  }

  // 1 = solid contact, 0 = no contact, in between = flaky (re-rolled per frame)
  contactQuality(col) {
    if (this.tilt === 0) return 1;
    const x = (col / 29) * 2 - 1; // -1 (left) .. +1 (right)
    const lift = (this.tilt / TILT_MAX) * -x;
    if (lift <= 0.15) return 1;
    if (lift >= 0.6) return 0;
    return 1 - (lift - 0.15) / 0.45;
  }

  // Re-roll flaky pins and recompute the address/data masks. Call once per
  // rendered frame while tilted (or after a manual pin toggle / blow / reseat).
  recompute() {
    let addrMask = 0, dataMask = 0;
    for (const p of ADDR_PINS) {
      const on = this.pinOn(p);
      if (on) addrMask |= (1 << p.bit);
    }
    for (const p of DATA_PINS) {
      const on = this.pinOn(p);
      if (on) dataMask |= (1 << p.bit);
    }
    this.addrMask = addrMask;
    this.dataMask = dataMask;
  }

  pinOn(p) {
    if (this.manualOff.has(p.pin)) return false;
    const q = this.contactQuality(p.col);
    return q >= 1 || Math.random() < q;
  }

  setTilt(deg) {
    this.tilt = Math.max(-TILT_MAX, Math.min(TILT_MAX, deg));
  }

  togglePin(pin) {
    if (this.manualOff.has(pin)) this.manualOff.delete(pin);
    else this.manualOff.add(pin);
  }

  // 息(フーフー): dust blows off (65% of dead pins recover), but humidity
  // sometimes kills a previously-good PPU pin (10% chance) — same odds as
  // the original "foofoo" handler in web/main.js.
  blow() {
    for (const p of ALL_PINS) {
      if (this.manualOff.has(p.pin)) {
        if (Math.random() < 0.65) this.manualOff.delete(p.pin);
      } else if (Math.random() < 0.10) {
        this.manualOff.add(p.pin);
      }
    }
  }

  reseat() {
    this.manualOff.clear();
    this.tilt = 0;
  }
}

export { ADDR_PINS, DATA_PINS, TILT_MAX };
