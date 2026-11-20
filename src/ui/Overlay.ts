import type { DanmakuEngine } from '../core/Engine';
import type { AudioStatusInfo } from '../core/AudioSync';
import { StageRecorder, type ExportConfig } from '../core/Recorder';
import { SPELL_REGISTRY, createSpellById, getImplementedSpellIds } from '../spells/registry';
import { smootherstep } from '../prototypes/DanmakuMath';
import type { SpellCardInstance } from '../spells/types';

export class DirectorOverlay {
  private readonly engine: DanmakuEngine;
  private readonly recorder = new StageRecorder();

  private readonly hudEl = document.getElementById('director-hud')!;
  private readonly captionEl = document.getElementById('cinema-caption')!;
  private readonly captionMetaEl = document.getElementById('caption-meta')!;
  private readonly captionTitleEl = document.getElementById('caption-title')!;
  private readonly restoreHintEl = document.getElementById('hud-restore-hint')!;

  private readonly spellSelect = document.getElementById('spell-select') as HTMLSelectElement;
  private readonly btnMedley = document.getElementById('btn-medley') as HTMLButtonElement;
  private readonly phaseBadge = document.getElementById('phase-badge')!;
  private readonly statsBadge = document.getElementById('stats-badge')!;
  private readonly btnCameraMode = document.getElementById('btn-camera-mode') as HTMLButtonElement;
  private readonly btnCaptionToggle = document.getElementById('btn-caption-toggle') as HTMLButtonElement;
  private readonly btnAudioPanel = document.getElementById('btn-audio-panel') as HTMLButtonElement;
  private readonly btnExportPanel = document.getElementById('btn-export-panel') as HTMLButtonElement;
  private readonly btnHideHud = document.getElementById('btn-hide-hud') as HTMLButtonElement;

  private readonly audioDrawer = document.getElementById('audio-drawer')!;
  private readonly btnCloseAudio = document.getElementById('btn-close-audio') as HTMLButtonElement;
  private readonly audioCanonHint = document.getElementById('audio-canon-hint')!;
  private readonly audioFileInput = document.getElementById('audio-file-input') as HTMLInputElement;
  private readonly btnAudioMute = document.getElementById('btn-audio-mute') as HTMLButtonElement;
  private readonly btnCopyCue = document.getElementById('btn-copy-cue') as HTMLButtonElement;
  private readonly audioOffsetSlider = document.getElementById('audio-offset-slider') as HTMLInputElement;
  private readonly audioOffsetVal = document.getElementById('audio-offset-val')!;
  private readonly audioVolSlider = document.getElementById('audio-vol-slider') as HTMLInputElement;
  private readonly audioVolVal = document.getElementById('audio-vol-val')!;
  private readonly audioStatusEl = document.getElementById('audio-status')!;

  private readonly exportDrawer = document.getElementById('export-drawer')!;
  private readonly btnCloseExport = document.getElementById('btn-close-export') as HTMLButtonElement;
  private readonly exportRes = document.getElementById('export-res') as HTMLSelectElement;
  private readonly exportFps = document.getElementById('export-fps') as HTMLSelectElement;
  private readonly exportIncludeCaption = document.getElementById('export-include-caption') as HTMLInputElement;
  private readonly btnRecordWebm = document.getElementById('btn-record-webm') as HTMLButtonElement;
  private readonly btnExportPng = document.getElementById('btn-export-png') as HTMLButtonElement;
  private readonly btnCancelExport = document.getElementById('btn-cancel-export') as HTMLButtonElement;
  private readonly exportStatus = document.getElementById('export-status')!;

  private readonly btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
  private readonly btnRestart = document.getElementById('btn-restart') as HTMLButtonElement;
  private readonly speedSelect = document.getElementById('speed-select') as HTMLSelectElement;
  private readonly timelineSlider = document.getElementById('timeline-slider') as HTMLInputElement;
  private readonly phaseMarkers = document.getElementById('phase-markers')!;
  private readonly timeReadout = document.getElementById('time-readout')!;
  private readonly phaseButtons = document.getElementById('phase-buttons')!;

