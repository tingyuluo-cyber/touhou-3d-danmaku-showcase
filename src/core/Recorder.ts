export interface ExportConfig {
  resolution: 'viewport' | '1920x1080' | '2560x1440' | '3840x2160';
  fps: number;
  includeCaption: boolean;
}

export interface RecorderHost {
  getCanvas(): HTMLCanvasElement;
  getDuration(): number;
  getCaptionInfo(): { meta: string; title: string; gameCode: string };
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
  meta: string,
  title: string,
  alpha = 1,
): void {
  if (alpha <= 0.005) return;
  const scale = height / 1080;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  const bottomMargin = Math.round(52 * scale);

  // Meta subtitle
  ctx.font = `500 ${Math.round(16 * scale)}px "Segoe UI", "PingFang SC", sans-serif`;
  ctx.fillStyle = 'rgba(186, 214, 255, 0.78)';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 10 * scale;
  ctx.fillText(meta.split('').join(' '), width / 2, height - bottomMargin - Math.round(44 * scale));

  // Main spell card title
  ctx.font = `500 ${Math.round(40 * scale)}px "Songti SC", "Noto Serif SC", "STSong", Georgia, serif`;
  ctx.fillStyle = 'rgba(246, 250, 255, 0.96)';
  ctx.shadowColor = 'rgba(130, 198, 255, 0.55)';
  ctx.shadowBlur = 20 * scale;
  ctx.fillText(title, width / 2, height - bottomMargin);
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
          drawCaptionOverlay(ctx, width, height, caption.meta, caption.title, cIn * cOut);
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
          drawCaptionOverlay(ctx, width, height, caption.meta, caption.title, cIn * cOut);
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
