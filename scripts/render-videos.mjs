import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

const ROOT = process.cwd();
const DIST_DIR = path.join(ROOT, 'dist');
const AUDIO_MASTER = path.join(ROOT, 'public', 'audio', 'master_mix.mp3');
const OUTPUT_DIR = path.join(ROOT, 'outputs');
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

const VIDEO_JOBS = [
  {
    key: 'landscape-dynamic',
    fileName: '01_TH06-TH20_横屏16x9_自动动态运镜.mp4',
    width: 1920,
    height: 1080,
    cameraMode: 'cinema',
    aspectMode: 'landscape',
  },
  {
    key: 'portrait-dynamic',
    fileName: '02_TH06-TH20_竖屏9x16_自动动态运镜.mp4',
    width: 1080,
    height: 1920,
    cameraMode: 'cinema',
    aspectMode: 'portrait',
  },
  {
    key: 'landscape-locked',
    fileName: '03_TH06-TH20_横屏16x9_固定斜角全景.mp4',
    width: 1920,
    height: 1080,
    cameraMode: 'locked',
    aspectMode: 'landscape',
  },
  {
    key: 'portrait-locked',
    fileName: '04_TH06-TH20_竖屏9x16_固定斜角全景.mp4',
    width: 1080,
    height: 1920,
    cameraMode: 'locked',
    aspectMode: 'portrait',
  },
];

function findChromeBin() {
  const found = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Chrome/Edge executable not found on this machine.');
  return found;
}

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      let filePath = path.join(DIST_DIR, rel);
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(ROOT, 'public', rel);
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.ws = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', (err) => reject(err));
      ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(String(ev.data));
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(msg.error.message || JSON.stringify(msg.error)));
          else res(msg.result);
        }
      });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(
        res.exceptionDetails.exception?.description ||
          res.exceptionDetails.text ||
          'Runtime.evaluate exception',
      );
    }
    return res.result?.value;
  }

  close() {
    try {
      this.ws?.close();
    } catch {}
  }
}

const activeCleanups = new Set();
function cleanupAll() {
  for (const fn of activeCleanups) {
    try {
      fn();
    } catch {}
  }
  activeCleanups.clear();
}
process.on('SIGINT', () => {
  cleanupAll();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanupAll();
  process.exit(143);
});

async function launchChromeOnce(width, height, debugPort) {
  const chromeBin = findChromeBin();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'th3d-chrome-'));
  const proc = spawn(
    chromeBin,
    [
      '--headless=new',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDir}`,
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--disable-gpu-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--autoplay-policy=no-user-gesture-required',
      `--window-size=${width},${height}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  let stderrTail = '';
  proc.stderr?.on('data', (d) => {
    stderrTail = (stderrTail + d.toString()).slice(-1200);
  });

  // Wait for CDP JSON endpoint
  const deadline = Date.now() + 25000;
  let targets = null;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) break;
    try {
      const resp = await fetch(`http://127.0.0.1:${debugPort}/json`);
      if (resp.ok) {
        const list = await resp.json();
        const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) {
          targets = page;
          break;
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!targets) {
    try {
      proc.kill('SIGKILL');
    } catch {}
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {}
    throw new Error(
      `Chrome CDP failed to start on port ${debugPort} (exit=${proc.exitCode}): ${stderrTail.trim()}`,
    );
  }

  const cdp = new CDPClient(targets.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const cleanup = () => {
    activeCleanups.delete(cleanup);
    cdp.close();
    try {
      proc.kill();
    } catch {}
    setTimeout(() => {
      try {
        fs.rmSync(profileDir, { recursive: true, force: true });
      } catch {}
    }, 400);
  };
  activeCleanups.add(cleanup);
  return { cdp, cleanup };
}

async function launchChrome(width, height, debugPort) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = debugPort + attempt * 10;
    try {
      return await launchChromeOnce(width, height, port);
    } catch (err) {
      lastErr = err;
      console.warn(`[chrome] Attempt ${attempt + 1} on port ${port} failed, retrying...`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

async function openRenderPage(cdp, httpPort, width, height, cameraMode, aspectMode) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await cdp.send('Page.navigate', {
    url: `http://127.0.0.1:${httpPort}/?renderMode=1`,
  });

  // Wait until window.__renderController is ready
  const startWait = Date.now();
  while (Date.now() - startWait < 30000) {
    const ready = await cdp.evaluate('Boolean(window.__renderController)');
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  const info = await cdp.evaluate(
    `window.__renderController.configure(${JSON.stringify({ width, height, cameraMode, aspectMode })})`,
  );
  // Let fonts settle cleanly
  await cdp.evaluate('document.fonts.ready.then(() => true)');
  return info;
}

async function buildContactSheet(framePaths, outPath, cols, rows, tileW, tileH) {
  return new Promise((resolve, reject) => {
    const args = ['-y', '-v', 'error'];
    for (const p of framePaths) {
      args.push('-i', p);
    }
    const inputs = framePaths.map((_, i) => `[${i}:v]scale=${tileW}:${tileH}[v${i}]`).join(';');
    const concat = framePaths.map((_, i) => `[v${i}]`).join('');
    args.push(
      '-filter_complex',
      `${inputs};${concat}concat=n=${framePaths.length}:v=1:a=0,tile=${cols}x${rows}:padding=6:color=0x10141c`,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      outPath,
    );
    const ff = spawn(ffmpegStatic, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => (err += d.toString()));
    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`contact sheet ffmpeg exited ${code}: ${err}`));
    });
  });
}

