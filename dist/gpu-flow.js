import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import { packPositions, TEXTURE_WIDTH, TEXTURE_HEIGHT, particleLifeGLSL } from './particle-data.js';
import { FluidGrid, gridSampling } from './fluid-grid.js';
import { PARTICLE_MIN, PARTICLE_MAX } from './chamber-bounds.js';

const positionShader = `
  uniform float uDelta;
  uniform float uAgeTime,uMorph;
  uniform sampler2D uTarget,uPrevious;
  uniform vec3 uBoundsMin,uBoundsMax;
  ${particleLifeGLSL}
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 p = texture2D(texturePosition, uv);
    vec3 velocity = texture2D(textureVelocity, uv).xyz;
    vec3 next = p.xyz + velocity * uDelta;
    if(uMorph<.999) {
      next=mix(texture2D(uPrevious,uv).xyz,texture2D(uTarget,uv).xyz,uMorph)+velocity*.025;
    }
    // Fading mist is replenished at its source, rather than pulling every dot
    // back along a spring. The renderer uses the same lifetime for a soft fade.
    if(uMorph>.999 && particleAge(p.w,uAgeTime)<particleAge(p.w,max(0.0,uAgeTime-uDelta))) {
      next=texture2D(uTarget,uv).xyz;
    }
    // Safety reflection at the glass planes. Mirroring an overshoot avoids
    // flattening every escaping particle onto an invisible curved surface.
    vec3 span=uBoundsMax-uBoundsMin;
    vec3 folded=mod(next-uBoundsMin,span*2.0);
    next=uBoundsMin+mix(folded,span*2.0-folded,step(span,folded));
    gl_FragColor = vec4(next, p.w);
  }
`;

const velocityShader = `
  uniform sampler2D uTarget;
  uniform sampler2D uPrevious;
  uniform float uMorph;
  uniform float uDelta;
  uniform float uTime;
  uniform float uHoldShape;
  uniform sampler2D uFlow;
  ${gridSampling}

  // Each component is independent of its own coordinate: divergence is zero.
  vec3 curlField(vec3 p, float t) {
    return vec3(
      cos(p.y * 2.0 + t) - sin(p.z * 2.0 - t * .7),
      cos(p.z * 2.0 + 1.2 + t * .8) - sin(p.x * 2.0 + t * .6),
      cos(p.x * 2.0 + 2.1 - t * .6) - sin(p.y * 2.0 - t * .4)
    );
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec3 p = texture2D(texturePosition, uv).xyz;
    vec4 previousVelocity = texture2D(textureVelocity, uv);
    vec3 v = previousVelocity.xyz;
    vec3 goal = mix(texture2D(uPrevious, uv).xyz, texture2D(uTarget, uv).xyz, uMorph);
    vec4 flow=sampleGrid(uFlow,worldCell(p));
    float activity=clamp(flow.w,0.0,1.0);
    vec3 desired=flow.xyz+curlField(p*4.0,uTime*.48)*.045;
    // A drawn silhouette needs a gentle shape memory, relaxed by local flow.
    desired+=(goal-p)*uHoldShape*mix(.20625,.035,activity);
    // Free circulation throughout the cabinet; only the glass redirects flow.
    desired=wallVelocity(p,desired,.16);
    // Touched mist responds promptly; quiet surrounding flow keeps its inertia.
    v=mix(v,desired,1.0-exp(-uDelta*mix(8.0,30.0,activity)));
    float speed = length(v);
    if (speed > 2.3) v *= 2.3 / speed;
    vec3 predicted=p+v*uDelta;
    if(predicted.x>uBoundsMax.x)v.x=-abs(v.x)*.35;
    if(predicted.x<uBoundsMin.x)v.x=abs(v.x)*.35;
    if(predicted.y>uBoundsMax.y)v.y=-abs(v.y)*.35;
    if(predicted.y<uBoundsMin.y)v.y=abs(v.y)*.35;
    if(predicted.z>uBoundsMax.z)v.z=-abs(v.z)*.35;
    if(predicted.z<uBoundsMin.z)v.z=abs(v.z)*.35;
    gl_FragColor = vec4(v, activity);
  }
`;

