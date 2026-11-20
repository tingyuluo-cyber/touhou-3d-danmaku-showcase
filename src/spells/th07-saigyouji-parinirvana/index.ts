import * as THREE from 'three';
import type { SpellCardInstance, SpellMetadata, SpellUpdateContext } from '../types';
import type { TimelinePhase } from '../../core/Timeline';
import { createSakuraCrestTexture } from './ButterflyGeometry';
import { SpectralWings } from './SpectralWings';
import { ButterflyDanmaku } from './ButterflyDanmaku';
import { clamp, lerp, smootherstep, smoothstep } from '../../prototypes/DanmakuMath';

export const TH07_METADATA: SpellMetadata = {
  id: 'th07-saigyouji-parinirvana',
  gameCode: 'TH07',
  gameName: '东方妖妖梦',
  spellName: '"反魂蝶 -八分咲-"',
  character: '西行寺幽幽子',
  bgm: '幽雅地绽放吧, 墨染的樱花 ~ Border of Life / Border of Life',
  prototype: 'InstancedMesh粒子系统',
  spatialForm: '仿生巨翼 + 樱瓣流体',
  visualHighlight:
    '大量 Instanced 粒子拼出巨大半透明发光蝶翼舒展, 配合前景飘落樱花景深 (DOF), 色彩柔美粉蓝紫.',
  implemented: true,
};

export const TH07_DURATION = 14.0;

const TH07_PHASES: TimelinePhase[] = [
  { id: 'petals', label: '01 冥界幽樱', start: 0.0, end: 3.0, badgeStyle: 'normal' },
  { id: 'unfurl', label: '02 巨翼舒展', start: 3.0, end: 7.2, badgeStyle: 'frozen' },
  { id: 'bloom', label: '03 八分咲盛放', start: 7.2, end: 11.6, badgeStyle: 'burst' },
  { id: 'drift', label: '04 墨染散华', start: 11.6, end: 14.0, badgeStyle: 'normal' },
];

export class TH07SaigyoujiParinirvanaSpell implements SpellCardInstance {
  public readonly metadata = TH07_METADATA;
  public readonly duration = TH07_DURATION;
  public readonly phases = TH07_PHASES;

