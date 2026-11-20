import * as THREE from 'three';
import { createSeededRandom } from '../../prototypes/DanmakuMath';
import { createSoftGlowTexture } from '../../prototypes/MagicCircleFactory';

/**
 * Prototype 1 showcase (InstancedMesh / GPU Particle System):
 * 12,500 luminous particles crystallizing into colossal, breathing translucent
 * 3D Swallowtail Butterfly Wings (30 units wide) in soft sakura-pink, ghostly blue,
 * and pale lavender.
 *
 * All flapping wave propagation, morphing, vein shimmer, and blossom dissolution
 * run deterministically inside the GPU vertex shader (zero per-frame CPU loop!).
 */
export class SpectralWings {
  public readonly points: THREE.Points;
  public readonly count = 12500;

  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly glowTex: THREE.CanvasTexture;

  constructor() {
    this.glowTex = createSoftGlowTexture(128);
    const rand = createSeededRandom(20030817); // Touhou 07 PCB release date seed!

    const wingPositions = new Float32Array(this.count * 3);
    const scatterPositions = new Float32Array(this.count * 3);
    const colors = new Float32Array(this.count * 3);
    const sizes = new Float32Array(this.count);
    const meta = new Float32Array(this.count * 4); // x: side (-1/+1), y: spanFrac (0..1), z: veinWeight, w: seed

    // Ethereal sakura-pink / ghostly cyan / amethyst-lavender / pearl palette
    const cSakura = new THREE.Color(0xff84c8);
    const cBlush = new THREE.Color(0xffc6e8);
    const cViolet = new THREE.Color(0xa674ff);
    const cGhostBlue = new THREE.Color(0x6cd4ff);
    const cPearl = new THREE.Color(0xfff2fa);
    const tmpCol = new THREE.Color();

    /**
     * Evaluates a stylized anatomical swallowtail half-wing contour (x >= 0)
     * in local wing coordinates:
     *   u in [0, 1] -> radial distance from body root to outer wing edge
     *   theta in [-1.42, +1.18] -> hindwing bottom to forewing apex
     */
    const evalWingContour = (theta: number): { rMax: number; zCurve: number; isHind: boolean } => {
      if (theta >= -0.18) {
        // Forewing: grand sweeping upper wing spanning up to ~15.5 units
        const t = (theta + 0.18) / 1.36; // 0..1
        const arch = Math.sin(t * Math.PI);
        const apexBoost = Math.exp(-Math.pow((t - 0.64) * 3.1, 2));
        const scallop = 1.0 + 0.045 * Math.sin(t * Math.PI * 10);
        const rMax = (5.2 + arch * 8.4 + apexBoost * 3.6) * scallop;
        const zCurve = -Math.sin(t * Math.PI) * 1.15;
        return { rMax, zCurve, isHind: false };
      } else {
        // Hindwing: elegant lower lobe with trailing swallowtail pennant!
        const t = (-0.18 - theta) / 1.24; // 0..1 downward
        const lobe = Math.sin(t * Math.PI);
        const tailSpike = Math.exp(-Math.pow((t - 0.66) * 8.5, 2)) * 4.4;
        const scallop = 1.0 + 0.055 * Math.sin(t * Math.PI * 8);
        const rMax = (3.4 + lobe * 7.2 + tailSpike) * scallop;
        const zCurve = -lobe * 0.75 - tailSpike * 0.18;
        return { rMax, zCurve, isHind: true };
      }
    };

    const halfCount = Math.floor(this.count / 2);

    for (let i = 0; i < this.count; i++) {
      const side = i < halfCount ? 1 : -1;
      const localIdx = i % halfCount;
      const frac = localIdx / halfCount;

      let theta = 0;
      let radialFrac = 0;
      let veinWeight = 0;
      let pSize = 0.32;

      if (frac < 0.34) {
        // 1. Radiating luminous wing veins (15 crisp organic filaments per side)
        const veinIdx = Math.floor(rand() * 15);
        const veinAngles = [
          1.08, 0.92, 0.74, 0.56, 0.38, 0.2, 0.02, -0.12,
          -0.28, -0.46, -0.64, -0.82, -0.99, -1.16, -1.31,
        ];
        theta = veinAngles[veinIdx] + (rand() - 0.5) * 0.026;
        radialFrac = 0.06 + Math.pow(rand(), 0.78) * 0.94;
        veinWeight = 1.0;
        pSize = 0.28 + rand() * 0.24;
      } else if (frac < 0.62) {
        // 2. Scalloped outer margin & shimmering swallowtail fringe
        theta = -1.38 + rand() * 2.52;
        radialFrac = 0.87 + rand() * 0.13;
        veinWeight = 0.75;
        pSize = 0.34 + rand() * 0.3;
      } else if (frac < 0.72) {
        // 3. Ethereal glowing Eyespots (Ocelli) -- 2 per side (forewing & hindwing)
        const isForeSpot = rand() < 0.58;
        const centerTheta = isForeSpot ? 0.56 : -0.74;
        const centerRad = isForeSpot ? 0.68 : 0.62;
        const ringA = rand() * Math.PI * 2;
        const ringR = 0.07 + rand() * 0.045;
        theta = centerTheta + Math.cos(ringA) * ringR * 1.45;
        radialFrac = Math.min(0.95, Math.max(0.2, centerRad + Math.sin(ringA) * ringR));
        veinWeight = 0.95;
        pSize = 0.36 + rand() * 0.26;
      } else {
        // 4. Translucent silk membrane fill
        theta = -1.38 + rand() * 2.52;
        radialFrac = Math.sqrt(rand()) * 0.96;
        veinWeight = 0.15;
        pSize = 0.24 + rand() * 0.32;
      }

      const { rMax, zCurve, isHind } = evalWingContour(theta);
      const r = radialFrac * rMax;

      // Wing plane coordinates with subtle 3D camber & organic thickness
      const wx = side * (0.45 + Math.cos(theta) * r);
      const wy = 0.8 + Math.sin(theta) * r;
      const wz = zCurve * radialFrac + (rand() - 0.5) * 0.32;

      wingPositions[i * 3] = wx;
      wingPositions[i * 3 + 1] = wy;
      wingPositions[i * 3 + 2] = wz;

      // Initial/final scattered sakura-river spiral coordinates
      const sAngle = rand() * Math.PI * 4 + side * Math.PI;
      const sRad = 4.0 + Math.pow(rand(), 0.7) * 24.0;
      scatterPositions[i * 3] = Math.cos(sAngle) * sRad;
      scatterPositions[i * 3 + 1] = (rand() - 0.5) * 20.0;
      scatterPositions[i * 3 + 2] = Math.sin(sAngle) * sRad * 0.65 - 2.0;

      // Dreamy sakura-pink -> lavender -> ghostly ice-blue gradient across wingspan
      if (veinWeight > 0.85 && frac >= 0.62 && frac < 0.72) {
        // Ocelli eyespots glow ice-cyan + pearl white
        tmpCol.copy(cGhostBlue).lerp(cPearl, rand() * 0.5);
      } else if (radialFrac > 0.84) {
        // Outer scalloped rim shifts between ghost-blue and violet-sakura
        tmpCol.copy(isHind ? cViolet : cGhostBlue).lerp(cSakura, 0.38 + rand() * 0.35);
      } else if (veinWeight > 0.8) {
        // Inner veins gleam blush-pearl & soft sakura
        tmpCol.copy(cBlush).lerp(cPearl, 0.45);
      } else {
        // Translucent wing silk blends sakura pink -> lavender -> pale cyan
        const blend = radialFrac * 0.85 + (isHind ? 0.15 : 0.0);
        tmpCol.copy(cSakura).lerp(cViolet, Math.min(1, blend * 0.9)).lerp(cGhostBlue, Math.max(0, blend - 0.48) * 1.1);
      }

      colors[i * 3] = tmpCol.r;
      colors[i * 3 + 1] = tmpCol.g;
      colors[i * 3 + 2] = tmpCol.b;

      sizes[i] = pSize;
      meta[i * 4] = side;
      meta[i * 4 + 1] = Math.min(1, Math.abs(wx) / 15.5);
      meta[i * 4 + 2] = veinWeight;
      meta[i * 4 + 3] = rand();
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(wingPositions, 3));
    this.geometry.setAttribute('aScatter', new THREE.BufferAttribute(scatterPositions, 3));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.geometry.setAttribute('aMeta', new THREE.BufferAttribute(meta, 4));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 42);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uMap: { value: this.glowTex },
        uTime: { value: 0 },
        uForm: { value: 0 }, // 0 = swirling nebula, 1 = crystallized butterfly wings
        uDissolve: { value: 0 }, // 0 = solid wings, 1 = ascending sakura drift
        uBloomPulse: { value: 0 }, // climax energy wave ("八分咲")
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aScatter;
        attribute vec3 aColor;
        attribute float aSize;
        attribute vec4 aMeta; // x: side, y: spanFrac, z: veinWeight, w: seed

