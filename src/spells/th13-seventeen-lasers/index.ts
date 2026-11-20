import * as THREE from 'three';
import type { SpellCardInstance, SpellMetadata, SpellUpdateContext } from '../types';
import type { TimelinePhase } from '../../core/Timeline';
import {
  createPrismaticRibbonMaterial,
  createVolumetricBeamGeometry,
  createVolumetricBeamMaterial,
} from '../../prototypes/VolumetricLaserSystem';
import { CathedralStage } from './CathedralStage';
import {
  clamp,
  createSeededRandom,
  easeOutCubic,
  lerp,
  orientForwardWithRoll,
  smootherstep,
  smoothstep,
} from '../../prototypes/DanmakuMath';

export const TH13_METADATA: SpellMetadata = {
  id: 'th13-seventeen-lasers',
  gameCode: 'TH13',
  gameName: '东方神灵庙',
  spellName: '眼光 "十七条的光芒"',
  character: '丰聪耳神子',
  bgm: '圣德传说 ~ True Administrator',
  prototype: '体积激光与拖尾条带',
  spatialForm: '圣光穹顶 + 体积光束',
  visualHighlight:
    '17 道高亮度金色体积光束从中心向 3D 穹顶放射并缓慢扫掠, 搭配哥特彩窗光带与空气微尘, 尽显神圣线条美学.',
  implemented: true,
};

export const TH13_DURATION = 12.5;

const TH13_PHASES: TimelinePhase[] = [
  { id: 'descent', label: '01 圣光降临', start: 0.0, end: 2.8, badgeStyle: 'normal' },
  { id: 'ignite17', label: '02 十七条初现', start: 2.8, end: 6.0, badgeStyle: 'frozen' },
  { id: 'sweep', label: '03 圣光穹顶扫掠', start: 6.0, end: 10.2, badgeStyle: 'burst' },
  { id: 'crown', label: '04 威光永驻', start: 10.2, end: 12.5, badgeStyle: 'normal' },
];

interface BeamRig {
  group: THREE.Group;
  coreMat: THREE.ShaderMaterial;
  haloMat: THREE.ShaderMaterial;
  igniteAt: number;
  baseAzimuth: number;
}

interface ShardSpec {
  beamIdx: number;
  cycleOffset: number;
  speed: number;
  radialSpread: number;
  angleOffset: number;
  scale: number;
  color: THREE.Color;
}

export class TH13SeventeenLasersSpell implements SpellCardInstance {
  public readonly metadata = TH13_METADATA;
  public readonly duration = TH13_DURATION;
  public readonly phases = TH13_PHASES;

