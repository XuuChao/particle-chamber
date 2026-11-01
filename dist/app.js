import { DrawingPad } from './drawing.js';
import { contourVolume } from './shape.js';

const get = id => document.getElementById(id);
const shell = get('experience');
const panel = get('drawing-panel');
const drawButton = get('draw-open');
const feedback = get('drawing-feedback');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let chamber, pad;

function announce(message) { get('status-text').textContent = message; }

function drawingMessage(message, error = false) {
  feedback.textContent = message;
  feedback.dataset.error = String(error);
}

function showPanel(open, restoreFocus = true) {
  panel.hidden = !open;
  shell.classList.toggle('is-drawing', open);
  drawButton.setAttribute('aria-expanded', String(open));
  if (open) {
    pad.resize();
    get('draw-close').focus({ preventScroll: true });
  } else if (restoreFocus) drawButton.focus({ preventScroll: true });
}

function updatePause() {
  shell.classList.toggle('is-paused', chamber.paused);
  get('pause').setAttribute('aria-pressed', String(chamber.paused));
  get('pause-label').textContent = chamber.paused ? 'Resume' : 'Pause';
  get('pause-icon').textContent = chamber.paused ? '▷' : 'Ⅱ';
}

function fail(message) {
  get('load-state').hidden = false;
  get('load-title').textContent = 'The chamber couldn’t open.';
  get('load-message').textContent = message;
  get('reload').hidden = false;
  get('load-state').setAttribute('role', 'alert');
  for (const id of ['draw-open', 'pause', 'reset', 'draw-generate']) get(id).disabled = true;
  announce('3D view unavailable');
}

get('reload').addEventListener('click', () => location.reload());

try {
  pad = new DrawingPad(get('drawing'), points => {
    get('drawing-placeholder').hidden = points.length > 0;
    drawingMessage(points.length
      ? (pad.pointer === null ? 'Outline ready. Make particles, or draw again.' : 'Release to close your outline.')
      : 'Your drawing stays on this device.');
  });
  const { ParticleChamber } = await import('./scene.js');
  chamber = new ParticleChamber(get('scene'), {
    reducedMotion: reducedMotion.matches, onStatus: announce, onError: fail,
  });
  get('load-state').hidden = true;
  shell.dataset.ready = 'true';
  for (const id of ['draw-open', 'pause', 'reset']) get(id).disabled = false;
  updatePause();
  announce(chamber.paused ? 'Paused · reduced motion' : 'Live · move to disturb');

  drawButton.addEventListener('click', () => showPanel(true));
  get('draw-close').addEventListener('click', () => showPanel(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); showPanel(false); }
  });
  get('draw-clear').addEventListener('click', () => pad.clear());
  get('draw-generate').addEventListener('click', () => {
    try {
      const positions = contourVolume(pad.points, chamber.count);
      chamber.setShape(positions);
      get('shape-name').textContent = 'Your shape';
      get('shape-description').innerHTML = 'Your outline, given volume.<br>Drag to see another side.';
      showPanel(false);
      announce(chamber.paused ? 'Shape created · paused' : 'Shape created');
    } catch (error) { drawingMessage(error.message, true); }
  });
  get('pause').addEventListener('click', () => {
    chamber.setPaused(!chamber.paused);
    updatePause();
  });
  get('reset').addEventListener('click', () => {
    pad.clear();
    chamber.setPaused(reducedMotion.matches);
    chamber.reset();
    updatePause();
    get('shape-name').textContent = 'Sphere';
    get('shape-description').innerHTML = 'A small disturbance.<br>A thousand possibilities.';
    showPanel(false, false);
    announce(chamber.paused ? 'Reset · paused' : 'Reset · sphere restored');
  });
  reducedMotion.addEventListener('change', event => {
    if (event.matches) { chamber.setPaused(true); updatePause(); }
  });
} catch {
  fail('This experience needs WebGL 2. Enable graphics acceleration or try another browser, then reload.');
}
