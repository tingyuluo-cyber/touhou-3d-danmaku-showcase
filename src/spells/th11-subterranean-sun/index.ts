import * as THREE from 'three';
import type { SpellCardInstance, SpellMetadata, SpellUpdateContext } from '../types';
import type { TimelinePhase } from '../../core/Timeline';
import { NuclearSun } from './NuclearSun';
import { GravityDanmaku } from './GravityDanmaku';
import { clamp, easeOutExpo, lerp, smootherstep, smoothstep } from '../../prototypes/DanmakuMath';

export const TH11_METADATA: SpellMetadata = {
  id: 'th11-subterranean-sun',
  gameCode: 'TH11',
  gameName: '东方地灵殿',
  spellName: '"地底太阳"',
  character: '灵乌路空',
  bgm: '灵知的太阳信仰 ~ Nuclear Fusion',
  prototype: '后期Shader特效',
  spatialForm: '引力奇点 + 核爆耀斑',
  visualHighlight:
    '中心强 Bloom 沸腾微型恒星, 边缘实时引力透镜折射与热空气扭曲 (Heat Haze), 周围 4,600+ 弹幕向心加速吸积.',
  implemented: true,
};

export const TH11_DURATION = 14.0;

const TH11_PHASES: TimelinePhase[] = [
  { id: 'warning', label: '01 核警报充能', start: 0.0, end: 3.6, badgeStyle: 'normal' },
  { id: 'ignition', label: '02 微星点火', start: 3.6, end: 7.4, badgeStyle: 'burst' },
  { id: 'singularity', label: '03 引力奇点吸积', start: 7.4, end: 11.4, badgeStyle: 'burst' },
  { id: 'supernova', label: '04 超新星耀斑', start: 11.4, end: 14.0, badgeStyle: 'frozen' },
];

export class TH11SubterraneanSunSpell implements SpellCardInstance {
  public readonly metadata = TH11_METADATA;
  public readonly duration = TH11_DURATION;
  public readonly phases = TH11_PHASES;

  private root = new THREE.Group();
  private sun: NuclearSun | null = null;
  private danmaku: GravityDanmaku | null = null;
  private camCurve: THREE.CatmullRomCurve3 | null = null;
  private readonly sunAnchor = new THREE.Vector3(0, 0, 0);

  public init(scene: THREE.Scene, _renderer: THREE.WebGLRenderer): void {
    scene.background = new THREE.Color(0x060203);
    scene.fog = new THREE.FogExp2(0x0a0203, 0.011);

    this.root = new THREE.Group();
    scene.add(this.root);

    this.sun = new NuclearSun();
    this.danmaku = new GravityDanmaku();
    this.root.add(this.sun.root, this.danmaku.root);

    // High-pressure dramatic orbit closing in toward the blazing event horizon,
    // banking tightly during singularity climax, then whipping back on Supernova Flare!
    this.camCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0.0, 5.2, 24.5),
        new THREE.Vector3(10.5, 3.2, 17.5),
        new THREE.Vector3(12.8, -1.8, 10.6),
        new THREE.Vector3(4.2, -3.2, 13.8),
        new THREE.Vector3(-11.4, 2.6, 13.2),
        new THREE.Vector3(-6.2, 4.4, 20.8),
        new THREE.Vector3(0.0, 2.2, 28.5),
      ],
      false,
      'centripetal',
      0.5,
    );
  }

  public update(ctx: SpellUpdateContext): void {
    if (!this.sun || !this.danmaku || !this.camCurve) return;

    const t = ctx.time;
    const p = clamp(t / TH11_DURATION, 0, 1);

    const ignition = smoothstep(1.8, 4.4, t);
    const gravityClimax = smoothstep(6.8, 8.6, t) * (1 - smoothstep(11.4, 12.6, t));
    const supernova = easeOutExpo(clamp((t - 11.35) / 2.2, 0, 1));
    const outroFade = 1 - smoothstep(12.9, 14.0, t);

    // 1. Evaluate intense cinematic gravity-orbit camera
    const u = clamp(lerp(p, smootherstep(0, 1, p), 0.25), 0, 1);
    this.camCurve.getPoint(u, ctx.cameraPose.position);
    ctx.cameraPose.lookAt.set(0, 0, 0);
    ctx.cameraPose.roll = Math.sin(p * Math.PI * 2.2) * 0.14;
    ctx.cameraPose.fov = 48 + gravityClimax * 8.0 + supernova * 10.0;

    // Rumble micro-shake on ignition & supernova flare
    const igniteShake = Math.exp(-Math.max(0, t - 3.6) * 4.0) * smoothstep(3.5, 3.65, t) * 0.26;
    const novaShake = Math.exp(-Math.max(0, t - 11.4) * 3.0) * smoothstep(11.3, 11.45, t) * 0.44;
    ctx.cameraPose.shake = igniteShake + novaShake + gravityClimax * 0.055;

    // 2. Update boiling star & centripetal infall danmaku
    this.sun.update(t, ignition, gravityClimax, supernova, outroFade);
    this.danmaku.update(t, ignition * 0.6 + gravityClimax * 0.85, supernova, outroFade);

    // 3. Drive Prototype 4 Screen-Space Shader FX: Gravitational Lensing + Heat Haze!
    const fx = ctx.postFX;
    const camDist = ctx.isFreeCamera
      ? Math.max(6, ctx.cameraWorldPosition.length())
      : Math.max(6, ctx.cameraPose.position.length());

    fx.lensWorldPos = this.sunAnchor;
    // Apparent angular radius scales accurately with perspective camera distance!
    fx.lensRadius = clamp((3.6 + supernova * 1.4) / camDist, 0.08, 0.34);
    fx.lensStrength = (0.18 + ignition * 0.52 + gravityClimax * 0.32 + supernova * 0.28) * outroFade;
    fx.heatHaze = (0.15 + ignition * 0.45 + gravityClimax * 0.42 + supernova * 0.35) * outroFade;
    fx.warmGrade = (0.28 + gravityClimax * 0.38 + supernova * 0.34) * outroFade;

    fx.vignette = 0.44 + gravityClimax * 0.12;
    fx.chromatic = 0.0018 + gravityClimax * 0.0026 + supernova * 0.004;
    fx.flash = Math.exp(-Math.max(0, t - 11.4) * 8.5) * smoothstep(11.35, 11.42, t) * 0.16;

    // High-threshold HDR bloom keeps boiling photosphere granulation visible (no white-out blob!)
    fx.bloomThreshold = 1.04;
    fx.bloomStrength = 0.46 + gravityClimax * 0.12 + supernova * 0.16;
    fx.bloomRadius = 0.48 + supernova * 0.14;
  }

  public getInstanceCount(): number {
    return this.danmaku?.instanceCount ?? 0;
  }

  public dispose(scene: THREE.Scene): void {
    this.sun?.dispose();
    this.danmaku?.dispose();
    scene.remove(this.root);
    this.sun = null;
    this.danmaku = null;
  }
}
