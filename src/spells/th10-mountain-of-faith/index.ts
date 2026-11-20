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
import { createHexagramCircleTexture } from '../../prototypes/MagicCircleFactory';

export const TH10_METADATA: SpellMetadata = {
  id: 'th10-mountain-of-faith',
  gameCode: 'TH10',
  gameName: '东方风神录',
  spellName: '"风神之神德"',
  character: '八坂神奈子',
  bgm: '神圣庄严的古战场 ~ Suwa Foughten Field',
  prototype: 'InstancedMesh粒子系统',
  spatialForm: '全屏交错菱形符札网 + 纵深风暴突刺',
  visualHighlight:
    '还原原作"风神之神德"无安定点的窒息压迫: 红蓝金白 3D 立体符札以正反斜角横贯全屏交织成不断收紧的菱形弹幕墙, 配合注连绳圣环倾泻而下的高速纵深符札风暴与微操穿隙运镜, 后段进入高潮发狂加速.',
  implemented: true,
};

export const TH10_DURATION = 13.0;

const TH10_PHASES: TimelinePhase[] = [
  { id: 'summit', label: '01 御神威降临', start: 0.0, end: 3.2, badgeStyle: 'normal' },
  { id: 'lattice', label: '02 交错符札菱网', start: 3.2, end: 6.8, badgeStyle: 'frozen' },
  { id: 'lunatic', label: '03 风神发狂逼压', start: 6.8, end: 11.2, badgeStyle: 'burst' },
  { id: 'aftermath', label: '04 神德余威', start: 11.2, end: 13.0, badgeStyle: 'normal' },
];

interface LatticeOfuda {
  dirSign: number; // -1 sweeps top-right -> bottom-left; +1 sweeps top-left -> bottom-right
  planeIdx: number; // 0..4 depth planes across Z
  rowIdx: number;
  colPos: number; // position along diagonal ribbon
  depthZ: number;
  speed: number;
  slantRad: number;
  scale: number;
  unlockTime: number;
  color: THREE.Color;
}

interface StormOfuda {
  armIdx: number;
  armCount: number;
  cycleOffset: number;
  cycleSpan: number;
  speed: number;
  spreadAngle: number;
  spiralRate: number;
  scale: number;
  unlockTime: number;
  color: THREE.Color;
}

/**
 * Generates a high-contrast Japanese Shinto Ofuda / Kanako Talisman card texture
 * with crisp colored framing border and bold calligraphic sacred seal.
 */
function createOfudaTexture(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size * 2;
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;

  // Bright sacred paper core
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  // Bold colored outer framing border (multiplied cleanly by instanceColor)
  ctx.strokeStyle = '#c8d0e4';
  ctx.lineWidth = 26;
  ctx.strokeRect(13, 13, w - 26, h - 26);

  // Inner sharp seal border
  ctx.strokeStyle = '#6c7696';
  ctx.lineWidth = 7;
  ctx.strokeRect(38, 38, w - 76, h - 76);

  // Bold calligraphic vertical spirit seal strokes
  ctx.strokeStyle = '#2c344a';
  ctx.lineWidth = 11;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(w * 0.5, h * 0.14);
  ctx.lineTo(w * 0.5, h * 0.86);
  for (let i = 0; i < 5; i++) {
    const y = h * (0.24 + i * 0.13);
    const halfW = i % 2 === 0 ? w * 0.23 : w * 0.15;
    ctx.moveTo(w * 0.5 - halfW, y);
    ctx.lineTo(w * 0.5 + halfW, y + (i % 2 === 0 ? -12 : 12));
  }
  ctx.stroke();

  // Top sacred diamond crest
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#2c344a';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(w * 0.5, h * 0.08);
  ctx.lineTo(w * 0.63, h * 0.15);
  ctx.lineTo(w * 0.5, h * 0.22);
  ctx.lineTo(w * 0.37, h * 0.15);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Builds Kanako's iconic zigzag Shinto Shide (纸垂) paper streamer geometry.
 */
function createShideGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.22, 0.0);
  shape.lineTo(0.22, 0.0);
  shape.lineTo(0.14, -0.58);
  shape.lineTo(0.42, -0.78);
  shape.lineTo(0.08, -1.35);
  shape.lineTo(0.36, -1.58);
  shape.lineTo(-0.08, -2.25);
  shape.lineTo(-0.42, -1.85);
  shape.lineTo(-0.14, -1.42);
  shape.lineTo(-0.38, -1.02);
  shape.lineTo(-0.12, -0.56);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false });
}

