import * as THREE from './vendor/three.module.js';
import { spherePositions } from './shape.js';

const vertexShader = `
  attribute vec3 target;
  attribute float seed;
  uniform float uTime;
  uniform float uMorph;
  uniform float uRatio;
  uniform float uSize;
  uniform vec3 uPointer;
  uniform float uForce;
  varying float vLight;
  void main() {
    vec3 p = mix(position, target, uMorph);
    float t = uTime * 0.55;
    p += vec3(sin(t + seed * 29.0 + p.y * 3.0),
              cos(t * 0.8 + seed * 23.0 + p.z * 3.0),
              sin(t * 0.7 + seed * 19.0 + p.x * 3.0)) * 0.022;
    vec3 away = p - uPointer;
    float influence = exp(-dot(away, away) * 3.5) * uForce;
    p += normalize(away + vec3(0.001)) * influence * 0.75;
    p += vec3(-away.y, away.x, sin(seed * 19.0 + t)) * influence * 0.22;
    vec4 view = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = clamp((2.5 + seed * 2.0) * uRatio * uSize * 6.0 / -view.z, 1.0, 18.0);
    vLight = 0.30 + seed * 0.62;
  }
`;

const fragmentShader = `
  uniform float uOpacity;
  varying float vLight;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    float glow = exp(-r * r * 24.0) + exp(-r * r * 5.0) * 0.13;
    gl_FragColor = vec4(vec3(0.87, 0.93, 0.98), glow * vLight * uOpacity);
  }
`;

