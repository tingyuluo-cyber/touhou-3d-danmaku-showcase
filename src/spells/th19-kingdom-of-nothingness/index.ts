import * as THREE from 'three';
import type { SpellCardInstance, SpellMetadata, SpellUpdateContext } from '../types';
import type { TimelinePhase } from '../../core/Timeline';
import {
  clamp,
  createSeededRandom,
  lerp,
  orientForwardWithRoll,
  smootherstep,
  smoothstep,
} from '../../prototypes/DanmakuMath';

export const TH19_METADATA: SpellMetadata = {
  id: 'th19-kingdom-of-nothingness',
  gameCode: 'TH19',
  gameName: '东方兽王园',
  spellName: '"亡羊的王国"',
  character: '日白残无',
  bgm: '越轨者们的无碍光 ~ Kingdom of Nothingness',
  prototype: 'InstancedMesh粒子系统',
  spatialForm: '极高对比度 + 虚无波纹',
  visualHighlight:
    '情绪沉降收束段落: 极暗深渊虚空中, 仅存锐利猩红与冷白双色声波涟漪与 6,400 枚刃针波纹向外扩散吞噬空间, 冷峻克制.',
  implemented: true,
};

export const TH19_DURATION = 12.5;

const TH19_PHASES: TimelinePhase[] = [
  { id: 'abyss', label: '01 虚无初寂', start: 0.0, end: 3.0, badgeStyle: 'normal' },
  { id: 'ripples', label: '02 猩红声波扩散', start: 3.0, end: 6.6, badgeStyle: 'frozen' },
  { id: 'devour', label: '03 无碍光吞噬', start: 6.6, end: 10.6, badgeStyle: 'burst' },
  { id: 'hush', label: '04 万籁归无', start: 10.6, end: 12.5, badgeStyle: 'normal' },
];

interface RippleRingRig {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  cycleOffset: number;
  tiltQuat: THREE.Quaternion;
  isCrimson: boolean;
}

interface WaveNeedle {
  planeIdx: number;
  cycleOffset: number;
  angle: number;
  waveHarmonic: number;
  scale: number;
  isCrimson: boolean;
}

export class TH19KingdomOfNothingnessSpell implements SpellCardInstance {
  public readonly metadata = TH19_METADATA;
  public readonly duration = TH19_DURATION;
  public readonly phases = TH19_PHASES;

