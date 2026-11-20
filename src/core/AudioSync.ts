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
  private manifestMasterUrl: string | null = null;
  private manifestDetails: Record<
    string,
    { source: string; startSec: number; durationSec: number; masterStartSec?: number }
  > = {};
  private medleyMasterMode = false;
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

  public setMedleyMasterMode(enabled: boolean): void {
    if (this.medleyMasterMode === enabled) return;
    this.medleyMasterMode = enabled;
    if (this.activeSpellId) {
      void this.loadForSpell(this.activeSpellId);
    }
  }

  public isMedleyMasterActive(): boolean {
    return this.medleyMasterMode && this.sourceKind === 'clip' && !!this.manifestMasterUrl;
  }

  public async loadForSpell(spellId: string): Promise<void> {
    this.activeSpellId = spellId;

    // 1. Restore cached local file if user already auditioned one for this spell (unless in Master Medley)
    const cached = !this.medleyMasterMode ? this.localTrackCache.get(spellId) : undefined;
    if (cached) {
      this.audioEl.pause();
      this.loaded = false;
      this.sourceKind = 'local';
      this.label = cached.name;
      this.offsetSec = cached.offsetSec;
      this.audioEl.src = cached.url;
      this.audioEl.load();
      this.emitStatus();
      return;
    }

    // 2. Load manifest.json once
    const cue = SPELL_AUDIO_CUES[spellId];
    if (cue) {
      if (this.manifestClips === null) {
        try {
          const res = await fetch('/audio/manifest.json', { cache: 'no-store' });
          if (res.ok) {
            const data = (await res.json()) as {
              masterMix?: string;
              clips?: Record<string, string>;
              details?: Record<
                string,
                { source: string; startSec: number; durationSec: number; masterStartSec?: number }
              >;
            };
            this.manifestMasterUrl = data.masterMix ?? null;
            this.manifestClips = data.clips ?? {};
            this.manifestDetails = data.details ?? {};
          } else {
            this.manifestClips = {};
          }
        } catch {
          this.manifestClips = {};
        }
      }

      const detail = this.manifestDetails[cue.gameCode];

      // Organic Master Mix mode for unbroken Medley playback (zero audio reload stutter!)
      if (this.medleyMasterMode && this.manifestMasterUrl && detail?.masterStartSec !== undefined) {
        const expectedSrc = new URL(this.manifestMasterUrl, window.location.origin).href;
        this.sourceKind = 'clip';
        this.label = `无缝连播总轨 · ${cue.gameCode} (${detail.source})`;
        this.offsetSec = detail.masterStartSec;

        if (this.audioEl.src !== expectedSrc) {
          this.audioEl.pause();
          this.loaded = false;
          this.audioEl.src = this.manifestMasterUrl;
          this.audioEl.load();
        }
        this.emitStatus();
        return;
      }

      const clipPath = this.manifestClips[cue.gameCode];
      if (clipPath) {
        this.audioEl.pause();
        this.loaded = false;
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

    this.audioEl.pause();
    this.loaded = false;
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

    // Correct drift if timeline was scrubbed or looped (wider tolerance in unbroken Master Mix mode!)
    const drift = Math.abs(this.audioEl.currentTime - targetAudioTime);
    const maxDrift = this.medleyMasterMode ? 0.35 : 0.14;
    if (drift > maxDrift) {
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
