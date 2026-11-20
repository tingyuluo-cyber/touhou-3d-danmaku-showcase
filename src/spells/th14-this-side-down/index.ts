import * as THREE from 'three';
import type { SpellCardInstance, SpellMetadata, SpellUpdateContext } from '../types';
import type { TimelinePhase } from '../../core/Timeline';
import {
  clamp,
  createSeededRandom,
  easeInOutCubic,
  lerp,
  orientForwardWithRoll,
  smoothstep,
} from '../../prototypes/DanmakuMath';

export const TH14_METADATA: SpellMetadata = {
  id: 'th14-this-side-down',
  gameCode: 'TH14',
  gameName: '东方辉针城',
  spellName: '逆符 "天下翻覆"',
  character: '鬼人正邪',
  bgm: '逆转的意识形态 / Reverse Ideology',
  prototype: '后期Shader特效',
  spatialForm: '视错觉 + 摄像机反转',
  visualHighlight:
    '镜头随节拍做利落的 180 度滚转 (Roll), 重力瞬间倒置令满屏立体箭弹骤然翻向, 高潮段触发猩红斜线撕裂屏幕镜像反转空间.',
  implemented: true,
};

export const TH14_DURATION = 12.5;

const TH14_PHASES: TimelinePhase[] = [
  { id: 'normal', label: '01 正向降落', start: 0.0, end: 3.0, badgeStyle: 'normal' },
  { id: 'flip1', label: '02 天地 180° 翻转', start: 3.0, end: 6.4, badgeStyle: 'frozen' },
  { id: 'mirror', label: '03 镜像撕裂空间', start: 6.4, end: 10.4, badgeStyle: 'burst' },
  { id: 'invert', label: '04 逆转余波', start: 10.4, end: 12.5, badgeStyle: 'normal' },
];

interface ArrowBullet {
  x0: number;
  y0: number;
  z0: number;
  speed: number;
  swayPhase: number;
  scale: number;
  color: THREE.Color;
}

/**
 * Builds a sleek, sculpted Touhou Scale / Swept-Wing Arrowhead bullet (`矢弹 / 鳞弹`) pointing along +Z,
 * with sharp central spine ridge, swept delta wings, and concave tail notch (replaces rough 4-sided cone!).
 */
function createArrowBulletGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const tip: [number, number, number] = [0, 0, 0.68];
  const topSpine: [number, number, number] = [0, 0.09, -0.15];
  const botSpine: [number, number, number] = [0, -0.09, -0.15];
  const tailNotch: [number, number, number] = [0, 0, -0.32];
  const rightWing: [number, number, number] = [0.30, 0, -0.52];
  const leftWing: [number, number, number] = [-0.30, 0, -0.52];

  const tri = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) => {
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  };

  // Top swept facets
  tri(tip, rightWing, topSpine);
  tri(tip, topSpine, leftWing);
  tri(topSpine, rightWing, tailNotch);
  tri(topSpine, tailNotch, leftWing);
  // Bottom swept facets
  tri(tip, botSpine, rightWing);
  tri(tip, leftWing, botSpine);
  tri(botSpine, tailNotch, rightWing);
  tri(botSpine, leftWing, tailNotch);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
}

/**
 * Generates an Escher-like high-contrast glowing perspective grid texture for ceiling/floor planes.
 */
