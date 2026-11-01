export class DrawingPad {
  constructor(canvas, onChange) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    if (!this.context) throw new Error('The drawing canvas is unavailable.');
    this.points = [];
    this.pointer = null;
    this.onChange = onChange;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    canvas.addEventListener('pointerdown', event => this.start(event));
    canvas.addEventListener('pointermove', event => this.move(event));
    canvas.addEventListener('pointerup', event => this.finish(event));
    canvas.addEventListener('pointercancel', event => this.finish(event));
    canvas.addEventListener('lostpointercapture', event => this.finish(event));
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * ratio);
    this.canvas.height = Math.round(rect.height * ratio);
    this.render();
  }

  point(event) {
    const rect = this.canvas.getBoundingClientRect();
    const scale = Math.max(rect.width, rect.height);
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)) / scale,
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)) / scale,
    };
  }

  start(event) {
    if (event.button !== 0 || this.pointer !== null) return;
    event.preventDefault();
    this.pointer = event.pointerId;
    this.canvas.setPointerCapture(event.pointerId);
    const rect = this.canvas.getBoundingClientRect();
    const scale = Math.max(rect.width, rect.height);
    this.space = { width: rect.width / scale, height: rect.height / scale };
    this.points = [this.point(event)];
    this.onChange(this.points);
    this.render();
  }

  move(event) {
    if (event.pointerId !== this.pointer) return;
    const next = this.point(event), last = this.points.at(-1);
    if (Math.hypot(next.x - last.x, next.y - last.y) < .003) return;
    if (this.points.length >= 4000) this.points = this.points.filter((_, i) => i % 2 === 0);
    this.points.push(next);
    this.onChange(this.points);
    this.render();
  }

  finish(event) {
    if (event.pointerId !== this.pointer) return;
    if (event.type === 'pointerup') this.move(event);
    this.pointer = null;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    this.onChange(this.points);
    this.render();
  }

  clear() {
    this.pointer = null;
    this.points = [];
    this.onChange(this.points);
    this.render();
  }

  render() {
    const ctx = this.context;
    const { width, height } = this.canvas;
    ctx.clearRect(0, 0, width, height);
    if (!this.points.length) return;
    // Keep an existing outline visible, with its proportions, after a resize.
    const scale = Math.min(width / this.space.width, height / this.space.height);
    const offsetX = (width - this.space.width * scale) / 2;
    const offsetY = (height - this.space.height * scale) / 2;
    ctx.beginPath();
    this.points.forEach((point, i) => {
      if (i === 0) ctx.moveTo(point.x * scale + offsetX, point.y * scale + offsetY);
      else ctx.lineTo(point.x * scale + offsetX, point.y * scale + offsetY);
    });
    ctx.strokeStyle = '#c5e8ed';
    ctx.lineWidth = Math.max(1.5, width / 180);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (this.pointer === null && this.points.length > 2) {
      ctx.closePath();
      ctx.fillStyle = '#9ed8e51c';
      ctx.fill('evenodd');
    }
    ctx.stroke();
    const first = this.points[0];
    ctx.beginPath();
    ctx.arc(first.x * scale + offsetX, first.y * scale + offsetY, ctx.lineWidth * 1.4, 0, Math.PI * 2);
    ctx.fillStyle = '#e0f8f8';
    ctx.fill();
  }
}
