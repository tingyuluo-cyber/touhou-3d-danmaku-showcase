import { getCaptionTheme } from '../ui/captionThemes';

export interface ExportConfig {
  resolution: 'viewport' | '1920x1080' | '2560x1440' | '3840x2160';
  fps: number;
  includeCaption: boolean;
}

export interface RecorderHost {
  getCanvas(): HTMLCanvasElement;
  getDuration(): number;
  getCaptionInfo(): { meta: string; title: string; character: string; gameCode: string };
  enterExportSize(width: number, height: number): void;
  exitExportSize(): void;
  renderAtExactTime(timeSec: number, dtSec: number): void;
  setPlaying(playing: boolean): void;
  setCameraCinemaMode(): void;
}

function parseResolution(
  res: ExportConfig['resolution'],
  fallbackCanvas: HTMLCanvasElement,
): { width: number; height: number } {
  if (res === 'viewport') {
    return {
      width: Math.max(2, fallbackCanvas.width),
      height: Math.max(2, fallbackCanvas.height),
    };
  }
  const [w, h] = res.split('x').map(Number);
  return { width: w || 1920, height: h || 1080 };
}

function drawCaptionOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  caption: { meta: string; title: string; character: string; gameCode: string },
  time: number,
  alpha = 1,
): void {
  if (alpha <= 0.005) return;
  const theme = getCaptionTheme(caption.gameCode);
  const scale = height / 1080;
  const cx = width / 2;
  const bottomBase = height - Math.round(40 * scale);
  const isTimeStop = caption.gameCode === 'TH06' && time >= 2.4 && time <= 10.2;
  const isInverted = caption.gameCode === 'TH14' && time >= 3.2 && time <= 9.2;
  const isPetrified = caption.gameCode === 'TH20' && time >= 3.8;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Soft elliptical readability scrim (stronger warm sepia scrim for sunlit TH09)
  const scrimW = Math.round(360 * scale);
  const scrimH = Math.round(78 * scale);
  const scrimCy = bottomBase - Math.round(46 * scale);
  const scrimGrad = ctx.createRadialGradient(cx, scrimCy, 0, cx, scrimCy, scrimW);
  scrimGrad.addColorStop(0, theme.scrimColor ?? 'rgba(2, 4, 12, 0.56)');
  scrimGrad.addColorStop(0.55, theme.scrimColor ? 'rgba(38, 18, 4, 0.36)' : 'rgba(2, 4, 12, 0.22)');
  scrimGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.save();
  ctx.translate(cx, scrimCy);
  ctx.scale(1, scrimH / scrimW);
  ctx.fillStyle = scrimGrad;
  ctx.beginPath();
  ctx.arc(0, 0, scrimW, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Eyebrow meta + flanking ornaments
  const metaY = bottomBase - Math.round(74 * scale);
  const fullMeta = `${theme.ornLeft ? `${theme.ornLeft}  ` : ''}${theme.metaPrefix ?? ''}${caption.meta}${theme.metaSuffix ?? ''}${theme.ornRight ? `  ${theme.ornRight}` : ''}`;
  ctx.font = `600 ${Math.round(14 * scale)}px ${theme.metaFont}`;
  ctx.fillStyle = isTimeStop ? 'rgba(196, 226, 255, 0.88)' : theme.metaColor;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.94)';
  ctx.shadowBlur = 10 * scale;
  ctx.fillText(fullMeta, cx, metaY);

  // Per-game themed divider rule + emblem
  const ruleY = bottomBase - Math.round(60 * scale);
  const ruleHalfW = Math.round((caption.gameCode === 'TH15' ? 140 : 195) * scale);
  const grad = ctx.createLinearGradient(cx - ruleHalfW, ruleY, cx + ruleHalfW, ruleY);
  const stops = isTimeStop
    ? ['rgba(160,214,255,0)', 'rgba(160,214,255,0.9)', 'rgba(235,248,255,0.95)', 'rgba(160,214,255,0.9)', 'rgba(160,214,255,0)']
    : theme.ruleGradient;
  const denom = Math.max(1, stops.length - 1);
  stops.forEach((col, i) => grad.addColorStop(i / denom, col));

  ctx.save();
  ctx.strokeStyle = grad;
  ctx.lineWidth = Math.max(1, (caption.gameCode === 'TH10' || caption.gameCode === 'TH11' || caption.gameCode === 'TH14' || caption.gameCode === 'TH16' || caption.gameCode === 'TH18' ? 2 : 1.2) * scale);
  const emblemGap = Math.round((theme.emblem.length > 2 ? 38 : 22) * scale);
  ctx.beginPath();
  ctx.moveTo(cx - ruleHalfW, ruleY);
  ctx.lineTo(cx - emblemGap, ruleY);
  ctx.moveTo(cx + emblemGap, ruleY);
  ctx.lineTo(cx + ruleHalfW, ruleY);
  ctx.stroke();

  ctx.font = `600 ${Math.round(13 * scale)}px ${theme.metaFont}`;
  ctx.fillStyle = isTimeStop ? '#bfe4ff' : theme.emblemColor;
  ctx.shadowColor = theme.titleGlow;
  ctx.shadowBlur = 10 * scale;
  ctx.fillText(theme.emblem, cx, ruleY + Math.round(4 * scale));
  ctx.restore();

  // Main spell card title
  const titleY = bottomBase - Math.round(20 * scale);
  const baseFontPx =
    caption.gameCode === 'TH07' || caption.gameCode === 'TH12' || caption.gameCode === 'TH20'
      ? 44
      : caption.gameCode === 'TH14' || caption.gameCode === 'TH10'
        ? 34
        : 40;
  ctx.font = `${theme.titleWeight} ${Math.round(baseFontPx * scale)}px ${theme.titleFont}`;

  // Optional TH17 cyber brackets
  if (caption.gameCode === 'TH17') {
    const metrics = ctx.measureText(caption.title);
    const padX = Math.round(metrics.width * 0.5 + 24 * scale);
    const topB = titleY - Math.round(34 * scale);
    const botB = titleY + Math.round(10 * scale);
    const arm = Math.round(11 * scale);
    ctx.save();
    ctx.lineWidth = Math.max(1.5, 2 * scale);
    ctx.strokeStyle = '#44ebff';
    ctx.beginPath();
    ctx.moveTo(cx - padX + arm, topB);
    ctx.lineTo(cx - padX, topB);
    ctx.lineTo(cx - padX, botB);
    ctx.lineTo(cx - padX + arm, botB);
    ctx.stroke();
    ctx.strokeStyle = '#ffb842';
    ctx.beginPath();
    ctx.moveTo(cx + padX - arm, topB);
    ctx.lineTo(cx + padX, topB);
    ctx.lineTo(cx + padX, botB);
    ctx.lineTo(cx + padX - arm, botB);
    ctx.stroke();
    ctx.restore();
  }

  // TH14 chromatic glitch split + optional inverted ghost reflection
  if (caption.gameCode === 'TH14') {
    const split = 2.4 * scale;
    ctx.fillStyle = 'rgba(255, 36, 88, 0.85)';
    ctx.shadowBlur = 0;
    ctx.fillText(caption.title, cx - split, titleY);
    ctx.fillStyle = 'rgba(36, 228, 255, 0.85)';
    ctx.fillText(caption.title, cx + split, titleY);
    if (isInverted) {
      ctx.save();
      ctx.globalAlpha = alpha * 0.34;
      ctx.translate(cx, titleY + Math.round(6 * scale));
      ctx.scale(1, -1);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.fillText(caption.title, 0, 0);
      ctx.restore();
    }
  }

  ctx.fillStyle = isTimeStop ? '#dff0ff' : isPetrified ? '#eae6d9' : theme.titleColor;
  ctx.shadowColor = isTimeStop
    ? 'rgba(154, 216, 255, 0.75)'
    : isPetrified
      ? 'rgba(86, 208, 178, 0.6)'
      : theme.titleGlow;
  ctx.shadowBlur = 18 * scale;
  ctx.fillText(caption.title, cx, titleY);

  // Character + Official English Subtitle
  const subY = bottomBase + Math.round(4 * scale);
  ctx.font = `400 ${Math.round(13 * scale)}px ${theme.subFont}`;
  ctx.fillStyle = theme.subColor;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.96)';
  ctx.shadowBlur = 10 * scale;
  ctx.fillText(`${caption.character} · ${theme.englishSubtitle}`, cx, subY);

  ctx.restore();
}

