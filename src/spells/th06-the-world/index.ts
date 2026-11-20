import * as THREE from 'three';
import type { SpellCardInstance, SpellMetadata, SpellUpdateContext } from '../types';
import type { TimelinePhase } from '../../core/Timeline';
import { ClockworkStage } from './ClockworkStage';
import {
  KnifeChoreography,
  TH06_DURATION,
  TH06_TIME_RESUME_AT,
  TH06_TIME_STOP_AT,
} from './KnifeChoreography';
import { clamp, easeOutExpo, smoothstep } from '../../prototypes/DanmakuMath';

export const TH06_METADATA: SpellMetadata = {
  id: 'th06-the-world',
  gameCode: 'TH06',
  gameName: '东方红魔乡',
  spellName: '幻世 "The World"',
  character: '十六夜咲夜',
  bgm: '月时钟 ~ Luna Dial (月時計 ~ ルナ ダイアル)',
  prototype: '特定3D模型实例化',
  spatialForm: '静态悬浮刀阵 + 时间冻结',
  visualHighlight:
    '带金属高光(Specular)的3D飞刀模型, 子弹时间慢速穿梭, 刀尖反射冷光, 随后时间恢复瞬间爆发.',
  implemented: true,
};

const TH06_PHASES: TimelinePhase[] = [
  { id: 'prelude', label: '01 时流开启', start: 0.0, end: 2.4, badgeStyle: 'normal' },
  { id: 'timestop', label: '02 时间冻结', start: 2.4, end: 3.4, badgeStyle: 'frozen' },
  { id: 'bullettime', label: '03 子弹时间穿梭', start: 3.4, end: 10.2, badgeStyle: 'frozen' },
  { id: 'burst', label: '04 时流恢复爆发', start: 10.2, end: 15.0, badgeStyle: 'burst' },
];

export class TH06TheWorldSpell implements SpellCardInstance {
  public readonly metadata = TH06_METADATA;
  public readonly duration = TH06_DURATION;
  public readonly phases = TH06_PHASES;

  private root = new THREE.Group();
  private clockStage: ClockworkStage | null = null;
  private choreography: KnifeChoreography | null = null;

  // Dynamic specular lighting rig tailored for metallic silver knives
  private keyGlintLight: THREE.PointLight | null = null;
  private scarletRimLight: THREE.PointLight | null = null;
  private topMoonLight: THREE.DirectionalLight | null = null;
  private backClockLight: THREE.PointLight | null = null;

  private readonly _lightOffset = new THREE.Vector3();
  private readonly _activeCamPos = new THREE.Vector3();
  private readonly _activeCamDir = new THREE.Vector3();

  public init(scene: THREE.Scene, _renderer: THREE.WebGLRenderer): void {
    scene.background = new THREE.Color(0x020308);
    scene.fog = new THREE.FogExp2(0x02040b, 0.0115);

    this.root = new THREE.Group();
    scene.add(this.root);

    // 1. Dynamic Blade-Glint Light riding slightly offset from camera lens:
    // sweeps razor-sharp cold silver highlights across knife bevels & tips as the camera weaves!
    this.keyGlintLight = new THREE.PointLight(0xcfeaff, 22, 26, 1.55);
    this.root.add(this.keyGlintLight);

    // 2. Crisp overhead moonlight directional key
    this.topMoonLight = new THREE.DirectionalLight(0xd8eeff, 1.85);
    this.topMoonLight.position.set(10, 18, 12);
    this.root.add(this.topMoonLight);

    // 3. Scarlet Devil Mansion crimson accent rim light (gives subtle red edge-fire on metallic bevels)
    this.scarletRimLight = new THREE.PointLight(0xff2c5c, 24, 46, 1.5);
    this.scarletRimLight.position.set(-14, -4, 6);
    this.root.add(this.scarletRimLight);

    // 4. Astral cyan backlight emanating from the giant Roman numeral clock
    this.backClockLight = new THREE.PointLight(0x4ea8f5, 16, 46, 1.6);
    this.backClockLight.position.set(0, 1, -11);
    this.root.add(this.backClockLight);

    // 5. Build 3D Clockwork Astral Stage & 2,200+ Metallic Knife Choreography
    this.clockStage = new ClockworkStage();
    this.choreography = new KnifeChoreography();

    this.root.add(this.clockStage.root);
    this.root.add(this.choreography.root);
  }

