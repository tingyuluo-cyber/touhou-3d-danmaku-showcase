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
  { id: 'warning', label: '01 核警报充能', start: 0.0, end: 3.4, badgeStyle: 'normal' },
  { id: 'ignition', label: '02 微星点火', start: 3.4, end: 6.8, badgeStyle: 'burst' },
  { id: 'singularity', label: '03 引力奇点塌缩', start: 6.8, end: 10.1, badgeStyle: 'burst' },
  { id: 'supernova', label: '04 超新星爆裂', start: 10.1, end: 14.0, badgeStyle: 'frozen' },
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

    const ignition = smoothstep(1.6, 4.1, t);
    const gravityClimax = smoothstep(6.2, 8.2, t) * (1 - smoothstep(10.12, 10.6, t));
    // Breathless gravitational implosion pinch right before detonation (9.35s -> 10.10s)!
    const implosion = smoothstep(9.25, 10.08, t) * (1 - smoothstep(10.11, 10.22, t));
    const blastAge = Math.max(0, t - 10.15);
    const supernova = easeOutExpo(clamp(blastAge / 2.2, 0, 1));
    const blastImpulse = blastAge > 0 ? Math.exp(-blastAge * 3.8) : 0;
    const outroFade = 1 - smoothstep(12.9, 14.0, t);

    // 1. Intense gravity-orbit camera -> draws in on implosion, then WHIPS BACK on Supernova detonation!
    const u = clamp(lerp(p, smootherstep(0, 1, p), 0.25), 0, 1);
    this.camCurve.getPoint(u, ctx.cameraPose.position);
    // Concussive camera recoil pushback when blast wave hits
    if (supernova > 0.001) {
      const len = Math.max(1, ctx.cameraPose.position.length());
      ctx.cameraPose.position.multiplyScalar(1.0 + (supernova * 0.24) / Math.max(0.6, len / 18));
    }
    ctx.cameraPose.lookAt.set(0, 0, 0);
    ctx.cameraPose.roll = Math.sin(p * Math.PI * 2.2) * 0.12;
    // FOV tightens dramatically during implosion pinch, then explodes wide on detonation!
    ctx.cameraPose.fov = 48 + gravityClimax * 6.5 - implosion * 7.5 + blastImpulse * 18.0 + supernova * 8.0;

    // Visceral heavy concussive shake at ignition & supernova detonation!
    const igniteShake = Math.exp(-Math.max(0, t - 3.4) * 4.2) * smoothstep(3.3, 3.45, t) * 0.28;
    const novaShake = blastAge > 0 ? Math.exp(-blastAge * 4.2) * 0.68 : 0;
    ctx.cameraPose.shake = igniteShake + novaShake + gravityClimax * 0.045 + implosion * 0.12;

    // 2. Update boiling star, 3D plasma shockwave shell & centripetal infall/blast danmaku
    this.sun.update(t, ignition, gravityClimax, implosion, supernova, blastAge, outroFade);
    this.danmaku.update(
      t,
      ignition * 0.6 + gravityClimax * 0.9 + implosion * 1.4,
      supernova,
      outroFade,
    );

    // 3. Drive Prototype 4 Screen-Space Shader FX: Gravitational Lensing + Heat Haze + Blast Shockwave!
    const fx = ctx.postFX;
    const camDist = ctx.isFreeCamera
      ? Math.max(6, ctx.cameraWorldPosition.length())
      : Math.max(6, ctx.cameraPose.position.length());

    fx.lensWorldPos = this.sunAnchor;
    fx.lensRadius = clamp((3.6 - implosion * 1.1 + supernova * 2.2) / camDist, 0.08, 0.42);
    fx.lensStrength =
      (0.18 + ignition * 0.52 + gravityClimax * 0.36 + implosion * 0.55 + blastImpulse * 0.72) * outroFade;
    fx.heatHaze = (0.15 + ignition * 0.45 + gravityClimax * 0.45 + blastImpulse * 0.85) * outroFade;
    fx.warmGrade = (0.28 + gravityClimax * 0.38 + supernova * 0.42) * outroFade;

    // Screen-space concussive radial shockwave distortion tearing across the viewport on detonation!
    if (blastAge > 0.001 && blastAge < 1.85) {
      fx.waveRadius = blastAge * 0.95;
      fx.waveWidth = 0.16;
      fx.waveInvert = 0; // Pure physical shockwave refraction (no color inversion)
      fx.waveDistort = 0.055 * Math.exp(-blastAge * 1.65) * outroFade;
    } else {
      fx.waveRadius = -1;
      fx.waveDistort = 0;
    }

    fx.vignette = 0.44 + gravityClimax * 0.12 + implosion * 0.18 - blastImpulse * 0.2;
    fx.chromatic = 0.0018 + gravityClimax * 0.0024 + implosion * 0.003 + blastImpulse * 0.011;
    // Blinding incandescent flash right at detonation!
    fx.flash = blastAge > 0 ? Math.exp(-blastAge * 5.8) * 0.62 * outroFade : 0;

    // High-threshold HDR bloom keeps boiling photosphere crisp, then surges dramatically at detonation!
    fx.bloomThreshold = 1.04 - blastImpulse * 0.22;
    fx.bloomStrength = 0.46 + gravityClimax * 0.12 + implosion * 0.18 + blastImpulse * 0.44 + supernova * 0.12;
    fx.bloomRadius = 0.48 + blastImpulse * 0.28 + supernova * 0.14;
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