        uniform float uTime;
        uniform float uForm;
        uniform float uDissolve;
        uniform float uBloomPulse;
        uniform float uPixelRatio;

        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          float side = aMeta.x;
          float spanFrac = aMeta.y;
          float veinWeight = aMeta.z;
          float seed = aMeta.w;

          // Crystallize progressively from thorax root -> outer wingtips!
          float formDelay = spanFrac * 0.45 + seed * 0.14;
          float localForm = smoothstep(formDelay, formDelay + 0.42, uForm * 1.45);
          // Smooth cubic ease
          localForm = localForm * localForm * (3.0 - 2.0 * localForm);

          // Organic fluid silk wingbeat propagating outward along spanFrac
          float flapPhase = uTime * 1.55 - spanFrac * 1.38;
          float flapAmp = 0.26 + uBloomPulse * 0.18;
          float flapAngle = sin(flapPhase) * flapAmp + 0.14;

          // Rotate wing point around Y axis (hinged at thorax x = 0)
          float rx = abs(position.x);
          float c = cos(flapAngle);
          float s = sin(flapAngle);
          vec3 wingPos = vec3(
            side * (rx * c - position.z * s),
            position.y + sin(flapPhase + 0.6) * spanFrac * 0.55,
            position.z * c + rx * s
          );

