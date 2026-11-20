import * as THREE from 'three';

const ROMAN_NUMERALS = [
  'XII',
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
];

/**
 * Generates a crisp high-resolution Roman numeral astral clock face texture.
 */
export function createAstralClockTexture(size = 1024): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.46;

  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = '#d8eeff';
  ctx.fillStyle = '#eef8ff';
  ctx.lineCap = 'round';

  // Soft outer halo
  const halo = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R * 1.05);
  halo.addColorStop(0, 'rgba(110, 185, 255, 0.0)');
  halo.addColorStop(0.75, 'rgba(130, 200, 255, 0.08)');
  halo.addColorStop(0.92, 'rgba(180, 225, 255, 0.22)');
  halo.addColorStop(1, 'rgba(110, 185, 255, 0.0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.05, 0, Math.PI * 2);
  ctx.fill();

  const drawRing = (radius: number, lineWidth: number, alpha: number, dash?: number[]) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = lineWidth;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };

  drawRing(R * 0.99, 3.2, 0.92);
  drawRing(R * 0.945, 1.5, 0.65);
  drawRing(R * 0.77, 2.4, 0.85);
  drawRing(R * 0.73, 1.2, 0.5, [8, 10]);
  drawRing(R * 0.52, 1.8, 0.65);
  drawRing(R * 0.22, 1.5, 0.55);

  // 60 minute ticks + 12 major hour dividers
  for (let i = 0; i < 60; i++) {
    const angle = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const isHour = i % 5 === 0;
    const r0 = isHour ? R * 0.915 : R * 0.945;
    const r1 = R * 0.985;
    ctx.save();
    ctx.globalAlpha = isHour ? 0.92 : 0.45;
    ctx.lineWidth = isHour ? 2.6 : 1.2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * r0, cy + Math.sin(angle) * r0);
    ctx.lineTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
    ctx.stroke();
    ctx.restore();
  }

  // Inscribed 12-point astral star geometry inside inner dial
  ctx.save();
  ctx.globalAlpha = 0.34;
  ctx.lineWidth = 1.4;
  for (let step = 0; step < 2; step++) {
    const offset = (step * Math.PI) / 6;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = offset + (i / 6) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(a) * R * 0.725;
      const y = cy + Math.sin(a) * R * 0.725;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();

  // Ornate Roman numerals I - XII
  ctx.save();
  ctx.fillStyle = '#f2f9ff';
  ctx.shadowColor = 'rgba(130, 205, 255, 0.85)';
  ctx.shadowBlur = 10;
  ctx.font = `600 ${Math.round(size * 0.052)}px "Georgia", "Times New Roman", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const nr = R * 0.855;
    ctx.save();
    ctx.translate(cx + Math.cos(angle) * nr, cy + Math.sin(angle) * nr);
    ctx.rotate(angle + Math.PI / 2);
    ctx.fillText(ROMAN_NUMERALS[i], 0, 0);
    ctx.restore();
  }
  ctx.restore();

  // Small cardinal diamonds
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const dr = R * 0.77;
    ctx.save();
    ctx.translate(cx + Math.cos(angle) * dr, cy + Math.sin(angle) * dr);
    ctx.rotate(angle);
    ctx.fillStyle = i % 3 === 0 ? '#ffffff' : '#a8d8ff';
    ctx.beginPath();
    const s = i % 3 === 0 ? 7 : 4;
    ctx.moveTo(s, 0);
    ctx.lineTo(0, s * 0.6);
    ctx.lineTo(-s, 0);
    ctx.lineTo(0, -s * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Generates an intricate inner clockwork gear / filigree ring texture.
 */
export function createClockGearRingTexture(size = 1024): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.45;

  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = '#cde8ff';
  ctx.fillStyle = '#d8f0ff';

  // Fine gear teeth along outer edge
  const teeth = 48;
  ctx.save();
  ctx.globalAlpha = 0.72;
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const a1 = ((i + 0.32) / teeth) * Math.PI * 2;
    const a2 = ((i + 0.5) / teeth) * Math.PI * 2;
    const a3 = ((i + 0.82) / teeth) * Math.PI * 2;
    const rIn = R * 0.92;
    const rOut = R * 0.99;
    if (i === 0) ctx.moveTo(cx + Math.cos(a0) * rIn, cy + Math.sin(a0) * rIn);
    ctx.lineTo(cx + Math.cos(a1) * rIn, cy + Math.sin(a1) * rIn);
    ctx.lineTo(cx + Math.cos(a1) * rOut, cy + Math.sin(a1) * rOut);
    ctx.lineTo(cx + Math.cos(a2) * rOut, cy + Math.sin(a2) * rOut);
    ctx.lineTo(cx + Math.cos(a3) * rIn, cy + Math.sin(a3) * rIn);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  // Inner concentric filigree rings and spokes
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.84, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.58, 0, Math.PI * 2);
  ctx.stroke();

  // 8 ornate spokes
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R * 0.28, cy + Math.sin(a) * R * 0.28);
    ctx.lineTo(cx + Math.cos(a) * R * 0.84, cy + Math.sin(a) * R * 0.84);
    ctx.stroke();
  }

  // Small decorative circles along mid track
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * R * 0.71, cy + Math.sin(a) * R * 0.71, R * 0.045, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Generates a luminous Touhou-style hexagram magic circle texture
 * (matching the bright glowing floating spell seals in classic 3D danmaku showcases).
 */
export function createHexagramCircleTexture(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.42;

  ctx.clearRect(0, 0, size, size);

  // Soft bloom aura
  const aura = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.15);
  aura.addColorStop(0, 'rgba(180, 225, 255, 0.16)');
  aura.addColorStop(0.65, 'rgba(140, 205, 255, 0.24)');
  aura.addColorStop(0.88, 'rgba(220, 242, 255, 0.32)');
  aura.addColorStop(1, 'rgba(140, 205, 255, 0.0)');
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.15, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#ffffff';
  ctx.shadowColor = '#8fd4ff';
  ctx.shadowBlur = 12;
  ctx.lineJoin = 'miter';

  // Double outer circle
  ctx.lineWidth = 4.2;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = 2.0;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.87, 0, Math.PI * 2);
  ctx.stroke();

  // Rune ticks between outer rings
  ctx.save();
  ctx.lineWidth = 2.0;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R * 0.89, cy + Math.sin(a) * R * 0.89);
    ctx.lineTo(cx + Math.cos(a) * R * 0.98, cy + Math.sin(a) * R * 0.98);
    ctx.stroke();
  }
  ctx.restore();

  // Inscribed Hexagram (two overlapping equilateral triangles)
  ctx.lineWidth = 3.2;
  for (let t = 0; t < 2; t++) {
    const base = t * (Math.PI / 3) - Math.PI / 2;
    ctx.beginPath();
    for (let i = 0; i <= 3; i++) {
      const a = base + (i / 3) * Math.PI * 2;
      const x = cx + Math.cos(a) * R * 0.86;
      const y = cy + Math.sin(a) * R * 0.86;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Inner circle
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.44, 0, Math.PI * 2);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Generates a soft glowing radial mote texture for suspended time-dust particles.
 */
export function createSoftGlowTexture(size = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const half = size / 2;

  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.22, 'rgba(215, 240, 255, 0.85)');
  grad.addColorStop(0.55, 'rgba(130, 195, 255, 0.22)');
  grad.addColorStop(1.0, 'rgba(80, 140, 255, 0.0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
