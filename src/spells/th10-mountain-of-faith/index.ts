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
  spellName: '"Mountain of Faith" / "风神之神德"',
  character: '八坂神奈子',
  bgm: '神圣庄严的古战场 ~ Suwa Foughten Field',
  prototype: 'InstancedMesh粒子系统',
  spatialForm: '立体符札瀑布 + 交错几何山壁',
  visualHighlight:
    '4,600+ 带厚度红蓝白 3D 立体符札薄片从高空斜向交错倾泻成山壁, 随音乐高潮加速发狂, 镜头从仰视山壁转为缝隙穿行.',
  implemented: true,
};

export const TH10_DURATION = 13.0;

const TH10_PHASES: TimelinePhase[] = [
  { id: 'cliff', label: '01 仰视符札山壁', start: 0.0, end: 3.2, badgeStyle: 'normal' },
  { id: 'cascade', label: '02 交错瀑布倾泻', start: 3.2, end: 6.8, badgeStyle: 'frozen' },
  { id: 'lunatic', label: '03 发狂加速穿峡', start: 6.8, end: 11.0, badgeStyle: 'burst' },
  { id: 'summit', label: '04 神德余威', start: 11.0, end: 13.0, badgeStyle: 'normal' },
];

interface TalismanSpec {
  wallSide: number; // -1 left cliff, +1 right cliff
  laneX: number;
  depthZ: number;
  cycleOffset: number;
  cycleSpan: number;
  baseSpeed: number;
  slantAngle: number;
  scale: number;
  color: THREE.Color;
  unlockTime: number;
}

/**
 * Generates a crisp Japanese Shinto Ofuda / Touhou Talisman card texture
 * with double framing border and vertical calligraphic spirit seal.
 */
