import * as THREE from 'three';
import { createSeededRandom } from '../../prototypes/DanmakuMath';
import { createSoftGlowTexture } from '../../prototypes/MagicCircleFactory';

/**
 * Generates an intricate Gothic Cathedral Rose-Window + 17-Point Imperial Golden Sanctum Halo.
 */
function createCathedralRoseTexture(size = 1024): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.46;

  ctx.clearRect(0, 0, size, size);

  // Warm sacred golden cathedral aura
  const aura = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.06);
  aura.addColorStop(0.0, 'rgba(255, 232, 165, 0.28)');
  aura.addColorStop(0.45, 'rgba(255, 198, 92, 0.12)');
  aura.addColorStop(0.82, 'rgba(130, 190, 255, 0.14)');
  aura.addColorStop(1.0, 'rgba(255, 200, 90, 0.0)');
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.06, 0, Math.PI * 2);
  ctx.fill();

  // Subtle stained-glass jewel wedges inside outer rose-window arches (17 sacred divisions!)
  const stainedColors = [
    'rgba(255, 210, 95, 0.22)',
    'rgba(82, 172, 255, 0.20)',
    'rgba(72, 228, 168, 0.18)',
    'rgba(255, 96, 138, 0.18)',
    'rgba(182, 126, 255, 0.18)',
  ];
  for (let i = 0; i < 17; i++) {
    const a0 = (i / 17) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 1) / 17) * Math.PI * 2 - Math.PI / 2;
    const mid = (a0 + a1) * 0.5;
    ctx.save();
    ctx.fillStyle = stainedColors[i % stainedColors.length];
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.92, a0 + 0.02, a1 - 0.02, false);
    ctx.arc(cx, cy, R * 0.58, a1 - 0.02, a0 + 0.02, true);
    ctx.closePath();
    ctx.fill();

    // Gothic trefoil circular rosette in each of the 17 lancets
    ctx.strokeStyle = '#ffe59c';
    ctx.globalAlpha = 0.72;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(mid) * R * 0.76, cy + Math.sin(mid) * R * 0.76, R * 0.072, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Crisp golden architectural tracery rings
  ctx.strokeStyle = '#ffebb2';
  ctx.shadowColor = '#ffb845';
  ctx.shadowBlur = 12;

  const drawRing = (r: number, lw: number, alpha: number, dash?: number[]) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = lw;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };

  drawRing(R * 0.99, 3.6, 0.94);
  drawRing(R * 0.93, 2.0, 0.75);
  drawRing(R * 0.58, 2.8, 0.88);
  drawRing(R * 0.53, 1.4, 0.55, [8, 10]);
  drawRing(R * 0.28, 2.2, 0.82);

  // 17 radiating sacred golden ribs (Seventeen-Article Constitution!)
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 2.2;
  for (let i = 0; i < 17; i++) {
    const a = (i / 17) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R * 0.28, cy + Math.sin(a) * R * 0.28);
    ctx.lineTo(cx + Math.cos(a) * R * 0.98, cy + Math.sin(a) * R * 0.98);
    ctx.stroke();
  }

  // Inscribed 17-point star polygon in central sanctum
  ctx.globalAlpha = 0.62;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = 0; i <= 17; i++) {
    const idx = (i * 7) % 17;
    const a = (idx / 17) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * R * 0.52;
    const y = cy + Math.sin(a) * R * 0.52;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Pure 3D Gothic Sanctum stage for TH13 眼光 "十七条的光芒":
 * - Grand stained-glass Gothic rose-window dome halo
 * - 17 floating miniature golden glyph nodes marking beam emission origins
 * - 2,600 drifting sunlit cathedral incense dust motes
 */
export class CathedralStage {
  public readonly root = new THREE.Group();
  public readonly emitterNodes: THREE.Mesh[] = [];

  private readonly roseWindow: THREE.Mesh;
  private readonly innerHalo: THREE.Mesh;
  private readonly dustPoints: THREE.Points;
  private readonly dustBase: Float32Array;
  private readonly dustCount = 2600;

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];

  constructor() {
    const roseTex = createCathedralRoseTexture(1024);
    const glowTex = createSoftGlowTexture(128);
    this.textures.push(roseTex, glowTex);

    // 1. Grand Stained-Glass Rose Window Dome Halo high above the sanctum center
    const roseGeom = new THREE.PlaneGeometry(34, 34);
    const roseMat = new THREE.MeshBasicMaterial({
      map: roseTex,
      color: new THREE.Color(0xffe6aa),
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.roseWindow = new THREE.Mesh(roseGeom, roseMat);
    this.roseWindow.position.set(0, 7.8, -6.0);
    this.roseWindow.rotation.x = Math.PI * 0.28;
    this.root.add(this.roseWindow);

    const innerGeom = new THREE.PlaneGeometry(14.5, 14.5);
    const innerMat = new THREE.MeshBasicMaterial({
      map: roseTex,
      color: new THREE.Color(0xffd478),
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.innerHalo = new THREE.Mesh(innerGeom, innerMat);
    this.innerHalo.position.set(0, 7.2, -5.2);
    this.innerHalo.rotation.x = Math.PI * 0.28;
    this.root.add(this.innerHalo);
    this.geometries.push(roseGeom, innerGeom);
    this.materials.push(roseMat, innerMat);

    // 2. 17 Sacred Emitter Halo Nodes arranged in a golden crown ring
    const nodeGeom = new THREE.PlaneGeometry(1.75, 1.75);
    this.geometries.push(nodeGeom);
    for (let i = 0; i < 17; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: roseTex,
        color: new THREE.Color(0xffe8a8),
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(nodeGeom, mat);
      this.root.add(mesh);
      this.emitterNodes.push(mesh);
    }

    // 3. 2,600 Sunlit Cathedral Air-Dust Motes (gives volumetric shafts atmospheric depth!)
    const rand = createSeededRandom(20110813); // Touhou 13 TD release date seed!
    this.dustBase = new Float32Array(this.dustCount * 3);
    const dPos = new Float32Array(this.dustCount * 3);
    const dCol = new Float32Array(this.dustCount * 3);

    const palette = [
      new THREE.Color(0xffe69c), // sunlit gold
      new THREE.Color(0xfff7dc), // warm ivory
      new THREE.Color(0x88ccff), // stained sapphire
      new THREE.Color(0x6cf0ba), // jade emerald
      new THREE.Color(0xff92b0), // rose window pink
    ];

    for (let i = 0; i < this.dustCount; i++) {
      const r = 2 + Math.pow(rand(), 0.72) * 32;
      const a = rand() * Math.PI * 2;
      const y = (rand() - 0.5) * 26;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r - 2.0;

      this.dustBase[i * 3] = x;
      this.dustBase[i * 3 + 1] = y;
      this.dustBase[i * 3 + 2] = z;
      dPos[i * 3] = x;
      dPos[i * 3 + 1] = y;
      dPos[i * 3 + 2] = z;

      const c = rand() < 0.68 ? palette[i % 2] : palette[2 + (i % 3)];
      dCol[i * 3] = c.r;
      dCol[i * 3 + 1] = c.g;
      dCol[i * 3 + 2] = c.b;
    }

    const dustGeom = new THREE.BufferGeometry();
    dustGeom.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
    dustGeom.setAttribute('color', new THREE.BufferAttribute(dCol, 3));
    const dustMat = new THREE.PointsMaterial({
      size: 0.24,
      map: glowTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.dustPoints = new THREE.Points(dustGeom, dustMat);
    this.root.add(this.dustPoints);
    this.geometries.push(dustGeom);
    this.materials.push(dustMat);
  }

  public update(t: number, introFade: number, climax: number, outroFade: number, cameraPos: THREE.Vector3): void {
    const vis = introFade * outroFade;
    this.roseWindow.rotation.z = t * 0.08;
    this.innerHalo.rotation.z = -t * 0.16;

    (this.roseWindow.material as THREE.MeshBasicMaterial).opacity = (0.48 + climax * 0.22) * vis;
    (this.innerHalo.material as THREE.MeshBasicMaterial).opacity = (0.58 + climax * 0.24) * vis;

    // Gentle sunlit upward incense drift for cathedral dust motes
    const posAttr = this.dustPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    for (let i = 0; i < this.dustCount; i++) {
      const i3 = i * 3;
      const bx = this.dustBase[i3];
      const by = this.dustBase[i3 + 1];
      const bz = this.dustBase[i3 + 2];
      arr[i3] = bx + Math.sin(t * 0.55 + i * 0.17) * 0.55;
      arr[i3 + 1] = ((((by + t * 0.65 + 13) % 26) + 26) % 26) - 13;
      arr[i3 + 2] = bz + Math.cos(t * 0.48 + i * 0.23) * 0.55;
    }
    posAttr.needsUpdate = true;
    (this.dustPoints.material as THREE.PointsMaterial).opacity = (0.58 + climax * 0.24) * vis;

    // Billboard 17 emitter nodes smoothly toward camera
    for (let i = 0; i < this.emitterNodes.length; i++) {
      const node = this.emitterNodes[i];
      node.lookAt(cameraPos);
      node.rotateZ(t * 0.9 + i * 0.37);
    }
  }

  public dispose(): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
  }
}