  private root = new THREE.Group();
  private cathedral: CathedralStage | null = null;
  private beams: BeamRig[] = [];
  private ribbonMats: THREE.ShaderMaterial[] = [];
  private shardMesh: THREE.InstancedMesh | null = null;
  private shards: ShardSpec[] = [];

  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];

  private camCurve: THREE.CatmullRomCurve3 | null = null;
  private lookCurve: THREE.CatmullRomCurve3 | null = null;

  private readonly apexOrigin = new THREE.Vector3(0, 7.2, -5.2);
  private readonly _origin = new THREE.Vector3();
  private readonly _dir = new THREE.Vector3();
  private readonly _pos = new THREE.Vector3();
  private readonly _quat = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3();
  private readonly _mat4 = new THREE.Matrix4();
  private readonly _activeCam = new THREE.Vector3();

  public init(scene: THREE.Scene, _renderer: THREE.WebGLRenderer): void {
    scene.background = new THREE.Color(0x04040a);
    scene.fog = new THREE.FogExp2(0x05050d, 0.011);

    this.root = new THREE.Group();
    scene.add(this.root);

    this.cathedral = new CathedralStage();
    this.root.add(this.cathedral.root);

    // 1. Exactly 17 Sacred Golden Volumetric Beams (core + atmospheric god-ray cone!)
    const coreGeom = createVolumetricBeamGeometry(0.06, 0.14, 46, 16);
    const haloGeom = createVolumetricBeamGeometry(0.22, 1.35, 46, 20);
    this.geometries.push(coreGeom, haloGeom);

    this.beams = [];
    const stainHaloPalette = [
      0xffbe48, // imperial gold
      0xffd66e, // sunlit amber
      0x74c2ff, // cathedral sapphire accent
      0xffcc58, // pure gold
      0x68ebb8, // sacred jade accent
      0xffb44c, // warm gold
      0xff7ca4, // stained rose accent
    ];

    for (let i = 0; i < 17; i++) {
      const group = new THREE.Group();
      const haloHex = i % 3 === 0 ? stainHaloPalette[i % stainHaloPalette.length] : 0xffc652;
      const coreMat = createVolumetricBeamMaterial(0xfffbe4, 0xffd268, 'core');
      const haloMat = createVolumetricBeamMaterial(0xffe69c, haloHex, 'halo');
      this.materials.push(coreMat, haloMat);

      const coreMesh = new THREE.Mesh(coreGeom, coreMat);
      const haloMesh = new THREE.Mesh(haloGeom, haloMat);
      group.add(coreMesh, haloMesh);
      this.root.add(group);

      this.beams.push({
        group,
        coreMat,
        haloMat,
        igniteAt: 2.3 + (i / 17) * 2.5,
        baseAzimuth: (i / 17) * Math.PI * 2,
      });
    }

    // 2. 17 Gothic Stained-Glass Cathedral Rib-Vault Ribbon Arcs framing the 3D dome!
    const archColors = [0xffcf5a, 0x52b0ff, 0x4ae8ac, 0xff628c, 0xc286ff];
    this.ribbonMats = [];
    for (let i = 0; i < 17; i++) {
      const a = (i / 17) * Math.PI * 2;
      const p0 = new THREE.Vector3(Math.cos(a) * 1.8, 7.2, -5.2 + Math.sin(a) * 1.8);
      const p1 = new THREE.Vector3(Math.cos(a + 0.16) * 11.5, 4.6, -5.2 + Math.sin(a + 0.16) * 11.5);
      const p2 = new THREE.Vector3(Math.cos(a + 0.24) * 18.0, -3.5, -5.2 + Math.sin(a + 0.24) * 18.0);
      const p3 = new THREE.Vector3(Math.cos(a + 0.3) * 19.5, -13.0, -5.2 + Math.sin(a + 0.3) * 19.5);

      const curve = new THREE.CatmullRomCurve3([p0, p1, p2, p3]);
      const tubeGeom = new THREE.TubeGeometry(curve, 44, 0.085, 6, false);
      const mat = createPrismaticRibbonMaterial(archColors[i % archColors.length], i * 0.7);
      this.geometries.push(tubeGeom);
      this.materials.push(mat);
      this.ribbonMats.push(mat);

      const archMesh = new THREE.Mesh(tubeGeom, mat);
      this.root.add(archMesh);
    }

    // 3. 1,700 Sacred Light-Shard Crystal Bullets soaring along the 17 volumetric beams!
    const rand = createSeededRandom(13001717);
    const shardCount = 1700;
    this.shards = [];

    const sCols = [
      new THREE.Color(0xffe896),
      new THREE.Color(0xfff7dc),
      new THREE.Color(0x7acaff),
      new THREE.Color(0x64f0b8),
      new THREE.Color(0xff84ac),
    ];

    for (let i = 0; i < shardCount; i++) {
      this.shards.push({
        beamIdx: i % 17,
        cycleOffset: rand() * 3.8,
        speed: 9.5 + rand() * 5.5,
        radialSpread: 0.25 + rand() * 1.4,
        angleOffset: rand() * Math.PI * 2,
        scale: 0.22 + rand() * 0.24,
        color: sCols[i % 10 < 6 ? i % 2 : 2 + (i % 3)].clone(),
      });
    }

    // Crisp elongated diamond crystal shard geometry along +Z
    const shardGeom = new THREE.OctahedronGeometry(0.42, 0);
    shardGeom.scale(0.42, 0.42, 2.35);
    const shardMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.geometries.push(shardGeom);
    this.materials.push(shardMat);

    this.shardMesh = new THREE.InstancedMesh(shardGeom, shardMat, shardCount);
    this.shardMesh.frustumCulled = false;
    for (let i = 0; i < shardCount; i++) {
      this.shardMesh.setColorAt(i, this.shards[i].color);
    }
    if (this.shardMesh.instanceColor) this.shardMesh.instanceColor.needsUpdate = true;
    this.root.add(this.shardMesh);

    // 4. Sweeping Gothic Cathedral Camera Spline:
    // Keeps clean theatrical viewing distance from all 17 sweeping shafts so every golden line stays crisp!
    this.camCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0.0, -7.8, 18.8),
        new THREE.Vector3(11.4, -4.4, 16.2),
        new THREE.Vector3(14.0, 0.2, 11.4),
        new THREE.Vector3(4.8, 1.6, 16.4),
        new THREE.Vector3(-12.2, -1.2, 14.8),
        new THREE.Vector3(-5.2, -3.8, 19.2),
        new THREE.Vector3(0.0, -4.8, 22.0),
      ],
      false,
      'centripetal',
      0.5,
    );

    this.lookCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0.0, 5.2, -4.8),
        new THREE.Vector3(0.0, 3.8, -4.5),
        new THREE.Vector3(-0.6, 2.5, -4.5),
        new THREE.Vector3(0.0, 3.2, -4.8),
        new THREE.Vector3(0.4, 2.8, -4.5),
        new THREE.Vector3(0.0, 3.8, -4.8),
        new THREE.Vector3(0.0, 4.8, -5.0),
      ],
      false,
      'centripetal',
      0.5,
    );
  }

  public update(ctx: SpellUpdateContext): void {
    if (!this.cathedral || !this.shardMesh || !this.camCurve || !this.lookCurve) return;

    const t = ctx.time;
    const p = clamp(t / TH13_DURATION, 0, 1);

    const introFade = smoothstep(0.0, 1.3, t);
    const climax = smoothstep(5.6, 7.0, t) * (1 - smoothstep(10.6, 12.2, t));
    const outroFade = 1 - smoothstep(11.1, 12.5, t);

    // 1. Evaluate cathedral camera spline
    const u = clamp(lerp(p, smootherstep(0, 1, p), 0.25), 0, 1);
    this.camCurve.getPoint(u, ctx.cameraPose.position);
    this.lookCurve.getPoint(u, ctx.cameraPose.lookAt);
    ctx.cameraPose.roll = Math.sin(p * Math.PI * 2.0) * 0.08;
    ctx.cameraPose.fov = 50 + climax * 5.0;
    ctx.cameraPose.shake = 0.0;

    if (ctx.isFreeCamera) {
      this._activeCam.copy(ctx.cameraWorldPosition);
    } else {
      this._activeCam.copy(ctx.cameraPose.position);
    }

    // 2. Update rose-window dome & sunlit dust motes
    this.cathedral.update(t, introFade, climax, outroFade, this._activeCam);

    // 3. Choreograph all 17 Golden Volumetric Beams & their emitter halo nodes!
    const beamOrigins: THREE.Vector3[] = [];
    const beamDirs: THREE.Vector3[] = [];
    const beamAlphas: number[] = [];

    for (let i = 0; i < 17; i++) {
      const rig = this.beams[i];
      const igniteP = easeOutCubic(clamp((t - rig.igniteAt) / 0.62, 0, 1));
      const crownFocus = smoothstep(10.1, 12.0, t);

      // Emitter root rotates gently around the imperial halo crown
      const a = rig.baseAzimuth + t * 0.24;
      const crownR = 2.6 + Math.sin(t * 1.1 + i * 0.6) * 0.35;
      const origin = new THREE.Vector3(
        this.apexOrigin.x + Math.cos(a) * crownR,
        this.apexOrigin.y + Math.sin(a) * crownR * 0.42,
        this.apexOrigin.z + Math.sin(a) * crownR * 0.72,
      );

      // Update miniature emitter node
      const node = this.cathedral.emitterNodes[i];
      if (node) {
        node.position.copy(origin);
        node.scale.setScalar((0.35 + 0.65 * igniteP) * outroFade);
        (node.material as THREE.MeshBasicMaterial).opacity = (0.32 + igniteP * 0.68) * outroFade;
      }

      // Sacred sweeping harmonic angle: beams fan outward like a cathedral light organ,
      // crisscross in alternating even/odd harmonics during Climax, and converge into a radiant spire at Crown!
      const altSign = i % 2 === 0 ? 1 : -1;
      const sweepAz = a + Math.sin(t * 0.92 + altSign * 0.8) * (0.25 + climax * 0.52);
      const coneSpread = lerp(
        0.58 + 0.24 * Math.sin(t * 1.25 + i * 0.74) + (i % 2) * 0.14,
        0.22,
        crownFocus,
      );

      // Beams stream downward & forward through the dark cathedral vault
      const dir = new THREE.Vector3(
        Math.cos(sweepAz) * coneSpread,
        -0.78 - 0.14 * Math.cos(t * 1.1 + i),
        0.42 + Math.sin(sweepAz) * coneSpread * 0.78,
      ).normalize();

      rig.group.position.copy(origin);
      orientForwardWithRoll(dir, 0, this._quat);
      rig.group.quaternion.copy(this._quat);

      // Beam extends dramatically from 0 -> full length on ignition!
      const beamLenScale = 0.05 + 0.95 * igniteP;
      const beamWidthScale = 0.75 + climax * 0.32;
      rig.group.scale.set(beamWidthScale, beamWidthScale, beamLenScale);

      const alpha = igniteP * outroFade;
      rig.coreMat.uniforms.uTime.value = t;
      rig.coreMat.uniforms.uOpacity.value = alpha * (0.85 + climax * 0.25);
      rig.haloMat.uniforms.uTime.value = t;
      rig.haloMat.uniforms.uOpacity.value = alpha * (0.72 + climax * 0.3);

      beamOrigins.push(origin);
      beamDirs.push(dir);
      beamAlphas.push(alpha);
    }

    // 4. Update 17 Gothic Stained-Glass Cathedral Rib-Vault Ribbons
    const archReveal = smoothstep(1.2, 4.2, t) * outroFade;
    for (let i = 0; i < this.ribbonMats.length; i++) {
      this.ribbonMats[i].uniforms.uTime.value = t;
      this.ribbonMats[i].uniforms.uOpacity.value = (0.38 + climax * 0.34) * archReveal;
    }

    // 5. Update 1,700 Sacred Crystal Light-Shards streaming down the 17 beams
    for (let i = 0; i < this.shards.length; i++) {
      const sh = this.shards[i];
      const bAlpha = beamAlphas[sh.beamIdx];
      if (bAlpha <= 0.02) {
        this._mat4.makeScale(0, 0, 0);
        this.shardMesh.setMatrixAt(i, this._mat4);
        continue;
      }

      const cycle = (t + sh.cycleOffset) % 3.8;
      const travel = cycle * sh.speed;
      const fade = smoothstep(0.0, 0.25, cycle) * (1 - smoothstep(2.9, 3.8, cycle));

      this._origin.copy(beamOrigins[sh.beamIdx]);
      this._dir.copy(beamDirs[sh.beamIdx]);

      // Small helical orbit around its parent golden beam
      const swirlA = sh.angleOffset + cycle * 2.4;
      const spread = sh.radialSpread * (0.25 + travel * 0.032);
      this._pos.copy(this._origin).addScaledVector(this._dir, travel);
      this._pos.x += Math.cos(swirlA) * spread;
      this._pos.z += Math.sin(swirlA) * spread;

      orientForwardWithRoll(this._dir, swirlA, this._quat);
      const sc = sh.scale * fade * bAlpha;
      this._scale.setScalar(sc);
      this._mat4.compose(this._pos, this._quat, this._scale);
      this.shardMesh.setMatrixAt(i, this._mat4);
    }
    this.shardMesh.instanceMatrix.needsUpdate = true;

    // 6. Sacred Golden Post-Processing FX (crisp clean lines, ethereal stained-glass glow!)
    const fx = ctx.postFX;
    fx.vignette = 0.36;
    fx.chromatic = 0.0012 + climax * 0.0012;
    fx.bloomThreshold = 0.96;
    fx.bloomStrength = 0.44 + climax * 0.14;
    fx.bloomRadius = 0.52;
  }

  public getInstanceCount(): number {
    return 17 + 17 + this.shards.length + 2600;
  }

  public dispose(scene: THREE.Scene): void {
    this.cathedral?.dispose();
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    scene.remove(this.root);
    this.cathedral = null;
    this.beams = [];
    this.ribbonMats = [];
    this.shardMesh = null;
  }
}