export class TH10MountainOfFaithSpell implements SpellCardInstance {
  public readonly metadata = TH10_METADATA;
  public readonly duration = TH10_DURATION;
  public readonly phases = TH10_PHASES;

  private root = new THREE.Group();
  private talismanMesh: THREE.InstancedMesh | null = null;
  private crestRing: THREE.Mesh | null = null;
  private shimenawaGroup: THREE.Group | null = null;
  private shides: THREE.Mesh[] = [];
  private latticeOfudas: LatticeOfuda[] = [];
  private stormOfudas: StormOfuda[] = [];

  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private textures: THREE.Texture[] = [];

  private readonly _pos = new THREE.Vector3();
  private readonly _dir = new THREE.Vector3();
  private readonly _toBullet = new THREE.Vector3();
  private readonly _quat = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3();
  private readonly _mat4 = new THREE.Matrix4();
  private readonly _summitOrigin = new THREE.Vector3(0, 8.8, -22.0);

  public init(scene: THREE.Scene, _renderer: THREE.WebGLRenderer): void {
    scene.background = new THREE.Color(0x04050c);
    scene.fog = new THREE.FogExp2(0x05060f, 0.014);

    this.root = new THREE.Group();
    scene.add(this.root);

    // High-contrast shrine storm lighting carving sharp edges on every flying Ofuda card
    const amb = new THREE.AmbientLight(0x52628a, 0.85);
    const keyTop = new THREE.DirectionalLight(0xf6f8ff, 2.4);
    keyTop.position.set(0, 24, 14);
    const crimsonRim = new THREE.PointLight(0xff304c, 36, 65, 1.35);
    crimsonRim.position.set(-14, 6, -6);
    const cobaltRim = new THREE.PointLight(0x2e94ff, 36, 65, 1.35);
    cobaltRim.position.set(14, 6, -6);
    const goldSummit = new THREE.PointLight(0xffc966, 30, 52, 1.4);
    goldSummit.position.set(0, 11, -19);
    this.root.add(amb, keyTop, crimsonRim, cobaltRim, goldSummit);

    // 1. Kanako's Sacred Shimenawa Halo (注连绳光轮) + 4 Zigzag Shide Paper Streamers (纸垂)
    this.shimenawaGroup = new THREE.Group();
    this.shimenawaGroup.position.copy(this._summitOrigin);
    this.root.add(this.shimenawaGroup);

    const ropeGeom = new THREE.TorusGeometry(6.6, 0.24, 16, 96);
    const ropeMat = new THREE.MeshStandardMaterial({
      color: 0xe6b85c,
      roughness: 0.42,
      metalness: 0.35,
      emissive: new THREE.Color(0x885214),
      emissiveIntensity: 0.72,
    });
    const ropeMesh = new THREE.Mesh(ropeGeom, ropeMat);
    this.shimenawaGroup.add(ropeMesh);
    this.geometries.push(ropeGeom);
    this.materials.push(ropeMat);

    // Inner sacred hexagram halo
    const haloTex = createHexagramCircleTexture(512);
    this.textures.push(haloTex);
    const crestGeom = new THREE.PlaneGeometry(20, 20);
    const crestMat = new THREE.MeshBasicMaterial({
      map: haloTex,
      color: 0xff8468,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.crestRing = new THREE.Mesh(crestGeom, crestMat);
    this.crestRing.position.z = -0.5;
    this.shimenawaGroup.add(this.crestRing);
    this.geometries.push(crestGeom);
    this.materials.push(crestMat);

    // 4 Crisp White Shide paper pendants hanging along the lower arc of the Shimenawa ring
    const shideGeom = createShideGeometry();
    const shideMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0.08,
      emissive: new THREE.Color(0xb8c8e8),
      emissiveIntensity: 0.52,
      side: THREE.DoubleSide,
    });
    this.geometries.push(shideGeom);
    this.materials.push(shideMat);
    this.shides = [];
    const shideAngles = [-2.55, -2.02, -1.12, -0.59];
    for (let i = 0; i < shideAngles.length; i++) {
      const a = shideAngles[i];
      const shide = new THREE.Mesh(shideGeom, shideMat);
      shide.position.set(Math.cos(a) * 6.5, Math.sin(a) * 6.5, 0.2);
      shide.scale.setScalar(1.05);
      this.shimenawaGroup.add(shide);
      this.shides.push(shide);
    }

    // 2. Four Towering Onbashira (御柱) Monumental Shrine Pillars framing the abyss
    const pillarGeom = new THREE.CylinderGeometry(0.62, 0.78, 34, 16);
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x3b2822,
      roughness: 0.55,
      metalness: 0.25,
      emissive: new THREE.Color(0x281018),
      emissiveIntensity: 0.45,
    });
    const bandGeom = new THREE.TorusGeometry(0.76, 0.09, 10, 28);
    const bandMat = new THREE.MeshBasicMaterial({ color: 0xffd068 });
    this.geometries.push(pillarGeom, bandGeom);
    this.materials.push(pillarMat, bandMat);

    const pillarSpecs: [number, number, number, number][] = [
      [-15.5, -2.0, -18.0, 0.14],
      [15.5, -2.0, -18.0, -0.14],
      [-23.0, -4.0, -29.0, 0.22],
      [23.0, -4.0, -29.0, -0.22],
    ];
    for (const [px, py, pz, tiltZ] of pillarSpecs) {
      const pGroup = new THREE.Group();
      pGroup.position.set(px, py, pz);
      pGroup.rotation.z = tiltZ;
      const shaft = new THREE.Mesh(pillarGeom, pillarMat);
      pGroup.add(shaft);
      for (const by of [-4, 4, 11]) {
        const ring = new THREE.Mesh(bandGeom, bandMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = by;
        pGroup.add(ring);
      }
      this.root.add(pGroup);
    }

    // 3. Sculpted 3D Ofuda Slabs (3,200 Full-Screen Crisscrossing Lattice + 1,400 Depth-Rush Storm)
    const ofudaTex = createOfudaTexture(256);
    this.textures.push(ofudaTex);

    const slabGeom = new THREE.BoxGeometry(0.42, 0.055, 0.88);
    const slabMat = new THREE.MeshStandardMaterial({
      map: ofudaTex,
      color: 0xffffff,
      roughness: 0.26,
      metalness: 0.18,
      emissive: new THREE.Color(0x4b587c),
      emissiveIntensity: 0.58,
    });
    this.geometries.push(slabGeom);
    this.materials.push(slabMat);

    const rand = createSeededRandom(20070817); // Touhou 10 MoF release date seed
    const cCrimson = new THREE.Color(0xff2c4c);
    const cCobalt = new THREE.Color(0x2a8cff);
    const cGold = new THREE.Color(0xffbf36);
    const cWhite = new THREE.Color(0xf4f8ff);

    // Layer A: 3,200 Full-Screen Crisscrossing Diamond Lattice Ofuda sweeping directly across x = 0!
    // Arranged into coherent wave-rows so left-slanted & right-slanted curtains weave tight diamond pockets!
    this.latticeOfudas = [];
    const planeZ = [-15.5, -10.0, -4.8, 0.6, 6.2];
    const planeUnlock = [0.0, 0.0, 2.7, 4.4, 6.4];
    const rowsPerPlaneSide = 10;
    const colsPerRow = 32; // 5 planes * 2 sides * 10 rows * 32 cols = 3,200

    for (let pIdx = 0; pIdx < 5; pIdx++) {
      for (let side = 0; side < 2; side++) {
        const dirSign = side === 0 ? 1 : -1;
        // Distinct opposing slant angles weave crisp overlapping diamond grids!
        const slantRad = dirSign * (0.62 + (pIdx % 3) * 0.07);
        const baseSpeed = 9.2 + pIdx * 1.15;

        for (let row = 0; row < rowsPerPlaneSide; row++) {
          // Canonical alternating Red / Blue / Gold / White wave sheets
          let col: THREE.Color;
          if (pIdx < 2) {
            col = dirSign > 0 ? cCrimson : cCobalt;
          } else if (pIdx === 2) {
            col = row % 2 === 0 ? cGold : cWhite;
          } else {
            col = dirSign > 0 ? (row % 2 === 0 ? cCrimson : cGold) : (row % 2 === 0 ? cCobalt : cWhite);
          }

          for (let c = 0; c < colsPerRow; c++) {
            // Evenly spaced along the diagonal wave crest -> forms unmistakable crisp Touhou rows!
            const colPos = ((c + (row % 2) * 0.5) / colsPerRow - 0.5) * 38.0;
            this.latticeOfudas.push({
              dirSign,
              planeIdx: pIdx,
              rowIdx: row,
              colPos,
              depthZ: planeZ[pIdx] + (rand() - 0.5) * 0.55,
              speed: baseSpeed,
              slantRad,
              scale: 0.78 + (pIdx % 2) * 0.12,
              unlockTime: planeUnlock[pIdx] + (row / rowsPerPlaneSide) * 0.45,
              color: col.clone(),
            });
          }
        }
      }
    }

    // Layer B: 1,400 Oppressive Summit-to-Viewer Depth-Rush Ofuda firing from Kanako's Shimenawa Ring!
    this.stormOfudas = [];
    const stormCount = 1400;
    const armCount = 16;
    for (let i = 0; i < stormCount; i++) {
      const armIdx = i % armCount;
      const waveTier = Math.floor(i / armCount) % 3;
      const col =
        waveTier === 0
          ? armIdx % 2 === 0
            ? cCrimson
            : cCobalt
          : waveTier === 1
            ? cGold
            : cWhite;

      this.stormOfudas.push({
        armIdx,
        armCount,
        cycleOffset: rand() * 3.2,
        cycleSpan: 3.2,
        speed: 14.5 + waveTier * 3.8 + rand() * 2.0,
        spreadAngle: 0.14 + (i % 7) * 0.068 + rand() * 0.03,
        spiralRate: (waveTier % 2 === 0 ? 1 : -1) * (0.75 + waveTier * 0.28),
        scale: 0.82 + (waveTier === 2 ? 0.14 : 0),
        unlockTime: waveTier === 0 ? 2.4 : waveTier === 1 ? 5.6 : 7.0,
        color: col.clone(),
      });
    }

    const totalCount = this.latticeOfudas.length + this.stormOfudas.length;
    this.talismanMesh = new THREE.InstancedMesh(slabGeom, slabMat, totalCount);
    this.talismanMesh.frustumCulled = false;

    for (let i = 0; i < this.latticeOfudas.length; i++) {
      this.talismanMesh.setColorAt(i, this.latticeOfudas[i].color);
    }
    for (let j = 0; j < this.stormOfudas.length; j++) {
      this.talismanMesh.setColorAt(this.latticeOfudas.length + j, this.stormOfudas[j].color);
    }
    if (this.talismanMesh.instanceColor) this.talismanMesh.instanceColor.needsUpdate = true;
    this.root.add(this.talismanMesh);
  }

  public update(ctx: SpellUpdateContext): void {
    if (!this.talismanMesh) return;

    const t = ctx.time;
    const p = clamp(t / TH10_DURATION, 0, 1);
    const u = clamp(lerp(p, smootherstep(0, 1, p), 0.2), 0, 1);

    // Authentic Mountain of Faith Lunatic Escalation ("发狂"): accelerates relentlessly into Phase 3!
    const build = smoothstep(2.6, 6.8, t);
    const frenzy = smoothstep(6.2, 11.2, t) * (1 - smoothstep(11.6, 12.9, t));
    const flowTime =
      t +
      0.55 * Math.max(0, t - 3.0) * Math.max(0, t - 3.0) * 0.11 +
      1.25 * Math.max(0, t - 6.2) * Math.max(0, t - 6.2) * 0.16;

    // Active Micro-Dodging Camera: weaves & surges dynamically through shifting diamond gaps!
    // No static safe spot feel — the viewer actively threads through closing crisscross walls!
    const dodgeFreq = 1.35 + frenzy * 1.15;
    const camX =
      Math.sin(t * dodgeFreq) * (1.8 + build * 1.45) +
      Math.cos(t * 2.15) * (0.45 + frenzy * 0.65);
    const camY =
      lerp(-5.6, 1.4, smootherstep(0, 0.72, u)) +
      Math.cos(t * 1.65) * (0.65 + frenzy * 0.55);
    const camZ = lerp(17.5, -3.5, smootherstep(0.05, 0.88, u)) + Math.sin(p * Math.PI) * 1.2;

    ctx.cameraPose.position.set(camX, camY, camZ);
    ctx.cameraPose.lookAt.set(
      camX * 0.25,
      lerp(5.8, 3.2, u) + Math.sin(t * 1.4) * 0.4,
      -22.0,
    );
    ctx.cameraPose.roll = Math.sin(t * dodgeFreq + 0.5) * (0.05 + frenzy * 0.1);
    ctx.cameraPose.fov = 50 + build * 5.0 + frenzy * 10.5;
    ctx.cameraPose.shake = build * 0.02 + frenzy * 0.075;

    // Animate Kanako's Shimenawa Ring & wind-whipped Shide streamers
    if (this.crestRing) {
      this.crestRing.rotation.z = t * (0.35 + frenzy * 0.85);
      (this.crestRing.material as THREE.MeshBasicMaterial).opacity = 0.28 + build * 0.18 + frenzy * 0.28;
    }
    for (let i = 0; i < this.shides.length; i++) {
      this.shides[i].rotation.z = Math.sin(t * (3.2 + frenzy * 4.5) + i * 1.3) * (0.14 + frenzy * 0.24);
      this.shides[i].rotation.x = Math.cos(t * (2.6 + frenzy * 3.6) + i) * (0.12 + frenzy * 0.2);
    }

    const camPos = ctx.cameraPose.position;

    // 1. Update 3,200 Full-Screen Crisscrossing Diamond Lattice Ofuda (sweeping RIGHT across x = 0!)
    const rowSpan = 34.0;
    for (let i = 0; i < this.latticeOfudas.length; i++) {
      const s = this.latticeOfudas[i];
      const unlocked = smoothstep(s.unlockTime, s.unlockTime + 0.65, t);
      if (unlocked <= 0.002) {
        this._mat4.makeScale(0, 0, 0);
        this.talismanMesh.setMatrixAt(i, this._mat4);
        continue;
      }

      // Advance perpendicular to wave crest so every row stays Razor-Coherent as a diagonal barrier!
      const rowSpacing = rowSpan / 10;
      const progress = (flowTime * s.speed + s.rowIdx * rowSpacing) % rowSpan;
      const alongY = 17.5 - progress;

      // Oscillating cross-wind shear shifts the diamond intersections continuously -> ZERO static safe spot!
      const windShift = Math.sin(t * (0.85 + frenzy * 0.7) + s.planeIdx * 1.2) * (1.4 + frenzy * 1.8) * s.dirSign;
      const cosA = Math.cos(s.slantRad);
      const sinA = Math.sin(s.slantRad);

      // Position = diagonal crest point rotated by slantRad + downward cascade
      const rx = s.colPos * cosA + progress * sinA * 0.85 + windShift;
      // Wrap X smoothly inside [-21, +21] so the screen is ALWAYS densely blanketed edge-to-edge
      const wrappedX = ((((rx + 21) % 42) + 42) % 42) - 21;
      const ry = alongY + s.colPos * sinA * 0.42;
      const rz = s.depthZ + Math.sin(progress * 0.25 + s.planeIdx) * 0.45;

      this._pos.set(wrappedX, ry, rz);

      // Micro-lens deflection ONLY within 1.35u of camera eyeball -> near-miss thrills with zero clip!
      this._toBullet.subVectors(this._pos, camPos);
      const distSq = this._toBullet.lengthSq();
      if (distSq < 1.82 && distSq > 1e-5) {
        const d = Math.sqrt(distSq);
        this._pos.addScaledVector(this._toBullet, (1.35 - d) / d);
      }

      // Direction points strictly along the diagonal slashing motion
      this._dir.set(sinA * 0.88, -cosA, 0.08 * Math.sin(t + s.planeIdx)).normalize();
      orientForwardWithRoll(this._dir, s.dirSign * 0.35, this._quat);

      const edgeFade = smoothstep(0, 2.8, progress) * (1 - smoothstep(rowSpan - 3.2, rowSpan, progress));
      this._scale.setScalar(s.scale * unlocked * edgeFade);
      this._mat4.compose(this._pos, this._quat, this._scale);
      this.talismanMesh.setMatrixAt(i, this._mat4);
    }

    // 2. Update 1,400 Oppressive Summit-to-Viewer Depth-Rush Ofuda streaming from Shimenawa Halo!
    const baseIdx = this.latticeOfudas.length;
    for (let j = 0; j < this.stormOfudas.length; j++) {
      const s = this.stormOfudas[j];
      const unlocked = smoothstep(s.unlockTime, s.unlockTime + 0.7, t);
      if (unlocked <= 0.002) {
        this._mat4.makeScale(0, 0, 0);
        this.talismanMesh.setMatrixAt(baseIdx + j, this._mat4);
        continue;
      }

      const cycle = (flowTime * (1.0 + frenzy * 0.35) + s.cycleOffset) % s.cycleSpan;
      const travel = cycle * s.speed;

      // Spiraling radial emission from Kanako's summit Shimenawa straight down & forward toward viewer!
      const theta = (s.armIdx / s.armCount) * Math.PI * 2 + flowTime * s.spiralRate + cycle * 0.45;
      const coneR = Math.sin(s.spreadAngle) * travel;
      const x = this._summitOrigin.x + Math.cos(theta) * coneR;
      const y = this._summitOrigin.y - travel * 0.34 + Math.sin(theta) * coneR * 0.65;
      const z = this._summitOrigin.z + travel * 0.94;

      this._pos.set(x, y, z);

      // Deflect only right at the camera pupil so cards roar dramatically inches past both sides!
      this._toBullet.subVectors(this._pos, camPos);
      const distSq = this._toBullet.lengthSq();
      if (distSq < 2.25 && distSq > 1e-5) {
        const d = Math.sqrt(distSq);
        this._pos.addScaledVector(this._toBullet, (1.5 - d) / d);
      }

      this._dir
        .set(Math.cos(theta) * Math.sin(s.spreadAngle), -0.34 + Math.sin(theta) * Math.sin(s.spreadAngle) * 0.65, 0.94)
        .normalize();
      orientForwardWithRoll(this._dir, theta, this._quat);

      const lifeFade = smoothstep(0, 0.25, cycle) * (1 - smoothstep(s.cycleSpan - 0.35, s.cycleSpan, cycle));
      this._scale.setScalar(s.scale * unlocked * lifeFade);
      this._mat4.compose(this._pos, this._quat, this._scale);
      this.talismanMesh.setMatrixAt(baseIdx + j, this._mat4);
    }

    this.talismanMesh.instanceMatrix.needsUpdate = true;

    const fx = ctx.postFX;
    fx.vignette = 0.42 + frenzy * 0.08;
    fx.chromatic = 0.0016 + frenzy * 0.003;
    fx.bloomThreshold = 1.05;
    fx.bloomStrength = 0.36 + frenzy * 0.16;
    fx.bloomRadius = 0.4;
  }

  public getInstanceCount(): number {
    return this.latticeOfudas.length + this.stormOfudas.length;
  }

  public dispose(scene: THREE.Scene): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    scene.remove(this.root);
    this.talismanMesh = null;
    this.crestRing = null;
    this.shimenawaGroup = null;
    this.shides = [];
  }
}
