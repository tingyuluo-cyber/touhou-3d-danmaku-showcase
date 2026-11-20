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
import { createSoftGlowTexture } from '../../prototypes/MagicCircleFactory';

export const TH20_METADATA: SpellMetadata = {
  id: 'th20-danmaku-fossil',
  gameCode: 'TH20',
  gameName: '东方锦上京',
  spellName: '"弹幕的化石"',
  character: '磐永阿梨夜',
  bgm: '最后一人也早已习惯 ~ Stone Goddess',
  prototype: '特定3D模型实例化',
  spatialForm: '地质层理 / 结晶化石感',
  visualHighlight:
    '全片最新作纪念收尾: 2,800 枚切面琥珀与翡翠晶簇沿着远古鹦鹉螺化石螺旋与地质层理流转, 随后自中心向外逐层凝固石化成永恒水晶弹幕碑.',
  implemented: true,
};

export const TH20_DURATION = 14.5;

const TH20_PHASES: TimelinePhase[] = [
  { id: 'flow', label: '01 表里流转', start: 0.0, end: 3.6, badgeStyle: 'normal' },
  { id: 'petrify', label: '02 琥珀石化凝滞', start: 3.6, end: 8.0, badgeStyle: 'frozen' },
  { id: 'monument', label: '03 永恒化石碑', start: 8.0, end: 12.0, badgeStyle: 'burst' },
  { id: 'finale', label: '04 幻想乡终幕', start: 12.0, end: 14.5, badgeStyle: 'normal' },
];

interface CrystalSpec {
  layer: 'ammonite' | 'strata';
  armIdx: number;
  baseRadius: number;
  baseAngle: number;
  baseY: number;
  flowSpeed: number;
  petrifyAt: number;
  scaleX: number;
  scaleZ: number;
  roll: number;
  livingColor: THREE.Color;
  fossilColor: THREE.Color;
}

/**
 * Builds a true Double-Terminated Hexagonal Quartz Crystal Spire aligned along +Z:
 * sleek tapered 6-sided hexagonal shaft capped with razor-sharp 6-faced pyramid points
 * on BOTH ends (replaces blunt flat cylinders!) with crisp flat facet specular normals.
 */
function createQuartzCrystalGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const sides = 6;
  const rShaft = 0.16;
  const zBackTip = -0.82;
  const zBackBase = -0.44;
  const zFrontBase = 0.44;
  const zFrontTip = 0.88;

  const ringPts = (r: number, z: number): [number, number, number][] => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      pts.push([Math.cos(a) * r, Math.sin(a) * r, z]);
    }
    return pts;
  };

  const backRing = ringPts(rShaft * 0.92, zBackBase);
  const frontRing = ringPts(rShaft, zFrontBase);
  const backTip: [number, number, number] = [0, 0, zBackTip];
  const frontTip: [number, number, number] = [0, 0, zFrontTip];

  const tri = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) => {
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  };

  for (let i = 0; i < sides; i++) {
    const n = (i + 1) % sides;
    // Front sharp crystal spire pyramid (+Z)
    tri(frontTip, frontRing[i], frontRing[n]);
    // Hexagonal shaft bevel quad
    tri(frontRing[i], backRing[i], backRing[n]);
    tri(frontRing[i], backRing[n], frontRing[n]);
    // Rear crystal termination pyramid (-Z)
    tri(backTip, backRing[n], backRing[i]);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
}

export class TH20DanmakuFossilSpell implements SpellCardInstance {
  public readonly metadata = TH20_METADATA;
  public readonly duration = TH20_DURATION;
  public readonly phases = TH20_PHASES;

  private root = new THREE.Group();
  private crystalMesh: THREE.InstancedMesh | null = null;
  private strataRings: THREE.Mesh[] = [];
  private dustPoints: THREE.Points | null = null;
  private crystals: CrystalSpec[] = [];

  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private textures: THREE.Texture[] = [];