export class ParticleChamber {
  constructor(canvas, { reducedMotion, onStatus, onError }) {
    this.canvas = canvas;
    this.onStatus = onStatus;
    this.onError = onError;
    this.count = matchMedia('(pointer: coarse)').matches ? 6500 : 11000;
    this.paused = reducedMotion;
    this.time = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.drag = null;
    this.hover = false;
    this.failed = false;
    this.lastInteraction = performance.now();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.6));
    this.renderer.setClearColor(0x080d12);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.65;
    this.renderer.debug.onShaderError = () => { throw new Error('The particle shader could not start.'); };
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x080d12, .065);
    this.camera = new THREE.PerspectiveCamera(38, 1, .1, 60);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hit = new THREE.Vector3();
    this.plane = new THREE.Plane();
    this.normal = new THREE.Vector3();
    this.centre = new THREE.Vector3(0, .15, 0);
    this.makeRoom();
    this.makeParticles();
    this.bindPointer();
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      this.failed = true;
      cancelAnimationFrame(this.frame);
      onError('The graphics connection was interrupted. Reload to start again.');
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas.parentElement);
    this.resize();
    this.render();
    this.lastStamp = performance.now();
    this.animate = this.animate.bind(this);
    this.frame = requestAnimationFrame(this.animate);
    document.addEventListener('visibilitychange', () => {
      this.hover = false;
      this.drag = null;
      this.lastStamp = performance.now();
    });
  }

  makeRoom() {
    this.scene.add(new THREE.HemisphereLight(0xadc5da, 0x101720, 2.4));
    const key = new THREE.PointLight(0xc4e4f5, 30, 12, 2);
    key.position.set(-2, 3.5, 2);
    this.scene.add(key);
    const rim = new THREE.PointLight(0x7c9cbf, 18, 12, 2);
    rim.position.set(3, .8, -2);
    this.scene.add(rim);
    const metal = new THREE.MeshStandardMaterial({ color: 0x253440, metalness: .65, roughness: .36 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x111c26, metalness: .35, roughness: .62 });
    const edge = new THREE.MeshStandardMaterial({ color: 0x647d8d, metalness: .7, roughness: .3 });
    const box = (w, h, d, x, y, z, material = metal) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      this.scene.add(mesh);
      return mesh;
    };
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({ color: 0x111a24, metalness: .65, roughness: .3, transparent: true, opacity: .82, depthWrite: false }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.94;
    floor.renderOrder = 2;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(30, 22, 0x32404b, 0x263540);
    grid.position.y = -1.932;
    grid.material.transparent = true;
    grid.material.opacity = .3;
    this.scene.add(grid);
    box(20, 9, .15, 0, 2, -4.6, dark);
    for (let x = -9; x <= 9; x += 1.8) {
      box(.055, 8, .08, x, 2, -4.48, metal);
      box(1.6, .045, .09, x + .9, -.8, -4.45, metal);
      box(1.6, .035, .09, x + .9, 2.1, -4.45, metal);
    }
    box(.14, 9, 16, -6, 2, 0, dark);
    for (let z = -4; z <= 5; z += 1.7) box(.08, 8, .055, -5.9, 2, z, metal);
    const luminous = new THREE.MeshBasicMaterial({ color: 0xd5e8f3 });
    for (let z = -3; z < 2; z += 1.2) box(.03, .85, .23, -5.8, 2.6, z, luminous);

    // Layered plinth, canopy and very fine glass edges make the display case.
    box(3.62, .09, 3.04, 0, -1.80, 0, dark);
    box(3.42, .08, 2.88, 0, -1.72, 0, edge);
    box(3.25, .12, 2.70, 0, -1.62, 0);
    box(3.38, .13, 2.82, 0, 2.03, 0, dark);
    box(3.25, .028, 2.70, 0, 1.949, 0, edge);
    const caseGeometry = new THREE.BoxGeometry(3.2, 3.5, 2.65);
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(caseGeometry),
      new THREE.LineBasicMaterial({ color: 0x8ea9bc, transparent: true, opacity: .3 }));
    lines.position.y = .17;
    this.scene.add(lines);
    const glass = new THREE.MeshBasicMaterial({ color: 0x9dc8de, transparent: true, opacity: .022, side: THREE.DoubleSide, depthWrite: false });
    for (const x of [-1.6, 1.6]) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(2.65, 3.5), glass);
      panel.position.set(x, .17, 0);
      panel.rotation.y = Math.PI / 2;
      this.scene.add(panel);
    }
    const leds = [];
    for (let x = -1.45; x <= 1.45; x += .10) {
      for (let z = -1.2; z <= 1.2; z += .10) leds.push(x, 1.925, z);
    }
    const ledGeometry = new THREE.BufferGeometry();
    ledGeometry.setAttribute('position', new THREE.Float32BufferAttribute(leds, 3));
    this.scene.add(new THREE.Points(ledGeometry,
      new THREE.PointsMaterial({ color: 0xc8e0ef, size: .018, transparent: true, opacity: .6 })));
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.55, 3.45, 32, 1, true),
      new THREE.ShaderMaterial({
        vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: 'varying vec2 vUv; void main(){float rays=pow(0.5+0.5*sin(vUv.x*100.0),8.0); float a=(0.008+rays*0.022)*vUv.y; gl_FragColor=vec4(0.65,0.8,0.95,a);}',
        side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
    shaft.position.y = .19;
    this.scene.add(shaft);
  }

  makeParticles() {
    const positions = spherePositions(this.count);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
    this.geometry.setAttribute('target', new THREE.BufferAttribute(positions.slice(), 3));
    const seeds = Float32Array.from({ length: this.count }, () => Math.random());
    this.geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
    this.uniforms = {
      uTime: { value: 0 }, uMorph: { value: 1 },
      uRatio: { value: this.renderer.getPixelRatio() },
      uSize: { value: 1 },
      uPointer: { value: new THREE.Vector3(10, 10, 10) },
      uForce: { value: 0 }, uOpacity: { value: 1.1 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader, fragmentShader,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.anchor = new THREE.Group();
    this.anchor.position.copy(this.centre);
    this.form = new THREE.Group();
    this.points = new THREE.Points(this.geometry, material);
    this.points.frustumCulled = false;
    this.form.add(this.points);
    const haloMaterial = material.clone();
    haloMaterial.uniforms = { ...this.uniforms, uOpacity: { value: .075 }, uSize: { value: 3 } };
    const halo = new THREE.Points(this.geometry, haloMaterial);
    halo.frustumCulled = false;
    this.form.add(halo);
    this.anchor.add(this.form);
    this.scene.add(this.anchor);
    // A faint mirrored cloud below the translucent floor anchors the light.
    this.mirrorAnchor = new THREE.Group();
    this.mirrorAnchor.position.set(0, -4.03, 0);
    this.mirrorAnchor.scale.y = -1;
    const reflectionMaterial = material.clone();
    reflectionMaterial.uniforms = { ...this.uniforms, uOpacity: { value: .18 } };
    this.reflection = new THREE.Points(this.geometry, reflectionMaterial);
    this.reflection.frustumCulled = false;
    this.reflection.renderOrder = 1;
    this.mirrorAnchor.add(this.reflection);
    this.scene.add(this.mirrorAnchor);
  }

  resize() {
    if (this.failed) return;
    const { width, height } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    const mobile = width <= 700;
    const distance = mobile ? Math.max(9, 6.6 / this.camera.aspect) : 9;
    this.camera.position.set(distance * .32, distance * .20, distance);
    this.camera.lookAt(mobile ? 0 : .65, .1, 0);
    this.camera.updateProjectionMatrix();
    this.anchor.quaternion.copy(this.camera.quaternion);
    this.mirrorAnchor.quaternion.copy(this.camera.quaternion);
    this.render();
  }

  setShape(positions) {
    const from = this.geometry.attributes.position;
    const target = this.geometry.attributes.target;
    const mix = this.uniforms.uMorph.value;
    // Start a new transition from the current shape, including rapid requests.
    for (let i = 0; i < from.array.length; i++) from.array[i] += (target.array[i] - from.array[i]) * mix;
    target.array.set(positions);
    from.needsUpdate = target.needsUpdate = true;
    this.uniforms.uMorph.value = this.paused ? 1 : 0;
    this.morphTime = this.paused ? 1.15 : 0;
    this.uniforms.uForce.value = 0;
    this.hover = false;
    this.yaw = this.pitch = 0;
    this.lastInteraction = performance.now() + 1500;
  }

  reset() {
    this.setShape(spherePositions(this.count));
    this.time = 0;
    this.uniforms.uTime.value = 0;
    this.uniforms.uForce.value = 0;
    this.drag = null;
  }

  setPaused(paused) {
    this.paused = paused;
    this.hover = false;
    if (paused) {
      this.uniforms.uMorph.value = 1;
      this.morphTime = 1.15;
    }
    this.onStatus(paused ? 'Paused · drag to inspect' : 'Live · move to disturb');
  }

  bindPointer() {
    const canvas = this.canvas;
    const finish = event => {
      if (this.drag?.id !== event.pointerId) return;
      this.drag = null;
      this.hover = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      this.onStatus(this.paused ? 'Paused · drag to inspect' : 'Live · move to disturb');
    };
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 || this.drag) return;
      canvas.setPointerCapture(event.pointerId);
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      this.hover = false;
      this.lastInteraction = performance.now();
      this.onStatus('Rotating sculpture');
    });
    canvas.addEventListener('pointermove', event => {
      if (this.failed) return;
      if (this.drag?.id === event.pointerId) {
        this.yaw += (event.clientX - this.drag.x) * .008;
        this.pitch = THREE.MathUtils.clamp(this.pitch + (event.clientY - this.drag.y) * .008, -1.3, 1.3);
        this.drag.x = event.clientX;
        this.drag.y = event.clientY;
        this.lastInteraction = performance.now();
        return;
      }
      if (this.paused || event.pointerType !== 'mouse') return;
      const rect = canvas.getBoundingClientRect();
      this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1,
        -(event.clientY - rect.top) / rect.height * 2 + 1);
      this.camera.getWorldDirection(this.normal);
      this.plane.setFromNormalAndCoplanarPoint(this.normal, this.centre);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) return;
      this.form.worldToLocal(this.hit);
      this.uniforms.uPointer.value.copy(this.hit);
      const hover = this.hit.length() < 1.65;
      if (hover !== this.hover) this.onStatus(hover ? 'Particles disturbed' : 'Live · move to disturb');
      this.hover = hover;
    });
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    canvas.addEventListener('lostpointercapture', finish);
    canvas.addEventListener('pointerleave', () => {
      this.hover = false;
      if (!this.drag) this.onStatus(this.paused ? 'Paused · drag to inspect' : 'Live · move to disturb');
    });
    canvas.addEventListener('keydown', event => {
      const directions = { ArrowLeft: [-.15, 0], ArrowRight: [.15, 0], ArrowUp: [0, -.15], ArrowDown: [0, .15] };
      if (!directions[event.key]) return;
      event.preventDefault();
      this.yaw += directions[event.key][0];
      this.pitch = THREE.MathUtils.clamp(this.pitch + directions[event.key][1], -1.3, 1.3);
      this.lastInteraction = performance.now();
    });
    window.addEventListener('blur', () => { this.drag = null; this.hover = false; });
  }

  render() {
    this.form.rotation.set(this.pitch, this.yaw, 0);
    this.reflection.rotation.copy(this.form.rotation);
    this.renderer.render(this.scene, this.camera);
  }

  animate(stamp) {
    if (this.failed) return;
    const delta = Math.min((stamp - this.lastStamp) / 1000, .04);
    this.lastStamp = stamp;
    if (!document.hidden) {
      if (!this.paused) {
        this.time += delta;
        this.uniforms.uTime.value = this.time;
        this.morphTime = (this.morphTime || 0) + delta;
        const t = Math.min(1, this.morphTime / 1.15);
        this.uniforms.uMorph.value = t * t * (3 - 2 * t);
        this.uniforms.uForce.value += ((this.hover ? 1 : 0) - this.uniforms.uForce.value) * (1 - Math.exp(-delta * 8));
        if (!this.drag && !this.hover && stamp - this.lastInteraction > 1500) this.yaw += delta * .10;
      }
      try { this.render(); }
      catch {
        this.failed = true;
        this.onError('The 3D view could not render. Try reloading or using another browser.');
        return;
      }
    }
    this.frame = requestAnimationFrame(this.animate);
  }
}