          // Swirl scatter nebula slowly during intro
          float swirlA = uTime * 0.35 + seed * 6.2831;
          float cs = cos(swirlA);
          float sn = sin(swirlA);
          vec3 scatterPos = vec3(
            aScatter.x * cs - aScatter.z * sn,
            aScatter.y + sin(uTime * 0.8 + seed * 12.0) * 0.9,
            aScatter.x * sn + aScatter.z * cs
          );

          vec3 pos = mix(scatterPos, wingPos, localForm);

          // Outro dissolution: wingtips lift upward into a drifting river of sakura embers!
          float dissDelay = (1.0 - spanFrac) * 0.45 + seed * 0.15;
          float localDiss = smoothstep(dissDelay, dissDelay + 0.45, uDissolve * 1.45);
          if (localDiss > 0.001) {
            float d2 = localDiss * localDiss;
            pos.x += side * d2 * (4.5 + seed * 5.0) + sin(uTime * 1.8 + seed * 9.0) * d2 * 2.2;
            pos.y += d2 * (9.5 + seed * 6.5);
            pos.z += d2 * (3.5 * (seed - 0.3));
          }

          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPosition;

          // Outward shimmering pulse along veins during "八分咲" climax
          float rippleDelta = (spanFrac - fract(uTime * 0.48)) * 8.0;
          float veinShimmer = exp(-(rippleDelta * rippleDelta)) * (0.35 + uBloomPulse * 0.85);

          float dist = max(1.5, -mvPosition.z);
          float twinkle = 0.78 + 0.22 * sin(uTime * 3.4 + seed * 31.4);
          float pointSz = aSize * (0.72 + localForm * 0.45 + veinShimmer * 0.35) * twinkle;
          gl_PointSize = clamp((pointSz * 260.0 * uPixelRatio) / dist, 1.4, 34.0);

          // Keep brightness richly saturated pastel pink/violet/cyan (never blowing out to solid white!)
          vec3 shimmerTint = mix(aColor, vec3(0.88, 0.96, 1.0), veinShimmer * 0.42);
          vColor = shimmerTint * (0.58 + veinWeight * 0.32 + veinShimmer * 0.34);

          float introFade = smoothstep(0.0, 0.25, uForm + 0.12);
          float dissFade = 1.0 - smoothstep(0.45, 1.0, localDiss);
          vAlpha = (0.36 + veinWeight * 0.28 + localForm * 0.22) * introFade * dissFade;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float alpha = tex.a * vAlpha;
          if (alpha < 0.008) discard;
          gl_FragColor = vec4(vColor * tex.rgb, alpha);
        }
      `,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.position.set(0, 0.2, -3.5);
    this.points.frustumCulled = false;
  }

  public update(t: number, form: number, dissolve: number, bloomPulse: number, pixelRatio: number): void {
    const u = this.material.uniforms;
    u.uTime.value = t;
    u.uForm.value = form;
    u.uDissolve.value = dissolve;
    u.uBloomPulse.value = bloomPulse;
    u.uPixelRatio.value = pixelRatio;
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.glowTex.dispose();
  }
}
