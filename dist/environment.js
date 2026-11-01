import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CABINET } from './chamber-bounds.js';

function grainTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(256, 256);
  let seed = 173;
  for (let i = 0; i < image.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const grey = 140 + (seed / 4294967296) * 85;
    image.data.set([grey, grey, grey, 255], i);
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(12, 12);
  return texture;
}

function makeFloor() {
  const shader = {
    uniforms: {
      ...THREE.UniformsUtils.clone(Reflector.ReflectorShader.uniforms),
      roughnessLOD: { value: 2.7 },
    },
    vertexShader: `
      uniform mat4 textureMatrix;
      varying vec4 vUv;
      varying vec2 vFloor;
      void main() {
        vUv = textureMatrix * vec4(position, 1.0);
        vFloor = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float roughnessLOD;
      varying vec4 vUv;
      varying vec2 vFloor;
      float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7))) * 43758.5453); }
      void main() {
        vec2 uv = vUv.xy / vUv.w;
        vec3 reflection = textureLod(tDiffuse, uv, roughnessLOD).rgb;
        vec2 tile = vFloor * .85;
        vec2 line = abs(fract(tile) - .5) / max(fwidth(tile), vec2(.0001));
        float grout = 1.0 - clamp(min(line.x,line.y),0.0,1.0);
        float stone = hash(floor(tile)) * .2 + hash(vFloor * 180.0) * .09;
        float underCase = exp(-dot(vFloor, vFloor) * .32);
        vec3 base = vec3(.008,.012,.018) * (1.0 + stone) * (1.0 - grout * .5);
        base *= 1.0 - underCase * .30;
        gl_FragColor = vec4(base + reflection * .36, 1.0);
      }
    `,
  };
  const floor = new Reflector(new THREE.PlaneGeometry(40, 40), {
    textureWidth: 1024, textureHeight: 1024, clipBias: .003, multisample: 4, shader,
  });
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.94;
  floor.material.toneMapped = false;
  floor.getRenderTarget().depthTexture = new THREE.DepthTexture(1024,1024,THREE.UnsignedIntType);
  floor.getRenderTarget().texture.generateMipmaps = true;
  floor.getRenderTarget().texture.minFilter = THREE.LinearMipmapLinearFilter;
  return floor;
}

export function makeEnvironment(scene, renderer) {
  scene.background = new THREE.Color(0x101820);
  scene.fog = new THREE.FogExp2(0x101820, .055);
  const room = new RoomEnvironment();
  const generator = new THREE.PMREMGenerator(renderer);
  scene.environment = generator.fromScene(room, .04).texture;
  scene.environmentIntensity = .10;
  room.dispose();
  generator.dispose();

  scene.add(new THREE.HemisphereLight(0xc3d1dd, 0x17202b, .35));
  const key = new THREE.SpotLight(0xe1ecf3, 35, 18, .62, .8, 1.5);
  key.position.set(-3.7, 4.0, 3);
  key.target.position.set(0, -.8, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -.0003;
  key.shadow.normalBias = .025;
  scene.add(key, key.target);
  const roofLight = new THREE.SpotLight(0xc5dced, 12, 7, .9, .8, 2);
  roofLight.position.set(0, 1.83, 0);
  roofLight.target.position.set(0, -1.5, 0);
  scene.add(roofLight, roofLight.target);
  const bounce = new THREE.PointLight(0xbdd6e8, .8, 5, 2);
  bounce.position.set(0, -.35, .8);
  scene.add(bounce);

  const grain = grainTexture();
  const metal = new THREE.MeshStandardMaterial({ color: 0x485460, metalness: .8, roughness: .34, roughnessMap: grain, envMapIntensity: .25 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x202b35, metalness: .4, roughness: .65, roughnessMap: grain });
  const rim = new THREE.MeshStandardMaterial({ color: 0x91a0ad, metalness: .85, roughness: .26, envMapIntensity: .4 });
  const wall = new THREE.MeshStandardMaterial({ color: 0x28323c, metalness: .18, roughness: .8, roughnessMap: grain });
  const box = (w, h, d, x, y, z, material = metal) => {
    const radius = Math.min(.03, Math.min(w,h,d) * .22);
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(w,h,d,2,radius), material);
    mesh.position.set(x,y,z);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };
  box(22,10,.2, 0,2,-4.7,wall);
  box(.2,10,18,-6,2,0,wall);
  for (let x = -9; x < 10; x += 1.8) {
    box(.055,8,.06,x,2,-4.55,dark);
    box(1.7,.035,.06,x+.9,-.8,-4.55,metal);
    box(1.7,.035,.06,x+.9,2.2,-4.55,metal);
  }
  const luminous = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3,1.5,1.7), toneMapped: false });
  for (let z = -3.8; z < 1; z += 1.3) {
    box(.035,.9,.2,-5.85,2.3,z,luminous);
    box(.08,1.05,.32,-5.90,2.3,z,dark);
  }
  for (let x=-4;x<5;x+=2) box(.16,.18,8,x,4.8,-.3,dark);

  box(3.65,.09,3.05,0,-1.8,0,dark);
  box(3.45,.06,2.88,0,-1.72,0,rim);
  box(3.28,.12,2.72,0,-1.63,0,metal);
  box(3.17,.025,2.62,0,-1.55,0,dark);
  box(3.4,.14,2.86,0,2.04,0,dark);
  box(3.24,.025,2.7,0,1.95,0,rim);
  for (const x of [-1.59,1.59]) {
    for (const z of [-1.31,1.31]) box(.012,3.48,.012,x,.19,z,rim);
  }
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xc8dce6, transparent: true, opacity: .025, metalness: 0,
    roughness: .07, ior: 1.45, clearcoat: .4, envMapIntensity: .2,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const glassHeight=CABINET.top-CABINET.bottom;
  const glassCentre=(CABINET.top+CABINET.bottom)/2;
  for (const x of [-CABINET.halfWidth,CABINET.halfWidth]) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(CABINET.halfDepth*2,glassHeight),glass);
    mesh.rotation.y = Math.PI / 2;
    mesh.position.set(x,glassCentre,0);
    scene.add(mesh);
  }
  const back = new THREE.Mesh(new THREE.PlaneGeometry(CABINET.halfWidth*2,glassHeight),glass);
  back.position.set(0,glassCentre,-CABINET.halfDepth);
  scene.add(back);

  const leds = [];
  for (let x=-1.48;x<=1.48;x+=.095) for(let z=-1.2;z<=1.2;z+=.095) leds.push(x,1.925,z);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(leds,3));
  scene.add(new THREE.Points(geometry,new THREE.PointsMaterial({color:new THREE.Color(1.1,1.3,1.5),size:.013,toneMapped:false})));

  const shafts = new THREE.Mesh(new THREE.CylinderGeometry(1.18,1.5,3.42,48,1,true),new THREE.ShaderMaterial({
    vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'varying vec2 vUv; void main(){float band=pow(.5+.5*sin(vUv.x*83.0),6.0);float fade=smoothstep(0.0,.7,vUv.y);gl_FragColor=vec4(.6,.75,.9,(.008+band*.018)*fade);}',
    transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,toneMapped:false,
  }));
  shafts.position.y=.19;
  scene.add(shafts);

  const floor = makeFloor();
  scene.add(floor);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(40,40),new THREE.ShadowMaterial({opacity:.25}));
  shadow.rotation.x=-Math.PI/2;
  shadow.position.y=-1.932;
  shadow.receiveShadow=true;
  scene.add(shadow);
  return { floor, bounce };
}
