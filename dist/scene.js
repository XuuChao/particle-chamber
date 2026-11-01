import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { spherePositions } from './shape.js';
import { GPUFlow } from './gpu-flow.js';
import { PARTICLE_COUNT } from './particle-data.js';
import { makeEnvironment } from './environment.js';
import { DensityVolume, DensityPass } from './density-volume.js';
import { CHAMBER_ORIGIN, PARTICLE_MIN, PARTICLE_MAX } from './chamber-bounds.js';

export class ParticleChamber {
  constructor(canvas, { reducedMotion, onStatus, onError }) {
    this.canvas = canvas;
    this.onStatus = onStatus;
    this.onError = onError;
    this.count = PARTICLE_COUNT;
    this.paused = reducedMotion;
    this.time = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.drag = null;
    this.lastStroke = null;
    this.flowStatus = '';
    this.failed = false;
    this.accumulator = 0;
    this.lastInteraction = performance.now();
    this.centre = new THREE.Vector3(...CHAMBER_ORIGIN);
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias:true, powerPreference:'high-performance' });
    } catch {
      throw new Error('This experience needs WebGL 2. Enable graphics acceleration or try another browser.');
    }
    if (!this.renderer.extensions.has('EXT_color_buffer_float')) {
      throw new Error('Full-quality particles need floating-point graphics support. Try a browser with graphics acceleration enabled.');
    }
    this.renderer.setPixelRatio(devicePixelRatio || 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = .85;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.debug.onShaderError = () => { throw new Error('A graphics shader could not compile. Please reload.'); };
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38,1,.1,70);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hit = new THREE.Vector3();
    this.normal = new THREE.Vector3();
    this.brushOrientation = new THREE.Quaternion();
    this.plane = new THREE.Plane();
    this.planeCentre = new THREE.Vector3();
    this.environment = makeEnvironment(this.scene,this.renderer);
    this.makeParticles();
    const target = new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:4});
    target.depthTexture = new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
    this.composer = new EffectComposer(this.renderer,target);
    this.composer.addPass(new RenderPass(this.scene,this.camera));
    this.composer.addPass(new DensityPass(this.volume,this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1,1),.5,.45,1.1);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.bindPointer();
    this.canvas.addEventListener('webglcontextlost',event => {
      event.preventDefault();
      this.failed = true;
      cancelAnimationFrame(this.frame);
      onError('The graphics connection was interrupted. Reload to start again.');
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas.parentElement);
    this.resize();
    if (this.failed) throw new Error(this.failureMessage || 'Full-quality graphics could not start.');
    this.lastStamp = performance.now();
    this.animate = this.animate.bind(this);
    this.frame = requestAnimationFrame(this.animate);
    document.addEventListener('visibilitychange',() => {
      this.lastStroke = this.drag = null;
      this.accumulator = 0;
      this.lastStamp = performance.now();
      this.simulation.stopInput();
    });
  }

  makeParticles() {
    this.simulation = new GPUFlow(this.renderer,spherePositions(this.count));
    this.volume = new DensityVolume(this.renderer,this.simulation,this.centre);
    this.anchor = this.volume.anchor;
    this.form = this.volume.form;
    this.points = this.volume.points;
    this.uniforms = this.volume.uniforms;
    const floor = this.environment.floor;
    const reflectWorld = floor.onBeforeRender;
    // The pinned r187 Reflector retains the matching reflected camera here.
    floor.onBeforeRender = (renderer,world,camera,...args) => {
      reflectWorld.call(floor,renderer,world,camera,...args);
      const reflectedCamera = floor._reflectionCameras.get(camera);
      if(reflectedCamera) this.volume.renderInto(floor.getRenderTarget(),reflectedCamera);
    };
  }

  resize() {
    if (this.failed) return;
    const {width,height} = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    const ratio = devicePixelRatio || 1;
    const limit = this.renderer.capabilities.maxTextureSize;
    if (width * ratio > limit || height * ratio > limit) {
      this.failed = true;
      this.failureMessage='This display size exceeds the graphics limit. Use a smaller browser window and reload.';
      this.onError(this.failureMessage);
      return;
    }
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width,height,false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(width,height);
    this.volume.setSize(width,height,ratio);
    const reflection = this.environment.floor.getRenderTarget();
    reflection.setSize(Math.ceil(width*ratio),Math.ceil(height*ratio));
    this.environment.floor.material.uniforms.roughnessLOD.value=2.7+Math.log2(ratio);
    this.camera.aspect = width / height;
    const compact = width <= 700;
    const horizontalShare = compact ? .88 : .68;
    const verticalShare = compact ? .74 : .77;
    const tangent = Math.tan(THREE.MathUtils.degToRad(this.camera.fov)/2);
    const distance = Math.max(4.9/(2*tangent*this.camera.aspect*horizontalShare),4.6/(2*tangent*verticalShare))+.9;
    this.viewDistance=distance;
    this.camera.setViewOffset(width,height,compact?0:width*.08,0,width,height);
    this.camera.updateProjectionMatrix();
    this.uniforms.uRatio.value = ratio;
    this.uniforms.uHeight.value = height;
    this.uniforms.uDistance.value = distance;
    this.simulation.uniforms.uBrushRadius.value=.30;
    this.render();
  }

  setShape(positions) {
    this.simulation.retarget(positions,this.paused);
    this.lastStroke = null;
    this.flowStatus = '';
    this.yaw = this.pitch = 0;
    this.lastInteraction = performance.now() + 1500;
  }

  reset() {
    this.simulation.retarget(spherePositions(this.count),true,false);
    this.time = this.accumulator = 0;
    this.yaw = this.pitch = 0;
    this.drag = this.lastStroke = null;
    this.flowStatus = '';
  }

  setPaused(paused) {
    this.paused = paused;
    this.lastStroke = null;
    this.accumulator = 0;
    this.simulation.stopInput();
    this.onStatus(paused?'Paused \u00b7 drag to inspect':'Live \u00b7 move to stir');
  }

  updateCamera() {
    // Orbit the view, leaving the simulated enclosure fixed in world space.
    // Keep the camera inside the room: unrestricted orbit could pass through
    // the opaque back wall, left wall or floor and turn the entire view black.
    const baseAzimuth=Math.atan2(.36,1);
    const minAzimuth=Math.asin(Math.max(-.95,-5.5/this.viewDistance));
    const azimuth=THREE.MathUtils.clamp(baseAzimuth+this.yaw,minAzimuth,Math.PI/2-.10);
    const maxElevation=Math.min(.60,Math.asin(Math.min(.95,4.2/this.viewDistance)));
    const elevation=THREE.MathUtils.clamp(.066+this.pitch,.025,Math.max(.07,maxElevation));
    this.yaw=azimuth-baseAzimuth;
    this.pitch=elevation-.066;
    const direction=new THREE.Vector3(
      Math.sin(azimuth)*Math.cos(elevation),Math.sin(elevation),
      Math.cos(azimuth)*Math.cos(elevation),
    );
    this.camera.position.copy(this.centre).addScaledVector(direction,this.viewDistance);
    this.camera.lookAt(this.centre);
    this.camera.updateMatrixWorld();
  }

  bindPointer() {
    const canvas = this.canvas;
    const finish = event => {
      if (this.drag?.id !== event.pointerId) return;
      this.drag = this.lastStroke = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      this.onStatus(this.paused?'Paused \u00b7 drag to inspect':'Live \u00b7 move to stir');
    };
    canvas.addEventListener('pointerdown',event => {
      if (event.button !== 0 || this.drag) return;
      canvas.setPointerCapture(event.pointerId);
      this.drag={id:event.pointerId,x:event.clientX,y:event.clientY};
      this.lastStroke=null;
      this.lastInteraction=performance.now();
      this.onStatus('Rotating view');
    });
    canvas.addEventListener('pointermove',event => {
      if (this.failed) return;
      if (this.drag?.id === event.pointerId) {
        this.yaw+=(event.clientX-this.drag.x)*.008;
        this.pitch=THREE.MathUtils.clamp(this.pitch+(event.clientY-this.drag.y)*.006,-.35,.65);
        this.drag.x=event.clientX;this.drag.y=event.clientY;
        this.lastInteraction=performance.now();
        return;
      }
      if (this.paused || event.pointerType !== 'mouse') return;
      const rect=canvas.getBoundingClientRect();
      this.pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
      this.camera.getWorldDirection(this.normal);
      this.raycaster.setFromCamera(this.pointer,this.camera);
      this.planeCentre.copy(this.centre).addScaledVector(this.normal,-.25);
      this.plane.setFromNormalAndCoplanarPoint(this.normal,this.planeCentre);
      if(!this.raycaster.ray.intersectPlane(this.plane,this.hit))return;
      this.form.updateWorldMatrix(true,false);
      this.form.worldToLocal(this.hit);
      if([this.hit.x,this.hit.y,this.hit.z].some((v,i)=>v<PARTICLE_MIN[i]-.5 || v>PARTICLE_MAX[i]+.5)) {
        this.lastStroke=null;return;
      }
      this.form.getWorldQuaternion(this.brushOrientation).invert();
      this.simulation.uniforms.uBrushNormal.value.copy(this.normal).negate().applyQuaternion(this.brushOrientation);
      const stamp=performance.now();
      if (this.lastStroke && stamp-this.lastStroke.stamp<250) {
        if (this.simulation.stroke(this.lastStroke.point,this.hit,(stamp-this.lastStroke.stamp)/1000)) {
          this.lastInteraction=stamp;
          if(this.flowStatus!=='flowing') this.onStatus('Particles flowing');
          this.flowStatus='flowing';
        }
      }
      this.lastStroke={point:this.hit.clone(),stamp};
    });
    canvas.addEventListener('pointerup',finish);
    canvas.addEventListener('pointercancel',finish);
    canvas.addEventListener('lostpointercapture',finish);
    canvas.addEventListener('pointerleave',() => {this.lastStroke=null;});
    canvas.addEventListener('keydown',event => {
      const keys={ArrowLeft:[-.15,0],ArrowRight:[.15,0],ArrowUp:[0,-.15],ArrowDown:[0,.15]};
      if(!keys[event.key])return;
      event.preventDefault();
      this.yaw+=keys[event.key][0];
      this.pitch=THREE.MathUtils.clamp(this.pitch+keys[event.key][1],-.35,.65);
      this.lastInteraction=performance.now();
    });
    window.addEventListener('blur',() => {this.drag=this.lastStroke=null;});
  }

  render() {
    if(this.failed)return;
    this.updateCamera();
    this.uniforms.uPositions.value=this.simulation.positions;
    this.environment.bounce.intensity=.8;
    this.composer.render();
  }

  animate(stamp) {
    if(this.failed)return;
    const elapsed=Math.min((stamp-this.lastStamp)/1000,.12);
    this.lastStamp=stamp;
    try {
      if(!document.hidden) {
        if(!this.paused) {
          this.accumulator+=elapsed;
          while(this.accumulator>=1/60) {
            this.time+=1/60;
            this.simulation.step(1/60,this.time);
            this.accumulator-=1/60;
          }
          if(this.flowStatus==='flowing' && stamp-this.lastInteraction>180) {
            this.flowStatus='settling';this.onStatus('Wake fading');
          }
          if(this.flowStatus==='settling' && stamp-this.lastInteraction>3500) {
            this.flowStatus='';this.onStatus('Live \u00b7 move to stir');
          }
        }
        this.render();
      }
    } catch(error) {
      this.failed=true;
      this.onError(error.message || 'The 3D view could not render. Reload to start again.');
      return;
    }
    this.frame=requestAnimationFrame(this.animate);
  }
}
