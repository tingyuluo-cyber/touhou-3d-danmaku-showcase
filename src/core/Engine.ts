import * as THREE from 'three';
import { createMetallicStudioEnv } from './StudioEnv';
import { PostProcessingPipeline } from './PostProcessing';
import { CameraDirector, type CameraMode } from './CameraDirector';
import { Timeline } from './Timeline';
import { AudioSyncController, type AudioStatusInfo } from './AudioSync';
import { smootherstep } from '../prototypes/DanmakuMath';
import type { RecorderHost } from './Recorder';
import type { CameraPose, PostFXState, SpellCardInstance } from '../spells/types';

export interface EngineCallbacks {
  onFrameStats?: (fps: number, instanceCount: number) => void;
  onSpellLoaded?: (spell: SpellCardInstance) => void;
  onAudioStatus?: (info: AudioStatusInfo) => void;
  onSpellCompleted?: (spell: SpellCardInstance) => void;
}

export class DanmakuEngine implements RecorderHost {
  public readonly canvas: HTMLCanvasElement;
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly post: PostProcessingPipeline;
  public readonly cameraDirector: CameraDirector;
  public readonly timeline = new Timeline();
  public readonly audio: AudioSyncController;

  private readonly envTexture: THREE.Texture;
  private readonly callbacks: EngineCallbacks;
  private currentSpell: SpellCardInstance | null = null;

  private rafId = 0;
  private lastPerfTime = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private currentFps = 60;
  private isExportSizing = false;

  private readonly cameraPose: CameraPose = {
    position: new THREE.Vector3(0, 2, 22),
    lookAt: new THREE.Vector3(0, 0, -2),
    roll: 0,
    fov: 50,
    shake: 0,
  };

  private readonly postFX: PostFXState = {
    bloomStrength: 0.56,
    bloomRadius: 0.48,
    bloomThreshold: 0.78,
    timeStopFactor: 0,
    waveRadius: -1,
    waveWidth: 0.14,
    waveInvert: 0,
    waveDistort: 0,
    chromatic: 0.0014,
    flash: 0,
    vignette: 0.36,
    lensStrength: 0,
    lensRadius: 0.16,
    lensCenterX: 0.5,
    lensCenterY: 0.5,
    lensWorldPos: null,
    heatHaze: 0,
    warmGrade: 0,
    mirrorSplit: 0,
    stageFade: 1,
  };

