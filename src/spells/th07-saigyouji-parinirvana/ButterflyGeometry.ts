import * as THREE from 'three';

/**
 * Builds a sculpted 4-wing 3D Butterfly bullet aligned along +Z (head at +Z, tail at -Z).
 *
 * UV convention for GPU vertex-shader wing flapping:
 *   uv.x -> -1.0 for left wing, 0.0 for body, +1.0 for right wing
 *   uv.y -> normalized span distance from body (0.0 thorax -> 1.0 wingtip)
 */
export function createButterflyBulletGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const n = new THREE.Vector3();

  const pushTri = (
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    uv0: [number, number],
    uv1: [number, number],
    uv2: [number, number],
    c0: [number, number, number],
    c1: [number, number, number],
    c2: [number, number, number],
  ) => {
    vA.set(p0[0], p0[1], p0[2]);
    vB.set(p1[0], p1[1], p1[2]);
    vC.set(p2[0], p2[1], p2[2]);
    e1.subVectors(vB, vA);
    e2.subVectors(vC, vA);
    n.crossVectors(e1, e2);
    if (n.lengthSq() < 1e-12) return;
    n.normalize();

    positions.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
    normals.push(n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z);
    uvs.push(uv0[0], uv0[1], uv1[0], uv1[1], uv2[0], uv2[1]);
    colors.push(c0[0], c0[1], c0[2], c1[0], c1[1], c1[2], c2[0], c2[1], c2[2]);
  };

  const bodyWhite: [number, number, number] = [1.0, 0.98, 1.0];
  const innerWing: [number, number, number] = [0.98, 0.95, 1.0];
  const outerWing: [number, number, number] = [0.85, 0.88, 1.0];

  // Mirror left (s = -1) and right (s = +1) wings
  for (const s of [-1, 1] as const) {
    // Upper forewing (graceful swept diamond fan)
    const rootFront: [number, number, number] = [0.02 * s, 0.0, 0.24];
    const rootMid: [number, number, number] = [0.02 * s, 0.0, -0.02];
    const foreLead: [number, number, number] = [0.42 * s, 0.06, 0.42];
    const foreTip: [number, number, number] = [0.52 * s, 0.04, 0.16];
    const foreTrail: [number, number, number] = [0.30 * s, 0.01, -0.05];

    pushTri(rootFront, foreLead, foreTip, [s, 0.0], [s, 0.85], [s, 1.0], bodyWhite, innerWing, outerWing);
    pushTri(rootFront, foreTip, foreTrail, [s, 0.0], [s, 1.0], [s, 0.6], bodyWhite, outerWing, innerWing);
    pushTri(rootFront, foreTrail, rootMid, [s, 0.0], [s, 0.6], [s, 0.0], bodyWhite, innerWing, bodyWhite);

    // Lower hindwing (delicate swallowtail lobe)
    const rootRear: [number, number, number] = [0.02 * s, 0.0, -0.24];
    const hindMid: [number, number, number] = [0.34 * s, -0.01, -0.14];
    const hindTail: [number, number, number] = [0.24 * s, -0.02, -0.44];

    pushTri(rootMid, hindMid, hindTail, [s, 0.0], [s, 0.68], [s, 0.82], bodyWhite, innerWing, outerWing);
    pushTri(rootMid, hindTail, rootRear, [s, 0.0], [s, 0.82], [s, 0.0], bodyWhite, outerWing, bodyWhite);
  }

  // Slender luminous thorax spine
  pushTri([0, 0.025, 0.3], [-0.03, 0, 0.0], [0.03, 0, 0.0], [0, 0], [0, 0], [0, 0], bodyWhite, bodyWhite, bodyWhite);
  pushTri([0, 0.025, -0.32], [0.03, 0, 0.0], [-0.03, 0, 0.0], [0, 0], [0, 0], [0, 0], bodyWhite, bodyWhite, bodyWhite);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geom.computeBoundingSphere();
  return geom;
}

/**
 * Builds a delicately cupped, heart-notched 3D Sakura (cherry blossom) petal.
 */
