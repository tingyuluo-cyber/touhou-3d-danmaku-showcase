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
  spatialForm: '中空大玉 + 多尺度红蓝白纯粹矩阵',
  visualHighlight:
    '剥离一切法阵装饰, 还原纯狐原作标志性的多尺度纯粹圆弹体系: 巨型中空大红/大蓝泡弹, 中型纯蓝/纯红实心玉与万级细密红白小点交错成冷峻窒息的几何地狱.',
  implemented: true,
};

export const TH15_DURATION = 13.5;

const TH15_PHASES: TimelinePhase[] = [
  { id: 'pure1', label: '01 纯粹红蓝初环', start: 0.0, end: 3.0, badgeStyle: 'normal' },
  { id: 'bubbles', label: '02 中空大玉降临', start: 3.0, end: 6.6, badgeStyle: 'frozen' },
  { id: 'hell', label: '03 万弹纯粹地狱', start: 6.6, end: 11.4, badgeStyle: 'burst' },
  { id: 'void', label: '04 冰冷沉寂', start: 11.4, end: 13.5, badgeStyle: 'normal' },
];

type PureGroup = 'shell' | 'moire' | 'needleRing';

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

interface HollowBubbleSpec {
  waveIdx: number;
  dir: THREE.Vector3;
  speed: number;
  spinRate: number;
  scale: number;
  spawnTime: number;
  color: THREE.Color;
}

export class TH15PristineDanmakuHellSpell implements SpellCardInstance {
  public readonly metadata = TH15_METADATA;
  public readonly duration = TH15_DURATION;
  public readonly phases = TH15_PHASES;

