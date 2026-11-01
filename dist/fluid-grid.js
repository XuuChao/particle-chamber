import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// A 32³ fluid grid packed into a 256 × 128 texture. All particles sample the
// same velocity: a stroke moves neighbouring fluid, not selected particle IDs.
export const GRID_SIZE = 32;
export const GRID_EXTENT = 3.6;
const WIDTH = 256, HEIGHT = 128;

export const gridSampling = `
  uniform vec3 uBoundsMin,uBoundsMax;
  vec2 cellUV(vec3 cell) {
    cell=clamp(cell,vec3(0.0),vec3(31.0));
    float index=cell.x+cell.y*32.0+cell.z*1024.0;
    return (vec2(mod(index,256.0),floor(index/256.0))+.5)/vec2(256.0,128.0);
  }
  vec3 fragmentCell() {
    float index=floor(gl_FragCoord.x)+floor(gl_FragCoord.y)*256.0;
    return vec3(mod(index,32.0),mod(floor(index/32.0),32.0),floor(index/1024.0));
  }
  vec3 worldCell(vec3 p) { return (p/3.6+.5)*32.0-.5; }
  vec3 cellWorld(vec3 p) { return ((p+.5)/32.0-.5)*3.6; }
  bool insideCabinet(vec3 cell) {
    vec3 p=cellWorld(cell);
    return all(greaterThanEqual(p,uBoundsMin)) && all(lessThanEqual(p,uBoundsMax));
  }
  vec3 wallVelocity(vec3 p,vec3 v,float margin) {
    vec3 lower=clamp((p-uBoundsMin)/margin,0.0,1.0);
    vec3 upper=clamp((uBoundsMax-p)/margin,0.0,1.0);
    return max(v,vec3(0.0))*upper+min(v,vec3(0.0))*lower;
  }
  float pressureAt(sampler2D source,vec3 cell,float centre) {
    return insideCabinet(cell)?texture2D(source,cellUV(cell)).r:centre;
  }
  vec4 sampleGrid(sampler2D source,vec3 cell) {
    cell=clamp(cell,vec3(0.0),vec3(31.0));
    vec3 i=floor(cell),f=fract(cell);
    return mix(mix(mix(texture2D(source,cellUV(i)),texture2D(source,cellUV(i+vec3(1,0,0))),f.x),
                   mix(texture2D(source,cellUV(i+vec3(0,1,0))),texture2D(source,cellUV(i+vec3(1,1,0))),f.x),f.y),
               mix(mix(texture2D(source,cellUV(i+vec3(0,0,1))),texture2D(source,cellUV(i+vec3(1,0,1))),f.x),
                   mix(texture2D(source,cellUV(i+vec3(0,1,1))),texture2D(source,cellUV(i+vec3(1,1,1))),f.x),f.y),f.z);
  }
`;

const advect = `
  uniform sampler2D uVelocity;
  uniform float uDelta,uTime,uActivity,uBrushRadius;
  uniform vec3 uPointer,uStrokeStart,uBrushNormal,uCursorVelocity;
  ${gridSampling}
  vec3 curl(vec3 p,float t) {
    return vec3(cos(p.y*2.0+t)-sin(p.z*2.0-t*.7),
                cos(p.z*2.0+1.2+t*.8)-sin(p.x*2.0+t*.6),
                cos(p.x*2.0+2.1-t*.6)-sin(p.y*2.0-t*.4));
  }
  void main() {
    vec3 cell=fragmentCell(),p=cellWorld(cell);
    if(!insideCabinet(cell)){gl_FragColor=vec4(0.0);return;}
    vec4 old=texture2D(uVelocity,cellUV(cell));
    vec4 carried=sampleGrid(uVelocity,cell-old.xyz*uDelta/(3.6/32.0));
    vec4 neighbours=texture2D(uVelocity,cellUV(cell+vec3(1,0,0)))
                   +texture2D(uVelocity,cellUV(cell-vec3(1,0,0)))
                   +texture2D(uVelocity,cellUV(cell+vec3(0,1,0)))
                   +texture2D(uVelocity,cellUV(cell-vec3(0,1,0)))
                   +texture2D(uVelocity,cellUV(cell+vec3(0,0,1)))
                   +texture2D(uVelocity,cellUV(cell-vec3(0,0,1)));
    // Small viscosity transports momentum into the surrounding cells.
    carried+=(neighbours-old*6.0)*(.012*uDelta/pow(3.6/32.0,2.0));
    vec3 ambient=curl(p*1.15,uTime*.32)*.16
                +curl(p*2.9+vec3(1.7,3.1,2.4),uTime*.45)*.055;
    vec3 velocity=mix(carried.xyz,ambient,1.0-exp(-uDelta*.75));
    float energy=max(0.0,carried.w)*exp(-uDelta*1.25);
    vec3 segment=uPointer-uStrokeStart;
    float along=clamp(dot(p-uStrokeStart,segment)/max(dot(segment,segment),.000001),0.0,1.0);
    vec3 offset=p-mix(uStrokeStart,uPointer,along);
    float depth=dot(offset,uBrushNormal);
    vec3 lateral=offset-uBrushNormal*depth;
    float distance=sqrt(dot(lateral,lateral)+depth*depth*.30);
    float weight=1.0-smoothstep(uBrushRadius*.2,uBrushRadius*1.45,distance);
    vec3 drag=uCursorVelocity-uBrushNormal*dot(uCursorVelocity,uBrushNormal);
    vec3 axis=cross(uBrushNormal,drag);
    axis/=max(length(axis),.001);
    axis=normalize(axis*.8+uBrushNormal*.6);
    vec3 rolling=cross(axis,offset)/max(uBrushRadius,.01);
    velocity+=(drag*8.0+rolling*uActivity*7.0)*weight*uDelta;
    energy=max(energy,weight*uActivity);
    velocity=wallVelocity(p,velocity,3.6/32.0);
    float speed=length(velocity);if(speed>3.0)velocity*=3.0/speed;
    gl_FragColor=vec4(velocity,energy);
  }
`;

