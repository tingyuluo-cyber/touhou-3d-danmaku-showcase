import './style.css';
import { DanmakuEngine } from './core/Engine';
import { DirectorOverlay } from './ui/Overlay';
import { SPELL_REGISTRY, createSpellById } from './spells/registry';
import type { AspectMode, CameraMode } from './core/CameraDirector';

const canvas = document.getElementById('stage-canvas') as HTMLCanvasElement;
const params = new URLSearchParams(window.location.search);
const isOfflineRenderMode = params.get('renderMode') === '1';

let overlay: DirectorOverlay | null = null;

const engine = new DanmakuEngine(canvas, {
  onFrameStats: (fps, count) => overlay?.updateStats(fps, count),
  onSpellLoaded: (spell) => overlay?.onSpellLoaded(spell),
  onAudioStatus: (info) => overlay?.onAudioStatus(info),
  onSpellCompleted: (spell) => overlay?.onSpellCompleted(spell),
});

overlay = new DirectorOverlay(engine);

// Load TH06 幻世 "The World" as the opening showcase hook
const th06 = createSpellById('th06-the-world');
engine.loadSpell(th06);

if (isOfflineRenderMode) {
  engine.stop();
  engine.timeline.playing = false;
  engine.setForceMedleyFade(true);
} else {
  engine.start();
}

interface MedleyCueItem {
  id: string;
  gameCode: string;
  masterStartSec: number;
  durationSec: number;
}

// Deterministic offline frame-stepping controller for zero-dropped-frame 60fps MP4 production
const renderController = {
  schedule: [] as MedleyCueItem[],
  currentSpellId: 'th06-the-world',

  async configure(opts: {
    width: number;
    height: number;
    cameraMode: CameraMode;
    aspectMode: AspectMode;
  }): Promise<{ totalDurationSec: number; count: number }> {
    engine.stop();
    engine.timeline.playing = false;
    engine.setForceMedleyFade(true);
    overlay?.enterOfflineRenderMode(opts.aspectMode);

    // Fetch exact master_mix.mp3 segment timings from manifest.json for sample-accurate A/V sync!
    const res = await fetch('/audio/manifest.json', { cache: 'no-store' });
    const manifest = (await res.json()) as {
      masterDurationSec?: number;
      details?: Record<string, { masterStartSec: number; durationSec: number }>;
    };

    this.schedule = SPELL_REGISTRY.filter((e) => e.metadata.implemented).map((entry) => {
      const d = manifest.details?.[entry.metadata.gameCode];
      return {
        id: entry.metadata.id,
        gameCode: entry.metadata.gameCode,
        masterStartSec: d?.masterStartSec ?? 0,
        durationSec: d?.durationSec ?? 12.5,
      };
    });

    engine.setAspectMode(opts.aspectMode);
    engine.enterExportSize(opts.width, opts.height);
    engine.setCameraMode(opts.cameraMode);
    if (opts.cameraMode === 'locked') {
      engine.cameraDirector.applyLockedPreset(this.schedule[0]?.gameCode ?? 'TH06');
    }

    const last = this.schedule[this.schedule.length - 1];
    const totalDurationSec = last
      ? last.masterStartSec + last.durationSec
      : (manifest.masterDurationSec ?? 184.1);
    return { totalDurationSec, count: this.schedule.length };
  },

  renderMasterFrame(masterTimeSec: number): { gameCode: string; localTime: number } {
    // Find active spell at exact masterTimeSec
    let active = this.schedule[0];
    for (let i = 0; i < this.schedule.length; i++) {
      if (masterTimeSec >= this.schedule[i].masterStartSec) {
        active = this.schedule[i];
      } else {
        break;
      }
    }

    if (active && this.currentSpellId !== active.id) {
      this.currentSpellId = active.id;
      const spell = createSpellById(active.id);
      engine.loadSpell(spell);
      // Immediately clear swapping guard so caption renders cleanly on exact deterministic frame
      document.getElementById('cinema-caption')?.classList.remove('is-swapping');
    }

    const localTime = Math.max(0, masterTimeSec - active.masterStartSec);
    const isOverlapHandoff = active.gameCode !== 'TH20';
    engine.renderAtExactTime(localTime, 1 / 60);
    overlay?.syncCaptionAtExactTime(localTime, active.durationSec, isOverlapHandoff);

    // Step CSS @keyframes deterministically to exact localTime so animations run at true 60fps!
    const animMs = localTime * 1000;
    const anims = document.getAnimations();
    for (let i = 0; i < anims.length; i++) {
      anims[i].pause();
      anims[i].currentTime = animMs;
    }

    // Flush GPU command queue before Chrome Viz composites the screenshot
    engine.renderer.getContext().flush();
    return { gameCode: active.gameCode, localTime };
  },
};

(window as unknown as { __danmakuEngine?: DanmakuEngine }).__danmakuEngine = engine;
(window as unknown as { __renderController?: typeof renderController }).__renderController =
  renderController;