async function runPreviewBenchmark(httpPort, previewDir) {
  fs.mkdirSync(previewDir, { recursive: true });
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'public', 'audio', 'manifest.json'), 'utf8'),
  );
  // Signature mid-climax local offsets for all 15 spells
  const sampleOffsets = {
    TH06: 5.5,
    TH07: 6.8,
    TH08: 6.2,
    TH09: 6.0,
    TH10: 6.4,
    TH11: 9.8,
    TH12: 7.6,
    TH13: 6.2,
    TH14: 6.2,
    TH15: 6.8,
    TH16: 6.2,
    TH17: 6.2,
    TH18: 6.55,
    TH19: 6.2,
    TH20: 7.4,
  };
  const games = Object.keys(sampleOffsets);

  const chrome = await launchChrome(1920, 1080, 9321);
  try {
    // 1. Capture all 15 locked 16:9 frames -> 5x3 contact sheet + full-res TH06
    await openRenderPage(chrome.cdp, httpPort, 1920, 1080, 'locked', 'landscape');
    const paths16x9 = [];
    for (const g of games) {
      const mt = (manifest.details[g]?.masterStartSec ?? 0) + sampleOffsets[g];
      await chrome.cdp.evaluate(`window.__renderController.renderMasterFrame(${mt})`);
      const shot = await chrome.cdp.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 94,
        fromSurface: true,
        optimizeForSpeed: true,
      });
      const outPath = path.join(previewDir, `l16_${g}.jpg`);
      fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
      paths16x9.push(outPath);
    }
    await buildContactSheet(
      paths16x9,
      path.join(previewDir, 'contact_16x9_locked.jpg'),
      5,
      3,
      480,
      270,
    );
    console.log(`[preview] Saved contact_16x9_locked.jpg`);

    // 2. Capture all 15 locked 9:16 frames -> 5x3 contact sheet + full-res TH06
    await openRenderPage(chrome.cdp, httpPort, 1080, 1920, 'locked', 'portrait');
    const paths9x16 = [];
    for (const g of games) {
      const mt = (manifest.details[g]?.masterStartSec ?? 0) + sampleOffsets[g];
      await chrome.cdp.evaluate(`window.__renderController.renderMasterFrame(${mt})`);
      const shot = await chrome.cdp.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 94,
        fromSurface: true,
        optimizeForSpeed: true,
      });
      const outPath = path.join(previewDir, `p9_${g}.jpg`);
      fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
      paths9x16.push(outPath);
    }
    await buildContactSheet(
      paths9x16,
      path.join(previewDir, 'contact_9x16_locked.jpg'),
      5,
      3,
      270,
      480,
    );
    console.log(`[preview] Saved contact_9x16_locked.jpg`);

    // 3. Benchmark 60 consecutive frames @ 1920x1080 with optimizeForSpeed
    await openRenderPage(chrome.cdp, httpPort, 1920, 1080, 'cinema', 'landscape');
    const t0 = performance.now();
    for (let f = 0; f < 60; f++) {
      const mt = 3.0 + f / 60;
      await chrome.cdp.evaluate(`window.__renderController.renderMasterFrame(${mt})`);
      await chrome.cdp.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 95,
        fromSurface: true,
        optimizeForSpeed: true,
      });
    }
    const elapsed = (performance.now() - t0) / 1000;
    const fps = 60 / elapsed;
    console.log(
      `[bench] 60 frames @ 1920x1080 (optimizeForSpeed) took ${elapsed.toFixed(2)}s (${fps.toFixed(1)} render-fps -> ~${(11046 / fps / 60).toFixed(1)} min per full 184s 60fps video)`,
    );
  } finally {
    chrome.cleanup();
  }
}