export class GPUFlow {
  constructor(renderer, positions) {
    this.renderer = renderer;
    this.compute = new GPUComputationRenderer(TEXTURE_WIDTH, TEXTURE_HEIGHT, renderer);
    this.target = this.compute.createTexture();
    this.target.image.data.set(packPositions(positions));
    const initial = this.target.clone();
    initial.image = { ...this.target.image, data: this.target.image.data.slice() };
    initial.needsUpdate = true;
    this.zero = this.compute.createTexture();
    this.zero.image.data.fill(0);
    this.previous = this.compute.createRenderTarget();
    this.positionVariable = this.compute.addVariable('texturePosition', positionShader, initial);
    this.velocityVariable = this.compute.addVariable('textureVelocity', velocityShader, this.zero);
    const variables = [this.positionVariable, this.velocityVariable];
    for (const variable of variables) this.compute.setVariableDependencies(variable, variables);
    this.uniforms = {
      uTarget: { value: this.target }, uPrevious: { value: this.previous.texture },
      uMorph: { value: 1 }, uDelta: { value: 1 / 60 }, uTime: { value: 0 },
      uAgeTime: { value: 0 },
      uHoldShape: { value: 0 }, uFlow: { value: null },
      uBoundsMin: { value: new THREE.Vector3(...PARTICLE_MIN) },
      uBoundsMax: { value: new THREE.Vector3(...PARTICLE_MAX) },
      uActivity: { value: 0 }, uPointer: { value: new THREE.Vector3(5, 5, 5) },
      uStrokeStart: { value: new THREE.Vector3(5, 5, 5) },
      uBrushNormal: { value: new THREE.Vector3(0, 0, 1) },
      uBrushRadius: { value: .3 },
      uCursorVelocity: { value: new THREE.Vector3() },
    };
    Object.assign(this.velocityVariable.material.uniforms, this.uniforms);
    Object.assign(this.positionVariable.material.uniforms,this.uniforms);
    const error = this.compute.init();
    if (error) throw new Error('GPU particle simulation is unavailable: ' + error);
    this.compute.renderTexture(this.target, this.previous);
    this.fluid = new FluidGrid(renderer,this.uniforms);
    this.uniforms.uFlow.value=this.fluid.texture;
    this.activity = 0;
    this.morphTime = 1.35;
    this.cursorVelocity = new THREE.Vector3();
    this.pendingStroke = false;
  }

  get positions() { return this.compute.getCurrentRenderTarget(this.positionVariable).texture; }
  get velocities() { return this.compute.getCurrentRenderTarget(this.velocityVariable).texture; }

  retarget(positions, immediate = false, holdShape = true) {
    const packed = packPositions(positions);
    this.compute.renderTexture(this.positions, this.previous);
    this.target.image.data.set(packed);
    this.target.needsUpdate = true;
    for (const target of this.velocityVariable.renderTargets) this.compute.renderTexture(this.zero, target);
    if (immediate) {
      for (const target of this.positionVariable.renderTargets) this.compute.renderTexture(this.target, target);
      this.compute.renderTexture(this.target, this.previous);
    }
    this.morphTime = immediate ? 1.35 : 0;
    this.uniforms.uHoldShape.value=holdShape?1:0;
    this.uniforms.uAgeTime.value=0;
    this.fluid.clear();
    this.stopInput();
  }

  stroke(start, end, seconds) {
    const delta = new THREE.Vector3().subVectors(end, start);
    const distance = delta.length();
    if (distance < .0005 || distance > 3.6) return false;
    delta.multiplyScalar(1 / Math.max(seconds, .004)).clampLength(0, 5);
    this.cursorVelocity.copy(delta);
    if (!this.pendingStroke) this.uniforms.uStrokeStart.value.copy(start);
    this.uniforms.uPointer.value.copy(end);
    this.pendingStroke = true;
    this.activity = Math.min(1.0, Math.max(this.activity, .3 + delta.length() * .5));
    return true;
  }

  stopInput() {
    this.activity = 0;
    this.cursorVelocity.set(0, 0, 0);
    this.pendingStroke = false;
    this.uniforms.uActivity.value = 0;
    this.uniforms.uCursorVelocity.value.set(0, 0, 0);
  }

  step(delta, time) {
    this.morphTime = Math.min(1.35, this.morphTime + delta);
    const t = this.morphTime / 1.35;
    this.uniforms.uMorph.value = t * t * (3 - 2 * t);
    this.uniforms.uDelta.value = delta;
    this.uniforms.uTime.value = time;
    this.uniforms.uAgeTime.value+=delta;
    this.uniforms.uActivity.value = this.activity;
    this.uniforms.uCursorVelocity.value.copy(this.cursorVelocity);
    this.fluid.step();
    this.uniforms.uFlow.value=this.fluid.texture;
    // Integrate with this step's velocity, rather than the previous texture.
    const read=this.compute.currentTextureIndex,write=1-read;
    const position=this.positionVariable,velocity=this.velocityVariable;
    velocity.material.uniforms.texturePosition.value=position.renderTargets[read].texture;
    velocity.material.uniforms.textureVelocity.value=velocity.renderTargets[read].texture;
    this.compute.doRenderTarget(velocity.material,velocity.renderTargets[write]);
    position.material.uniforms.texturePosition.value=position.renderTargets[read].texture;
    position.material.uniforms.textureVelocity.value=velocity.renderTargets[write].texture;
    this.compute.doRenderTarget(position.material,position.renderTargets[write]);
    this.compute.currentTextureIndex=write;
    this.pendingStroke = false;
    this.activity *= Math.exp(-delta * 8);
    this.cursorVelocity.multiplyScalar(Math.exp(-delta * 12));
  }

  readPositions() {
    const data = new Float32Array(TEXTURE_WIDTH * TEXTURE_HEIGHT * 4);
    this.renderer.readRenderTargetPixels(this.compute.getCurrentRenderTarget(this.positionVariable), 0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT, data);
    return data;
  }
}
