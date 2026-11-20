import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

/**
 * Organic Cinema Audio Pipeline for Touhou 3D Spell Card Showcase (TH06-TH20).
 *
 * Solves mismatched BPM across 15 original ZUN tracks WITHOUT destroying tempo:
 * 1. Normalizes all 15 tracks to -14 LUFS with gentle S-curve fades (`0.75-0.95s` in, `1.6-2.4s` out)
 *    for individual web-stage clips (`public/audio/clips/THxx.mp3`).
 * 2. Builds an unbroken, emotionally continuous `public/audio/master_mix.mp3` by:
 *    - Extending each track's ending with a high-passed cathedral reverb wash ("化开") so its
 *      harmonic sheen floats smoothly across the cut without colliding kick drums!
 *    - Synthesizing tailored procedural cinema transition risers + deep sub-bass downbeat impacts
 *      (chime / airy wind / nuclear rumble / reverse tape suction / vacuum drop / stone bell)
 *      bridging seamlessly onto the next track's entrance!
 */

const ROOT = process.cwd();
const FFMPEG_BIN = ffmpegStatic || 'ffmpeg';
const SOURCE_DIRS = [
  path.join(ROOT, 'musicfiles'),
  path.join(ROOT, 'public', 'audio', 'raw'),
];
const CLIPS_DIR = path.join(ROOT, 'public', 'audio', 'clips');
const CUTS_CONFIG_PATH = path.join(ROOT, 'scripts', 'audio-cuts.json');
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.opus']);

const TRACK_MATCHERS = [
  { code: 'TH06', patterns: [/TH06/i, /月時計/i, /ルナ[・\s]?ダイアル/i, /Luna\s*Dial/i, /月亮的钟表/i] },
  {
    code: 'TH07',
    priorityPatterns: [/ボーダーオブライフ/i, /生死之境/i],
    patterns: [/TH07/i, /幽雅に咲かせ/i, /墨染の桜/i, /Border\s*of\s*Life/i, /Necrofantasia/i],
  },
  { code: 'TH08', patterns: [/TH08/i, /千年幻想郷/i, /千年幻想乡/i, /History\s*of\s*the\s*Moon/i] },
  { code: 'TH09', patterns: [/TH09/i, /今昔幻想郷/i, /今昔幻想乡/i, /Flower\s*Land/i] },
  { code: 'TH10', patterns: [/TH10/i, /神さびた古戦場/i, /Suwa\s*Foughten/i, /古战场/i] },
  { code: 'TH11', patterns: [/TH11/i, /霊知の太陽信仰/i, /灵知的太阳信仰/i, /Nuclear\s*Fusion/i] },
  { code: 'TH12', patterns: [/TH12/i, /感情の摩天楼/i, /感情的摩天楼/i, /Cosmic\s*Mind/i] },
  { code: 'TH13', patterns: [/TH13/i, /聖徳伝説/i, /圣德传说/i, /True\s*Administrator/i] },
  { code: 'TH14', patterns: [/TH14/i, /リバースイデオロギー/i, /Reverse\s*Ideology/i, /反意识形态/i, /逆转的意识形态/i] },
  { code: 'TH15', patterns: [/TH15/i, /ピュアヒューリーズ/i, /Pure\s*Furies/i, /心の在処/i] },
  { code: 'TH16', patterns: [/TH16/i, /秘匿されたフォーシーズンズ/i, /秘匿的四季/i, /秘神マターラ/i, /Hidden\s*Star/i] },
  { code: 'TH17', patterns: [/TH17/i, /偶像に世界を委ねて/i, /Idoratrize\s*World/i] },
  { code: 'TH18', patterns: [/TH18/i, /あの賑やかな市場/i, /Immemorial\s*Marketeers/i] },
  { code: 'TH19', patterns: [/TH19/i, /逸脱者達の無礙光/i, /Kingd[ao]m\s*of\s*Nothingness/i, /无碍光/i] },
  { code: 'TH20', patterns: [/TH20/i, /最後の一人は慣れてるから/i, /Stone\s*Goddess/i] },
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function loadCutsConfig() {
  return JSON.parse(fs.readFileSync(CUTS_CONFIG_PATH, 'utf8'));
}

function findRawTracks() {
  const candidates = [];
  for (const dir of SOURCE_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const ext = path.extname(name).toLowerCase();
      if (!AUDIO_EXTS.has(ext)) continue;
      candidates.push({ name, fullPath: path.join(dir, name) });
    }
  }

  const found = new Map();
  for (const matcher of TRACK_MATCHERS) {
    let matched = null;
    if (matcher.priorityPatterns) {
      matched = candidates.find((c) => matcher.priorityPatterns.some((re) => re.test(c.name)));
    }
    if (!matched) {
      matched = candidates.find((c) => matcher.patterns.some((re) => re.test(c.name)));
    }
    if (matched) found.set(matcher.code, matched.fullPath);
  }
  return found;
}