export function createSakuraPetalGeometry(): THREE.BufferGeometry {
  const pts: [number, number, number][] = [
    [0.0, 0.0, -0.26], // 0: base stem
    [0.14, 0.025, -0.06], // 1: right lower belly
    [0.17, 0.045, 0.14], // 2: right upper lobe
    [0.075, 0.035, 0.27], // 3: right apical tip
    [0.0, 0.02, 0.19], // 4: classic sakura center notch
    [-0.075, 0.035, 0.27], // 5: left apical tip
    [-0.17, 0.045, 0.14], // 6: left upper lobe
    [-0.14, 0.025, -0.06], // 7: left lower belly
    [0.0, -0.015, 0.04], // 8: gently cupped center
  ];

  const indices = [
    8, 0, 1,
    8, 1, 2,
    8, 2, 3,
    8, 3, 4,
    8, 4, 5,
    8, 5, 6,
    8, 6, 7,
    8, 7, 0,
  ];

  const positions: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    positions.push(pts[i][0], pts[i][1], pts[i][2]);
    // Base slightly deeper rose, tips soft translucent white-pink
    const tipT = (pts[i][2] + 0.26) / 0.53;
    colors.push(1.0, 0.68 + tipT * 0.28, 0.84 + tipT * 0.15);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
}

/**
 * Generates an ornate Yuyuko / Saigyou Ayakashi cherry-blossom & fan-rib magic circle.
 */
export function createSakuraCrestTexture(size = 1024): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.45;

  ctx.clearRect(0, 0, size, size);

  // Ethereal pink-lavender halo
  const halo = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R * 1.08);
  halo.addColorStop(0.0, 'rgba(255, 175, 225, 0.10)');
  halo.addColorStop(0.55, 'rgba(170, 130, 255, 0.12)');
  halo.addColorStop(0.86, 'rgba(255, 165, 220, 0.20)');
  halo.addColorStop(1.0, 'rgba(130, 185, 255, 0.0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.08, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#ffdcf2';
  ctx.shadowColor = '#c58cff';
  ctx.shadowBlur = 12;

  const ring = (r: number, lw: number, alpha: number, dash?: number[]) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = lw;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };

  ring(R * 0.98, 2.8, 0.85);
  ring(R * 0.92, 1.4, 0.55, [10, 12]);
  ring(R * 0.74, 2.2, 0.72);
  ring(R * 0.34, 1.8, 0.62);

  // 10 delicate fan-rib rays & scalloped cherry-blossom petals
  ctx.save();
  ctx.globalAlpha = 0.68;
  ctx.lineWidth = 2.0;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);

    // Sculpted sakura petal contour
    ctx.beginPath();
    ctx.moveTo(0, -R * 0.22);
    ctx.bezierCurveTo(R * 0.34, -R * 0.36, R * 0.42, -R * 0.74, R * 0.11, -R * 0.90);
    ctx.lineTo(0, -R * 0.80);
    ctx.lineTo(-R * 0.11, -R * 0.90);
    ctx.bezierCurveTo(-R * 0.42, -R * 0.74, -R * 0.34, -R * 0.36, 0, -R * 0.22);
    ctx.stroke();

    // Inner vein line
    ctx.globalAlpha = 0.42;
    ctx.beginPath();
    ctx.moveTo(0, -R * 0.26);
    ctx.lineTo(0, -R * 0.76);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // Outer 30 rune/petal ticks
  ctx.save();
  ctx.globalAlpha = 0.52;
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    const r0 = i % 3 === 0 ? R * 0.86 : R * 0.91;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * R * 0.97, cy + Math.sin(a) * R * 0.97);
    ctx.stroke();
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Generates a dreamy out-of-focus cherry-blossom bokeh sprite for foreground shallow-DOF petals.
 */
export function createBokehPetalTexture(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const half = size / 2;

  ctx.clearRect(0, 0, size, size);

  // Soft bokeh petal silhouette (slightly elongated heart-oval with bright lens bokeh rim)
  ctx.save();
  ctx.translate(half, half);
  ctx.scale(0.86, 1.0);

  const grad = ctx.createRadialGradient(0, 0, size * 0.04, 0, 0, size * 0.42);
  grad.addColorStop(0.0, 'rgba(255, 225, 245, 0.42)');
  grad.addColorStop(0.55, 'rgba(255, 170, 224, 0.34)');
  grad.addColorStop(0.78, 'rgba(235, 185, 255, 0.56)');
  grad.addColorStop(0.92, 'rgba(180, 220, 255, 0.22)');
  grad.addColorStop(1.0, 'rgba(160, 190, 255, 0.0)');

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