const divergence = `
  uniform sampler2D uVelocity;
  ${gridSampling}
  void main() {
    vec3 c=fragmentCell();
    if(!insideCabinet(c)){gl_FragColor=vec4(0.0);return;}
    float d=texture2D(uVelocity,cellUV(c+vec3(1,0,0))).x-texture2D(uVelocity,cellUV(c-vec3(1,0,0))).x
           +texture2D(uVelocity,cellUV(c+vec3(0,1,0))).y-texture2D(uVelocity,cellUV(c-vec3(0,1,0))).y
           +texture2D(uVelocity,cellUV(c+vec3(0,0,1))).z-texture2D(uVelocity,cellUV(c-vec3(0,0,1))).z;
    gl_FragColor=vec4(d/(2.0*3.6/32.0),0,0,1);
  }
`;

const pressure = `
  uniform sampler2D uPressure,uDivergence;
  ${gridSampling}
  void main() {
    vec3 c=fragmentCell();
    if(!insideCabinet(c)){gl_FragColor=vec4(0.0);return;}
    float centre=texture2D(uPressure,cellUV(c)).x;
    float sum=pressureAt(uPressure,c+vec3(1,0,0),centre)+pressureAt(uPressure,c-vec3(1,0,0),centre)
             +pressureAt(uPressure,c+vec3(0,1,0),centre)+pressureAt(uPressure,c-vec3(0,1,0),centre)
             +pressureAt(uPressure,c+vec3(0,0,1),centre)+pressureAt(uPressure,c-vec3(0,0,1),centre);
    float d=texture2D(uDivergence,cellUV(c)).x;
    gl_FragColor=vec4((sum-d*pow(3.6/32.0,2.0))/6.0,0,0,1);
  }
`;

const project = `
  uniform sampler2D uVelocity,uPressure;
  ${gridSampling}
  void main() {
    vec3 c=fragmentCell();
    if(!insideCabinet(c)){gl_FragColor=vec4(0.0);return;}
    float centre=texture2D(uPressure,cellUV(c)).x;
    vec3 gradient=vec3(
      pressureAt(uPressure,c+vec3(1,0,0),centre)-pressureAt(uPressure,c-vec3(1,0,0),centre),
      pressureAt(uPressure,c+vec3(0,1,0),centre)-pressureAt(uPressure,c-vec3(0,1,0),centre),
      pressureAt(uPressure,c+vec3(0,0,1),centre)-pressureAt(uPressure,c-vec3(0,0,1),centre))/(2.0*3.6/32.0);
    vec4 v=texture2D(uVelocity,cellUV(c));
    gl_FragColor=vec4(wallVelocity(cellWorld(c),v.xyz-gradient,3.6/32.0),v.w);
  }
`;

function target() {
  return new THREE.WebGLRenderTarget(WIDTH,HEIGHT,{
    type:THREE.FloatType,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,
    depthBuffer:false,stencilBuffer:false,
  });
}

function material(fragmentShader,uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,fragmentShader,
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,1.0);}',
    depthTest:false,depthWrite:false,blending:THREE.NoBlending,
  });
}

export class FluidGrid {
  constructor(renderer,input) {
    this.renderer=renderer;
    this.velocity=[target(),target()];
    this.pressure=[target(),target()];
    this.divergence=target();
    this.uniforms={
      ...input,uVelocity:{value:null},uPressure:{value:null},uDivergence:{value:this.divergence.texture},
    };
    this.advect=material(advect,this.uniforms);
    this.diverge=material(divergence,this.uniforms);
    this.solve=material(pressure,this.uniforms);
    this.project=material(project,this.uniforms);
    this.quad=new FullScreenQuad(this.advect);
    this.clearColor=new THREE.Color();
    this.clear();
  }

  get texture() { return this.velocity[0].texture; }

  clear() {
    const r=this.renderer,previous=r.getRenderTarget(),alpha=r.getClearAlpha();
    r.getClearColor(this.clearColor);r.setClearColor(0x000000,0);
    for(const t of [...this.velocity,...this.pressure,this.divergence]) {
      r.setRenderTarget(t);r.clear(true,false,false);
    }
    r.setRenderTarget(previous);r.setClearColor(this.clearColor,alpha);
  }

  draw(material,target) {
    this.quad.material=material;
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);
  }

  step() {
    const r=this.renderer,previous=r.getRenderTarget();
    try {
      this.uniforms.uVelocity.value=this.velocity[0].texture;
      this.draw(this.advect,this.velocity[1]);
      this.uniforms.uVelocity.value=this.velocity[1].texture;
      this.draw(this.diverge,this.divergence);
      for(let i=0;i<12;i++) {
        this.uniforms.uPressure.value=this.pressure[0].texture;
        this.draw(this.solve,this.pressure[1]);
        this.pressure.reverse();
      }
      this.uniforms.uPressure.value=this.pressure[0].texture;
      this.draw(this.project,this.velocity[0]);
    } finally { r.setRenderTarget(previous); }
  }

  readVelocity() {
    const data=new Float32Array(WIDTH*HEIGHT*4);
    this.renderer.readRenderTargetPixels(this.velocity[0],0,0,WIDTH,HEIGHT,data);
    return data;
  }
}