  private hudVisible = true;
  private captionVisible = true;
  private medleyMode = false;
  private hintTimer = 0;
  private isScrubbing = false;
  private uiRafId = 0;
  private phaseChipEls: HTMLButtonElement[] = [];

  constructor(engine: DanmakuEngine) {
    this.engine = engine;
    this.populateSpellSelect();
    this.bindEvents();
    this.syncLayoutState();
    this.startUiLoop();
  }

  public onSpellLoaded(spell: SpellCardInstance): void {
    const m = spell.metadata;
    this.spellSelect.value = m.id;
    this.captionMetaEl.textContent = `${m.gameCode} · ${m.gameName}`;
    this.captionTitleEl.textContent = m.spellName;
    this.audioCanonHint.textContent = `对应原曲: ${m.bgm}`;
    this.timelineSlider.max = String(spell.duration);
    this.buildPhaseControls(spell);
  }

  public onAudioStatus(info: AudioStatusInfo): void {
    const durMax = info.trackDurationSec > 2 ? Math.max(10, info.trackDurationSec - 2) : 240;
    this.audioOffsetSlider.max = durMax.toFixed(1);
    this.audioOffsetSlider.value = info.offsetSec.toFixed(1);
    this.audioOffsetVal.textContent = `${info.offsetSec.toFixed(1)}s`;
    this.audioVolSlider.value = info.volume.toFixed(2);
    this.audioVolVal.textContent = `${Math.round(info.volume * 100)}%`;
    this.btnAudioMute.textContent = info.muted ? '静音: 开' : '静音: 关';
    this.btnAudioMute.classList.toggle('active', info.muted);

    if (info.sourceKind === 'none') {
      this.audioStatusEl.textContent =
        '未载入 BGM. 提示: 直接拖拽音频文件到页面, 或把原曲放到 public/audio/raw/ 后运行 pnpm run audio:build.';
    } else if (info.loaded) {
      const totalStr = info.trackDurationSec > 0 ? ` (总长 ${info.trackDurationSec.toFixed(1)}s)` : '';
      this.audioStatusEl.textContent = `已同步: ${info.label}${totalStr} | 起点 ${info.offsetSec.toFixed(1)}s`;
    } else {
      this.audioStatusEl.textContent = `正在载入: ${info.label}...`;
    }
  }

  public onSpellCompleted(spell: SpellCardInstance): void {
    if (!this.medleyMode) return;
    const ids = getImplementedSpellIds();
    if (ids.length <= 1) return;
    const idx = ids.indexOf(spell.metadata.id);
    const nextId = ids[(idx + 1) % ids.length];
    this.engine.loadSpell(createSpellById(nextId));
    this.engine.timeline.playing = true;
  }

  public updateStats(fps: number, instanceCount: number): void {
    const code = this.engine.getCurrentSpell()?.metadata.gameCode;
    const unit = code === 'TH06' ? 'BLADES' : code === 'TH13' ? 'RAYS+INST' : 'INST';
    this.statsBadge.textContent = `${fps} FPS | ${instanceCount} ${unit}`;
  }

  private populateSpellSelect(): void {
    this.spellSelect.innerHTML = '';
    for (const entry of SPELL_REGISTRY) {
      const m = entry.metadata;
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.implemented
        ? `${m.gameCode} ${m.spellName}`
        : `${m.gameCode} ${m.spellName} (规划中)`;
      opt.disabled = !m.implemented;
      this.spellSelect.appendChild(opt);
    }
  }

  private buildPhaseControls(spell: SpellCardInstance): void {
    this.phaseMarkers.innerHTML = '';
    this.phaseButtons.innerHTML = '';
    this.phaseChipEls = [];

    for (const phase of spell.phases) {
      if (phase.start > 0) {
        const tick = document.createElement('div');
        tick.className = 'phase-tick';
        tick.style.left = `${(phase.start / spell.duration) * 100}%`;
        this.phaseMarkers.appendChild(tick);
      }

      const btn = document.createElement('button');
      btn.className = 'phase-chip';
      btn.textContent = `${phase.label} (${phase.start.toFixed(1)}s)`;
      btn.addEventListener('click', () => {
        this.engine.timeline.setTime(phase.start);
        if (!this.engine.timeline.playing) {
          this.engine.renderAtExactTime(phase.start, 1 / 60);
        }
      });
      this.phaseButtons.appendChild(btn);
      this.phaseChipEls.push(btn);
    }
  }