  private camCurve: THREE.CatmullRomCurve3 | null = null;
  private readonly _pos = new THREE.Vector3();
  private readonly _dir = new THREE.Vector3();
  private readonly _quat = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3();
  private readonly _mat4 = new THREE.Matrix4();
  private readonly _col = new THREE.Color();

  public init(scene: THREE.Scene, _renderer: THREE.WebGLRenderer): void {
    scene.background = new THREE.Color(0x060504);
    scene.fog = new THREE.FogExp2(0x080705, 0.011);

    this.root = new THREE.Group();
    scene.add(this.root);

    // Museum-grade warm amber-gold & ancient jade rim lighting for crystal facets!
    const amb = new THREE.AmbientLight(0x524638, 0.85);
    const amberSun = new THREE.DirectionalLight(0xffd286, 2.8);
    amberSun.position.set(14, 20, 14);
    const jadeRim = new THREE.PointLight(0x46d8c4, 34, 62, 1.4);
    jadeRim.position.set(-16, -6, 10);
    const goldCore = new THREE.PointLight(0xffa638, 36, 56, 1.4);
    goldCore.position.set(0, 2, 2);
    this.root.add(amb, amberSun, jadeRim, goldCore);

    // 1. Subtle Glowing Geological Strata Contour Rings (evoking fossil rock layers!)
    this.strataRings = [];
    for (let i = 0; i < 7; i++) {
      const r = 4.2 + i * 3.1;
      const rGeom = new THREE.TorusGeometry(r, 0.035, 8, 96);
      const rMat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xffbe5c : 0x56c8bc,
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const rMesh = new THREE.Mesh(rGeom, rMat);
      rMesh.rotation.x = Math.PI * 0.48;
      rMesh.position.y = (i - 3) * 1.45;
      this.root.add(rMesh);
      this.strataRings.push(rMesh);
      this.geometries.push(rGeom);
      this.materials.push(rMat);
    }

    // 2. 2,800 Sculpted Faceted Quartz/Amber Crystal Fossils
    const rand = createSeededRandom(20250817); // Touhou 20 Fossilized Wonders release seed!
    const totalCount = 2800;
    this.crystals = [];

    // Authentic TH20 "弹幕的化石": vivid living Touhou danmaku colors -> petrify into ancient amber/jade/stone fossil!
    const livingPalette = [
      new THREE.Color(0xff4278), // vivid danmaku crimson
      new THREE.Color(0x42c2ff), // vivid danmaku azure
      new THREE.Color(0xa674ff), // vivid danmaku violet
      new THREE.Color(0x46f0b2), // vivid danmaku emerald
    ];
    const cAmber = new THREE.Color(0xffb446);
    const cGold = new THREE.Color(0xffe096);
    const cJade = new THREE.Color(0x52c4b4);
    const cQuartz = new THREE.Color(0xe8dfd0);
    const cSlate = new THREE.Color(0x888076);

    // Layer A: Colossal 3D Logarithmic Ammonite Fossil Spiral (1,800 double-terminated quartz spires!)
    const ammoniteCount = 1800;
    const arms = 6;
    for (let i = 0; i < ammoniteCount; i++) {
      const armIdx = i % arms;
      const frac = Math.floor(i / arms) / (ammoniteCount / arms);
      const theta = frac * Math.PI * 4.6 + (armIdx / arms) * Math.PI * 2;
      const r = 1.6 + Math.pow(frac, 1.15) * 20.5;
      const y = (frac - 0.5) * 6.5 * Math.sin(theta * 0.5) + (rand() - 0.5) * 1.2;

      const fossilCol =
        i % 5 === 0
          ? cJade
          : i % 3 === 0
            ? cAmber
            : i % 4 === 0
              ? cQuartz
              : cGold;

      this.crystals.push({
        layer: 'ammonite',
        armIdx,
        baseRadius: r,
        baseAngle: theta,
        baseY: y,
        flowSpeed: 0.42 + (1 - frac) * 0.35,
        petrifyAt: 3.4 + frac * 4.6,
        scaleX: 0.62 + (1 - frac * 0.4) * 0.55 + rand() * 0.24,
        scaleZ: 0.85 + rand() * 0.95,
        roll: rand() * Math.PI * 2,
        livingColor: livingPalette[armIdx % livingPalette.length].clone(),
        fossilColor: fossilCol.clone(),
      });
    }

    // Layer B: Sweeping Curved Geological Strata Crystal Cliffs (1,000 spires!)
    const strataCount = totalCount - ammoniteCount;
    for (let i = 0; i < strataCount; i++) {
      const band = i % 6;
      const yBand = ((band - 2.5) * 3.8) + (rand() - 0.5) * 0.9;
      const r = 9.0 + rand() * 18.0;
      const angle = rand() * Math.PI * 2;
      const fossilCol = band % 3 === 0 ? cAmber : band % 3 === 1 ? cSlate : cJade;

      this.crystals.push({
        layer: 'strata',
        armIdx: band,
        baseRadius: r,
        baseAngle: angle,
        baseY: yBand,
        flowSpeed: (band % 2 === 0 ? 1 : -1) * 0.16,
        petrifyAt: 4.0 + (r / 27.0) * 4.0,
        scaleX: 0.72 + rand() * 0.62,
        scaleZ: 0.95 + rand() * 1.1,
        roll: rand() * Math.PI * 2,
        livingColor: livingPalette[band % livingPalette.length].clone(),
        fossilColor: fossilCol.clone(),
      });
    }

    const crystalGeom = createQuartzCrystalGeometry();
    const crystalMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0.48,
      roughness: 0.12,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
      envMapIntensity: 1.5,
      emissive: new THREE.Color(0x4a2e12),
      emissiveIntensity: 0.34,
    });
    this.geometries.push(crystalGeom);
    this.materials.push(crystalMat);

    this.crystalMesh = new THREE.InstancedMesh(crystalGeom, crystalMat, totalCount);
    this.crystalMesh.frustumCulled = false;
    for (let i = 0; i < totalCount; i++) {
      this.crystalMesh.setColorAt(i, this.crystals[i].livingColor);
    }
    if (this.crystalMesh.instanceColor) this.crystalMesh.instanceColor.needsUpdate = true;
    this.root.add(this.crystalMesh);

    // 3. Suspended Golden Amber Dust Motes (freeze alongside the petrified danmaku!)
    const glowTex = createSoftGlowTexture(128);
    this.textures.push(glowTex);
    const dustCount = 1400;
    const dPos = new Float32Array(dustCount * 3);
    const dCol = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      const r = 4 + rand() * 34;
      const a = rand() * Math.PI * 2;
      dPos[i * 3] = Math.cos(a) * r;
      dPos[i * 3 + 1] = (rand() - 0.5) * 24;
      dPos[i * 3 + 2] = Math.sin(a) * r;
      const c = i % 3 === 0 ? cJade : cGold;
      dCol[i * 3] = c.r;
      dCol[i * 3 + 1] = c.g;
      dCol[i * 3 + 2] = c.b;
    }
    const dustGeom = new THREE.BufferGeometry();
    dustGeom.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
    dustGeom.setAttribute('color', new THREE.BufferAttribute(dCol, 3));
    const dustMat = new THREE.PointsMaterial({
      size: 0.28,
      map: glowTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.58,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.dustPoints = new THREE.Points(dustGeom, dustMat);
    this.root.add(this.dustPoints);
    this.geometries.push(dustGeom);
    this.materials.push(dustMat);

    // 4. Reverent Finale Crane-Orbit Camera gliding past crystallizing amber formations,
    // pulling out into a grand commemorative shot of the Eternal Fossilized Danmaku Monument!
    this.camCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0.0, 4.5, 22.0),
        new THREE.Vector3(12.2, 7.6, 17.5),
        new THREE.Vector3(16.8, 12.2, 6.4),
        new THREE.Vector3(6.5, 16.4, 15.2),
        new THREE.Vector3(-8.4, 15.0, 24.5),
        new THREE.Vector3(0.0, 12.5, 32.0),
      ],
      false,
      'centripetal',
      0.5,
    );
  }

  public update(ctx: SpellUpdateContext): void {
    if (!this.crystalMesh || !this.camCurve) return;

    const t = ctx.time;
    const p = clamp(t / TH20_DURATION, 0, 1);
    const u = clamp(lerp(p, smootherstep(0, 1, p), 0.32), 0, 1);

    this.camCurve.getPoint(u, ctx.cameraPose.position);
    ctx.cameraPose.lookAt.set(0, 0, 0);
    ctx.cameraPose.roll = Math.sin(p * Math.PI) * 0.05;
    ctx.cameraPose.fov = lerp(48, 44, u);
    ctx.cameraPose.shake = 0;

    // Smooth deceleration integral: flowing alive in Act 0 -> freezes into eternal amber stone by Act 2!
    const globalFreeze = smoothstep(3.6, 8.4, t);
    const strataSpin = t * (1 - globalFreeze * 0.72);
    for (let i = 0; i < this.strataRings.length; i++) {
      this.strataRings[i].rotation.z = strataSpin * (i % 2 === 0 ? 0.14 : -0.14);
    }
    if (this.dustPoints) {
      this.dustPoints.rotation.y = strataSpin * 0.05;
    }

    // Update all 2,800 quartz-amber crystal danmaku fossils
    for (let i = 0; i < this.crystals.length; i++) {
      const c = this.crystals[i];
      // Each crystal flows smoothly until its local petrification wave arrives, then locks eternally solid!
      const localStop = smoothstep(c.petrifyAt - 0.6, c.petrifyAt + 0.8, t);
      const effectiveTime = Math.min(t, c.petrifyAt) + (t > c.petrifyAt ? 0.35 * (1 - Math.exp(-(t - c.petrifyAt) * 1.8)) : 0);

      const angle = c.baseAngle + effectiveTime * c.flowSpeed;
      const r = c.baseRadius;
      const y = c.baseY + Math.sin(angle * 2.0) * (c.layer === 'strata' ? 0.85 : 0.45);

      this._pos.set(Math.cos(angle) * r, y, Math.sin(angle) * r);

      // Tangential spiral orientation -- crystals point gracefully along the ancient spiral current!
      this._dir.set(-Math.sin(angle), c.layer === 'ammonite' ? 0.18 : 0.35, Math.cos(angle)).normalize();
      orientForwardWithRoll(this._dir, c.roll + effectiveTime * 0.4, this._quat);

      // Subtle crystal growth pop + visible living-danmaku -> amber-stone petrification color transition!
      const crystalizePop = 1.0 + localStop * 0.16;
      this._scale.set(c.scaleX * crystalizePop, c.scaleX * crystalizePop, c.scaleZ * crystalizePop);
      this._mat4.compose(this._pos, this._quat, this._scale);
      this.crystalMesh.setMatrixAt(i, this._mat4);

      this._col.copy(c.livingColor).lerp(c.fossilColor, localStop);
      this.crystalMesh.setColorAt(i, this._col);
    }
    this.crystalMesh.instanceMatrix.needsUpdate = true;
    if (this.crystalMesh.instanceColor) this.crystalMesh.instanceColor.needsUpdate = true;

    const fx = ctx.postFX;
    fx.vignette = 0.38;
    fx.chromatic = 0.0012;
    fx.warmGrade = 0.24 + globalFreeze * 0.22;
    fx.bloomThreshold = 1.02;
    fx.bloomStrength = 0.42;
    fx.bloomRadius = 0.46;
  }

  public getInstanceCount(): number {
    return this.crystals.length + 1400;
  }

  public dispose(scene: THREE.Scene): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    scene.remove(this.root);
    this.crystalMesh = null;
    this.strataRings = [];
  }
}