  private root = new THREE.Group();
  private wings: SpectralWings | null = null;
  private danmaku: ButterflyDanmaku | null = null;
  private crestMain: THREE.Mesh | null = null;
  private crestInner: THREE.Mesh | null = null;
  private subCrests: THREE.Mesh[] = [];
  private crestTex: THREE.CanvasTexture | null = null;
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];

  private camCurve: THREE.CatmullRomCurve3 | null = null;
  private lookCurve: THREE.CatmullRomCurve3 | null = null;
  private rendererRef: THREE.WebGLRenderer | null = null;

  public init(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
    this.rendererRef = renderer;
    scene.background = new THREE.Color(0x04020d);
    scene.fog = new THREE.FogExp2(0x050312, 0.0125);

    this.root = new THREE.Group();
    scene.add(this.root);

    // Ethereal pink-lavender & moonlight-blue lighting for cupped 3D sakura petals
    const amb = new THREE.AmbientLight(0x7c5ca8, 0.75);
    const sakuraKey = new THREE.PointLight(0xff8ad0, 24, 54, 1.4);
    sakuraKey.position.set(8, 10, 12);
    const moonRim = new THREE.PointLight(0x74d4ff, 22, 54, 1.4);
    moonRim.position.set(-12, -4, 8);
    this.root.add(amb, sakuraKey, moonRim);

    // Glowing Saigyou Ayakashi cherry-blossom & fan magic circle stage anchor
    this.crestTex = createSakuraCrestTexture(1024);

    const mainGeom = new THREE.PlaneGeometry(26, 26);
    const mainMat = new THREE.MeshBasicMaterial({
      map: this.crestTex,
      color: new THREE.Color(0xe6a8ff),
      transparent: true,
      opacity: 0.44,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.crestMain = new THREE.Mesh(mainGeom, mainMat);
    this.crestMain.position.set(0, 0.4, -9.8);
    this.root.add(this.crestMain);

    const innerGeom = new THREE.PlaneGeometry(15, 15);
    const innerMat = new THREE.MeshBasicMaterial({
      map: this.crestTex,
      color: new THREE.Color(0x98dcff),
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.crestInner = new THREE.Mesh(innerGeom, innerMat);
    this.crestInner.position.set(0, 0.4, -7.8);
    this.root.add(this.crestInner);
    this.geometries.push(mainGeom, innerGeom);
    this.materials.push(mainMat, innerMat);

    // 4 floating peripheral blossom circles framing the wide wingspan
    const subGeom = new THREE.PlaneGeometry(5.2, 5.2);
    this.geometries.push(subGeom);
    this.subCrests = [];
    const subPositions: [number, number, number][] = [
      [-13.5, 6.2, -5.5],
      [13.5, 6.2, -5.5],
      [-11.0, -6.5, -4.5],
      [11.0, -6.5, -4.5],
    ];
    for (let i = 0; i < subPositions.length; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.crestTex,
        color: new THREE.Color(i % 2 === 0 ? 0xffa6dc : 0x8cd8ff),
        transparent: true,
        opacity: 0.48,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(subGeom, mat);
      mesh.position.set(...subPositions[i]);
      this.root.add(mesh);
      this.subCrests.push(mesh);
    }

    // Build colossal spectral wings + 3D butterfly barrage + foreground bokeh sakura
    this.wings = new SpectralWings();
    this.danmaku = new ButterflyDanmaku();
    this.root.add(this.wings.points, this.danmaku.root);

    // Sweeping 16s graceful cinema camera spline:
    // Gentle drift -> wide sweeping orbit framing the FULL 30-unit wingspan -> glide through blooming vortex -> serene pull-out
    this.camCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0.0, -0.6, 25.0),
        new THREE.Vector3(6.8, 0.8, 22.8),
        new THREE.Vector3(12.2, 4.2, 20.6),
        new THREE.Vector3(2.8, 1.8, 18.6),
        new THREE.Vector3(-9.8, -1.0, 19.6),
        new THREE.Vector3(-4.2, 2.4, 24.4),
        new THREE.Vector3(0.0, 3.8, 28.5),
      ],
      false,
      'centripetal',
      0.5,
    );

    this.lookCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0.0, 0.2, -3.5),
        new THREE.Vector3(0.0, 0.6, -3.5),
        new THREE.Vector3(-0.6, 0.8, -3.2),
        new THREE.Vector3(0.0, 0.4, -3.0),
        new THREE.Vector3(0.6, 0.3, -3.2),
        new THREE.Vector3(0.0, 0.8, -3.5),
        new THREE.Vector3(0.0, 2.2, -4.0),
      ],
      false,
      'centripetal',
      0.5,
    );
  }

  public update(ctx: SpellUpdateContext): void {
    if (!this.wings || !this.danmaku || !this.camCurve || !this.lookCurve) return;

    const t = ctx.time;
    const p = clamp(t / TH07_DURATION, 0, 1);

    // 1. Evaluate graceful sweeping cinema camera
    const u = clamp(lerp(p, smootherstep(0, 1, p), 0.28), 0, 1);
    this.camCurve.getPoint(u, ctx.cameraPose.position);
    this.lookCurve.getPoint(u, ctx.cameraPose.lookAt);
    ctx.cameraPose.roll = Math.sin(p * Math.PI * 2) * 0.065;
    ctx.cameraPose.fov = 48 + Math.sin(p * Math.PI) * 5.0;
    ctx.cameraPose.shake = 0.0;

    // 2. Drive organic wing formation, "八分咲" bloom pulse, and outro dissolution
    const wingForm = smoothstep(2.0, 6.6, t);
    const bloomClimax = smoothstep(7.0, 8.4, t) * (1 - smoothstep(11.2, 12.8, t));
    const dissolve = smoothstep(11.4, 13.85, t);
    const outroFade = 1 - smoothstep(12.5, 14.0, t);
    const introFade = smoothstep(0.0, 1.2, t);
    const pixelRatio = this.rendererRef?.getPixelRatio() ?? 1;

    this.wings.update(t, wingForm, dissolve, bloomClimax, pixelRatio);
    this.danmaku.update(t, bloomClimax, outroFade, pixelRatio);

    // 3. Animate glowing sakura magic circles
    if (this.crestMain && this.crestInner) {
      this.crestMain.rotation.z = t * 0.14;
      this.crestInner.rotation.z = -t * 0.24;
      const crestPulse = 0.88 + 0.12 * Math.sin(t * 2.1);
      (this.crestMain.material as THREE.MeshBasicMaterial).opacity =
        (0.36 + bloomClimax * 0.18) * crestPulse * introFade * outroFade;
      (this.crestInner.material as THREE.MeshBasicMaterial).opacity =
        (0.28 + bloomClimax * 0.16) * crestPulse * introFade * outroFade;
    }

    for (let i = 0; i < this.subCrests.length; i++) {
      const m = this.subCrests[i];
      m.rotation.z = t * (i % 2 === 0 ? 0.35 : -0.35);
      (m.material as THREE.MeshBasicMaterial).opacity =
        (0.32 + bloomClimax * 0.22) * introFade * outroFade;
    }

    // 4. Pastel ethereal Post-Processing FX (soft twilight bloom, zero over-exposure)
    const fx = ctx.postFX;
    fx.timeStopFactor = 0;
    fx.waveRadius = -1;
    fx.waveWidth = 0.14;
    fx.waveInvert = 0;
    fx.waveDistort = 0;
    fx.flash = 0;
    fx.vignette = 0.34;
    fx.chromatic = 0.0011 + bloomClimax * 0.0012;

    fx.bloomThreshold = 0.94;
    fx.bloomStrength = 0.44 + bloomClimax * 0.14;
    fx.bloomRadius = 0.56;
  }

  public getInstanceCount(): number {
    return (this.wings?.count ?? 0) + (this.danmaku?.instanceCount ?? 0);
  }

  public dispose(scene: THREE.Scene): void {
    this.wings?.dispose();
    this.danmaku?.dispose();
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.crestTex?.dispose();
    scene.remove(this.root);
    this.wings = null;
    this.danmaku = null;
    this.subCrests = [];
  }
}
