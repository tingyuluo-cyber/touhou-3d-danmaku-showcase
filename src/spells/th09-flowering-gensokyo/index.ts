import * as THREE from 'three';
import type { SpellCardInstance, SpellMetadata, SpellUpdateContext } from '../types';
import type { TimelinePhase } from '../../core/Timeline';
import { createPrismaticRibbonMaterial } from '../../prototypes/VolumetricLaserSystem';
import {
  clamp,
  createSeededRandom,
  easeOutCubic,
  lerp,
  smootherstep,
  smoothstep,
} from '../../prototypes/DanmakuMath';
import { createSoftGlowTexture } from '../../prototypes/MagicCircleFactory';

export const TH09_METADATA: SpellMetadata = {
  id: 'th09-flowering-gensokyo',
  gameCode: 'TH09',
  gameName: '东方花映冢',
  spellName: '花符 "幻想乡的开花"',
  character: '风见幽香',
  bgm: '今昔幻想乡 ~ Flower Land',
  prototype: '体积激光与拖尾条带',
  spatialForm: '高明度立体绽放',
  visualHighlight:
    '全片少有的暖金明亮日光调剂段落: 48 瓣立体光带花苞层层剥开绽放, 伴随向日葵斐波那契金蕊与暖阳花瓣弹幕.',
  implemented: true,
};

export const TH09_DURATION = 12.0;

const TH09_PHASES: TimelinePhase[] = [
  { id: 'bud', label: '01 金苞初含', start: 0.0, end: 2.8, badgeStyle: 'normal' },
  { id: 'peel', label: '02 层层剥开', start: 2.8, end: 6.4, badgeStyle: 'frozen' },
  { id: 'fullbloom', label: '03 幻想乡满开', start: 6.4, end: 10.2, badgeStyle: 'burst' },
  { id: 'sunlit', label: '04 暖阳余韵', start: 10.2, end: 12.0, badgeStyle: 'normal' },
];

interface PetalRibbonRig {
  pivot: THREE.Group;
  tier: number;
  azimuth: number;
  closedPitch: number;
  openPitch: number;
  openDelay: number;
  mat: THREE.ShaderMaterial;
}

interface PollenBullet {
  spawnTime: number;
  azimuth: number;
  elevation: number;
  speed: number;
  swirl: number;
  scale: number;
  color: THREE.Color;
}

export class TH09FloweringGensokyoSpell implements SpellCardInstance {
  public readonly metadata = TH09_METADATA;
  public readonly duration = TH09_DURATION;
  public readonly phases = TH09_PHASES;

  private root = new THREE.Group();
  private skyDome: THREE.Mesh | null = null;
  private flowerRoot = new THREE.Group();
  private petalRigs: PetalRibbonRig[] = [];
  private coreSeedMesh: THREE.InstancedMesh | null = null;
  private pollenMesh: THREE.InstancedMesh | null = null;
  private sunDust: THREE.Points | null = null;