function probeDuration(filePath) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
    { encoding: 'utf8' },
  ).trim();
  return Number.parseFloat(out) || 0;
}

/**
 * Generates a subtle, theatrical stereo transition SFX bridge WAV (2.4s total,
 * climax peak at t = 1.35s right on the incoming track's downbeat!).
 */
function synthesizeBridgeWav(kind, outPath, seed = 1) {
  const sr = 48000;
  const dur = 2.4;
  const peakT = 1.35;
  const samples = Math.floor(sr * dur);
  const left = new Float32Array(samples);
  const right = new Float32Array(samples);

  // Deterministic PRNG for silky filtered air/whoosh noise
  let state = (seed * 2654435761) >>> 0;
  const rand = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };

  let lpL = 0;
  let lpR = 0;
  let hpPrevL = 0;
  let hpPrevR = 0;

  for (let i = 0; i < samples; i++) {
    const t = i / sr;

    // 1. Rising airy reverse-swell envelope peaking at peakT, softly decaying after
    let env = 0;
    if (t < peakT) {
      const u = t / peakT;
      env = u * u * u;
    } else {
      const u = (t - peakT) / (dur - peakT);
      env = Math.exp(-u * 4.2);
    }

    // Sweep filter brightness up as swell approaches peakT!
    const cutoff = 0.015 + env * (kind === 'rumble' ? 0.12 : 0.28);
    lpL += (rand() - lpL) * cutoff;
    lpR += (rand() - lpR) * cutoff;
    const airL = lpL - hpPrevL * 0.72;
    const airR = lpR - hpPrevR * 0.72;
    hpPrevL = lpL;
    hpPrevR = lpR;

    let sigL = airL * env * (kind === 'vacuum' ? 0.12 : 0.22);
    let sigR = airR * env * (kind === 'vacuum' ? 0.12 : 0.22);

    // 2. Soft cinema sub-bass heartbeat impact right at peakT (54 Hz -> 34 Hz pitch glide)
    if (t >= peakT && kind !== 'airy') {
      const dt = t - peakT;
      const subEnv = Math.exp(-dt * 4.8) * Math.min(1, dt * 160);
      const freq = 58 * Math.exp(-dt * 2.2) + 32;
      const sub = Math.sin(2 * Math.PI * freq * dt) * subEnv * (kind === 'rumble' ? 0.26 : 0.16);
      sigL += sub;
      sigR += sub;
    }

    // 3. Harmonic crystalline shimmer / bell overtones for magical transitions
    if (kind === 'chime' || kind === 'bell' || kind === 'airy') {
      const dt = Math.max(0, t - (peakT - 0.18));
      const chimeEnv = t >= peakT - 0.18 ? Math.exp(-dt * (kind === 'bell' ? 2.1 : 3.2)) * Math.min(1, dt * 40) : 0;
      const baseHz = kind === 'bell' ? 440 : 659.25; // A4 / E5 airy fifth harmonics
      const cL =
        (Math.sin(2 * Math.PI * baseHz * dt) * 0.5 +
          Math.sin(2 * Math.PI * baseHz * 1.498 * dt) * 0.32 +
          Math.sin(2 * Math.PI * baseHz * 2.003 * dt) * 0.18) *
        chimeEnv *
        0.085;
      const cR =
        (Math.sin(2 * Math.PI * (baseHz * 1.004) * dt) * 0.5 +
          Math.sin(2 * Math.PI * (baseHz * 1.502) * dt) * 0.32 +
          Math.sin(2 * Math.PI * (baseHz * 1.997) * dt) * 0.18) *
        chimeEnv *
        0.085;
      sigL += cL;
      sigR += cR;
    }

    // 4. Reverse suction pitch-rise for TH13 -> TH14 inversion flip
    if (kind === 'reverse' && t < peakT) {
      const u = t / peakT;
      const revFreq = 180 + u * u * 720;
      const rev = Math.sin(2 * Math.PI * revFreq * t) * (u * u * u) * 0.08;
      sigL += rev;
      sigR -= rev * 0.85;
    }

    left[i] = Math.max(-0.95, Math.min(0.95, sigL));
    right[i] = Math.max(-0.95, Math.min(0.95, sigR));
  }

  // Write uncompressed 16-bit stereo PCM WAV
  const dataBytes = samples * 4;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22); // stereo
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);

  let off = 44;
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round(left[i] * 32767), off);
    buf.writeInt16LE(Math.round(right[i] * 32767), off + 2);
    off += 4;
  }
  fs.writeFileSync(outPath, buf);
}

