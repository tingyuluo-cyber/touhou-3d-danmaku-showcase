import { SPELL_AUDIO_CUES } from '../audio/cueSheet';

export interface AudioStatusInfo {
  loaded: boolean;
  label: string;
  sourceKind: 'none' | 'clip' | 'local';
  offsetSec: number;
  trackDurationSec: number;
  muted: boolean;
  volume: number;
}

/**
 * Synchronizes a local or built-in BGM track tightly with the 3D Timeline.
 * Supports:
 * - Auto-loading built clips from `/audio/clips/THxx.mp3` when present
 * - Local drag-and-drop / file picker for full raw tracks + live start-offset auditioning
 * - Real-time low-frequency energy sampling via Web Audio AnalyserNode
 */
export class AudioSyncController {
  private audioEl: HTMLAudioElement;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private freqBins: Uint8Array<ArrayBuffer> | null = null;
  private mediaSource: MediaElementAudioSourceNode | null = null;

  private objectUrl: string | null = null;
  private loaded = false;
  private label = '未载入 BGM';
  private sourceKind: 'none' | 'clip' | 'local' = 'none';
  private offsetSec = 0;
  private volume = 0.78;
  private muted = false;
  private activeSpellId = '';
  private onStatusChange?: (info: AudioStatusInfo) => void;

  // Remember user-picked local files & offsets per spell during a session
  private readonly localTrackCache = new Map<
    string,
    { url: string; name: string; offsetSec: number }
  >();
  private manifestClips: Record<string, string> | null = null;
  private manifestDetails: Record<string, { source: string; startSec: number; durationSec: number }> = {};
  private playAttemptPending = false;
  private readonly handleUserUnlock = (): void => {
    if (this.audioCtx?.state === 'suspended') {
      void this.audioCtx.resume();
    }
    if (this.loaded && this.audioEl.paused && !this.muted) {
      void this.audioEl.play().catch(() => {});
    }
  };

  constructor(onStatusChange?: (info: AudioStatusInfo) => void) {
    this.onStatusChange = onStatusChange;
    this.audioEl = new Audio();
    this.audioEl.preload = 'auto';
    this.audioEl.crossOrigin = 'anonymous';
    this.audioEl.volume = this.volume;

    this.audioEl.addEventListener('loadedmetadata', () => {
      this.loaded = true;
      this.emitStatus();
    });
    this.audioEl.addEventListener('error', () => {
      this.loaded = false;
      this.emitStatus();
    });

    window.addEventListener('pointerdown', this.handleUserUnlock);
    window.addEventListener('keydown', this.handleUserUnlock);
  }

