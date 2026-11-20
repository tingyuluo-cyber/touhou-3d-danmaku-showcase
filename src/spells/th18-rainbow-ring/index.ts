import * as THREE from 'three';
import type { SpellCardInstance, SpellMetadata, SpellUpdateContext } from '../types';
import type { TimelinePhase } from '../../core/Timeline';
import {
  clamp,
  createSeededRandom,
  lerp,
  smootherstep,
  smoothstep,
} from '../../prototypes/DanmakuMath';

export const TH18_METADATA: SpellMetadata = {
  id: 'th18-rainbow-ring',
  gameCode: 'TH18',
  gameName: '东方虹龙洞',
  spellName: '"虹人环"',
  character: '天弓千亦',
  bgm: '那热闹的市场今在何处 ~ Immemorial Marketeers',
  prototype: '体积激光与拖尾条带',
  spatialForm: '多层彩虹光环阵列 + 棱镜色散',
  visualHighlight:
    '12 层七彩立体彩虹光环阵列与 4,200 颗虹彩星弹交织成旋转陀螺星环, 镜头穿梭于光环中心与环壁之间, 叠加棱镜色散后期.',
  implemented: true,
};

export const TH18_DURATION = 12.5;

const TH18_PHASES: TimelinePhase[] = [
  { id: 'prism', label: '01 棱镜初现', start: 0.0, end: 2.8, badgeStyle: 'normal' },
  { id: 'rings', label: '02 虹环交织', start: 2.8, end: 6.4, badgeStyle: 'frozen' },
  { id: 'weave', label: '03 穿梭虹人环', start: 6.4, end: 10.6, badgeStyle: 'burst' },
  { id: 'disperse', label: '04 虹彩消散', start: 10.6, end: 12.5, badgeStyle: 'normal' },
];

interface RainbowRingRig {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  radius: number;
  baseRot: THREE.Euler;
  spinSpeedX: number;
  spinSpeedY: number;
  spinSpeedZ: number;
}

interface RingOrb {
  ringIdx: number;
  angle0: number;
  offsetR: number;
  offsetZ: number;
  orbitSpeed: number;
  scale: number;
  color: THREE.Color;
}

export class TH18RainbowRingSpell implements SpellCardInstance {
  public readonly metadata = TH18_METADATA;
  public readonly duration = TH18_DURATION;
  public readonly phases = TH18_PHASES;

