import * as THREE from 'three';
import type { SpellCardInstance, SpellMetadata, SpellUpdateContext } from '../types';
import type { TimelinePhase } from '../../core/Timeline';
import {
  clamp,
  fibonacciSpherePoint,
  lerp,
  smootherstep,
  smoothstep,
} from '../../prototypes/DanmakuMath';

export const TH15_METADATA: SpellMetadata = {
  id: 'th15-pristine-danmaku-hell',
  gameCode: 'TH15',
  gameName: '东方绀珠传',
  spellName: '纯符 "纯粹的弹幕地狱"',
  character: '纯狐',
  bgm: 'Pure Furies ~ 心之所在',
  prototype: 'InstancedMesh粒子系统',
  spatialForm: '极简主义高密度矩阵',
  visualHighlight:
    '剥离一切花哨法阵与装饰, 只保留红, 蓝, 白三原色 12,000 颗高密度实心发光球体, 堆出冰冷精确, 令人窒息的数学几何压迫.',
  implemented: true,
};

export const TH15_DURATION = 13.5;

const TH15_PHASES: TimelinePhase[] = [
  { id: 'pure1', label: '01 纯粹初环', start: 0.0, end: 3.0, badgeStyle: 'normal' },
  { id: 'lattice', label: '02 几何矩阵闭合', start: 3.0, end: 6.8, badgeStyle: 'frozen' },
  { id: 'hell', label: '03 万弹纯粹地狱', start: 6.8, end: 11.4, badgeStyle: 'burst' },
  { id: 'void', label: '04 冰冷沉寂', start: 11.4, end: 13.5, badgeStyle: 'normal' },
];

type PureGroup = 'shell' | 'lattice' | 'ring';

interface PureBulletSpec {
  group: PureGroup;
  waveIdx: number;
  dir: THREE.Vector3;
  basePos: THREE.Vector3;
  speed: number;
  spinRate: number;
  scale: number;
  color: THREE.Color;
}

export class TH15PristineDanmakuHellSpell implements SpellCardInstance {
  public readonly metadata = TH15_METADATA;
  public readonly duration = TH15_DURATION;
  public readonly phases = TH15_PHASES;