async function renderFullVideo(job, httpPort, fps, debugPort) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, job.fileName);
  const chrome = await launchChrome(job.width, job.height, debugPort);

  try {
    const { totalDurationSec } = await openRenderPage(
      chrome.cdp,
      httpPort,
      job.width,
      job.height,
      job.cameraMode,
      job.aspectMode,
    );

    const totalFrames = Math.ceil(totalDurationSec * fps);
    console.log(
      `[render] Starting ${job.fileName} (${job.width}x${job.height} @ ${fps}fps, ${totalFrames} frames, ${totalDurationSec.toFixed(2)}s)`,
    );

    const ff = spawn(
      ffmpegStatic,
      [
        '-y',
        '-v',
        'error',
        '-f',
        'image2pipe',
        '-vcodec',
        'mjpeg',
        '-framerate',
        String(fps),
        '-i',
        '-',
        '-i',
        AUDIO_MASTER,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '17',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-c:a',
        'aac',
        '-b:a',
        '320k',
        '-shortest',
        outPath,
      ],
      { stdio: ['pipe', 'ignore', 'pipe'] },
    );

    let ffStderr = '';
    ff.stderr.on('data', (d) => {
      ffStderr += d.toString();
    });

    const ffDone = new Promise((resolve, reject) => {
      ff.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited ${code}: ${ffStderr}`));
      });
      ff.on('error', reject);
    });

    const tStart = performance.now();
    for (let frame = 0; frame < totalFrames; frame++) {
      const masterSec = frame / fps;
      await chrome.cdp.evaluate(`window.__renderController.renderMasterFrame(${masterSec.toFixed(6)})`);
      const shot = await chrome.cdp.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 93,
        fromSurface: true,
        optimizeForSpeed: true,
      });
      const buf = Buffer.from(shot.data, 'base64');
      if (!ff.stdin.write(buf)) {
        await new Promise((r) => ff.stdin.once('drain', r));
      }

      if ((frame + 1) % 300 === 0 || frame === totalFrames - 1) {
        const elapsed = (performance.now() - tStart) / 1000;
        const rate = (frame + 1) / elapsed;
        const etaMin = ((totalFrames - frame - 1) / Math.max(rate, 0.1) / 60).toFixed(1);
        const pct = (((frame + 1) / totalFrames) * 100).toFixed(1);
        console.log(
          `[render:${job.key}] ${frame + 1}/${totalFrames} (${pct}%) | ${rate.toFixed(1)} fps | ETA ${etaMin}m`,
        );
      }
    }

    ff.stdin.end();
    await ffDone;
    const sizeMB = (fs.statSync(outPath).size / (1024 * 1024)).toFixed(1);
    const totalMin = ((performance.now() - tStart) / 60000).toFixed(2);
    console.log(`[render] DONE ${outPath} (${sizeMB} MB in ${totalMin} min)`);
  } finally {
    chrome.cleanup();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isPreview = args.includes('--preview');
  const fpsArg = args.find((a) => a.startsWith('--fps='));
  const fps = fpsArg ? Number(fpsArg.split('=')[1]) || 60 : 60;
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const onlyKeys = onlyArg ? new Set(onlyArg.split('=')[1].split(',')) : null;

  const parallelArg = args.find((a) => a.startsWith('--parallel='));
  const concurrency = Math.max(1, Math.min(4, parallelArg ? Number(parallelArg.split('=')[1]) || 2 : 2));

  if (!fs.existsSync(DIST_DIR)) {
    throw new Error('dist/ not found. Run `pnpm run build` first.');
  }
  if (!fs.existsSync(AUDIO_MASTER)) {
    throw new Error('public/audio/master_mix.mp3 not found. Run `pnpm run audio:build` first.');
  }

  const { server, port } = await startStaticServer();
  try {
    if (isPreview) {
      const previewDir = path.join(ROOT, 'outputs', '_previews');
      await runPreviewBenchmark(port, previewDir);
      return;
    }

    const jobs = onlyKeys ? VIDEO_JOBS.filter((j) => onlyKeys.has(j.key)) : VIDEO_JOBS;
    let nextIdx = 0;
    let portBase = 9341;
    const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, async (_, workerIdx) => {
      if (workerIdx > 0) {
        await new Promise((r) => setTimeout(r, workerIdx * 2200));
      }
      while (nextIdx < jobs.length) {
        const job = jobs[nextIdx++];
        const debugPort = portBase++;
        await renderFullVideo(job, port, fps, debugPort);
      }
    });
    await Promise.all(workers);
  } finally {
    cleanupAll();
    server.close();
  }
}

main().catch((err) => {
  cleanupAll();
  console.error('[render] Fatal error:', err);
  process.exit(1);
});