  private ensureWebAudioGraph(): void {
    if (this.audioCtx) return;
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new Ctx();
      this.mediaSource = this.audioCtx.createMediaElementSource(this.audioEl);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.78;
      this.freqBins = new Uint8Array(this.analyser.frequencyBinCount);

      this.mediaSource.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);
    } catch {
      // Fallback gracefully to direct HTMLAudio playback if Web Audio init is blocked
      this.audioCtx = null;
      this.analyser = null;
    }
  }

  public async loadForSpell(spellId: string): Promise<void> {
    this.activeSpellId = spellId;
    this.audioEl.pause();
    this.loaded = false;

    // 1. Restore cached local file if user already auditioned one for this spell
    const cached = this.localTrackCache.get(spellId);
    if (cached) {
      this.sourceKind = 'local';
      this.label = cached.name;
      this.offsetSec = cached.offsetSec;
      this.audioEl.src = cached.url;
      this.audioEl.load();
      this.emitStatus();
      return;
    }

    // 2. Otherwise check manifest.json for pre-built clips (avoids noisy 404 HEAD requests)
    const cue = SPELL_AUDIO_CUES[spellId];
    if (cue) {
      if (this.manifestClips === null) {
        try {
          const res = await fetch('/audio/manifest.json', { cache: 'no-store' });
          if (res.ok) {
            const data = (await res.json()) as {
              clips?: Record<string, string>;
              details?: Record<string, { source: string; startSec: number; durationSec: number }>;
            };
            this.manifestClips = data.clips ?? {};
            this.manifestDetails = data.details ?? {};
          } else {
            this.manifestClips = {};
          }
        } catch {
          this.manifestClips = {};
        }
      }
      const clipPath = this.manifestClips[cue.gameCode];
      if (clipPath) {
        const detail = this.manifestDetails[cue.gameCode];
        this.sourceKind = 'clip';
        this.label = detail
          ? `${cue.gameCode} · ${detail.source} (截取 ${detail.startSec}s 起)`
          : `${cue.gameCode} 剪辑音轨`;
        this.offsetSec = 0;
        this.audioEl.src = clipPath;
        this.audioEl.load();
        this.emitStatus();
        return;
      }
    }

    this.sourceKind = 'none';
    this.label = '未载入 BGM (可点此载入本地原曲试听对轨)';
    this.offsetSec = cue?.rawStartSec ?? 0;
    this.audioEl.removeAttribute('src');
    this.emitStatus();
  }

  public loadLocalFile(file: File, spellId: string): void {
    const prev = this.localTrackCache.get(spellId);
    if (prev && prev.url !== this.objectUrl) {
      URL.revokeObjectURL(prev.url);
    }
    const url = URL.createObjectURL(file);
    this.objectUrl = url;
    const cue = SPELL_AUDIO_CUES[spellId];
    const startOffset = prev?.offsetSec ?? cue?.rawStartSec ?? 0;

    this.localTrackCache.set(spellId, {
      url,
      name: file.name,
      offsetSec: startOffset,
    });

    this.activeSpellId = spellId;
    this.sourceKind = 'local';
    this.label = file.name;
    this.offsetSec = startOffset;
    this.loaded = false;
    this.audioEl.src = url;
    this.audioEl.load();
    this.emitStatus();
  }

  public setOffsetSec(seconds: number): void {
    this.offsetSec = Math.max(0, seconds);
    const cached = this.localTrackCache.get(this.activeSpellId);
    if (cached) cached.offsetSec = this.offsetSec;
    this.emitStatus();
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    this.audioEl.volume = this.muted ? 0 : this.volume;
    this.emitStatus();
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    this.audioEl.volume = this.muted ? 0 : this.volume;
    this.emitStatus();
    return this.muted;
  }

  /**
   * Call once per animation frame to keep HTMLAudio locked to the 3D Timeline.
   */
  public sync(timelineTime: number, playing: boolean, playbackRate: number): void {
    if (!this.loaded || this.sourceKind === 'none') return;

    const targetAudioTime = this.offsetSec + timelineTime;
    const trackDur = Number.isFinite(this.audioEl.duration) ? this.audioEl.duration : Infinity;

    if (Math.abs(this.audioEl.playbackRate - playbackRate) > 0.01) {
      this.audioEl.playbackRate = Math.max(0.25, Math.min(2.0, playbackRate));
    }

    if (!playing || targetAudioTime >= trackDur - 0.05) {
      if (!this.audioEl.paused) this.audioEl.pause();
      if (Math.abs(this.audioEl.currentTime - targetAudioTime) > 0.06 && targetAudioTime < trackDur) {
        this.audioEl.currentTime = Math.max(0, targetAudioTime);
      }
      return;
    }

    // Correct drift if timeline was scrubbed or looped
    const drift = Math.abs(this.audioEl.currentTime - targetAudioTime);
    if (drift > 0.14) {
      this.audioEl.currentTime = Math.max(0, targetAudioTime);
    }

    if (this.audioEl.paused && !this.playAttemptPending) {
      this.playAttemptPending = true;
      this.ensureWebAudioGraph();
      if (this.audioCtx?.state === 'suspended') {
        void this.audioCtx.resume();
      }
      void this.audioEl
        .play()
        .catch(() => {
          // Browser autoplay policy until first user gesture
        })
        .finally(() => {
          this.playAttemptPending = false;
        });
    }
  }

  /**
   * Returns normalized low/mid beat energy (0..1) when audio is actively playing.
   */
  public sampleEnergy(): number {
    if (!this.analyser || !this.freqBins || this.audioEl.paused) return 0;
    this.analyser.getByteFrequencyData(this.freqBins);
    let sum = 0;
    const count = Math.min(24, this.freqBins.length);
    for (let i = 1; i < count; i++) {
      sum += this.freqBins[i];
    }
    return sum / (count * 255);
  }

  public getStatus(): AudioStatusInfo {
    return {
      loaded: this.loaded,
      label: this.label,
      sourceKind: this.sourceKind,
      offsetSec: this.offsetSec,
      trackDurationSec: Number.isFinite(this.audioEl.duration) ? this.audioEl.duration : 0,
      muted: this.muted,
      volume: this.volume,
    };
  }

  private emitStatus(): void {
    this.onStatusChange?.(this.getStatus());
  }

  public dispose(): void {
    window.removeEventListener('pointerdown', this.handleUserUnlock);
    window.removeEventListener('keydown', this.handleUserUnlock);
    this.audioEl.pause();
    for (const item of this.localTrackCache.values()) {
      URL.revokeObjectURL(item.url);
    }
    this.localTrackCache.clear();
    void this.audioCtx?.close();
  }
}