  private root = new THREE.Group();
  private sphereMesh: THREE.InstancedMesh | null = null;
  private hollowBubbleMesh: THREE.InstancedMesh | null = null;
  private bullets: PureBulletSpec[] = [];
  private hollowBubbles: HollowBubbleSpec[] = [];

  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];

  private readonly _pos = new THREE.Vector3();
  private readonly _quat = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3();
  private readonly _mat4 = new THREE.Matrix4();

  public init(scene: THREE.Scene, _renderer: THREE.WebGLRenderer): void {
    // Stark pure obsidian void -- zero magic circles, zero ornamental clutter!
    scene.background = new THREE.Color(0x010103);
    scene.fog = new THREE.FogExp2(0x010103, 0.011);

    this.root = new THREE.Group();
    scene.add(this.root);

    // Strictly pure Junko primary colors: Pure Crimson, Cobalt Blue, Blinding White, Deep Magenta-Red
    const cRed = new THREE.Color(0xff1838);
    const cBlue = new THREE.Color(0x1e74ff);
    const cWhite = new THREE.Color(0xf8fbff);
    const cBubbleRed = new THREE.Color(0xff2048);
    const cBubbleBlue = new THREE.Color(0x2884ff);

    this.bullets = [];
    this.hollowBubbles = [];

    // 1. GIANT HOLLOW BUBBLE ORBS ("中空大红玉 / 中空大蓝玉" — 360 huge translucent rim-glow spheres!)
    // Authentic Junko signature contrast: huge slow hollow red/blue bubbles drifting ominously among tiny dots!
    const bubbleWaves = 9;
    const perBubbleWave = 40;
    for (let w = 0; w < bubbleWaves; w++) {
      const isBlueWave = w % 3 === 2;
      const col = isBlueWave ? cBubbleBlue : cBubbleRed;
      const spinSign = w % 2 === 0 ? 1 : -1;
      for (let i = 0; i < perBubbleWave; i++) {
        const unit = fibonacciSpherePoint(i, perBubbleWave);
        this.hollowBubbles.push({
          waveIdx: w,
          dir: unit.clone(),
          speed: 3.1 + (w % 2) * 0.55,
          spinRate: spinSign * 0.14,
          scale: isBlueWave ? 0.92 : 1.12, // Huge unmistakable hollow red bubble silhouette!
          spawnTime: 0.6 + w * 1.15,
          color: col.clone(),
        });
      }
    }

    // 2. Medium Solid Pure-Blue & Pure-Red Spherical Shells ("中玉·普通蓝 / 普通红" — 4,800 medium orbs!)
    const shells = 16;
    const perShell = 300;
    for (let w = 0; w < shells; w++) {
      const isBlue = w % 2 === 1;
      const col = isBlue ? cBlue : cRed;
      const spinSign = isBlue ? -1 : 1;
      for (let i = 0; i < perShell; i++) {
        const unit = fibonacciSpherePoint(i, perShell);
        this.bullets.push({
          group: 'shell',
          waveIdx: w,
          dir: unit.clone(),
          basePos: new THREE.Vector3(),
          speed: isBlue ? 5.6 : 4.8,
          spinRate: spinSign * 0.22,
          // Distinct medium size contrast (Blue medium 0.34, Red medium 0.27)
          scale: isBlue ? 0.34 : 0.27,
          color: col.clone(),
        });
      }
    }

    // 3. Dense Fine Crimson & Blue Moire Interference Dot Rings ("小玉·密集红蓝点" — 4,080 fine dots!)
    const moireRings = 24;
    const perMoire = 170;
    for (let rIdx = 0; rIdx < moireRings; rIdx++) {
      const col = rIdx % 3 === 0 ? cRed : rIdx % 3 === 1 ? cBlue : cWhite;
      const lat = (rIdx / (moireRings - 1) - 0.5) * Math.PI * 0.86;
      const cosLat = Math.cos(lat);
      const sinLat = Math.sin(lat);
      const radius = 11.2 + (rIdx % 4) * 3.5;
      const dirSign = rIdx % 2 === 0 ? 1 : -1;
      for (let j = 0; j < perMoire; j++) {
        const a = (j / perMoire) * Math.PI * 2;
        const bx = Math.cos(a) * cosLat * radius;
        const by = sinLat * radius;
        const bz = Math.sin(a) * cosLat * radius;
        this.bullets.push({
          group: 'moire',
          waveIdx: rIdx,
          dir: new THREE.Vector3(bx, by, bz).normalize(),
          basePos: new THREE.Vector3(bx, by, bz),
          speed: 0,
          spinRate: dirSign * (0.24 + (rIdx % 3) * 0.08),
          scale: 0.145, // Fine pinpoint dot scale!
          color: col.clone(),
        });
      }
    }

    // 4. Razor-Fast Pure-White & Crimson Pinpoint Micro-Orb Slicing Rings ("极小玉" — 2,400 micro-orbs!)
    const ringWaves = 12;
    const perRing = 200;
    for (let w = 0; w < ringWaves; w++) {
      const tilt = ((w % 4) - 1.5) * 0.44;
      const col = w % 2 === 0 ? cWhite : cRed;
      for (let i = 0; i < perRing; i++) {
        const a = (i / perRing) * Math.PI * 2;
        const dir = new THREE.Vector3(
          Math.cos(a),
          Math.sin(a) * Math.sin(tilt),
          Math.sin(a) * Math.cos(tilt),
        ).normalize();
        this.bullets.push({
          group: 'needleRing',
          waveIdx: w,
          dir,
          basePos: new THREE.Vector3(),
          speed: 9.2,
          spinRate: (w % 2 === 0 ? 1 : -1) * 0.36,
          scale: 0.115, // Razor-fine micro-pellet scale!
          color: col.clone(),
        });
      }
    }

    // Shader A: Crisp Solid Touhou Pure Orb (white center core + pure saturated red/blue rim)
    const sphereGeom = new THREE.SphereGeometry(1.0, 18, 12);
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
          vec3 col = mix(vColor * 1.05, vec3(1.06, 1.08, 1.12), smoothstep(0.62, 0.92, ndv));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.geometries.push(sphereGeom);
    this.materials.push(sphereMat);

    this.sphereMesh = new THREE.InstancedMesh(sphereGeom, sphereMat, this.bullets.length);
    this.sphereMesh.frustumCulled = false;
    for (let i = 0; i < this.bullets.length; i++) {
      this.sphereMesh.setColorAt(i, this.bullets[i].color);
    }
    if (this.sphereMesh.instanceColor) this.sphereMesh.instanceColor.needsUpdate = true;
    this.root.add(this.sphereMesh);

    // Shader B: GIANT HOLLOW TOUHOU BUBBLE ORB ("中空大红玉" — glassy transparent dark hollow center + blazing neon rim!)
    const bubbleGeom = new THREE.SphereGeometry(1.0, 28, 20);
    const bubbleMat = new THREE.ShaderMaterial({
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
          vNearFade = smoothstep(2.2, 5.8, -mvPos.z);
          #ifdef USE_INSTANCING_COLOR
            vColor = instanceColor;
          #else
            vColor = vec3(1.0, 0.15, 0.3);
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
          float rim = 1.0 - ndv;
          float rim2 = rim * rim;
          float rim4 = rim2 * rim2;
          // Sharp glowing hollow-bubble outer wall + razor white inner ring highlight + clear hollow interior!
          float innerHairline = exp(-((rim - 0.62) * (rim - 0.62)) / 0.0045);
          vec3 col = vColor * (0.65 + rim2 * 0.95) + vec3(1.15, 1.05, 1.08) * innerHairline * 0.68;
          float alpha = (0.045 + rim4 * 0.88 + innerHairline * 0.52) * vNearFade;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.95));
        }
      `,
    });
    this.geometries.push(bubbleGeom);
    this.materials.push(bubbleMat);

    this.hollowBubbleMesh = new THREE.InstancedMesh(bubbleGeom, bubbleMat, this.hollowBubbles.length);
    this.hollowBubbleMesh.frustumCulled = false;
    for (let i = 0; i < this.hollowBubbles.length; i++) {
      this.hollowBubbleMesh.setColorAt(i, this.hollowBubbles[i].color);
    }
    if (this.hollowBubbleMesh.instanceColor) this.hollowBubbleMesh.instanceColor.needsUpdate = true;
    this.root.add(this.hollowBubbleMesh);
  }

  public update(ctx: SpellUpdateContext): void {
    if (!this.sphereMesh || !this.hollowBubbleMesh) return;

    const t = ctx.time;
    const p = clamp(t / TH15_DURATION, 0, 1);
    const u = smootherstep(0, 1, p);

    // Cold, clinical slow orbital pullback staring right into the multi-scale pure bullet hell!
    const angle = u * Math.PI * 1.15;
    const radius = lerp(12.0, 29.0, u);
    ctx.cameraPose.position.set(
      Math.sin(angle) * radius,
      Math.sin(p * Math.PI) * 5.2,
      Math.cos(angle) * radius,
    );
    ctx.cameraPose.lookAt.set(0, 0, 0);
    ctx.cameraPose.roll = Math.sin(p * Math.PI * 2) * 0.04;
    ctx.cameraPose.fov = lerp(52, 46, u);
    ctx.cameraPose.shake = 0;

    const moireReveal = smoothstep(2.6, 5.4, t);
    const hellIntensity = smoothstep(6.2, 8.2, t);
    const latRot = t * 0.14;

    // 1. Update 360 Giant Hollow Crimson & Cobalt Bubble Orbs ("中空大玉")
    for (let i = 0; i < this.hollowBubbles.length; i++) {
      const hb = this.hollowBubbles[i];
      if (t < hb.spawnTime) {
        this._mat4.makeScale(0, 0, 0);
        this.hollowBubbleMesh.setMatrixAt(i, this._mat4);
        continue;
      }
      const age = t - hb.spawnTime;
      const r = 1.8 + age * hb.speed;
      const fade = smoothstep(0, 0.38, age) * (1 - smoothstep(27, 35, r));
      if (fade <= 0.002) {
        this._mat4.makeScale(0, 0, 0);
        this.hollowBubbleMesh.setMatrixAt(i, this._mat4);
        continue;
      }
      const spin = age * hb.spinRate;
      const cs = Math.cos(spin);
      const sn = Math.sin(spin);
      this._pos.set(
        (hb.dir.x * cs - hb.dir.z * sn) * r,
        hb.dir.y * r,
        (hb.dir.x * sn + hb.dir.z * cs) * r,
      );
      this._quat.identity();
      this._scale.setScalar(hb.scale * fade);
      this._mat4.compose(this._pos, this._quat, this._scale);
      this.hollowBubbleMesh.setMatrixAt(i, this._mat4);
    }
    this.hollowBubbleMesh.instanceMatrix.needsUpdate = true;

    // 2. Update 11,280 Multi-Scale Pure Solid Orbs (Medium Blue/Red, Fine Moire Dots, White Micro-Needles)
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
      } else if (b.group === 'moire') {
        if (moireReveal <= 0.002) {
          this._mat4.makeScale(0, 0, 0);
          this.sphereMesh.setMatrixAt(i, this._mat4);
          continue;
        }
        const breathe = 1.0 - hellIntensity * 0.14 + Math.sin(t * 2.2 + b.waveIdx * 0.5) * 0.06;
        const rot = t * b.spinRate + (b.waveIdx % 2 === 0 ? latRot : -latRot);
        const cr = Math.cos(rot);
        const sr = Math.sin(rot);
        const bx = b.basePos.x * breathe;
        const by = b.basePos.y * breathe;
        const bz = b.basePos.z * breathe;
        this._pos.set(bx * cr - bz * sr, by, bx * sr + bz * cr);
        this._quat.identity();
        this._scale.setScalar(b.scale * moireReveal);
        this._mat4.compose(this._pos, this._quat, this._scale);
        this.sphereMesh.setMatrixAt(i, this._mat4);
      } else {
        // Slicing pure-white & crimson micro-orb equatorial ring curtains during Climax!
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

    // Ultra-clean cold minimalist bloom (pitch-black void between giant hollow red bubbles & sharp solid dots!)
    const fx = ctx.postFX;
    fx.vignette = 0.44;
    fx.chromatic = 0.0008;
    fx.bloomThreshold = 1.22;
    fx.bloomStrength = 0.24;
    fx.bloomRadius = 0.3;
  }

  public getInstanceCount(): number {
    return this.bullets.length + this.hollowBubbles.length;
  }

  public dispose(scene: THREE.Scene): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    scene.remove(this.root);
    this.sphereMesh = null;
    this.hollowBubbleMesh = null;
  }
}
