import * as THREE from 'three';

interface Section {
  z: number;
  width: number;
  thickness: number;
  colorEdge: [number, number, number];
  colorRidge: [number, number, number];
  tipFactor: number;
}

/**
 * Builds a sculpted, razor-faceted 3D silver throwing knife aligned along +Z.
 *
 * Key craft detail: each bevel plane uses unshared triangle vertices so face normals
 * stay razor-sharp across the central spine and cutting edges, creating crisp metallic
 * specular flashes when the camera weaves past frozen blades.
 *
 * UV convention encoded for custom blade-glint shader:
 *   uv.x -> 0.0 at spine/handle, 1.0 at razor cutting edges & tip
 *   uv.y -> 0.0 at handle/pommel, 0.25 at guard, 1.0 at needle tip
 */
export function createThrowingKnifeGeometry(): THREE.BufferGeometry {
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

  const pushQuad = (
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    uv0: [number, number],
    uv1: [number, number],
    uv2: [number, number],
    uv3: [number, number],
    c0: [number, number, number],
    c1: [number, number, number],
    c2: [number, number, number],
    c3: [number, number, number],
  ) => {
    pushTri(p0, p1, p2, uv0, uv1, uv2, c0, c1, c2);
    pushTri(p0, p2, p3, uv0, uv2, uv3, c0, c2, c3);
  };

  const ringPoints = (s: Section): [number, number, number][] => [
    [0, s.thickness, s.z], // 0: Top spine ridge
    [s.width, 0, s.z], // 1: Right razor edge
    [0, -s.thickness, s.z], // 2: Bottom spine ridge
    [-s.width, 0, s.z], // 3: Left razor edge
  ];

  const ringUVs = (s: Section): [number, number][] => [
    [0.15, s.tipFactor],
    [1.0, s.tipFactor],
    [0.15, s.tipFactor],
    [1.0, s.tipFactor],
  ];

  const ringColors = (s: Section): [number, number, number][] => [
    s.colorRidge,
    s.colorEdge,
    s.colorRidge,
    s.colorEdge,
  ];

  const silverRidge: [number, number, number] = [0.84, 0.9, 0.98];
  const silverEdge: [number, number, number] = [1.0, 1.0, 1.0];
  const guardMetal: [number, number, number] = [0.68, 0.76, 0.88];
  const guardEdge: [number, number, number] = [0.9, 0.95, 1.0];
  const gripDark: [number, number, number] = [0.22, 0.08, 0.14];
  const gripHighlight: [number, number, number] = [0.36, 0.14, 0.22];
  const pommelSilver: [number, number, number] = [0.86, 0.91, 0.98];

  // Cross-sections from pommel (-Z) to blade needle tip (+Z)
  const sections: Section[] = [
    // Pommel cap base
    { z: -0.58, width: 0.045, thickness: 0.026, colorEdge: pommelSilver, colorRidge: guardMetal, tipFactor: 0.0 },
    { z: -0.52, width: 0.068, thickness: 0.036, colorEdge: silverEdge, colorRidge: pommelSilver, tipFactor: 0.04 },
    // Grip (dark crimson-obsidian contrast handle)
    { z: -0.49, width: 0.046, thickness: 0.028, colorEdge: gripHighlight, colorRidge: gripDark, tipFactor: 0.06 },
    { z: -0.32, width: 0.056, thickness: 0.033, colorEdge: gripHighlight, colorRidge: gripDark, tipFactor: 0.12 },
    { z: -0.15, width: 0.052, thickness: 0.031, colorEdge: gripHighlight, colorRidge: gripDark, tipFactor: 0.18 },
    // Flared crossguard / bolster
    { z: -0.12, width: 0.175, thickness: 0.048, colorEdge: guardEdge, colorRidge: guardMetal, tipFactor: 0.22 },
    { z: -0.06, width: 0.145, thickness: 0.042, colorEdge: guardEdge, colorRidge: guardMetal, tipFactor: 0.25 },
    // Ricasso & sleek leaf-tapered double-edged silver blade
    { z: -0.04, width: 0.086, thickness: 0.036, colorEdge: silverEdge, colorRidge: silverRidge, tipFactor: 0.28 },
    { z: 0.2, width: 0.122, thickness: 0.045, colorEdge: silverEdge, colorRidge: silverRidge, tipFactor: 0.48 },
    { z: 0.62, width: 0.094, thickness: 0.034, colorEdge: silverEdge, colorRidge: silverRidge, tipFactor: 0.72 },
    { z: 0.96, width: 0.042, thickness: 0.017, colorEdge: silverEdge, colorRidge: silverEdge, tipFactor: 0.9 },
  ];

  // Cap pommel tail tip at z = -0.66
  const tailTip: [number, number, number] = [0, 0, -0.66];
  const firstPts = ringPoints(sections[0]);
  const firstUvs = ringUVs(sections[0]);
  const firstCols = ringColors(sections[0]);
  for (let i = 0; i < 4; i++) {
    const next = (i + 1) % 4;
    pushTri(
      tailTip,
      firstPts[i],
      firstPts[next],
      [0.2, 0.0],
      firstUvs[i],
      firstUvs[next],
      pommelSilver,
      firstCols[i],
      firstCols[next],
    );
  }

  // Connect lofted faceted segments along Z
  for (let s = 0; s < sections.length - 1; s++) {
    const pA = ringPoints(sections[s]);
    const pB = ringPoints(sections[s + 1]);
    const uvA = ringUVs(sections[s]);
    const uvB = ringUVs(sections[s + 1]);
    const cA = ringColors(sections[s]);
    const cB = ringColors(sections[s + 1]);

    for (let i = 0; i < 4; i++) {
      const next = (i + 1) % 4;
      pushQuad(
        pA[i],
        pB[i],
        pB[next],
        pA[next],
        uvA[i],
        uvB[i],
        uvB[next],
        uvA[next],
        cA[i],
        cB[i],
        cB[next],
        cA[next],
      );
    }
  }

  // Needle-sharp blade tip at z = +1.20
  const bladeTip: [number, number, number] = [0, 0, 1.2];
  const lastSec = sections[sections.length - 1];
  const lastPts = ringPoints(lastSec);
  const lastUvs = ringUVs(lastSec);
  const lastCols = ringColors(lastSec);
  for (let i = 0; i < 4; i++) {
    const next = (i + 1) % 4;
    pushTri(
      lastPts[i],
      bladeTip,
      lastPts[next],
      lastUvs[i],
      [1.0, 1.0],
      lastUvs[next],
      lastCols[i],
      silverEdge,
      lastCols[next],
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();

  return geometry;
}

/**
 * Creates a slender diamond-tapered lance geometry extending along -Z behind a knife,
 * used for glowing velocity streak trails when Time Resumes.
 */
export function createVelocityStreakGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];

  const pushQuad = (
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
  ) => {
    positions.push(
      p0[0], p0[1], p0[2],
      p1[0], p1[1], p1[2],
      p2[0], p2[1], p2[2],
      p0[0], p0[1], p0[2],
      p2[0], p2[1], p2[2],
      p3[0], p3[1], p3[2],
    );
    uvs.push(0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0);
  };

  // Crossed dual-ribbon planes (+X/+Y) so the streak stays visible from every camera angle
  const wFront = 0.055;
  const wTail = 0.004;
  const zHead = 0.1;
  const zTail = -2.8;

  // Horizontal plane
  pushQuad([-wFront, 0, zHead], [wFront, 0, zHead], [wTail, 0, zTail], [-wTail, 0, zTail]);
  // Vertical plane
  pushQuad([0, -wFront, zHead], [0, wFront, zHead], [0, wTail, zTail], [0, -wTail, zTail]);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.computeBoundingSphere();
  return geom;
}