function createOfudaTexture(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size * 2;
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;

  // Crisp luminous paper base
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  // Colored thick outer border frame (tinted by instanceColor!)
  ctx.strokeStyle = '#d4d8e8';
  ctx.lineWidth = 22;
  ctx.strokeRect(11, 11, w - 22, h - 22);

  // Inner seal rectangle
  ctx.strokeStyle = '#8088a4';
  ctx.lineWidth = 6;
  ctx.strokeRect(34, 34, w - 68, h - 68);

  // Stylized geometric vertical talisman brush strokes down center
  ctx.strokeStyle = '#404860';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(w * 0.5, h * 0.14);
  ctx.lineTo(w * 0.5, h * 0.86);
  for (let i = 0; i < 5; i++) {
    const y = h * (0.22 + i * 0.14);
    const halfW = i % 2 === 0 ? w * 0.22 : w * 0.15;
    ctx.moveTo(w * 0.5 - halfW, y);
    ctx.lineTo(w * 0.5 + halfW, y + (i % 2 === 0 ? -12 : 12));
  }
  ctx.stroke();

  // Top sacred diamond emblem
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#404860';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(w * 0.5, h * 0.08);
  ctx.lineTo(w * 0.62, h * 0.15);
  ctx.lineTo(w * 0.5, h * 0.22);
  ctx.lineTo(w * 0.38, h * 0.15);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export class TH10MountainOfFaithSpell implements SpellCardInstance {
  public readonly metadata = TH10_METADATA;
  public readonly duration = TH10_DURATION;
  public readonly phases = TH10_PHASES;

  private root = new THREE.Group();
  private talismanMesh: THREE.InstancedMesh | null = null;
  private crestRing: THREE.Mesh | null = null;
  private talismans: TalismanSpec[] = [];

  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private textures: THREE.Texture[] = [];

  private camCurve: THREE.CatmullRomCurve3 | null = null;
  private lookCurve: THREE.CatmullRomCurve3 | null = null;

  private readonly _pos = new THREE.Vector3();
  private readonly _dir = new THREE.Vector3();
  private readonly _quat = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3();
  private readonly _mat4 = new THREE.Matrix4();

  public init(scene: THREE.Scene, _renderer: THREE.WebGLRenderer): void {
    scene.background = new THREE.Color(0x04060e);
    scene.fog = new THREE.FogExp2(0x050712, 0.013);

    this.root = new THREE.Group();
    scene.add(this.root);

    // Dramatic shrine storm lighting catching thickness edges of the 3D talisman slabs
    const amb = new THREE.AmbientLight(0x52648c, 0.9);
    const keyTop = new THREE.DirectionalLight(0xeef4ff, 2.2);
    keyTop.position.set(0, 26, 12);
    const redGlow = new THREE.PointLight(0xff3858, 28, 56, 1.4);
    redGlow.position.set(-14, 4, -8);
    const blueGlow = new THREE.PointLight(0x3a9cff, 28, 56, 1.4);
    blueGlow.position.set(14, 4, -8);
    this.root.add(amb, keyTop, redGlow, blueGlow);

    // 1. Towering Sacred Shinto Halo Circle high at the mountain summit
    const haloTex = createHexagramCircleTexture(512);
    this.textures.push(haloTex);
    const crestGeom = new THREE.PlaneGeometry(26, 26);
    const crestMat = new THREE.MeshBasicMaterial({
      map: haloTex,
      color: 0xff9878,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.crestRing = new THREE.Mesh(crestGeom, crestMat);
    this.crestRing.position.set(0, 14.5, -24);
    this.root.add(this.crestRing);
    this.geometries.push(crestGeom);
    this.materials.push(crestMat);

    // 2. 4,600 Thick 3D Sculpted Ofuda Talisman Slabs cascading in crisscrossing mountain walls!
    const ofudaTex = createOfudaTexture(256);
    this.textures.push(ofudaTex);

    // Real 3D thick rectangular talisman slab aligned along +Z (facing forward, length along Z)
    const slabGeom = new THREE.BoxGeometry(0.46, 0.065, 0.92);
    const slabMat = new THREE.MeshStandardMaterial({
      map: ofudaTex,
      color: 0xffffff,
      roughness: 0.28,
      metalness: 0.22,
      emissive: new THREE.Color(0x5a6890),
      emissiveIntensity: 0.65,
    });
    this.geometries.push(slabGeom);
    this.materials.push(slabMat);

    const rand = createSeededRandom(20070817); // Touhou 10 MoF release date seed!
    const count = 4600;
    this.talismans = [];

    // Iconic Kanako Mountain of Faith palette: Vermilion Red, Sacred Cobalt Blue, Pure Ivory White
    const cRed = new THREE.Color(0xff3854);
    const cBlue = new THREE.Color(0x3a96ff);
    const cWhite = new THREE.Color(0xf6f8ff);

    for (let i = 0; i < count; i++) {
      const wallSide = i % 2 === 0 ? -1 : 1;
      const tier = Math.floor(i / 2) % 6;
      // Crisscrossing terraced canyon walls leaving a navigable center corridor (x in [-2.6, +2.6] clear!)
      const canyonOffset = 3.2 + tier * 2.15 + (rand() - 0.5) * 1.1;
      const depthZ = 14 - rand() * 58;
      // Progressive Lunatic unlock: outer density layers flood in as music intensifies!
      const unlockTime = tier < 2 ? 0.0 : tier < 4 ? 2.8 + (tier - 2) * 1.2 : 6.2 + (tier - 4) * 1.1;

      const colorBand = (tier + (wallSide > 0 ? 1 : 0)) % 3;
      const col = colorBand === 0 ? cRed : colorBand === 1 ? cBlue : cWhite;

      this.talismans.push({
        wallSide,
        laneX: wallSide * canyonOffset,
        depthZ,
        cycleOffset: rand() * 42,
        cycleSpan: 42,
        baseSpeed: 8.5 + tier * 1.15 + rand() * 1.8,
        slantAngle: wallSide * (0.42 + (tier % 3) * 0.08),
        scale: 0.85 + (tier % 3) * 0.14,
        color: col.clone(),
        unlockTime,
      });
    }

    this.talismanMesh = new THREE.InstancedMesh(slabGeom, slabMat, count);
    this.talismanMesh.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      this.talismanMesh.setColorAt(i, this.talismans[i].color);
    }
    if (this.talismanMesh.instanceColor) this.talismanMesh.instanceColor.needsUpdate = true;
    this.root.add(this.talismanMesh);

    // 3. Signature Camera: Starts LOW looking UP at towering talisman cliffs,
    // then levels off and plunges straight through the crisscrossing geometric canyon gap!
    this.camCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0.0, -7.2, 18.5),
        new THREE.Vector3(1.2, -3.5, 11.5),
        new THREE.Vector3(-0.8, 0.2, 2.0),
        new THREE.Vector3(0.6, 1.4, -10.5),
        new THREE.Vector3(0.0, 2.8, -24.0),
      ],
      false,
      'centripetal',
      0.5,
    );

    this.lookCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0.0, 9.5, -10.0),
        new THREE.Vector3(0.0, 5.2, -16.0),
        new THREE.Vector3(0.0, 2.2, -26.0),
        new THREE.Vector3(0.0, 3.0, -38.0),
        new THREE.Vector3(0.0, 6.5, -48.0),
      ],
      false,
      'centripetal',
      0.5,
    );
  }

  public update(ctx: SpellUpdateContext): void {
    if (!this.talismanMesh || !this.camCurve || !this.lookCurve) return;

    const t = ctx.time;
    const p = clamp(t / TH10_DURATION, 0, 1);
    const u = clamp(lerp(p, smootherstep(0, 1, p), 0.25), 0, 1);

    // Authentic Mountain of Faith Lunatic Escalation: integrated distance accelerates exponentially!
    const frenzy = smoothstep(5.5, 11.5, t);
    // Integral of speed multiplier (1.0 + 1.55 * frenzy) over time t
    const flowPhase = t + 0.78 * Math.max(0, t - 4.8) * Math.max(0, t - 4.8) * 0.18;

    this.camCurve.getPoint(u, ctx.cameraPose.position);
    this.lookCurve.getPoint(u, ctx.cameraPose.lookAt);
    ctx.cameraPose.roll = Math.sin(p * Math.PI * 2.5) * (0.06 + frenzy * 0.08);
    ctx.cameraPose.fov = 52 + frenzy * 10.0;
    ctx.cameraPose.shake = frenzy * 0.065;

    if (this.crestRing) {
      this.crestRing.rotation.z = t * (0.25 + frenzy * 0.45);
      (this.crestRing.material as THREE.MeshBasicMaterial).opacity = 0.36 + frenzy * 0.25;
    }

    // Update all 4,600 3D talisman slabs cascading diagonally down the crisscrossing mountain walls
    for (let i = 0; i < this.talismans.length; i++) {
      const s = this.talismans[i];
      const unlocked = smoothstep(s.unlockTime, s.unlockTime + 0.85, t);
      if (unlocked <= 0.002) {
        this._mat4.makeScale(0, 0, 0);
        this.talismanMesh.setMatrixAt(i, this._mat4);
        continue;
      }

      const travel = (flowPhase * s.baseSpeed + s.cycleOffset) % s.cycleSpan;
      const topY = 23.0;
      const y = topY - travel;
      // Diagonal slanted mountain wall slope: widens toward base, crisscrosses cleanly overhead!
      const slopeShift = (travel / s.cycleSpan - 0.4) * Math.sin(s.slantAngle) * 9.5;
      const x = s.laneX + slopeShift;
      // Subtle sinusoidal curtain ripple down the waterfall
      const z = s.depthZ + Math.sin(travel * 0.32 + i * 0.11) * 0.65;

      // Keep crisp navigable center corridor clear right around camera X so slabs never clip lens
      const safeX = Math.abs(x) < 2.2 ? (x < 0 ? -2.2 : 2.2) : x;

      this._pos.set(safeX, y, z);
      this._dir.set(Math.sin(s.slantAngle) * 0.6, -1.0, 0.14 * Math.cos(travel * 0.25)).normalize();

      orientForwardWithRoll(this._dir, s.wallSide * 0.45, this._quat);
      const edgeFade = smoothstep(0, 3.5, travel) * (1 - smoothstep(s.cycleSpan - 4.0, s.cycleSpan, travel));
      this._scale.setScalar(s.scale * unlocked * edgeFade);
      this._mat4.compose(this._pos, this._quat, this._scale);
      this.talismanMesh.setMatrixAt(i, this._mat4);
    }
    this.talismanMesh.instanceMatrix.needsUpdate = true;

    const fx = ctx.postFX;
    fx.vignette = 0.38;
    fx.chromatic = 0.0014 + frenzy * 0.0024;
    fx.bloomThreshold = 0.92;
    fx.bloomStrength = 0.45 + frenzy * 0.15;
    fx.bloomRadius = 0.44;
  }

  public getInstanceCount(): number {
    return this.talismans.length;
  }

  public dispose(scene: THREE.Scene): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    scene.remove(this.root);
    this.talismanMesh = null;
  }
}
