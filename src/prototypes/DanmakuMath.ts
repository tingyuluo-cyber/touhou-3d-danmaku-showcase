import * as THREE from 'three';

/**
 * Deterministic PRNG (Mulberry32) so scrubbing and offline frame export
 * produce bit-identical 3D formations every time.
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function smootherstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function easeOutCubic(t: number): number {
  const k = 1 - clamp(t, 0, 1);
  return 1 - k * k * k;
}

export function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function easeOutExpo(t: number): number {
  const x = clamp(t, 0, 1);
  return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
}

export function easeInQuart(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * x * x;
}

/**
 * Generates an evenly distributed point on a unit sphere using Fibonacci lattice.
 */
export function fibonacciSpherePoint(index: number, total: number, out = new THREE.Vector3()): THREE.Vector3 {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - ((index + 0.5) / total) * 2;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = goldenAngle * index;
  out.set(Math.cos(theta) * radius, y, Math.sin(theta) * radius);
  return out;
}

const _forwardZ = new THREE.Vector3(0, 0, 1);
const _rollQuat = new THREE.Quaternion();
const _dirNorm = new THREE.Vector3();

/**
 * Orient a +Z-aligned model (such as our throwing knife blade) toward `direction`,
 * applying an optional roll angle around the forward axis.
 */
export function orientForwardWithRoll(
  direction: THREE.Vector3,
  rollRad: number,
  outQuat: THREE.Quaternion,
): THREE.Quaternion {
  _dirNorm.copy(direction);
  if (_dirNorm.lengthSq() < 1e-8) {
    outQuat.identity();
    return outQuat;
  }
  _dirNorm.normalize();
  outQuat.setFromUnitVectors(_forwardZ, _dirNorm);
  if (rollRad !== 0) {
    _rollQuat.setFromAxisAngle(_forwardZ, rollRad);
    outQuat.multiply(_rollQuat);
  }
  return outQuat;
}

/**
 * Builds an iconic Touhou 3D 5-pointed Star Bullet (`星弹`) geometry with crisp faceted peaks
 * along front/back Z faces so star danmaku read unmistakably in TH08 and TH12.
 */
export function createStarBulletGeometry(outerR = 1.0, innerR = 0.44, depth = 0.28): THREE.BufferGeometry {
  const positions: number[] = [];
  const points = 5;
  const ring: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI * 0.5;
    const r = i % 2 === 0 ? outerR : innerR;
    ring.push([Math.cos(a) * r, Math.sin(a) * r]);
  }

  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    // Front pyramid face (+Z)
    positions.push(0, 0, depth, x0, y0, 0, x1, y1, 0);
    // Back pyramid face (-Z)
    positions.push(0, 0, -depth, x1, y1, 0, x0, y0, 0);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
}