/**
 * Builds both:
 * - Web preview clip (`public/audio/clips/THxx.mp3`): clean -14 LUFS with gentle S-curve fade-in & lingering fade-out
 * - Master stem (`tmpDir/THxx_stem.wav`): extends 1.5s past clip end with a dreamy high-passed reverb wash tail
 *   so adjacent tracks blend organically without colliding drums!
 */
function buildTrackClips(code, inputPath, cfg, webOutPath, stemOutPath) {
  const rawDur = probeDuration(inputPath);
  const safeStart = Math.max(0, Math.min(cfg.startSec, Math.max(0, rawDur - 2)));
  const actualDur = Math.min(cfg.durationSec, Math.max(1, rawDur - safeStart));
  const fadeOutStart = Math.max(0, actualDur - cfg.fadeOut);

  // 1. Clean silky web-stage clip (100% locked to spell duration)
  const webFilter = [
    `loudnorm=I=-14:TP=-1.5:LRA=9`,
    `afade=t=in:st=0:d=${cfg.fadeIn.toFixed(2)}:curve=qsin`,
    `afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${cfg.fadeOut.toFixed(2)}:curve=hsin`,
  ].join(',');

  execFileSync(
    FFMPEG_BIN,
    [
      '-y', '-v', 'error',
      '-ss', safeStart.toFixed(3),
      '-t', actualDur.toFixed(3),
      '-i', inputPath,
      '-vn',
      '-af', webFilter,
      '-ar', '48000', '-ac', '2', '-b:a', '256k',
      webOutPath,
    ],
    { stdio: 'pipe' },
  );

  // 2. Organic master stem: dry track + lush high-passed reverb wash blooming gently over the final 2.0s + 1.4s tail!
  const tailStart = Math.max(0, actualDur - 2.1);
  const stemFilter = [
    `[0:a]loudnorm=I=-14:TP=-1.5:LRA=9,asplit=2[dry_in][wet_in]`,
    `[dry_in]afade=t=in:st=0:d=${cfg.fadeIn.toFixed(2)}:curve=qsin,afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${cfg.fadeOut.toFixed(2)}:curve=hsin,apad=pad_dur=1.4[dry]`,
    `[wet_in]atrim=start=${tailStart.toFixed(3)},asetpts=PTS-STARTPTS,highpass=f=320,lowpass=f=5200,aecho=0.8:0.88:55|110|180:0.42|0.34|0.24,afade=t=in:st=0:d=0.6:curve=qsin,apad=pad_dur=1.4,afade=t=out:st=1.4:d=2.0:curve=exp,volume=0.45,adelay=${Math.round(tailStart * 1000)}|${Math.round(tailStart * 1000)}[wet]`,
    `[dry][wet]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[out]`,
  ].join(';');

  execFileSync(
    FFMPEG_BIN,
    [
      '-y', '-v', 'error',
      '-ss', safeStart.toFixed(3),
      '-t', actualDur.toFixed(3),
      '-i', inputPath,
      '-vn',
      '-filter_complex', stemFilter,
      '-map', '[out]',
      '-ar', '48000', '-ac', '2',
      stemOutPath,
    ],
    { stdio: 'pipe' },
  );

  console.log(
    `[audio] Built ${code}: ${path.basename(inputPath)} [${safeStart.toFixed(2)}s -> ${(safeStart + actualDur).toFixed(2)}s, ${actualDur.toFixed(1)}s]`,
  );
  return {
    code,
    sourceName: path.basename(inputPath),
    webOutPath,
    stemOutPath,
    startSec: safeStart,
    duration: actualDur,
    bridge: cfg.bridge || 'airy',
  };
}

/**
 * Stitches all stems with overlapping diffused reverb tails + synthesized transition SFX bridges
 * so all 15 mismatched-BPM ZUN tracks flow as one unbroken theatrical score!
 */