  private root = new THREE.Group();
  private sphereMesh: THREE.InstancedMesh | null = null;
  private bullets: PureBulletSpec[] = [];

  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];

  private readonly _pos = new THREE.Vector3();
  private readonly _quat = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3();
  private readonly _mat4 = new THREE.Matrix4();

  public init(scene: THREE.Scene, _renderer: THREE.WebGLRenderer): void {
    // Stark pure obsidian void -- zero magic circles, zero fog distraction!
    scene.background = new THREE.Color(0x010103);
    scene.fog = new THREE.FogExp2(0x010103, 0.011);

    this.root = new THREE.Group();
    scene.add(this.root);

    // Strictly 3 pure Junko colors: Pure Crimson, Cobalt Blue, Pure Blinding White
    const cRed = new THREE.Color(0xff1838);
    const cBlue = new THREE.Color(0x1e74ff);
    const cWhite = new THREE.Color(0xf8fbff);

    this.bullets = [];

    // 1. Expanding Concentric Pure Fibonacci Spherical Shells (6,400 spheres across 16 rhythmic shells!)
    const shells = 16;
    const perShell = 400;
    for (let w = 0; w < shells; w++) {
      const col = w % 3 === 0 ? cRed : w % 3 === 1 ? cBlue : cWhite;
      const spinSign = w % 2 === 0 ? 1 : -1;
      for (let i = 0; i < perShell; i++) {
        const unit = fibonacciSpherePoint(i, perShell);
        this.bullets.push({
          group: 'shell',
          waveIdx: w,
          dir: unit.clone(),
          basePos: new THREE.Vector3(),
          speed: 5.2 + (w % 3) * 0.85,
          spinRate: spinSign * 0.22,
          scale: 0.24,
          color: col.clone(),
        });
      }
    }

    // 2. Cold 3D Mathematical Cubic Lattice Grid (3,375 spheres = 15 x 15 x 15 hollow-cored matrix!)
    const gridN = 15;
    const spacing = 2.65;
    const half = ((gridN - 1) * spacing) * 0.5;
    for (let ix = 0; ix < gridN; ix++) {
      for (let iy = 0; iy < gridN; iy++) {
        for (let iz = 0; iz < gridN; iz++) {
          const x = ix * spacing - half;
          const y = iy * spacing - half;
          const z = iz * spacing - half;
          // Leave clean geometric inner eye right at center
          const r = Math.hypot(x, y, z);
          if (r < 4.2) continue;
          const parity = (ix + iy + iz) % 3;
          const col = parity === 0 ? cRed : parity === 1 ? cBlue : cWhite;
          this.bullets.push({
            group: 'lattice',
            waveIdx: Math.floor(r),
            dir: new THREE.Vector3(x, y, z).normalize(),
            basePos: new THREE.Vector3(x, y, z),
            speed: 0,
            spinRate: 0.08,
            scale: 0.19,
            color: col.clone(),
          });
        }
      }
    }

    // 3. Razor-Sharp Pure-White & Crimson Equatorial Slicing Ring Curtains (2,400 spheres!)
    const ringWaves = 12;
    const perRing = 200;
    for (let w = 0; w < ringWaves; w++) {
      const tilt = ((w % 4) - 1.5) * 0.42;
      const col = w % 2 === 0 ? cWhite : cRed;
      for (let i = 0; i < perRing; i++) {
        const a = (i / perRing) * Math.PI * 2;
        const dir = new THREE.Vector3(
          Math.cos(a),
          Math.sin(a) * Math.sin(tilt),
          Math.sin(a) * Math.cos(tilt),
        ).normalize();
        this.bullets.push({
          group: 'ring',
          waveIdx: w,
          dir,
          basePos: new THREE.Vector3(),
          speed: 8.8,
          spinRate: (w % 2 === 0 ? 1 : -1) * 0.35,
          scale: 0.22,
          color: col.clone(),
        });
      }
    }

    // Crisp solid Touhou glowing orb shader: bright pure white inner core, saturated solid colored shell!
    const sphereGeom = new THREE.SphereGeometry(1.0, 10, 8);
    const sphereMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: true,
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vColor;
        void main() {
          vec4 mvPos = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
          vViewDir = normalize(-mvPos.xyz);
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
        void main() {
          float ndv = clamp(abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0);
          // Classic razor-sharp Junko Touhou orb: saturated pure red/blue ring + crisp white inner core without blooming grey!
          vec3 col = mix(vColor * 1.05, vec3(1.06, 1.08, 1.12), smoothstep(0.68, 0.94, ndv));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.geometries.push(sphereGeom);
    this.materials.push(sphereMat);

    const total = this.bullets.length;
    this.sphereMesh = new THREE.InstancedMesh(sphereGeom, sphereMat, total);
    this.sphereMesh.frustumCulled = false;
    for (let i = 0; i < total; i++) {
      this.sphereMesh.setColorAt(i, this.bullets[i].color);
    }
    if (this.sphereMesh.instanceColor) this.sphereMesh.instanceColor.needsUpdate = true;
    this.root.add(this.sphereMesh);
  }

  public update(ctx: SpellUpdateContext): void {
    if (!this.sphereMesh) return;

    const t = ctx.time;
    const p = clamp(t / TH15_DURATION, 0, 1);
    const u = smootherstep(0, 1, p);

    // Cold, clinical slow orbital pullback & axial stare directly into the suffocating matrix!
    const angle = u * Math.PI * 1.15;
    const radius = lerp(11.5, 29.0, u);
    ctx.cameraPose.position.set(
      Math.sin(angle) * radius,
      Math.sin(p * Math.PI) * 5.2,
      Math.cos(angle) * radius,
    );
    ctx.cameraPose.lookAt.set(0, 0, 0);
    ctx.cameraPose.roll = Math.sin(p * Math.PI * 2) * 0.05;
    ctx.cameraPose.fov = lerp(52, 46, u);
    ctx.cameraPose.shake = 0;

    const latticeReveal = smoothstep(2.6, 5.4, t);
    const hellIntensity = smoothstep(6.2, 8.2, t);
    const latRot = t * 0.14;
    const cosL = Math.cos(latRot);
    const sinL = Math.sin(latRot);

    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];

      if (b.group === 'shell') {
        const spawn = b.waveIdx * 0.72;
        if (t < spawn) {
          this._mat4.makeScale(0, 0, 0);
          this.sphereMesh.setMatrixAt(i, this._mat4);
          continue;
        }
        const age = t - spawn;
        const r = 0.8 + age * b.speed;
        const fade = smoothstep(0, 0.22, age) * (1 - smoothstep(28, 36, r));
        if (fade <= 0.002) {
          this._mat4.makeScale(0, 0, 0);
          this.sphereMesh.setMatrixAt(i, this._mat4);
          continue;
        }
        const spin = age * b.spinRate;
        const cs = Math.cos(spin);
        const sn = Math.sin(spin);
        this._pos.set(
          (b.dir.x * cs - b.dir.z * sn) * r,
          b.dir.y * r,
          (b.dir.x * sn + b.dir.z * cs) * r,
        );
        this._quat.identity();
        this._scale.setScalar(b.scale * fade);
        this._mat4.compose(this._pos, this._quat, this._scale);
        this.sphereMesh.setMatrixAt(i, this._mat4);
      } else if (b.group === 'lattice') {
        if (latticeReveal <= 0.002) {
          this._mat4.makeScale(0, 0, 0);
          this.sphereMesh.setMatrixAt(i, this._mat4);
          continue;
        }
        // Slowly breathing geometric cubic cage tightening inward with suffocating precision!
        const breathe = 1.0 - hellIntensity * 0.16 + Math.sin(t * 2.4 + b.waveIdx * 0.35) * 0.04;
        const bx = b.basePos.x * breathe;
        const by = b.basePos.y * breathe;
        const bz = b.basePos.z * breathe;
        this._pos.set(bx * cosL - bz * sinL, by, bx * sinL + bz * cosL);
        this._quat.identity();
        this._scale.setScalar(b.scale * latticeReveal);
        this._mat4.compose(this._pos, this._quat, this._scale);
        this.sphereMesh.setMatrixAt(i, this._mat4);
      } else {
        // Slicing pure-white & crimson equatorial ring waves during Climax!
        const spawn = 4.6 + b.waveIdx * 0.65;
        if (t < spawn) {
          this._mat4.makeScale(0, 0, 0);
          this.sphereMesh.setMatrixAt(i, this._mat4);
          continue;
        }
        const age = t - spawn;
        const r = 1.2 + age * b.speed;
        const fade = smoothstep(0, 0.18, age) * (1 - smoothstep(30, 38, r));
        if (fade <= 0.002) {
          this._mat4.makeScale(0, 0, 0);
          this.sphereMesh.setMatrixAt(i, this._mat4);
          continue;
        }
        const spin = age * b.spinRate;
        const cs = Math.cos(spin);
        const sn = Math.sin(spin);
        this._pos.set(
          (b.dir.x * cs - b.dir.z * sn) * r,
          b.dir.y * r,
          (b.dir.x * sn + b.dir.z * cs) * r,
        );
        this._quat.identity();
        this._scale.setScalar(b.scale * fade);
        this._mat4.compose(this._pos, this._quat, this._scale);
        this.sphereMesh.setMatrixAt(i, this._mat4);
      }
    }
    this.sphereMesh.instanceMatrix.needsUpdate = true;

    // Ultra-clean cold minimalist bloom (pitch-black void between razor-sharp red/blue/white spheres!)
    const fx = ctx.postFX;
    fx.vignette = 0.44;
    fx.chromatic = 0.0008;
    fx.bloomThreshold = 1.24;
    fx.bloomStrength = 0.22;
    fx.bloomRadius = 0.28;
  }

  public getInstanceCount(): number {
    return this.bullets.length;
  }

  public dispose(scene: THREE.Scene): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    scene.remove(this.root);
    this.sphereMesh = null;
  }
}