function createEscherGridTexture(lineColor: string, size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);

  const cells = 8;
  const step = size / cells;
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2.5;
  ctx.globalAlpha = 0.72;

  for (let i = 0; i <= cells; i++) {
    const p = i * step;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  // Alternating subtle diamond markers in checkerboard cells
  ctx.fillStyle = lineColor;
  ctx.globalAlpha = 0.24;
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      if ((r + c) % 2 === 0) {
        const cx = (c + 0.5) * step;
        const cy = (r + 0.5) * step;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 10);
        ctx.lineTo(cx + 10, cy);
        ctx.lineTo(cx, cy + 10);
        ctx.lineTo(cx - 10, cy);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class TH14ThisSideDownSpell implements SpellCardInstance {
  public readonly metadata = TH14_METADATA;
  public readonly duration = TH14_DURATION;
  public readonly phases = TH14_PHASES;

  private root = new THREE.Group();
  private floorGrid: THREE.Mesh | null = null;
  private ceilGrid: THREE.Mesh | null = null;
  private arrowMesh: THREE.InstancedMesh | null = null;
  private ringMeshes: THREE.Mesh[] = [];
  private arrows: ArrowBullet[] = [];

  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private textures: THREE.Texture[] = [];

  private readonly _pos = new THREE.Vector3();
  private readonly _dir = new THREE.Vector3();
  private readonly _quat = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3();
  private readonly _mat4 = new THREE.Matrix4();

  public init(scene: THREE.Scene, _renderer: THREE.WebGLRenderer): void {
    scene.background = new THREE.Color(0x050208);
    scene.fog = new THREE.FogExp2(0x06020a, 0.016);

    this.root = new THREE.Group();
    scene.add(this.root);

    const amb = new THREE.AmbientLight(0x8a6484, 0.8);
    const redKey = new THREE.PointLight(0xff2c58, 34, 60, 1.4);
    redKey.position.set(10, 10, 10);
    const cyanKey = new THREE.PointLight(0x38d4ff, 34, 60, 1.4);
    cyanKey.position.set(-10, -10, 10);
    this.root.add(amb, redKey, cyanKey);

    // 1. Twin Opposing Escher Gravity Planes (Crimson Ceiling vs Cyan Floor!)
    const crimsonGridTex = createEscherGridTexture('#ff3664');
    const cyanGridTex = createEscherGridTexture('#44d4ff');
    this.textures.push(crimsonGridTex, cyanGridTex);

    const planeGeom = new THREE.PlaneGeometry(76, 76);
    const ceilMat = new THREE.MeshBasicMaterial({
      map: crimsonGridTex,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const floorMat = new THREE.MeshBasicMaterial({
      map: cyanGridTex,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.geometries.push(planeGeom);
    this.materials.push(ceilMat, floorMat);

    this.ceilGrid = new THREE.Mesh(planeGeom, ceilMat);
    this.ceilGrid.position.set(0, 11.5, -6);
    this.ceilGrid.rotation.x = Math.PI * 0.5;

    this.floorGrid = new THREE.Mesh(planeGeom, floorMat);
    this.floorGrid.position.set(0, -11.5, -6);
    this.floorGrid.rotation.x = Math.PI * 0.5;
    this.root.add(this.ceilGrid, this.floorGrid);

    // 2. Twin Counter-Rotating Split Yin-Yang / Inversion Rings in center
    this.ringMeshes = [];
    const ringCols = [0xff2c5c, 0x3ad8ff, 0xffffff];
    for (let i = 0; i < 3; i++) {
      const rGeom = new THREE.TorusGeometry(4.8 + i * 2.4, 0.06, 10, 96);
      const rMat = new THREE.MeshBasicMaterial({
        color: ringCols[i],
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const rMesh = new THREE.Mesh(rGeom, rMat);
      rMesh.position.set(0, 0, -4 - i * 3);
      this.root.add(rMesh);
      this.ringMeshes.push(rMesh);
      this.geometries.push(rGeom);
      this.materials.push(rMat);
    }

    // 3. 2,400 Crisp 3D Directional Arrowhead Bullets whose gravity & direction physically FLIP!
    const rand = createSeededRandom(20130812); // Touhou 14 DDC release date seed!
    const count = 2400;
    this.arrows = [];
    const cCrimson = new THREE.Color(0xff2a58);
    const cCyan = new THREE.Color(0x3ad8ff);
    const cWhite = new THREE.Color(0xf6f8ff);

    for (let i = 0; i < count; i++) {
      // Structured Escher columns + radial rings so gravity flip is unmistakably legible!
      const isCol = i % 3 !== 0;
      let x0 = 0;
      let z0 = 0;
      if (isCol) {
        const ringR = 4.2 + (i % 6) * 2.6;
        const a = (Math.floor(i / 6) / 60) * Math.PI * 2;
        x0 = Math.cos(a) * ringR;
        z0 = -4 + Math.sin(a) * ringR;
      } else {
        x0 = (rand() - 0.5) * 34;
        z0 = (rand() - 0.5) * 32 - 4;
      }
      const cPick = i % 3 === 0 ? cCrimson : i % 3 === 1 ? cCyan : cWhite;
      this.arrows.push({
        x0,
        y0: (rand() - 0.5) * 24,
        z0,
        speed: 5.5 + (i % 5) * 1.15,
        swayPhase: rand() * Math.PI * 2,
        scale: 0.65 + (i % 4) * 0.14,
        color: cPick.clone(),
      });
    }

    const arrowGeom = createArrowBulletGeometry();
    const arrowMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.22,
      metalness: 0.72,
      emissive: new THREE.Color(0x4a243c),
      emissiveIntensity: 0.85,
    });
    this.geometries.push(arrowGeom);
    this.materials.push(arrowMat);

    this.arrowMesh = new THREE.InstancedMesh(arrowGeom, arrowMat, count);
    this.arrowMesh.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      this.arrowMesh.setColorAt(i, this.arrows[i].color);
    }
    if (this.arrowMesh.instanceColor) this.arrowMesh.instanceColor.needsUpdate = true;
    this.root.add(this.arrowMesh);
  }

  public update(ctx: SpellUpdateContext): void {
    if (!this.arrowMesh) return;

    const t = ctx.time;
    const p = clamp(t / TH14_DURATION, 0, 1);

    // Crisp beat-timed 180-degree camera rolls!
    // Flip 1 at t = 3.0..3.85s (0 -> PI), Flip 2 at t = 7.4..8.25s (PI -> 2*PI)
    const flip1 = easeInOutCubic(clamp((t - 3.0) / 0.85, 0, 1));
    const flip2 = easeInOutCubic(clamp((t - 7.4) / 0.85, 0, 1));
    const camRoll = (flip1 + flip2) * Math.PI;

    // Gravity direction smoothly snaps +1 (down) -> -1 (up) -> +1 (down)
    const gravDir = lerp(1, -1, flip1) * (1 - flip2) + flip2 * 1;
    // Integrated vertical travel with gravity flips
    const integratedY =
      t < 3.4
        ? -t
        : t < 7.8
          ? -3.4 + (t - 3.4) * 1.15
          : -3.4 + 4.4 * 1.15 - (t - 7.8) * 1.3;

    // Mirror-tear shader peaks during Act 2 (`6.4s - 10.4s`)!
    const mirrorActive =
      smoothstep(6.2, 6.85, t) * (1 - smoothstep(10.0, 10.8, t));

    // Orbit smoothly while rolling upside-down
    const orbitA = p * Math.PI * 1.4 - 0.5;
    const camR = 17.5 - Math.sin(p * Math.PI) * 3.8;
    ctx.cameraPose.position.set(
      Math.sin(orbitA) * camR,
      Math.sin(t * 0.9) * 2.4,
      -4.0 + Math.cos(orbitA) * camR,
    );
    ctx.cameraPose.lookAt.set(0, 0, -4.0);
    ctx.cameraPose.roll = camRoll;
    ctx.cameraPose.fov = 52 + mirrorActive * 8.0;

    // Punchy micro-shake right on each 180-degree flip snap!
    const snap1 = Math.exp(-Math.abs(t - 3.05) * 10) * 0.3;
    const snap2 = Math.exp(-Math.abs(t - 7.45) * 10) * 0.32;
    ctx.cameraPose.shake = snap1 + snap2;

    if (this.floorGrid && this.ceilGrid) {
      const scroll = t * 0.35;
      (this.floorGrid.material as THREE.MeshBasicMaterial).map!.offset.set(scroll, scroll * 0.6);
      (this.ceilGrid.material as THREE.MeshBasicMaterial).map!.offset.set(-scroll, -scroll * 0.6);
    }

    for (let i = 0; i < this.ringMeshes.length; i++) {
      const m = this.ringMeshes[i];
      m.rotation.z = t * (i % 2 === 0 ? 1 : -1) * 0.8 + camRoll * 0.5;
      m.rotation.x = Math.sin(t * 0.7 + i) * 0.4;
    }

    // Update all 2,400 directional 3D arrowheads reversing mid-flight!
    for (let i = 0; i < this.arrows.length; i++) {
      const a = this.arrows[i];
      const span = 23.0;
      const rawY = a.y0 + integratedY * a.speed;
      const y = ((((rawY + span * 0.5) % span) + span) % span) - span * 0.5;
      const x = a.x0 + Math.sin(t * 1.4 + a.swayPhase) * 0.65;
      const z = a.z0 + Math.cos(t * 1.2 + a.swayPhase) * 0.65;

      this._pos.set(x, y, z);
      // Arrowhead points strictly along current gravity direction!
      this._dir.set(Math.cos(t * 1.4 + a.swayPhase) * 0.08, -gravDir, 0.04).normalize();
      orientForwardWithRoll(this._dir, t * 2.0 + a.swayPhase, this._quat);

      const yFade = 1 - smoothstep(9.2, 11.4, Math.abs(y));
      this._scale.setScalar(a.scale * yFade);
      this._mat4.compose(this._pos, this._quat, this._scale);
      this.arrowMesh.setMatrixAt(i, this._mat4);
    }
    this.arrowMesh.instanceMatrix.needsUpdate = true;

    const fx = ctx.postFX;
    fx.mirrorSplit = mirrorActive;
    fx.vignette = 0.38;
    fx.chromatic = 0.002 + mirrorActive * 0.0042 + (snap1 + snap2) * 0.012;
    fx.flash = (snap1 + snap2) * 0.35;
    fx.bloomThreshold = 0.94;
    fx.bloomStrength = 0.44 + mirrorActive * 0.14;
    fx.bloomRadius = 0.45;
  }

  public getInstanceCount(): number {
    return this.arrows.length + 3;
  }

  public dispose(scene: THREE.Scene): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    scene.remove(this.root);
    this.arrowMesh = null;
    this.ringMeshes = [];
  }
}