function stitchOrganicMasterMix(builtClips, tmpDir, masterPath) {
  if (builtClips.length === 0) return;

  // Each next track begins `overlapSec` BEFORE the previous track's nominal end
  // (during the previous track's lingering fade + cathedral wash tail),
  // bridged by our synthesized riser/sub-impact peaking right at the incoming beat!
  const overlapSec = 0.85;
  const bridgePeakSec = 1.35;

  const inputs = [];
  const filterParts = [];
  const mixRefs = [];

  let cursorSec = 0;
  let inputIdx = 0;
  const timelineOffsets = {};

  builtClips.forEach((clip, idx) => {
    timelineOffsets[clip.code] = {
      masterStartSec: Number(cursorSec.toFixed(2)),
      durationSec: Number(clip.duration.toFixed(2)),
    };

    // Add track stem delayed to cursorSec
    inputs.push('-i', clip.stemOutPath);
    const delayMs = Math.round(cursorSec * 1000);
    filterParts.push(`[${inputIdx}:a]adelay=${delayMs}|${delayMs}[t${idx}]`);
    mixRefs.push(`[t${idx}]`);
    inputIdx++;

    // Add organic cinema transition bridge between this clip and the next!
    if (idx < builtClips.length - 1 && clip.bridge !== 'none') {
      const nextStartSec = cursorSec + clip.duration - overlapSec;
      const bridgeStartSec = Math.max(0, nextStartSec - bridgePeakSec + 0.32);
      const bridgePath = path.join(tmpDir, `bridge_${idx}_${clip.bridge}.wav`);
      synthesizeBridgeWav(clip.bridge, bridgePath, idx + 11);

      inputs.push('-i', bridgePath);
      const bDelayMs = Math.round(bridgeStartSec * 1000);
      filterParts.push(`[${inputIdx}:a]adelay=${bDelayMs}|${bDelayMs}[b${idx}]`);
      mixRefs.push(`[b${idx}]`);
      inputIdx++;

      cursorSec = nextStartSec;
    } else {
      cursorSec += clip.duration;
    }
  });

  filterParts.push(
    `${mixRefs.join('')}amix=inputs=${mixRefs.length}:duration=longest:normalize=0,loudnorm=I=-14:TP=-1.2:LRA=10[master]`,
  );

  execFileSync(
    FFMPEG_BIN,
    [
      '-y', '-v', 'error',
      ...inputs,
      '-filter_complex', filterParts.join(';'),
      '-map', '[master]',
      '-ar', '48000', '-ac', '2', '-b:a', '320k',
      masterPath,
    ],
    { stdio: 'pipe' },
  );

  const masterDur = probeDuration(masterPath);
  console.log(
    `[audio] Organic master mix ready: ${path.relative(ROOT, masterPath)} (${builtClips.length} tracks, ${masterDur.toFixed(1)}s total, seamless reverb-wash + cinema SFX bridges!)`,
  );
  return { masterDur, timelineOffsets };
}

function main() {
  const cuts = loadCutsConfig();
  const rawMap = findRawTracks();
  ensureDir(CLIPS_DIR);

  if (rawMap.size === 0) {
    console.log('[audio] No TH06-TH20 raw audio files found.');
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'th3d-audio-'));
  try {
    const orderedCodes = Object.keys(cuts);
    const missing = [];
    const built = [];

    for (const code of orderedCodes) {
      const rawPath = rawMap.get(code);
      if (!rawPath) {
        missing.push(code);
        continue;
      }
      const webOut = path.join(CLIPS_DIR, `${code}.mp3`);
      const stemOut = path.join(tmpDir, `${code}_stem.wav`);
      built.push(buildTrackClips(code, rawPath, cuts[code], webOut, stemOut));
    }

    const masterPath = path.join(ROOT, 'public', 'audio', 'master_mix.mp3');
    const mixInfo = stitchOrganicMasterMix(built, tmpDir, masterPath);

    const manifestPath = path.join(ROOT, 'public', 'audio', 'manifest.json');
    const clipsMap = {};
    const metaMap = {};
    for (const item of built) {
      clipsMap[item.code] = `/audio/clips/${item.code}.mp3`;
      metaMap[item.code] = {
        source: item.sourceName,
        startSec: Number(item.startSec.toFixed(2)),
        durationSec: Number(item.duration.toFixed(2)),
        masterStartSec: mixInfo?.timelineOffsets[item.code]?.masterStartSec ?? 0,
      };
    }
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          masterMix: '/audio/master_mix.mp3',
          masterDurationSec: Number((mixInfo?.masterDur ?? 0).toFixed(2)),
          clips: clipsMap,
          details: metaMap,
          missing,
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    console.log(`[audio] Updated ${path.relative(ROOT, manifestPath)} (${built.length} built, missing: ${missing.join(', ') || 'none'}).`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