  private pollens: PollenBullet[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private textures: THREE.Texture[] = [];

  private camCurve: THREE.CatmullRomCurve3 | null = null;
  private readonly _pos = new THREE.Vector3();
  private readonly _quat = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3();
  private readonly _mat4 = new THREE.Matrix4();

  public init(scene: THREE.Scene, _renderer: THREE.WebGLRenderer): void {
    // Bright sunlit warm amber-cream backdrop (intentional bright breather in the dark-void montage!)
    scene.background = new THREE.Color(0x231608);
    scene.fog = new THREE.FogExp2(0x2a1b0a, 0.0085);

    this.root = new THREE.Group();
    scene.add(this.root);

    // 1. Warm Sunlit Golden Sky Gradient Dome
    const skyGeom = new THREE.SphereGeometry(95, 32, 24);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 lower = vec3(0.14, 0.09, 0.05);
          vec3 mid = vec3(0.36, 0.24, 0.09);
          vec3 zenith = vec3(0.62, 0.48, 0.24);
          vec3 col = mix(lower, mid, smoothstep(0.0, 0.55, h));
          col = mix(col, zenith, smoothstep(0.45, 1.0, h));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.skyDome = new THREE.Mesh(skyGeom, skyMat);
    this.root.add(this.skyDome);
    this.geometries.push(skyGeom);
    this.materials.push(skyMat);

    this.flowerRoot = new THREE.Group();
    this.root.add(this.flowerRoot);

    // 2. 48 Sculpted 3D Volumetric Ribbon Petals arranged in 3 concentric peeling tiers!
    const tierConfigs = [
      { count: 16, length: 9.5, curveArch: 3.2, closedPitch: 1.28, openPitch: 0.42, delay: 1.4, colors: [0xffe066, 0xffbe42] },
      { count: 16, length: 13.8, curveArch: 4.5, closedPitch: 1.15, openPitch: 0.08, delay: 2.8, colors: [0xff9a52, 0xff6b82] },
      { count: 16, length: 17.5, curveArch: 5.4, closedPitch: 0.98, openPitch: -0.24, delay: 4.2, colors: [0x82e68c, 0xffd268] },
    ];

    this.petalRigs = [];
    for (let tIdx = 0; tIdx < tierConfigs.length; tIdx++) {
      const cfg = tierConfigs[tIdx];
      // Build arched double-ribbon petal loop (extends radially along +Z so rotating around X peels it open!)
      const petalPts = [
        new THREE.Vector3(0, 0, 0.8),
        new THREE.Vector3(cfg.length * 0.12, cfg.curveArch * 0.55, cfg.length * 0.38),
        new THREE.Vector3(cfg.length * 0.09, cfg.curveArch * 0.45, cfg.length * 0.76),
        new THREE.Vector3(0, 0.0, cfg.length),
        new THREE.Vector3(-cfg.length * 0.09, cfg.curveArch * 0.45, cfg.length * 0.76),
        new THREE.Vector3(-cfg.length * 0.12, cfg.curveArch * 0.55, cfg.length * 0.38),
        new THREE.Vector3(0, 0, 0.8),
      ];
      const petalCurve = new THREE.CatmullRomCurve3(petalPts);
      const tubeGeom = new THREE.TubeGeometry(petalCurve, 44, 0.14 + tIdx * 0.03, 7, false);
      // Central midrib vein beam down each petal
      const ribCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0.8),
        new THREE.Vector3(0, cfg.curveArch * 0.38, cfg.length * 0.52),
        new THREE.Vector3(0, 0, cfg.length),
      ]);
      const ribGeom = new THREE.TubeGeometry(ribCurve, 24, 0.09, 6, false);
      this.geometries.push(tubeGeom, ribGeom);