export class StageRecorder {
  private aborted = false;
  public active = false;

  public cancel(): void {
    this.aborted = true;
  }

  /**
   * Real-time full-sequence WebM capture using MediaRecorder + VP9.
   * Composites optional bottom spell title cleanly onto an offscreen 2D canvas.
   */
  public async recordWebM(
    host: RecorderHost,
    config: ExportConfig,
    onProgress: (msg: string) => void,
  ): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.aborted = false;

    const srcCanvas = host.getCanvas();
    const { width, height } = parseResolution(config.resolution, srcCanvas);
    const duration = host.getDuration();
    const totalFrames = Math.ceil(duration * config.fps);
    const dt = 1 / config.fps;
    const caption = host.getCaptionInfo();

    const outCanvas = document.createElement('canvas');
    outCanvas.width = width;
    outCanvas.height = height;
    const ctx = outCanvas.getContext('2d');
    if (!ctx) {
      this.active = false;
      throw new Error('Failed to create 2D composite canvas');
    }

    const mimeCandidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    if (!mimeType) {
      this.active = false;
      throw new Error('Current browser does not support WebM MediaRecorder');
    }

    host.setPlaying(false);
    host.setCameraCinemaMode();
    host.enterExportSize(width, height);

    const stream = outCanvas.captureStream(config.fps);
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: width >= 2560 ? 32_000_000 : 20_000_000,
    });

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data);
    };

    const stoppedPromise = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });

    try {
      recorder.start(250);
      const frameIntervalMs = 1000 / config.fps;
      let nextFrameAt = performance.now();

      for (let frame = 0; frame < totalFrames; frame++) {
        if (this.aborted) break;

        const t = frame * dt;
        host.renderAtExactTime(t, dt);

        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(srcCanvas, 0, 0, width, height);
        if (config.includeCaption) {
          const cIn = Math.max(0, Math.min(1, (t - 0.35) / 1.0));
          const cOut = Math.max(0, Math.min(1, (duration - 0.2 - t) / 1.35));
          drawCaptionOverlay(ctx, width, height, caption, t, cIn * cOut);
        }

        if (frame % 15 === 0 || frame === totalFrames - 1) {
          const pct = (((frame + 1) / totalFrames) * 100).toFixed(1);
          onProgress(`录制 WebM 中: ${frame + 1}/${totalFrames} 帧 (${pct}%) [${width}x${height}]`);
        }

        // Pace capture close to target FPS for smooth MediaRecorder timestamps
        nextFrameAt += frameIntervalMs;
        const waitMs = Math.max(0, nextFrameAt - performance.now());
        await new Promise((r) => setTimeout(r, waitMs));
      }

      recorder.stop();
      await stoppedPromise;

      if (!this.aborted && chunks.length > 0) {
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${caption.gameCode}_${width}x${height}_${config.fps}fps.webm`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        onProgress(`WebM 导出完成! (${(blob.size / (1024 * 1024)).toFixed(1)} MB)`);
      } else {
        onProgress('已中止 WebM 录制.');
      }
    } finally {
      host.exitExportSize();
      host.setPlaying(true);
      this.active = false;
    }
  }

  /**
   * Deterministic fixed-timestep PNG sequence exporter using File System Access API.
   * Zero dropped frames at 1080p / 2K / 4K for Premiere / After Effects / FFmpeg workflows.
   */
  public async exportPngSequence(
    host: RecorderHost,
    config: ExportConfig,
    onProgress: (msg: string) => void,
  ): Promise<void> {
    if (this.active) return;

    const picker = (window as unknown as {
      showDirectoryPicker?: (opts?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker;

    if (!picker) {
      throw new Error('当前浏览器不支持文件夹直写 API (建议使用 Chrome / Edge 桌面版), 请改用 WebM 录制.');
    }

    const dirHandle = await picker({ mode: 'readwrite' });

    this.active = true;
    this.aborted = false;

    const srcCanvas = host.getCanvas();
    const { width, height } = parseResolution(config.resolution, srcCanvas);
    const duration = host.getDuration();
    const totalFrames = Math.ceil(duration * config.fps);
    const dt = 1 / config.fps;
    const caption = host.getCaptionInfo();

    const outCanvas = document.createElement('canvas');
    outCanvas.width = width;
    outCanvas.height = height;
    const ctx = outCanvas.getContext('2d');
    if (!ctx) {
      this.active = false;
      throw new Error('Failed to create 2D export canvas');
    }

    host.setPlaying(false);
    host.setCameraCinemaMode();
    host.enterExportSize(width, height);

    try {
      for (let frame = 0; frame < totalFrames; frame++) {
        if (this.aborted) break;

        const t = frame * dt;
        host.renderAtExactTime(t, dt);

        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(srcCanvas, 0, 0, width, height);
        if (config.includeCaption) {
          const cIn = Math.max(0, Math.min(1, (t - 0.35) / 1.0));
          const cOut = Math.max(0, Math.min(1, (duration - 0.2 - t) / 1.35));
          drawCaptionOverlay(ctx, width, height, caption, t, cIn * cOut);
        }

        const blob = await new Promise<Blob | null>((resolve) =>
          outCanvas.toBlob(resolve, 'image/png'),
        );
        if (!blob) continue;

        const fileName = `frame_${String(frame + 1).padStart(5, '0')}.png`;
        const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();

        if (frame % 5 === 0 || frame === totalFrames - 1) {
          const pct = (((frame + 1) / totalFrames) * 100).toFixed(1);
          onProgress(
            `逐帧导出 PNG 中: ${frame + 1}/${totalFrames} (${pct}%) [${width}x${height} @ ${config.fps}fps]`,
          );
        }
      }

      if (this.aborted) {
        onProgress('已中止 PNG 序列导出.');
      } else {
        onProgress(
          `PNG 序列导出完成 (${totalFrames} 帧)! 可运行: ffmpeg -framerate ${config.fps} -i frame_%05d.png -c:v libx264 -pix_fmt yuv420p -crf 16 out.mp4`,
        );
      }
    } finally {
      host.exitExportSize();
      host.setPlaying(true);
      this.active = false;
    }
  }
}