  public update(ctx: SpellUpdateContext): void {
    if (!this.clockStage || !this.choreography) return;

    const t = ctx.time;
    const { worldTime, timeStopFactor } = this.choreography.computeWorldTime(t);

    // 1. Evaluate deterministic bullet-time camera pose
    this.choreography.evaluateCamera(t, ctx.cameraPose);

    if (ctx.isFreeCamera) {
      this._activeCamPos.copy(ctx.cameraWorldPosition);
      this._activeCamDir.copy(ctx.cameraWorldDirection);
    } else {
      this._activeCamPos.copy(ctx.cameraPose.position);
      this._activeCamDir
        .subVectors(ctx.cameraPose.lookAt, ctx.cameraPose.position)
        .normalize();
    }

    // 2. Position camera-riding cold blade-glint light slightly above-right of camera
    if (this.keyGlintLight) {
      this._lightOffset
        .copy(this._activeCamPos)
        .addScaledVector(this._activeCamDir, 2.6);
      this._lightOffset.y += 1.4;
      this.keyGlintLight.position.copy(this._lightOffset);
      // Peak intensity during bullet-time close-ups so needle tips flash icy cold!
      const closeUpBoost = smoothstep(3.2, 4.4, t) * (1 - smoothstep(10.0, 11.4, t));
      this.keyGlintLight.intensity = 18 + closeUpBoost * 16;
    }

    if (this.scarletRimLight) {
      const burstFire = smoothstep(10.1, 10.5, t) * (1 - smoothstep(12.6, 14.8, t));
      this.scarletRimLight.intensity = 22 * (1 - timeStopFactor * 0.35) + burstFire * 34;
    }

    // 3. Update astral clockwork stage & all 2,200+ metallic knives
    this.clockStage.update(t, worldTime, timeStopFactor, this._activeCamPos);
    this.choreography.update(t, worldTime, timeStopFactor);

    // 4. Drive Cinema Post-Processing FX (Time-Stop Inverted Shockwave + Resume Surge)
    const fx = ctx.postFX;
    fx.timeStopFactor = timeStopFactor;
    fx.vignette = 0.4 + timeStopFactor * 0.1;

    // High-threshold HDR bloom: ONLY true specular glints, magic circles & trails bloom,
    // keeping dark forged metallic bevels razor-sharp against pitch-black void!
    const resumeBloom = smoothstep(10.1, 10.45, t) * (1 - smoothstep(12.5, 14.8, t));
    const preGlintBloom = smoothstep(9.2, 10.1, t) * (1 - smoothstep(10.2, 10.6, t));
    fx.bloomStrength = 0.36 + preGlintBloom * 0.14 + resumeBloom * 0.22;
    fx.bloomRadius = 0.36 + resumeBloom * 0.1;
    fx.bloomThreshold = 1.12 - resumeBloom * 0.14;

    // Screen-space Time-Stop inverted shockwave & Resume snap-in
    fx.waveRadius = -1;
    fx.waveWidth = 0.14;
    fx.waveInvert = 0;
    fx.waveDistort = 0;
    fx.chromatic = 0.0014 + resumeBloom * 0.0034;
    fx.flash = 0;

    if (t >= TH06_TIME_STOP_AT - 0.04 && t <= TH06_TIME_STOP_AT + 1.2) {
      const p = clamp((t - (TH06_TIME_STOP_AT - 0.04)) / 1.24, 0, 1);
      fx.waveRadius = easeOutExpo(p) * 1.48;
      fx.waveWidth = 0.11 + p * 0.12;
      fx.waveInvert = Math.sin(p * Math.PI) * 0.92;
      fx.waveDistort = (1 - p) * 0.04;
      fx.chromatic = 0.002 + Math.sin(p * Math.PI) * 0.007;
      fx.flash = Math.exp(-Math.max(0, t - TH06_TIME_STOP_AT) * 12.0) * 0.18;
    } else if (t >= TH06_TIME_RESUME_AT - 0.25 && t <= TH06_TIME_RESUME_AT + 0.75) {
      const p = clamp((t - (TH06_TIME_RESUME_AT - 0.25)) / 1.0, 0, 1);
      if (p < 0.26) {
        // Snap-in inverted ring pulling back to center
        const k = p / 0.26;
        fx.waveRadius = (1 - k) * 1.25;
        fx.waveWidth = 0.12;
        fx.waveInvert = k * 0.72;
        fx.waveDistort = k * 0.03;
        fx.chromatic = 0.002 + k * 0.0055;
      } else {
        // Explosive outward shockwave on Time Resume!
        const k = (p - 0.26) / 0.74;
        fx.waveRadius = easeOutExpo(k) * 1.65;
        fx.waveWidth = 0.15;
        fx.waveInvert = (1 - k) * 0.28;
        fx.waveDistort = (1 - k) * 0.038;
        fx.chromatic = 0.002 + (1 - k) * 0.0075;
        fx.flash = Math.exp(-Math.max(0, t - TH06_TIME_RESUME_AT) * 10.5) * 0.2;
      }
    }
  }

  public getInstanceCount(): number {
    return this.choreography?.count ?? 0;
  }

  public dispose(scene: THREE.Scene): void {
    this.clockStage?.dispose();
    this.choreography?.dispose();
    scene.remove(this.root);
    this.clockStage = null;
    this.choreography = null;
  }
}