      for (let i = 0; i < cfg.count; i++) {
        const azimuth = (i / cfg.count) * Math.PI * 2 + tIdx * (Math.PI / cfg.count);
        const azimuthHolder = new THREE.Group();
        azimuthHolder.rotation.y = azimuth;

        const pivot = new THREE.Group();
        const colHex = cfg.colors[i % cfg.colors.length];
        const mat = createPrismaticRibbonMaterial(colHex, i * 0.65 + tIdx * 2.1);
        this.materials.push(mat);

        const outlineMesh = new THREE.Mesh(tubeGeom, mat);
        const ribMesh = new THREE.Mesh(ribGeom, mat);
        pivot.add(outlineMesh, ribMesh);
        azimuthHolder.add(pivot);
        this.flowerRoot.add(azimuthHolder);

        this.petalRigs.push({
          pivot,
          tier: tIdx,
          azimuth,
          closedPitch: cfg.closedPitch,
          openPitch: cfg.openPitch,
          openDelay: cfg.delay + (i % 4) * 0.18,
          mat,
        });
      }
    }

    // 3. Golden Sunflower Phyllotaxis Seed Core (600 sparkling golden orbs in exact Vogel spiral!)
    const seedCount = 600;
    const seedGeom = new THREE.SphereGeometry(0.18, 10, 8);
    const seedMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.geometries.push(seedGeom);
    this.materials.push(seedMat);

    this.coreSeedMesh = new THREE.InstancedMesh(seedGeom, seedMat, seedCount);
    const goldenAngle = 2.39996323;
    const cCore = new THREE.Color(0xfff0a0);
    const cAmber = new THREE.Color(0xff9c2e);
    const tmpCol = new THREE.Color();
    for (let i = 0; i < seedCount; i++) {
      const r = Math.sqrt(i / seedCount) * 3.8;
      const a = i * goldenAngle;
      const domeY = Math.cos((r / 3.8) * Math.PI * 0.5) * 1.1;
      this._pos.set(Math.cos(a) * r, domeY, Math.sin(a) * r);
      this._quat.identity();
      this._scale.setScalar(0.65 + (1 - r / 3.8) * 0.65);
      this._mat4.compose(this._pos, this._quat, this._scale);
      this.coreSeedMesh.setMatrixAt(i, this._mat4);
      tmpCol.copy(cCore).lerp(cAmber, r / 3.8);
      this.coreSeedMesh.setColorAt(i, tmpCol);
    }
    this.coreSeedMesh.instanceMatrix.needsUpdate = true;
    if (this.coreSeedMesh.instanceColor) this.coreSeedMesh.instanceColor.needsUpdate = true;
    this.flowerRoot.add(this.coreSeedMesh);

    // 4. 3,400 Sparkling Blooming Sun-Pollen & Petal Bullets bursting radially outward!
    const rand = createSeededRandom(20050814); // Touhou 09 PoFV release date seed!
    const pollenCount = 3400;
    this.pollens = [];
    const palette = [
      new THREE.Color(0xffe878),
      new THREE.Color(0xffb44c),
      new THREE.Color(0xff7ca4),
      new THREE.Color(0x8cf298),
      new THREE.Color(0xfffbe0),
    ];
    for (let i = 0; i < pollenCount; i++) {
      const wave = i % 10;
      const frac = Math.floor(i / 10) / (pollenCount / 10);
      this.pollens.push({
        spawnTime: 1.4 + wave * 0.85 + rand() * 0.25,
        azimuth: frac * Math.PI * 2 * 5 + wave * 0.45,
        elevation: -0.2 + rand() * 1.15,
        speed: 3.6 + (i % 5) * 0.9 + rand() * 1.2,
        swirl: (wave % 2 === 0 ? 1 : -1) * (0.28 + rand() * 0.24),
        scale: 0.14 + rand() * 0.22,
        color: palette[i % palette.length].clone(),
      });
    }

    const polGeom = new THREE.OctahedronGeometry(0.65, 1);
    const polMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.geometries.push(polGeom);
    this.materials.push(polMat);

    this.pollenMesh = new THREE.InstancedMesh(polGeom, polMat, pollenCount);
    this.pollenMesh.frustumCulled = false;
    for (let i = 0; i < pollenCount; i++) {
      this.pollenMesh.setColorAt(i, this.pollens[i].color);
    }
    if (this.pollenMesh.instanceColor) this.pollenMesh.instanceColor.needsUpdate = true;
    this.root.add(this.pollenMesh);

    // 5. Floating Warm Sunlit Motes
    const glowTex = createSoftGlowTexture(128);
    this.textures.push(glowTex);
    const dustCount = 1200;
    const dPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      dPos[i * 3] = (rand() - 0.5) * 46;
      dPos[i * 3 + 1] = (rand() - 0.5) * 30 + 4;
      dPos[i * 3 + 2] = (rand() - 0.5) * 46;
    }
    const dGeom = new THREE.BufferGeometry();
    dGeom.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
    const dMat = new THREE.PointsMaterial({
      size: 0.34,
      map: glowTex,
      color: 0xffeba8,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.sunDust = new THREE.Points(dGeom, dMat);
    this.root.add(this.sunDust);
    this.geometries.push(dGeom);
    this.materials.push(dMat);

    // 6. Camera: Intimate look at closed golden bud -> graceful spiral rise revealing full 3D blooming sun-flower!
    this.camCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0.0, 4.5, 14.5),
        new THREE.Vector3(10.5, 8.2, 13.0),
        new THREE.Vector3(14.5, 13.6, 5.2),
        new THREE.Vector3(4.2, 19.5, 11.4),
        new THREE.Vector3(-12.4, 15.8, 16.5),
        new THREE.Vector3(-4.5, 13.5, 24.5),
      ],
      false,
      'centripetal',
      0.5,
    );
  }

  public update(ctx: SpellUpdateContext): void {
    if (!this.pollenMesh || !this.camCurve) return;

    const t = ctx.time;
    const p = clamp(t / TH09_DURATION, 0, 1);
    const u = clamp(lerp(p, smootherstep(0, 1, p), 0.28), 0, 1);

    this.camCurve.getPoint(u, ctx.cameraPose.position);
    ctx.cameraPose.lookAt.set(0, 2.0, 0);
    ctx.cameraPose.roll = Math.sin(p * Math.PI * 1.5) * 0.06;
    ctx.cameraPose.fov = 50 + Math.sin(p * Math.PI) * 5.0;
    ctx.cameraPose.shake = 0;

    // Slowly rotate the whole blooming 3D blossom
    this.flowerRoot.rotation.y = t * 0.22;

    // Peel all 48 volumetric ribbon petals open smoothly tier-by-tier!
    for (let i = 0; i < this.petalRigs.length; i++) {
      const rig = this.petalRigs[i];
      const openP = easeOutCubic(clamp((t - rig.openDelay) / 3.4, 0, 1));
      const breathe = Math.sin(t * 2.1 + rig.azimuth * 2.0) * 0.04 * openP;
      rig.pivot.rotation.x = -lerp(rig.closedPitch, rig.openPitch, openP) + breathe;
      rig.mat.uniforms.uTime.value = t;
      rig.mat.uniforms.uOpacity.value = 0.65 + openP * 0.35;
    }

    // Update 3,400 sparkling sun-pollen bullets blossoming outward
    for (let i = 0; i < this.pollens.length; i++) {
      const b = this.pollens[i];
      if (t < b.spawnTime) {
        this._mat4.makeScale(0, 0, 0);
        this.pollenMesh.setMatrixAt(i, this._mat4);
        continue;
      }
      const age = t - b.spawnTime;
      const life = 1 - smoothstep(5.4, 7.6, age);
      if (life <= 0.002) {
        this._mat4.makeScale(0, 0, 0);
        this.pollenMesh.setMatrixAt(i, this._mat4);
        continue;
      }

      const r = 1.6 + age * b.speed;
      const a = b.azimuth + age * b.swirl;
      const elev = b.elevation - age * 0.05;
      this._pos.set(
        Math.cos(a) * Math.cos(elev) * r,
        1.2 + Math.sin(elev) * r + Math.sin(age * 2.5 + i) * 0.4,
        Math.sin(a) * Math.cos(elev) * r,
      );
      this._quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a + age * 2.0);
      this._scale.setScalar(b.scale * smoothstep(0, 0.4, age) * life);
      this._mat4.compose(this._pos, this._quat, this._scale);
      this.pollenMesh.setMatrixAt(i, this._mat4);
    }
    this.pollenMesh.instanceMatrix.needsUpdate = true;

    if (this.sunDust) {
      this.sunDust.rotation.y = -t * 0.04;
      this.sunDust.position.y = Math.sin(t * 0.5) * 1.2;
    }

    const fx = ctx.postFX;
    fx.vignette = 0.26;
    fx.chromatic = 0.001;
    fx.warmGrade = 0.32;
    fx.bloomThreshold = 1.16;
    fx.bloomStrength = 0.28;
    fx.bloomRadius = 0.42;
  }

  public getInstanceCount(): number {
    return 48 + 600 + this.pollens.length + 1200;
  }

  public dispose(scene: THREE.Scene): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    scene.remove(this.root);
    this.petalRigs = [];
    this.pollenMesh = null;
    this.coreSeedMesh = null;
  }
}
