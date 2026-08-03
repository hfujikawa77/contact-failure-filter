import { ConnectorBus, ADDR_PINS, DATA_PINS, TILT_MAX } from './bus.js';
import { RENDER_W, RENDER_H, applyGlitch, resetBus } from './glitch.js';

const bus = new ConnectorBus();

const video = document.getElementById('source-video');
const outCanvas = document.getElementById('out-canvas');
const outCtx = outCanvas.getContext('2d', { willReadFrequently: false });
outCanvas.width = RENDER_W;
outCanvas.height = RENDER_H;

const srcCanvas = document.createElement('canvas');
srcCanvas.width = RENDER_W;
srcCanvas.height = RENDER_H;
const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });

let dstImage = outCtx.createImageData(RENDER_W, RENDER_H);
let haveSource = false;

const statusEl = document.getElementById('status');
const btnCamera = document.getElementById('btn-camera');
const btnFile = document.getElementById('btn-file');
const fileInput = document.getElementById('file-input');
const tiltSlider = document.getElementById('tilt-slider');
const tiltLabel = document.getElementById('tilt-label');
const btnGyro = document.getElementById('btn-gyro');
const btnBlow = document.getElementById('btn-blow');
const btnReseat = document.getElementById('btn-reseat');
const pinGrid = document.getElementById('pin-grid');

function setStatus(msg) { statusEl.textContent = msg; }

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    haveSource = true;
    setStatus('カメラ映像に接触不良エフェクトを適用中');
  } catch (err) {
    setStatus('カメラを開けませんでした: ' + err.message);
  }
}

function stopCurrentSource() {
  if (video.srcObject) {
    for (const t of video.srcObject.getTracks()) t.stop();
    video.srcObject = null;
  }
  video.removeAttribute('src');
  video.load();
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  stopCurrentSource();
  video.srcObject = null;
  video.src = URL.createObjectURL(file);
  video.loop = true;
  video.play().then(() => {
    haveSource = true;
    setStatus('ファイル映像に接触不良エフェクトを適用中: ' + file.name);
  }).catch((err) => setStatus('再生できませんでした: ' + err.message));
});

btnCamera.addEventListener('click', () => { stopCurrentSource(); startCamera(); });
btnFile.addEventListener('click', () => fileInput.click());

function updateTiltUI() {
  tiltSlider.value = bus.tilt;
  tiltLabel.textContent = (bus.tilt > 0 ? '+' : '') + bus.tilt.toFixed(1) + '°';
}
tiltSlider.min = -TILT_MAX;
tiltSlider.max = TILT_MAX;
tiltSlider.step = 0.1;
tiltSlider.addEventListener('input', () => {
  bus.setTilt(parseFloat(tiltSlider.value));
  bus.recompute();
  updateTiltUI();
  updatePinGridUI();
});
tiltSlider.addEventListener('dblclick', () => {
  bus.setTilt(0);
  bus.recompute();
  updateTiltUI();
  updatePinGridUI();
});
updateTiltUI();

// --- gyroscope tilt control ---
// Maps the phone's left/right roll (gamma, roughly -90..+90°) onto the
// cassette tilt range. Clamped to a ±45° input window so a comfortable
// hand-tilt reaches the full ±TILT_MAX effect instead of needing to nearly
// lay the phone flat.
const GYRO_INPUT_RANGE = 45;
let gyroEnabled = false;
let gyroDirty = false;

function onDeviceOrientation(event) {
  if (event.gamma === null) return;
  const clamped = Math.max(-GYRO_INPUT_RANGE, Math.min(GYRO_INPUT_RANGE, event.gamma));
  bus.setTilt((clamped / GYRO_INPUT_RANGE) * TILT_MAX);
  gyroDirty = true;
}

function setGyroEnabled(on) {
  gyroEnabled = on;
  tiltSlider.disabled = on;
  btnGyro.classList.toggle('active', on);
  btnGyro.setAttribute('aria-pressed', String(on));
  btnGyro.textContent = on ? '📱 ジャイロ操作: ON' : '📱 ジャイロ操作: OFF';
  if (on) {
    window.addEventListener('deviceorientation', onDeviceOrientation);
  } else {
    window.removeEventListener('deviceorientation', onDeviceOrientation);
  }
}