  private root = new THREE.Group();
  private prismCore: THREE.Mesh | null = null;
  private prismMat: THREE.ShaderMaterial | null = null;
  private rings: RainbowRingRig[] = [];
  private orbMesh: THREE.InstancedMesh | null = null;
  private orbs: RingOrb[] = [];

  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];

  private camCurve: THREE.CatmullRomCurve3 | null = null;
  private readonly _pos = new THREE.Vector3();
  private readonly _quat = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3();
  private readonly _mat4 = new THREE.Matrix4();

  public init(scene: THREE.Scene, _renderer: THREE.WebGLRenderer): void {
    scene.background = new THREE.Color(0x04030b);
    scene.fog = new THREE.FogExp2(0x04030c, 0.011);

    this.root = new THREE.Group();
    scene.add(this.root);

    // 1. Central Iridescent Spectral Crystal Core (glass-smooth 48x36 sphere with thin-film rainbow dispersion!)
    const prismGeom = new THREE.SphereGeometry(1.75, 48, 36);
    this.prismMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vPos;
        void main() {
          vPos = position;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vPos;
        vec3 spectrum(float t) {
          return 0.55 + 0.45 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
        }
        void main() {
          float ndv = clamp(abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0);
          float fres = 1.0 - ndv;
          float hue = fract(fres * 1.4 + vPos.y * 0.18 + uTime * 0.22);
          vec3 irid = spectrum(hue);
          vec3 darkCore = vec3(0.05, 0.04, 0.12);
          vec3 col = mix(darkCore, irid * 1.25, 0.22 + fres * fres * 1.15);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.prismCore = new THREE.Mesh(prismGeom, this.prismMat);
    this.root.add(this.prismCore);
    this.geometries.push(prismGeom);
    this.materials.push(this.prismMat);

    // 2. Authentic TH18 "虹人环": 14 Interlocking 7-Color Pure Spectral Rings (Red, Orange, Yellow, Green, Cyan, Blue, Violet)!
    const sevenRainbowHex = [
      0xff2a54, // Red
      0xff7e24, // Orange
      0xffe038, // Yellow
      0x34e884, // Green
      0x2cd8ff, // Cyan
      0x4078ff, // Blue
      0xb452ff, // Violet
    ];
    const ringCount = 14;
    this.rings = [];

    for (let i = 0; i < ringCount; i++) {
      const radius = 5.0 + i * 1.32;
      const ringCol = new THREE.Color(sevenRainbowHex[i % 7]);
      const torusGeom = new THREE.TorusGeometry(radius, 0.11 + (i % 2) * 0.03, 14, 128);
      const ringMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uPhase: { value: i * 0.55 },
          uOpacity: { value: 0.85 },
          uRingColor: { value: ringCol },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform float uPhase;
          uniform float uOpacity;
          uniform vec3 uRingColor;
          varying vec2 vUv;

          void main() {
            float pulse = 0.62 + 0.38 * sin(vUv.x * 37.699 - uTime * 4.2 + uPhase);
            float core = 0.72 + 0.28 * sin(vUv.y * 6.28318);
            vec3 col = uRingColor * (0.72 + pulse * 0.35);
            gl_FragColor = vec4(col, core * uOpacity * 0.44);
          }
        `,
      });
      this.geometries.push(torusGeom);
      this.materials.push(ringMat);

      const mesh = new THREE.Mesh(torusGeom, ringMat);
      const baseRot = new THREE.Euler(
        (i / ringCount) * Math.PI,
        ((i * 3) / ringCount) * Math.PI,
        (i % 2 === 0 ? 1 : -1) * 0.45,
      );
      mesh.rotation.copy(baseRot);
      this.root.add(mesh);

      this.rings.push({
        mesh,
        mat: ringMat,
        radius,
        baseRot,
        spinSpeedX: (i % 2 === 0 ? 1 : -1) * (0.16 + (i % 4) * 0.05),
        spinSpeedY: (i % 3 === 0 ? -1 : 1) * (0.22 + (i % 3) * 0.06),
        spinSpeedZ: (i % 2 === 0 ? -1 : 1) * 0.14,
      });
    }

    // 3. 4,200 Smooth Bead Orbs locked to their parent ring's pure ROYGBIV spectral color (true "虹人环" bead chains!)
    const rand = createSeededRandom(20210504); // Touhou 18 UM release date seed!
    const orbCount = 4200;
    this.orbs = [];

    for (let i = 0; i < orbCount; i++) {
      const ringIdx = i % ringCount;
      const frac = Math.floor(i / ringCount) / (orbCount / ringCount);
      const angle0 = frac * Math.PI * 2;
      const c = new THREE.Color(sevenRainbowHex[ringIdx % 7]);
      this.orbs.push({
        ringIdx,
        angle0,
        offsetR: (rand() - 0.5) * 0.42,
        offsetZ: (rand() - 0.5) * 0.38,
        orbitSpeed: (ringIdx % 2 === 0 ? 1 : -1) * (0.52 + (ringIdx % 4) * 0.12),
        scale: 0.16 + (i % 3) * 0.05,
        color: c,
      });
    }

    const orbGeom = new THREE.SphereGeometry(1.0, 20, 14);
    const orbMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vColor;
        varying float vNearFade;
        void main() {
          vec4 mvPos = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
          vViewDir = normalize(-mvPos.xyz);
          vNearFade = smoothstep(1.8, 4.8, -mvPos.z);
          #ifdef USE_INSTANCING_COLOR
            vColor = instanceColor;
          #else
            vColor = vec3(1.0);
          #endif
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vColor;
        varying float vNearFade;
        void main() {
          float ndv = clamp(abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0);
          float core = ndv * ndv;
          vec3 col = mix(vColor * 0.85, mix(vColor, vec3(1.06, 1.06, 1.1), 0.38), smoothstep(0.62, 0.96, core));
          float alpha = (0.14 + core * 0.52) * vNearFade;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
    this.geometries.push(orbGeom);
    this.materials.push(orbMat);

    this.orbMesh = new THREE.InstancedMesh(orbGeom, orbMat, orbCount);
    this.orbMesh.frustumCulled = false;
    for (let i = 0; i < orbCount; i++) {
      this.orbMesh.setColorAt(i, this.orbs[i].color);
    }
    if (this.orbMesh.instanceColor) this.orbMesh.instanceColor.needsUpdate = true;
    this.root.add(this.orbMesh);

    // 4. Sweeping Camera framing the 14-ring ROYGBIV kaleidoscope cleanly without colliding into the core!
    this.camCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0.0, 2.2, 27.5),
        new THREE.Vector3(12.8, 4.6, 19.0),
        new THREE.Vector3(9.4, -2.0, 14.6),
        new THREE.Vector3(-8.8, 3.2, 14.2),
        new THREE.Vector3(-13.8, 5.2, 19.5),
        new THREE.Vector3(-3.0, 3.4, 28.5),
      ],
      false,
      'centripetal',
      0.5,
    );
  }

  public update(ctx: SpellUpdateContext): void {
    if (!this.orbMesh || !this.camCurve) return;

    const t = ctx.time;
    const p = clamp(t / TH18_DURATION, 0, 1);
    const u = clamp(lerp(p, smootherstep(0, 1, p), 0.25), 0, 1);
    const climax = smoothstep(5.2, 7.4, t) * (1 - smoothstep(10.6, 12.2, t));

    this.camCurve.getPoint(u, ctx.cameraPose.position);
    ctx.cameraPose.lookAt.set(0, 0, 0);
    ctx.cameraPose.roll = Math.sin(p * Math.PI * 2.0) * 0.22;
    ctx.cameraPose.fov = 50 + climax * 9.0;
    ctx.cameraPose.shake = 0;

    if (this.prismCore) {
      this.prismCore.rotation.set(t * 0.55, t * 0.9, t * 0.35);
      if (this.prismMat) this.prismMat.uniforms.uTime.value = t;
    }

    // Rotate gyroscopic rainbow rings and cache their world quaternions
    const ringQuats: THREE.Quaternion[] = [];
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      const reveal = smoothstep(i * 0.22, i * 0.22 + 1.4, t);
      r.mesh.rotation.set(
        r.baseRot.x + t * r.spinSpeedX,
        r.baseRot.y + t * r.spinSpeedY,
        r.baseRot.z + t * r.spinSpeedZ,
      );
      r.mesh.scale.setScalar(0.5 + 0.5 * reveal);
      r.mat.uniforms.uTime.value = t;
      r.mat.uniforms.uOpacity.value = reveal * (0.72 + climax * 0.26);
      r.mesh.updateMatrix();
      ringQuats.push(r.mesh.quaternion.clone());
    }

    // Place 4,200 rainbow orbs directly along each rotating ring's local circle!
    for (let i = 0; i < this.orbs.length; i++) {
      const o = this.orbs[i];
      const ring = this.rings[o.ringIdx];
      const reveal = smoothstep(o.ringIdx * 0.22, o.ringIdx * 0.22 + 1.2, t);
      if (reveal <= 0.002) {
        this._mat4.makeScale(0, 0, 0);
        this.orbMesh.setMatrixAt(i, this._mat4);
        continue;
      }

      const a = o.angle0 + t * o.orbitSpeed;
      const rad = (ring.radius + o.offsetR) * (0.5 + 0.5 * reveal);
      this._pos.set(Math.cos(a) * rad, Math.sin(a) * rad, o.offsetZ);
      this._pos.applyQuaternion(ringQuats[o.ringIdx]);
      this._quat.identity();
      this._scale.setScalar(o.scale * reveal);
      this._mat4.compose(this._pos, this._quat, this._scale);
      this.orbMesh.setMatrixAt(i, this._mat4);
    }
    this.orbMesh.instanceMatrix.needsUpdate = true;

    // Signature Prism Chromatic Dispersion with crisp saturated rainbow contrast (zero white washout!)
    const fx = ctx.postFX;
    fx.vignette = 0.38;
    fx.chromatic = 0.0026 + climax * 0.0034;
    fx.bloomThreshold = 1.2;
    fx.bloomStrength = 0.26 + climax * 0.08;
    fx.bloomRadius = 0.35;
  }

  public getInstanceCount(): number {
    return 12 + this.orbs.length;
  }

  public dispose(scene: THREE.Scene): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    scene.remove(this.root);
    this.rings = [];
    this.orbMesh = null;
  }
}