  private readonly camWorldPos = new THREE.Vector3();
  private readonly camWorldDir = new THREE.Vector3();
  private readonly projScratch = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020308);

    // Procedural HDR PMREM studio map for rich metallic specular reflections
    this.envTexture = createMetallicStudioEnv(this.renderer);
    this.scene.environment = this.envTexture;

    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / Math.max(1, window.innerHeight),
      0.1,
      260,
    );
    this.camera.position.set(0, 2, 22);

    this.post = new PostProcessingPipeline(
      this.renderer,
      this.scene,
      this.camera,
      window.innerWidth,
      window.innerHeight,
    );

    this.cameraDirector = new CameraDirector(this.camera, this.canvas);
    this.audio = new AudioSyncController((info) => this.callbacks.onAudioStatus?.(info));

    window.addEventListener('resize', this.handleResize);
  }

  public loadSpell(spell: SpellCardInstance): void {
    if (this.currentSpell) {
      this.currentSpell.dispose(this.scene);
      this.currentSpell = null;
    }

    this.currentSpell = spell;
    this.currentSpell.init(this.scene, this.renderer);
    this.timeline.configure(spell.duration, spell.phases);
    this.cameraDirector.setMode('cinema');
    void this.audio.loadForSpell(spell.metadata.id);

    // Immediately evaluate frame 0 so camera and stage start crisp
    this.evaluateAndRender(0, 1 / 60);
    this.callbacks.onSpellLoaded?.(spell);
  }

  public getCurrentSpell(): SpellCardInstance | null {
    return this.currentSpell;
  }

  public start(): void {
    if (this.rafId) return;
    this.lastPerfTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  public stop(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  public setCameraMode(mode: CameraMode): void {
    this.cameraDirector.setMode(mode, this.cameraPose);
  }

  public toggleCameraMode(): CameraMode {
    const next: CameraMode = this.cameraDirector.mode === 'cinema' ? 'free' : 'cinema';
    this.setCameraMode(next);
    return next;
  }

  private readonly loop = (now: number): void => {
    this.rafId = requestAnimationFrame(this.loop);

    const realDt = Math.max(0.0001, (now - this.lastPerfTime) / 1000);
    this.lastPerfTime = now;

    if (!this.isExportSizing) {
      const { delta: simDt, completed } = this.timeline.advance(realDt);
      const masterOverlapReached =
        this.audio.isMedleyMasterActive() &&
        this.currentSpell &&
        this.currentSpell.metadata.gameCode !== 'TH20' &&
        this.timeline.time >= this.currentSpell.duration - 0.85;
      if ((completed || masterOverlapReached) && this.currentSpell) {
        this.callbacks.onSpellCompleted?.(this.currentSpell);
      }
      this.audio.sync(this.timeline.time, this.timeline.playing, this.timeline.speed);
      this.evaluateAndRender(this.timeline.time, simDt || realDt);
    }

    // Track FPS smoothly every 0.35s
    this.fpsAccum += realDt;
    this.fpsFrames += 1;
    if (this.fpsAccum >= 0.35) {
      this.currentFps = Math.round(this.fpsFrames / this.fpsAccum);
      this.fpsAccum = 0;
      this.fpsFrames = 0;
      this.callbacks.onFrameStats?.(
        this.currentFps,
        this.currentSpell?.getInstanceCount() ?? 0,
      );
    }
  };

  private evaluateAndRender(time: number, dt: number): void {
    if (!this.currentSpell) return;

    // Reset per-frame optional postFX so spells only specify what they need
    this.postFX.lensStrength = 0;
    this.postFX.lensWorldPos = null;
    this.postFX.heatHaze = 0;
    this.postFX.warmGrade = 0;
    this.postFX.mirrorSplit = 0;
    this.postFX.timeStopFactor = 0;
    this.postFX.waveRadius = -1;
    this.postFX.waveInvert = 0;
    this.postFX.waveDistort = 0;
    this.postFX.flash = 0;

    // Gentle global cinematic fade-in (1.2s) and lingering fade-out (1.5s) across every spell card
    const dur = this.currentSpell.duration;
    const isOverlapHandoff =
      this.audio.isMedleyMasterActive() && this.currentSpell.metadata.gameCode !== 'TH20';
    const fadeEnd = isOverlapHandoff ? Math.max(2.0, dur - 0.85) : dur;
    const fadeIn = smootherstep(0.0, 1.25, time);
    const fadeOut = 1.0 - smootherstep(Math.max(1.25, fadeEnd - 1.55), fadeEnd, time);
    this.postFX.stageFade = fadeIn * fadeOut;

    this.camera.getWorldPosition(this.camWorldPos);
    this.camera.getWorldDirection(this.camWorldDir);

    this.currentSpell.update({
      time,
      dt,
      duration: this.currentSpell.duration,
      isFreeCamera: this.cameraDirector.mode === 'free',
      cameraPose: this.cameraPose,
      postFX: this.postFX,
      cameraWorldPosition: this.camWorldPos,
      cameraWorldDirection: this.camWorldDir,
    });

    this.cameraDirector.applyCinemaPose(this.cameraPose, time);

    // Project optional 3D gravitational lens anchor to exact screen UV (works in Cinema & Free camera!)
    if (this.postFX.lensWorldPos && this.postFX.lensStrength > 0.0001) {
      this.camera.updateMatrixWorld();
      this.projScratch.copy(this.postFX.lensWorldPos).project(this.camera);
      if (this.projScratch.z < 1.0) {
        this.postFX.lensCenterX = this.projScratch.x * 0.5 + 0.5;
        this.postFX.lensCenterY = this.projScratch.y * 0.5 + 0.5;
      } else {
        this.postFX.lensStrength = 0;
      }
    }

    this.post.applyState(this.postFX, time);
    this.post.render();
  }

  private readonly handleResize = (): void => {
    if (this.isExportSizing) return;
    const width = window.innerWidth;
    const height = Math.max(1, window.innerHeight);
    const pr = Math.min(window.devicePixelRatio, 2);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(width, height, false);
    this.post.setSize(width, height, pr);
  };

  // ================= RecorderHost Implementation =================

  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  public getDuration(): number {
    return this.currentSpell?.duration ?? 22;
  }

  public getCaptionInfo(): { meta: string; title: string; character: string; gameCode: string } {
    const meta = this.currentSpell?.metadata;
    return {
      meta: meta ? `${meta.gameCode} · ${meta.gameName}` : 'TH06 · 东方红魔乡',
      title: meta ? meta.spellName : '幻世 "The World"',
      character: meta ? meta.character : '十六夜咲夜',
      gameCode: meta?.gameCode ?? 'TH06',
    };
  }

  public enterExportSize(width: number, height: number): void {
    this.isExportSizing = true;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.post.setSize(width, height, 1);
  }

  public exitExportSize(): void {
    this.isExportSizing = false;
    this.handleResize();
  }

  public renderAtExactTime(timeSec: number, dtSec: number): void {
    this.timeline.setTime(timeSec);
    this.evaluateAndRender(timeSec, dtSec);
  }

  public setPlaying(playing: boolean): void {
    this.timeline.playing = playing;
  }

  public setCameraCinemaMode(): void {
    this.setCameraMode('cinema');
  }

  public dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.handleResize);
    if (this.currentSpell) {
      this.currentSpell.dispose(this.scene);
      this.currentSpell = null;
    }
    this.audio.dispose();
    this.cameraDirector.dispose();
    this.post.dispose();
    this.envTexture.dispose();
    this.renderer.dispose();
  }
}