btnGyro.addEventListener('click', async () => {
  if (gyroEnabled) {
    setGyroEnabled(false);
    return;
  }
  if (typeof DeviceOrientationEvent === 'undefined') {
    setStatus('このデバイス/ブラウザはジャイロセンサーに対応していません');
    return;
  }
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const result = await DeviceOrientationEvent.requestPermission();
      if (result !== 'granted') {
        setStatus('ジャイロセンサーの利用が許可されませんでした');
        return;
      }
    } catch (err) {
      setStatus('ジャイロセンサーを利用できませんでした: ' + err.message);
      return;
    }
  }
  setGyroEnabled(true);
});

btnBlow.addEventListener('click', () => {
  bus.blow();
  bus.recompute();
  updatePinGridUI();
});
btnReseat.addEventListener('click', () => {
  bus.reseat();
  resetBus();
  bus.recompute();
  updateTiltUI();
  updatePinGridUI();
});

// --- pin grid (address pins on top row, data pins below), click to toggle ---
const pinEls = new Map();
function buildPinGrid() {
  const row = (pins, label) => {
    const wrap = document.createElement('div');
    wrap.className = 'pin-row';
    const tag = document.createElement('span');
    tag.className = 'pin-row-label';
    tag.textContent = label;
    wrap.appendChild(tag);
    for (const p of pins) {
      const el = document.createElement('button');
      el.className = 'pin';
      el.type = 'button';
      el.textContent = p.pin;
      el.title = `pin ${p.pin}`;
      el.addEventListener('click', () => {
        bus.togglePin(p.pin);
        bus.recompute();
        updatePinGridUI();
      });
      pinEls.set(p.pin, el);
      wrap.appendChild(el);
    }
    return wrap;
  };
  pinGrid.appendChild(row(ADDR_PINS, 'ADDR'));
  pinGrid.appendChild(row(DATA_PINS, 'DATA'));
}
function updatePinGridUI() {
  for (const p of ADDR_PINS.concat(DATA_PINS)) {
    const el = pinEls.get(p.pin);
    const off = bus.manualOff.has(p.pin);
    const q = off ? 0 : bus.contactQuality(p.col);
    el.classList.toggle('off', q === 0);
    el.classList.toggle('unstable', q > 0 && q < 1);
  }
}
buildPinGrid();
updatePinGridUI();

// --- render loop ---
function drawSourceCover(el, w, h) {
  const sw = el.videoWidth || el.naturalWidth;
  const sh = el.videoHeight || el.naturalHeight;
  if (!sw || !sh) return false;
  const scale = Math.max(w / sw, h / sh);
  const dw = sw * scale, dh = sh * scale;
  srcCtx.drawImage(el, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return true;
}

function tick() {
  requestAnimationFrame(tick);

  if (gyroDirty) {
    gyroDirty = false;
    updateTiltUI();
    updatePinGridUI();
  }

  if (!haveSource || video.readyState < 2) return;

  if (bus.tilt !== 0 || bus.manualOff.size) bus.recompute();

  if (!drawSourceCover(video, RENDER_W, RENDER_H)) return;

  // Contacts fully seated (no tilt, no dead pins) -> show the original
  // color frame as-is instead of running it through the CHR/glitch pipeline,
  // which always collapses color into 4 gray levels.
  if (bus.tilt === 0 && bus.manualOff.size === 0) {
    outCtx.drawImage(srcCanvas, 0, 0);
    resetBus();
    return;
  }

  const srcImage = srcCtx.getImageData(0, 0, RENDER_W, RENDER_H);
  applyGlitch(srcImage.data, dstImage.data, bus.addrMask, bus.dataMask);
  outCtx.putImageData(dstImage, 0, 0);
}
requestAnimationFrame(tick);