  private root = new THREE.Group();
  private voidSphere: THREE.Mesh | null = null;
  private rippleRings: RippleRingRig[] = [];
  private voidBlades: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; baseAz: number; tilt: number }[] = [];
  private needleMesh: THREE.InstancedMesh | null = null;
  private needles: WaveNeedle[] = [];
  private planeQuats: THREE.Quaternion[] = [];

  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];

  private readonly _pos = new THREE.Vector3();
  private readonly _dir = new THREE.Vector3();
  private readonly _quat = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3();
  private readonly _mat4 = new THREE.Matrix4();

  public init(scene: THREE.Scene, _renderer: THREE.WebGLRenderer): void {
    // Deepest austere void -- stark monochrome crimson & cold white contrast!
    scene.background = new THREE.Color(0x010102);
    scene.fog = new THREE.FogExp2(0x010102, 0.014);

    this.root = new THREE.Group();
    scene.add(this.root);

    // 1. Hollow Obsidian Singularity Core with razor-thin crimson eclipse rim
    const coreGeom = new THREE.SphereGeometry(2.2, 48, 36);
    const coreMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          float ndv = clamp(abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0);
          float rim = 1.0 - ndv;
          float sharp = rim * rim * rim * rim;
          vec3 col = mix(vec3(0.0, 0.0, 0.0), vec3(1.5, 0.12, 0.25), sharp * 1.45);
          col += vec3(1.2, 1.25, 1.35) * (sharp * sharp) * 0.9;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.voidSphere = new THREE.Mesh(coreGeom, coreMat);
    this.root.add(this.voidSphere);
    this.geometries.push(coreGeom);
    this.materials.push(coreMat);

    // 2. 4 Intersecting Acoustic Ripple Planes (Horizontal + Vertical + 2 Diagonals)
    const tilts: [number, number, number][] = [
      [Math.PI * 0.5, 0, 0],
      [Math.PI * 0.5 + 0.58, 0.42, 0.25],
      [Math.PI * 0.5 - 0.58, -0.42, -0.25],
      [0.08, 0.25, 0],
    ];
    this.planeQuats = tilts.map((e) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...e)));

    // 3. 16 Razor-Thin Expanding Concentric Void Echo Rings (alternating Crimson & Stark White!)
    const ringGeom = new THREE.TorusGeometry(1.0, 0.0055, 8, 128);
    this.geometries.push(ringGeom);
    this.rippleRings = [];

    for (let i = 0; i < 16; i++) {
      const isCrimson = i % 2 === 0;
      const mat = new THREE.MeshBasicMaterial({
        color: isCrimson ? 0xff1a3c : 0xf4f7ff,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(ringGeom, mat);
      const q = this.planeQuats[i % this.planeQuats.length];
      mesh.quaternion.copy(q);
      this.root.add(mesh);

      this.rippleRings.push({
        mesh,
        mat,
        cycleOffset: (i / 16) * 4.8,
        tiltQuat: q,
        isCrimson,
      });
    }

    // 4. 6,400 High-Contrast Razor Needle Bullets rippling outward in silent acoustic rings!
    const rand = createSeededRandom(20230813); // Touhou 19 UDoALG release date seed!
    const count = 6400;
    this.needles = [];

    // Sleek 8-facet tapered lancet needle (much crisper than 4-sided octahedron!)
    const needleGeom = new THREE.ConeGeometry(0.11, 1.05, 8);
    needleGeom.rotateX(Math.PI * 0.5);
    const needleMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.94,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.geometries.push(needleGeom);
    this.materials.push(needleMat);

    const cCrimson = new THREE.Color(0xff1838);
    const cWhite = new THREE.Color(0xf6f8ff);

    this.needleMesh = new THREE.InstancedMesh(needleGeom, needleMat, count);
    this.needleMesh.frustumCulled = false;

    const wavesPerPlane = 16;
    const perWave = count / (this.planeQuats.length * wavesPerPlane);
    let idx = 0;
    for (let pl = 0; pl < this.planeQuats.length; pl++) {
      for (let w = 0; w < wavesPerPlane; w++) {
        const isCrimson = (pl + w) % 2 === 0;
        const harmonic = 6 + (w % 4) * 2;
        for (let j = 0; j < perWave; j++) {
          const angle = (j / perWave) * Math.PI * 2 + w * 0.19;
          this.needles.push({
            planeIdx: pl,
            cycleOffset: (w / wavesPerPlane) * 4.8 + rand() * 0.04,
            angle,
            waveHarmonic: harmonic,
            scale: 0.42 + (j % 3) * 0.08,
            isCrimson,
          });
          this.needleMesh.setColorAt(idx, isCrimson ? cCrimson : cWhite);
          idx++;
        }
      }
    }
    if (this.needleMesh.instanceColor) this.needleMesh.instanceColor.needsUpdate = true;
    this.root.add(this.needleMesh);

    // 5. Zanmu's 6 Stark Crimson & Bone-White "Forked-Crossroad" Void Slash Beams ("歧路无碍光刃")!
    const bladeGeom = new THREE.CylinderGeometry(0.045, 0.22, 34, 10, 1, true);
    bladeGeom.translate(0, 19.1, 0); // emerges seamlessly from the r=2.2 crimson eclipse rim!
    this.geometries.push(bladeGeom);
    this.voidBlades = [];
    for (let i = 0; i < 6; i++) {
      const isCrimson = i % 2 === 0;
      const bMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uOpacity: { value: 0 },
          uColor: { value: new THREE.Color(isCrimson ? 0xff163a : 0xf4f7ff) },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vViewDir;
          void main() {
            vUv = uv;
            vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
            vNormal = normalize(normalMatrix * normal);
            vViewDir = normalize(-mvPos.xyz);
            gl_Position = projectionMatrix * mvPos;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uOpacity;
          uniform vec3 uColor;
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vViewDir;
          void main() {
            float ndv = clamp(abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0);
            float core = ndv * ndv;
            float tipFade = smoothstep(0.0, 0.1, vUv.y) * (1.0 - smoothstep(0.68, 1.0, vUv.y));
            vec3 col = mix(uColor * 1.1, vec3(1.35, 1.35, 1.42), smoothstep(0.65, 0.96, core));
            float alpha = (0.12 + core * 0.78) * tipFade * uOpacity;
            if (alpha < 0.005) discard;
            gl_FragColor = vec4(col, alpha);
          }
        `,
      });
      this.materials.push(bMat);
      const mesh = new THREE.Mesh(bladeGeom, bMat);
      const baseAz = (i / 6) * Math.PI * 2;
      const tilt = i % 2 === 0 ? 0.24 : -0.24;
      this.root.add(mesh);
      this.voidBlades.push({ mesh, mat: bMat, baseAz, tilt });
    }
  }

  public update(ctx: SpellUpdateContext): void {
    if (!this.needleMesh) return;

    const t = ctx.time;
    const p = clamp(t / TH19_DURATION, 0, 1);
    const u = smootherstep(0, 1, p);
    const climax = smoothstep(5.5, 7.8, t) * (1 - smoothstep(10.8, 12.2, t));

    // Cold, stately restrained camera arc (deliberately calm & severe compared to TH18's rainbow rush!)
    const orbitA = lerp(-0.5, 0.95, u);
    const radius = lerp(18.5, 29.5, u);
    ctx.cameraPose.position.set(
      Math.sin(orbitA) * radius,
      lerp(5.8, 12.5, u),
      Math.cos(orbitA) * radius,
    );
    ctx.cameraPose.lookAt.set(0, 0, 0);
    ctx.cameraPose.roll = Math.sin(p * Math.PI) * 0.04;
    ctx.cameraPose.fov = 46;
    ctx.cameraPose.shake = 0;

    const period = 4.8;

    // Expanding razor-thin crimson & white hollow acoustic rings
    for (let i = 0; i < this.rippleRings.length; i++) {
      const rr = this.rippleRings[i];
      const age = (t + rr.cycleOffset) % period;
      const frac = age / period;
      const r = 2.4 + frac * 30.0;
      const fade = smoothstep(0.0, 0.08, frac) * (1 - smoothstep(0.58, 1.0, frac));
      rr.mesh.scale.setScalar(r);
      rr.mat.opacity = fade * (0.72 + climax * 0.25);
    }

    // 6,400 sharp crimson & white acoustic ripple needles expanding outward
    for (let i = 0; i < this.needles.length; i++) {
      const n = this.needles[i];
      const age = (t + n.cycleOffset) % period;
      const frac = age / period;
      const fade = smoothstep(0.0, 0.1, frac) * (1 - smoothstep(0.65, 1.0, frac));
      if (fade <= 0.002) {
        this._mat4.makeScale(0, 0, 0);
        this.needleMesh.setMatrixAt(i, this._mat4);
        continue;
      }

      // Crisp standing-wave ripple contour around each expanding ring!
      const waveAmp = (0.35 + climax * 0.85) * Math.sin(n.angle * n.waveHarmonic + t * 2.0);
      const r = 2.4 + frac * 30.0 + waveAmp;
      const a = n.angle + frac * (n.isCrimson ? 0.35 : -0.35);

      this._pos.set(Math.cos(a) * r, Math.sin(a) * r, 0);
      this._pos.applyQuaternion(this.planeQuats[n.planeIdx]);

      this._dir.set(Math.cos(a), Math.sin(a), 0).applyQuaternion(this.planeQuats[n.planeIdx]).normalize();
      orientForwardWithRoll(this._dir, 0, this._quat);

      this._scale.setScalar(n.scale * fade);
      this._mat4.compose(this._pos, this._quat, this._scale);
      this.needleMesh.setMatrixAt(i, this._mat4);
    }
    this.needleMesh.instanceMatrix.needsUpdate = true;

    // Breathing obsidian eclipse core + 6 Forked-Crossroad Void Slash Beams ("歧路无碍光刃")
    const devourAge = Math.max(0, t - 6.6);
    const devourPulse = devourAge > 0 && devourAge < 1.8 ? Math.exp(-devourAge * 2.8) : 0;
    if (this.voidSphere) {
      this.voidSphere.scale.setScalar(1.0 + Math.sin(t * 2.2) * 0.04 + devourPulse * 0.36);
    }

    const bladeVis = smoothstep(2.8, 4.2, t) * (1 - smoothstep(10.8, 12.1, t));
    for (let i = 0; i < this.voidBlades.length; i++) {
      const vb = this.voidBlades[i];
      const az = vb.baseAz + t * (i % 2 === 0 ? 0.16 : -0.14);
      const el = vb.tilt + Math.sin(t * 0.7 + i) * 0.16;
      vb.mesh.rotation.set(Math.PI * 0.5 + el, 0, az);
      const scaleLen = 0.25 + bladeVis * 0.75 + climax * 0.25;
      vb.mesh.scale.set(0.85 + devourPulse * 0.45, scaleLen, 0.85 + devourPulse * 0.45);
      vb.mat.uniforms.uOpacity.value = bladeVis * (0.45 + climax * 0.38 + devourPulse * 0.25);
    }

    // Stark high-contrast grading with razor-crisp tight bloom
    const fx = ctx.postFX;
    fx.vignette = 0.48;
    fx.chromatic = 0.001 + devourPulse * 0.003;
    fx.bloomThreshold = 1.04;
    fx.bloomStrength = 0.42 + devourPulse * 0.14;
    fx.bloomRadius = 0.4;
  }

  public getInstanceCount(): number {
    return 16 + 6 + this.needles.length;
  }

  public dispose(scene: THREE.Scene): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    scene.remove(this.root);
    this.rippleRings = [];
    this.voidBlades = [];
    this.needleMesh = null;
  }
}
