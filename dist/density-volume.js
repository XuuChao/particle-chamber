import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import { PARTICLE_COUNT, TEXTURE_WIDTH, TEXTURE_HEIGHT, particleLifeGLSL } from './particle-data.js';

const vertexShader = `
  attribute vec2 reference;
  uniform sampler2D uPositions;
  uniform sampler2D uTarget;
  uniform float uHoldShape;
  uniform float uAgeTime;
  ${particleLifeGLSL}
  uniform float uRatio;
  uniform float uHeight;
  uniform float uDistance;
  varying float vShade;
  varying float vDepth;
  varying float vDensity;
  float hash(vec3 p) {
    p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);
  }
  float noise(vec3 p) {
    vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),
                   mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                   mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
  }
  void main() {
    vec4 data = texture2D(uPositions,reference);
    vec3 rest = texture2D(uTarget,reference).xyz;
    vec3 normal = normalize(mat3(modelMatrix) * normalize(data.xyz + vec3(.0001)));
    vShade = .14 + .86 * pow(max(dot(normal,normalize(vec3(-.75,1.0,.25))),0.0),.65);
    vec4 view = modelViewMatrix * vec4(data.xyz,1.0);
    vDepth = exp(-max(0.0,-view.z-uDistance+.3)*.75);
    float mist=.72;
    vDensity=mix(mist,mix(1.0,.3,smoothstep(.695,.705,data.w)),uHoldShape);
    float cloud=noise(rest*3.5)*.6+noise(rest*8.0+4.1)*.28+noise(rest*17.0)*.12;
    float textureDensity=smoothstep(.2,.78,cloud);
    vDensity *= mix(mix(.4,1.1,textureDensity),mix(.08,1.25,textureDensity),uHoldShape);
    float age=particleAge(data.w,uAgeTime);
    vDensity*=smoothstep(0.0,.10,age)*(1.0-smoothstep(.68,1.0,age));
    gl_Position = projectionMatrix * view;
    // Crisp small cores; softness comes from the distribution, not defocus.
    gl_PointSize = clamp(1.8*uHeight/1080.0*uRatio*9.0/-view.z,1.0*uRatio,2.4*uRatio);
  }
`;

const fragmentShader = `
  uniform sampler2D uSceneDepth;
  uniform vec2 uResolution;
  varying float vShade;
  varying float vDepth;
  varying float vDensity;
  void main() {
    float roomDepth=texture2D(uSceneDepth,gl_FragCoord.xy/uResolution).r;
    if(gl_FragCoord.z>roomDepth+.00002)discard;
    float r=length(gl_PointCoord-.5);
    if(r>.5)discard;
    float core=1.0-smoothstep(.34,.5,r);
    float density=core*.38*vDepth*vDensity;
    vec3 radiance=mix(vec3(.23,.29,.35),vec3(3.3,3.4,3.5),vShade);
    gl_FragColor=vec4(radiance*density,density);
  }
`;

export class DensityVolume {
  constructor(renderer, simulation, centre) {
    this.renderer=renderer;
    this.simulation=simulation;
    this.scene=new THREE.Scene();
    this.accumulation=new THREE.WebGLRenderTarget(1,1,{
      type:THREE.HalfFloatType,depthBuffer:false,stencilBuffer:false,
    });
    const reference=new Float32Array(PARTICLE_COUNT*2);
    for(let i=0;i<PARTICLE_COUNT;i++) {
      reference[i*2]=((i%TEXTURE_WIDTH)+.5)/TEXTURE_WIDTH;
      reference[i*2+1]=(Math.floor(i/TEXTURE_WIDTH)+.5)/TEXTURE_HEIGHT;
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(PARTICLE_COUNT*3),3));
    geometry.setAttribute('reference',new THREE.BufferAttribute(reference,2));
    this.uniforms={
      uPositions:{value:simulation.positions},uTarget:{value:simulation.target},
      uHoldShape:simulation.uniforms.uHoldShape,
      uAgeTime:simulation.uniforms.uAgeTime,
      uSceneDepth:{value:null},uResolution:{value:new THREE.Vector2(1,1)},
      uRatio:{value:1},uHeight:{value:1080},uDistance:{value:10},
    };
    const material=new THREE.ShaderMaterial({
      uniforms:this.uniforms,vertexShader,fragmentShader,
      transparent:true,depthWrite:false,depthTest:false,toneMapped:false,
      blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,
      blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor,
      blendEquationAlpha:THREE.AddEquation,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneFactor,
    });
    this.points=new THREE.Points(geometry,material);
    this.points.frustumCulled=false;
    this.anchor=new THREE.Group();this.anchor.position.copy(centre);
    this.form=new THREE.Group();this.form.add(this.points);this.anchor.add(this.form);
    this.scene.add(this.anchor);
    this.composite=new THREE.ShaderMaterial({
      uniforms:{tDensity:{value:this.accumulation.texture}},
      vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:`uniform sampler2D tDensity;varying vec2 vUv;void main(){
        vec4 density=texture2D(tDensity,vUv);
        if(density.a<.00001)discard;
        vec3 radiance=density.rgb/max(density.a,.00001);
        float opacity=1.0-exp(-density.a*1.3);
        gl_FragColor=vec4(radiance,opacity);}`,
      transparent:true,depthWrite:false,depthTest:false,blending:THREE.NormalBlending,toneMapped:false,
    });
    this.quad=new FullScreenQuad(this.composite);
    this.ratio=1;
    this.clearColor=new THREE.Color();
  }

  setSize(width,height,ratio) {
    this.ratio=ratio;
    this.accumulation.setSize(Math.ceil(width*ratio),Math.ceil(height*ratio));
    this.uniforms.uRatio.value=ratio;
    this.uniforms.uHeight.value=height;
  }

  renderInto(target,camera) {
    const renderer=this.renderer;
    const previous=renderer.getRenderTarget();
    const autoClear=renderer.autoClear;
    const shadows=renderer.shadowMap.autoUpdate;
    const alpha=renderer.getClearAlpha();renderer.getClearColor(this.clearColor);
    this.uniforms.uPositions.value=this.simulation.positions;
    this.uniforms.uSceneDepth.value=target.depthTexture;
    this.uniforms.uResolution.value.set(target.width,target.height);
    this.uniforms.uDistance.value=camera.position.distanceTo(this.anchor.position);
    renderer.autoClear=false;
    renderer.shadowMap.autoUpdate=false;
    try {
      renderer.setRenderTarget(this.accumulation);
      renderer.setClearColor(0x000000,0);renderer.clear(true,false,false);
      renderer.render(this.scene,camera);
      renderer.setRenderTarget(target);
      this.quad.render(renderer);
    } finally {
      renderer.setRenderTarget(previous);
      renderer.setClearColor(this.clearColor,alpha);
      renderer.autoClear=autoClear;
      renderer.shadowMap.autoUpdate=shadows;
    }
  }
}

export class DensityPass extends Pass {
  constructor(volume,camera) { super();this.volume=volume;this.camera=camera;this.needsSwap=false; }
  render(renderer,writeBuffer,readBuffer) { this.volume.renderInto(readBuffer,this.camera); }
}