  private bindEvents(): void {
    this.spellSelect.addEventListener('change', () => {
      try {
        const spell = createSpellById(this.spellSelect.value);
        this.engine.loadSpell(spell);
      } catch {
        // Ignore unimplemented roadmap items
      }
    });

    this.btnMedley.addEventListener('click', () => this.toggleMedley());

    this.btnPlay.addEventListener('click', () => this.togglePlay());
    this.btnRestart.addEventListener('click', () => this.restart());

    this.speedSelect.addEventListener('change', () => {
      this.engine.timeline.speed = Number(this.speedSelect.value) || 1;
    });

    this.timelineSlider.addEventListener('pointerdown', () => {
      this.isScrubbing = true;
    });
    window.addEventListener('pointerup', () => {
      if (this.isScrubbing) {
        this.isScrubbing = false;
        this.timelineSlider.blur();
      }
    });
    this.timelineSlider.addEventListener('input', () => {
      const val = Number(this.timelineSlider.value);
      this.engine.timeline.setTime(val);
      if (!this.engine.timeline.playing) {
        this.engine.renderAtExactTime(val, 1 / 60);
      }
    });

    this.btnCameraMode.addEventListener('click', () => this.toggleCameraMode());
    this.btnCaptionToggle.addEventListener('click', () => this.toggleCaption());
    this.btnHideHud.addEventListener('click', () => this.toggleHud());

    this.btnAudioPanel.addEventListener('click', () => this.toggleAudioDrawer());
    this.btnCloseAudio.addEventListener('click', () => {
      this.audioDrawer.classList.add('hidden');
      this.btnAudioPanel.classList.remove('active');
    });

    this.audioFileInput.addEventListener('change', () => {
      const file = this.audioFileInput.files?.[0];
      const spellId = this.engine.getCurrentSpell()?.metadata.id;
      if (file && spellId) {
        this.engine.audio.loadLocalFile(file, spellId);
        this.engine.timeline.setTime(0);
        this.engine.timeline.playing = true;
        this.btnPlay.textContent = '暂停';
      }
      this.audioFileInput.value = '';
    });

    this.audioOffsetSlider.addEventListener('input', () => {
      const sec = Number(this.audioOffsetSlider.value) || 0;
      this.engine.audio.setOffsetSec(sec);
      this.audioOffsetVal.textContent = `${sec.toFixed(1)}s`;
      this.engine.timeline.setTime(0);
    });

    this.audioVolSlider.addEventListener('input', () => {
      const vol = Number(this.audioVolSlider.value);
      this.engine.audio.setVolume(vol);
      this.audioVolVal.textContent = `${Math.round(vol * 100)}%`;
    });

    this.btnAudioMute.addEventListener('click', () => {
      this.engine.audio.toggleMute();
    });

    this.btnCopyCue.addEventListener('click', () => {
      const spell = this.engine.getCurrentSpell();
      if (!spell) return;
      const st = this.engine.audio.getStatus();
      const snippet = `"${spell.metadata.gameCode}": { "startSec": ${Number(st.offsetSec.toFixed(2))}, "durationSec": ${spell.duration} }`;
      void navigator.clipboard?.writeText(snippet).then(
        () => {
          this.audioStatusEl.textContent = `已复制截取配置: ${snippet}`;
        },
        () => {
          this.audioStatusEl.textContent = `截取配置: ${snippet}`;
        },
      );
    });

    // Drag & drop local audio file anywhere onto the window to audition immediately!
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      const spellId = this.engine.getCurrentSpell()?.metadata.id;
      if (file && spellId && (file.type.startsWith('audio/') || /\.(mp3|wav|flac|ogg|m4a)$/i.test(file.name))) {
        this.engine.audio.loadLocalFile(file, spellId);
        this.audioDrawer.classList.remove('hidden');
        this.exportDrawer.classList.add('hidden');
        this.btnAudioPanel.classList.add('active');
        this.btnExportPanel.classList.remove('active');
      }
    });

    this.btnExportPanel.addEventListener('click', () => {
      this.audioDrawer.classList.add('hidden');
      this.btnAudioPanel.classList.remove('active');
      this.exportDrawer.classList.toggle('hidden');
      this.btnExportPanel.classList.toggle('active', !this.exportDrawer.classList.contains('hidden'));
    });
    this.btnCloseExport.addEventListener('click', () => {
      this.exportDrawer.classList.add('hidden');
      this.btnExportPanel.classList.remove('active');
    });

    this.btnRecordWebm.addEventListener('click', () => void this.runExport('webm'));
    this.btnExportPng.addEventListener('click', () => void this.runExport('png'));
    this.btnCancelExport.addEventListener('click', () => {
      this.recorder.cancel();
      this.exportStatus.textContent = '正在中止导出...';
    });

    window.addEventListener('keydown', (e) => {
      if (
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLInputElement &&
          e.target.type !== 'range' &&
          e.target.type !== 'checkbox')
      ) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlay();
      } else if (e.key === 'h' || e.key === 'H') {
        this.toggleHud();
      } else if (e.key === 'c' || e.key === 'C') {
        this.toggleCameraMode();
      } else if (e.key === 't' || e.key === 'T') {
        this.toggleCaption();
      } else if (e.key === 'r' || e.key === 'R') {
        this.restart();
      } else if (e.key === 'a' || e.key === 'A') {
        this.toggleMedley();
      } else if (e.key === 'b' || e.key === 'B') {
        if (this.hudVisible) this.toggleAudioDrawer();
      } else if (e.key === 'm' || e.key === 'M') {
        this.engine.audio.toggleMute();
      } else if (e.key === 'e' || e.key === 'E') {
        if (this.hudVisible) {
          this.audioDrawer.classList.add('hidden');
          this.btnAudioPanel.classList.remove('active');
          this.exportDrawer.classList.toggle('hidden');
          this.btnExportPanel.classList.toggle(
            'active',
            !this.exportDrawer.classList.contains('hidden'),
          );
        }
      } else if (e.code === 'ArrowRight') {
        const next = Math.min(this.engine.timeline.duration, this.engine.timeline.time + 0.5);
        this.engine.timeline.setTime(next);
        if (!this.engine.timeline.playing) this.engine.renderAtExactTime(next, 1 / 60);
      } else if (e.code === 'ArrowLeft') {
        const prev = Math.max(0, this.engine.timeline.time - 0.5);
        this.engine.timeline.setTime(prev);
        if (!this.engine.timeline.playing) this.engine.renderAtExactTime(prev, 1 / 60);
      }
    });
  }

  private toggleMedley(): void {
    this.medleyMode = !this.medleyMode;
    this.btnMedley.textContent = this.medleyMode ? '连播: 开 (无缝总轨)' : '连播: 关';
    this.btnMedley.classList.toggle('active', this.medleyMode);
    this.engine.audio.setMedleyMasterMode(this.medleyMode);
  }

  private toggleAudioDrawer(): void {
    this.exportDrawer.classList.add('hidden');
    this.btnExportPanel.classList.remove('active');
    this.audioDrawer.classList.toggle('hidden');
    this.btnAudioPanel.classList.toggle('active', !this.audioDrawer.classList.contains('hidden'));
  }

  private togglePlay(): void {
    this.engine.timeline.playing = !this.engine.timeline.playing;
    this.btnPlay.textContent = this.engine.timeline.playing ? '暂停' : '播放';
  }

  private restart(): void {
    this.engine.timeline.setTime(0);
    this.engine.timeline.playing = true;
    this.btnPlay.textContent = '暂停';
  }

  private toggleCameraMode(): void {
    const mode = this.engine.toggleCameraMode();
    this.btnCameraMode.textContent = mode === 'cinema' ? '运镜: 自动' : '运镜: 自由拖拽';
    this.btnCameraMode.classList.toggle('active', mode === 'cinema');
  }

  private toggleCaption(): void {
    this.captionVisible = !this.captionVisible;
    this.btnCaptionToggle.textContent = this.captionVisible ? '标题: 开' : '标题: 关';
    this.btnCaptionToggle.classList.toggle('active', this.captionVisible);
    this.syncLayoutState();
  }

  private toggleHud(): void {
    this.hudVisible = !this.hudVisible;
    this.syncLayoutState();
    if (!this.hudVisible) {
      this.restoreHintEl.classList.remove('hidden');
      requestAnimationFrame(() => this.restoreHintEl.classList.add('visible'));
      window.clearTimeout(this.hintTimer);
      this.hintTimer = window.setTimeout(() => {
        this.restoreHintEl.classList.remove('visible');
      }, 2800);
    } else {
      this.restoreHintEl.classList.remove('visible');
      this.restoreHintEl.classList.add('hidden');
    }
  }

  private syncLayoutState(): void {
    this.hudEl.classList.toggle('hidden', !this.hudVisible);
    this.captionEl.classList.toggle('hidden', !this.captionVisible);
    this.captionEl.classList.toggle('hud-open', this.hudVisible);
  }

  private getExportConfig(): ExportConfig {
    return {
      resolution: this.exportRes.value as ExportConfig['resolution'],
      fps: Number(this.exportFps.value) || 60,
      includeCaption: this.exportIncludeCaption.checked,
    };
  }

  private async runExport(kind: 'webm' | 'png'): Promise<void> {
    if (this.recorder.active) return;

    const config = this.getExportConfig();
    this.btnRecordWebm.disabled = true;
    this.btnExportPng.disabled = true;
    this.btnCancelExport.classList.remove('hidden');
    this.exportStatus.textContent = kind === 'webm' ? '初始化 WebM 录制...' : '请选择本地输出目录...';

    try {
      if (kind === 'webm') {
        await this.recorder.recordWebM(this.engine, config, (msg) => {
          this.exportStatus.textContent = msg;
        });
      } else {
        await this.recorder.exportPngSequence(this.engine, config, (msg) => {
          this.exportStatus.textContent = msg;
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('abort') || msg.includes('AbortError')) {
        this.exportStatus.textContent = '已取消选择目录.';
      } else {
        this.exportStatus.textContent = `导出失败: ${msg}`;
      }
    } finally {
      this.btnRecordWebm.disabled = false;
      this.btnExportPng.disabled = false;
      this.btnCancelExport.classList.add('hidden');
      this.btnPlay.textContent = this.engine.timeline.playing ? '暂停' : '播放';
    }
  }

  private startUiLoop(): void {
    const tick = () => {
      this.uiRafId = requestAnimationFrame(tick);
      const tl = this.engine.timeline;

      if (!this.isScrubbing) {
        this.timelineSlider.value = tl.time.toFixed(2);
      }
      this.timeReadout.textContent = `${tl.time.toFixed(2).padStart(5, '0')} / ${tl.duration.toFixed(2)}s`;

      // Smooth caption fade synced to the global cinema transition curtain
      if (this.captionVisible) {
        const cIn = smootherstep(0.35, 1.35, tl.time);
        const cOut = 1.0 - smootherstep(Math.max(1.4, tl.duration - 1.55), Math.max(1.5, tl.duration - 0.2), tl.time);
        this.captionEl.style.opacity = (cIn * cOut).toFixed(3);
      } else {
        this.captionEl.style.opacity = '0';
      }

      const phase = tl.getCurrentPhase();
      if (phase) {
        this.phaseBadge.textContent = phase.label;
        this.phaseBadge.classList.toggle('frozen', phase.badgeStyle === 'frozen');
        this.phaseBadge.classList.toggle('burst', phase.badgeStyle === 'burst');

        for (let i = 0; i < tl.phases.length; i++) {
          this.phaseChipEls[i]?.classList.toggle('active', tl.phases[i].id === phase.id);
        }
      }
    };
    this.uiRafId = requestAnimationFrame(tick);
  }

  public dispose(): void {
    cancelAnimationFrame(this.uiRafId);
  }
}
