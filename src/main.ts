import './style.css';
import { DanmakuEngine } from './core/Engine';
import { DirectorOverlay } from './ui/Overlay';
import { createSpellById } from './spells/registry';

const canvas = document.getElementById('stage-canvas') as HTMLCanvasElement;

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
engine.start();

// Expose clean debug/capture handle for Playwright/DevTools inspection if desired
(window as unknown as { __danmakuEngine?: DanmakuEngine }).__danmakuEngine = engine;
