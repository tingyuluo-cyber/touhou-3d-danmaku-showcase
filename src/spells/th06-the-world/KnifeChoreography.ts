import * as THREE from 'three';
import { createThrowingKnifeGeometry, createVelocityStreakGeometry } from './KnifeGeometry';
import {
  clamp,
  createSeededRandom,
  easeInQuart,
  easeOutCubic,
  easeOutExpo,
  fibonacciSpherePoint,
  lerp,
  orientForwardWithRoll,
  smootherstep,
  smoothstep,
} from '../../prototypes/DanmakuMath';
import type { CameraPose } from '../types';

type KnifeLayer = 'prelude' | 'tunnel' | 'cage' | 'clockFan' | 'hero';

interface KnifeSpec {
  layer: KnifeLayer;
  spawnTime: number;
  appearDuration: number;
  basePos: THREE.Vector3;
  aimDir: THREE.Vector3;
  roll: number;
  baseScale: number;
  // Prelude movement before time stop (t < 3.2s)
  preludeVelocity: THREE.Vector3;
  // Post-resume movement (t > 14.8s)
  resumeDelay: number;
  resumeSpeed: number;
  resumeAccel: number;
  swirlRate: number;
  color: THREE.Color;
  streakColor: THREE.Color;
  glintPhase: number;
}

export interface KnifeShaderUniforms {
  uTime: { value: number };
  uFrozen: { value: number };
  uGlintSweep: { value: number };
  uBurstEnergy: { value: number };
}

export const TH06_TIME_STOP_AT = 2.4;
export const TH06_TIME_RESUME_AT = 10.2;
export const TH06_DURATION = 15.0;

/**
 * Deterministic 3D choreography for TH06 幻世 "The World":
 * Manages 2,200+ sculpted metallic throwing knives across 5 architectural layers
 * + paired kinetic light-streak lances + smooth bullet-time camera splines.
 */
export class KnifeChoreography {
  public readonly root = new THREE.Group();
  public readonly knifeMesh: THREE.InstancedMesh;
  public readonly streakMesh: THREE.InstancedMesh;
  public readonly shaderUniforms: KnifeShaderUniforms;

  private readonly knives: KnifeSpec[] = [];
  private readonly bulletCamCurve: THREE.CatmullRomCurve3;
  private readonly bulletLookCurve: THREE.CatmullRomCurve3;

  private readonly knifeGeom: THREE.BufferGeometry;
  private readonly knifeMat: THREE.MeshStandardMaterial;
  private readonly streakGeom: THREE.BufferGeometry;
  private readonly streakMat: THREE.ShaderMaterial;

  // Reusable scratch math objects (zero per-frame GC pressure)
  private readonly _pos = new THREE.Vector3();
  private readonly _dir = new THREE.Vector3();
  private readonly _quat = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3();
  private readonly _mat4 = new THREE.Matrix4();
  private readonly _tangent = new THREE.Vector3();
  private readonly _up = new THREE.Vector3(0, 1, 0);
  private readonly _side = new THREE.Vector3();
  private readonly _perp = new THREE.Vector3();

  constructor() {
    // Smooth Bullet-Time Camera Flight Path (t = 4.5s -> 14.8s)
    // Curves right through the frozen knife corridor, grazes Hero Blades,
    // weaves past the converging kill-cage, and pulls back to frame the full astral clock!
    this.bulletCamCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(8.2, 1.8, 14.4),
        new THREE.Vector3(5.8, 0.7, 8.2),
        new THREE.Vector3(1.8, -0.4, 3.6),
        new THREE.Vector3(-4.4, 1.3, 4.9),
        new THREE.Vector3(-4.2, 2.7, 11.4),
        new THREE.Vector3(0.0, 1.4, 18.8),
      ],
      false,
      'centripetal',
      0.5,
    );

    this.bulletLookCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(2.2, 0.1, 3.2),
        new THREE.Vector3(0.2, -0.2, 0.4),
        new THREE.Vector3(-1.4, 0.4, -2.5),
        new THREE.Vector3(-0.3, 0.3, -2.0),
        new THREE.Vector3(0.0, 0.1, -2.5),
        new THREE.Vector3(0.0, 0.0, -3.0),
      ],
      false,
      'centripetal',
      0.5,
    );

    this.buildKnifeFormations();

    // 1. Metallic Throwing Knife Material with custom razor-edge & needle-tip cold glint hook
    this.shaderUniforms = {
      uTime: { value: 0 },
      uFrozen: { value: 0 },
      uGlintSweep: { value: 0 },
      uBurstEnergy: { value: 0 },
    };

    this.knifeGeom = createThrowingKnifeGeometry();
    this.knifeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      metalness: 0.94,
      roughness: 0.16,
      envMapIntensity: 1.15,
    });

    this.knifeMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.shaderUniforms.uTime;
      shader.uniforms.uFrozen = this.shaderUniforms.uFrozen;
      shader.uniforms.uGlintSweep = this.shaderUniforms.uGlintSweep;
      shader.uniforms.uBurstEnergy = this.shaderUniforms.uBurstEnergy;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec2 vKnifeUv;
           varying float vInstancePhase;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vKnifeUv = uv;
           #ifdef USE_INSTANCING
             vInstancePhase = fract(sin(dot(instanceMatrix[3].xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
           #else
             vInstancePhase = 0.0;
           #endif`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec2 vKnifeUv;
           varying float vInstancePhase;
           uniform float uTime;
           uniform float uFrozen;
           uniform float uGlintSweep;
           uniform float uBurstEnergy;`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
           vec3 bladeViewDir = normalize(vViewPosition + vec3(0.0, 0.0, 1e-5));
           float ndv = clamp(abs(dot(normalize(normal), bladeViewDir)), 0.0, 1.0);
           float invNdv = max(1.0 - ndv, 0.0001);
           float bladeFresnel = invNdv * invNdv * invNdv;
           float isMetalBlade = smoothstep(0.26, 0.36, vKnifeUv.y);
           float razorEdge = smoothstep(0.76, 1.0, vKnifeUv.x) * isMetalBlade;
           float needleTip = smoothstep(0.82, 1.0, vKnifeUv.y);

           // Razor-crisp cold silver glint confined to needle tips & grazing edges (zero pow-on-negative NaN risk)
           float shimmerDelta = (vKnifeUv.y - fract(uTime * 0.42 + vInstancePhase)) * 11.0;
           float shimmerWave = exp(-(shimmerDelta * shimmerDelta));
           vec3 coldIce = vec3(0.65, 0.88, 1.32);

           float tipStarlight = needleTip * (0.22 + uFrozen * 0.24 + uGlintSweep * 0.95);
           float edgeRim = razorEdge * bladeFresnel * (0.42 + uFrozen * 0.32);
           float frozenSweep = razorEdge * shimmerWave * (0.14 + uFrozen * 0.42 + uGlintSweep * 0.55);

           totalEmissiveRadiance += coldIce * (tipStarlight + edgeRim + frozenSweep);
           totalEmissiveRadiance += diffuseColor.rgb * (razorEdge * 0.48 + needleTip * 0.85) * uBurstEnergy;`,
        );
    };
    this.knifeMat.customProgramCacheKey = () => 'th06-silver-knife-v3';

    const count = this.knives.length;
    this.knifeMesh = new THREE.InstancedMesh(this.knifeGeom, this.knifeMat, count);
    this.knifeMesh.frustumCulled = false;

    // 2. Paired Velocity Streak Lances (ignite automatically when knives fly fast!)
    this.streakGeom = createVelocityStreakGeometry();
    this.streakMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vColor;
        void main() {
          vUv = uv;
          #ifdef USE_INSTANCING_COLOR
            vColor = instanceColor;
          #else
            vColor = vec3(0.75, 0.92, 1.0);
          #endif
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vColor;
        void main() {
          float s = clamp(sin(clamp(vUv.x, 0.0, 1.0) * 3.14159265), 0.0, 1.0);
          float crossFade = s * sqrt(s);
          float ty = clamp(vUv.y, 0.0, 1.0);
          float tailFade = ty * ty;
          float alpha = crossFade * tailFade * 0.42;
          vec3 core = mix(vColor, vec3(1.0), tailFade * 0.32);
          gl_FragColor = vec4(core * 0.95, alpha);
        }
      `,
    });

    this.streakMesh = new THREE.InstancedMesh(this.streakGeom, this.streakMat, count);
    this.streakMesh.frustumCulled = false;

    // Assign per-instance metallic tints & velocity streak colors
    for (let i = 0; i < count; i++) {
      this.knifeMesh.setColorAt(i, this.knives[i].color);
      this.streakMesh.setColorAt(i, this.knives[i].streakColor);
    }
    if (this.knifeMesh.instanceColor) this.knifeMesh.instanceColor.needsUpdate = true;
    if (this.streakMesh.instanceColor) this.streakMesh.instanceColor.needsUpdate = true;

    this.root.add(this.knifeMesh, this.streakMesh);
  }

  public get count(): number {
    return this.knives.length;
  }

  private buildKnifeFormations(): void {
    const rand = createSeededRandom(20020811); // Touhou 06 release date seed!

    // Palette inspired by Touhou 06 Sakuya's metallic silver + icy cyan + scarlet crimson knives
    const cSilver = new THREE.Color(0xf2f7ff);
    const cIceBlue = new THREE.Color(0x98d8ff);
    const cDeepCyan = new THREE.Color(0x6bb8ff);
    const cCrimson = new THREE.Color(0xff5278);
    const cAmethyst = new THREE.Color(0xa698ff);

    const sSilver = new THREE.Color(0xcce8ff);
    const sIce = new THREE.Color(0x52bcff);
    const sCrimson = new THREE.Color(0xff2d62);
    const sAmethyst = new THREE.Color(0x8868ff);

    const focalCenter = new THREE.Vector3(0, 0, -1.2);

    // =========================================================================
    // LAYER 1: Prelude Spiral Barrage (440 knives)
    // Launched from 6 floating hexagram circles during 0.0s..2.4s, frozen mid-flight!
    const preludeWaves = 11;
    const perWave = 40;
    for (let w = 0; w < preludeWaves; w++) {
      const spawnTime = 0.05 + w * 0.2;
      const emitterIdx = w % 6;
      const orbitAngle = (emitterIdx / 6) * Math.PI * 2 + Math.PI / 6 + spawnTime * 0.22;
      const orbitR = 11.8;
      const elev = (emitterIdx % 2 === 0 ? 1 : -1) * 2.2;
      const emitterOrigin = new THREE.Vector3(
        Math.cos(orbitAngle) * orbitR,
        Math.sin(orbitAngle) * orbitR * 0.72,
        elev - 2.0 + Math.sin(spawnTime * 0.9 + emitterIdx) * 0.8,
      );

      for (let j = 0; j < perWave; j++) {
        const frac = j / perWave;
        const theta = frac * Math.PI * 2 + w * 0.42;
        const spiralSpread = Math.sin(frac * Math.PI * 4 + w) * 0.42;
        const toCenter = new THREE.Vector3().subVectors(focalCenter, emitterOrigin).normalize();

        // Build radial fan tilted around emitter->center vector
        const refUp = Math.abs(toCenter.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(toCenter, refUp).normalize();
        const up = new THREE.Vector3().crossVectors(right, toCenter).normalize();

        const dir = new THREE.Vector3()
          .addScaledVector(toCenter, 0.62)
          .addScaledVector(right, Math.cos(theta) * 0.78)
          .addScaledVector(up, Math.sin(theta) * 0.78 + spiralSpread * 0.35)
          .normalize();

        const speed = 4.8 + (j % 4) * 0.65;
        const isRed = (w + j) % 3 === 0;

        this.knives.push({
          layer: 'prelude',
          spawnTime,
          appearDuration: 0.16,
          basePos: emitterOrigin.clone(),
          aimDir: dir,
          roll: (j % 2 === 0 ? 1 : -1) * 0.35 + frac * Math.PI,
          baseScale: 0.88 + rand() * 0.18,
          preludeVelocity: dir.clone().multiplyScalar(speed),
          resumeDelay: (w % 3) * 0.04,
          resumeSpeed: 13.5 + rand() * 4.5,
          resumeAccel: 14.0,
          swirlRate: (w % 2 === 0 ? 1 : -1) * 0.18,
          color: isRed ? cCrimson.clone() : j % 2 === 0 ? cIceBlue.clone() : cSilver.clone(),
          streakColor: isRed ? sCrimson.clone() : sIce.clone(),
          glintPhase: rand(),
        });
      }
    }

    // =========================================================================
    // LAYER 2: Bullet-Time Spiral Corridor / Blade Tunnel (540 knives)
    // Built cleanly around bulletCamCurve (u = 0.03..0.78) with guaranteed clearance!
    // Materializes in hypnotic waves during 3.9s..7.6s while time is frozen.
    // =========================================================================
    const tunnelRings = 30;
    const knivesPerRing = 18;
    const tmpPt = new THREE.Vector3();
    const tmpTan = new THREE.Vector3();
    const tmpRight = new THREE.Vector3();
    const tmpUp = new THREE.Vector3();

    for (let r = 0; r < tunnelRings; r++) {
      const u = 0.03 + (r / (tunnelRings - 1)) * 0.76;
      this.bulletCamCurve.getPoint(u, tmpPt);
      this.bulletCamCurve.getTangent(u, tmpTan).normalize();
      tmpRight.crossVectors(tmpTan, this._up);
      if (tmpRight.lengthSq() < 1e-4) tmpRight.set(1, 0, 0);
      else tmpRight.normalize();
      tmpUp.crossVectors(tmpRight, tmpTan).normalize();

      const ringTwist = r * 0.34;
      for (let k = 0; k < knivesPerRing; k++) {
        const angle = (k / knivesPerRing) * Math.PI * 2 + ringTwist;
        // Guaranteed >= 2.8 clearance from camera spline so camera glides safely inside
        const radius = 3.05 + (k % 3) * 1.15 + rand() * 0.75;
        const pos = tmpPt
          .clone()
          .addScaledVector(tmpRight, Math.cos(angle) * radius)
          .addScaledVector(tmpUp, Math.sin(angle) * radius);

        // Sleek grazing direction: pitched along the spiral tunnel with slight inward aim
        const radialIn = tmpPt.clone().sub(pos).normalize();
        const tangentSpin = tmpRight
          .clone()
          .multiplyScalar(-Math.sin(angle))
          .addScaledVector(tmpUp, Math.cos(angle));
        const aimDir = tmpTan
          .clone()
          .multiplyScalar(0.74)
          .addScaledVector(tangentSpin, 0.48)
          .addScaledVector(radialIn, 0.22)
          .normalize();

        const paletteRoll = (r + k) % 5;
        const col =
          paletteRoll === 0
            ? cCrimson
            : paletteRoll === 1 || paletteRoll === 3
              ? cIceBlue
              : paletteRoll === 2
                ? cSilver
                : cAmethyst;
        const sCol =
          paletteRoll === 0 ? sCrimson : paletteRoll === 4 ? sAmethyst : sIce;

        this.knives.push({
          layer: 'tunnel',
          spawnTime: 2.9 + u * 2.4 + (k / knivesPerRing) * 0.26,
          appearDuration: 0.36,
          basePos: pos,
          aimDir,
          roll: angle + 0.5,
          baseScale: 0.92 + (k % 3) * 0.14,
          preludeVelocity: new THREE.Vector3(),
          resumeDelay: u * 0.18,
          resumeSpeed: 15.0 + rand() * 5.0,
          resumeAccel: 18.0,
          swirlRate: 0.32,
          color: col.clone(),
          streakColor: sCol.clone(),
          glintPhase: rand(),
        });
      }
    }

    // =========================================================================
    // LAYER 3: Converging Kill-Cage / Geodesic Fibonacci Shells (720 knives)
    // 3 concentric spherical layers (R = 6.8, 10.6, 14.4) all aimed dead-center!
    // =========================================================================
    const shellConfigs = [
      { count: 180, radius: 7.4, startT: 3.8, spanT: 1.5, col: cCrimson, sCol: sCrimson, scale: 0.8, speed: 18.5 },
      { count: 250, radius: 11.4, startT: 4.7, spanT: 1.6, col: cSilver, sCol: sSilver, scale: 0.86, speed: 21.5 },
      { count: 290, radius: 15.6, startT: 5.6, spanT: 1.7, col: cIceBlue, sCol: sIce, scale: 0.92, speed: 24.5 },
    ];

    for (let sIdx = 0; sIdx < shellConfigs.length; sIdx++) {
      const cfg = shellConfigs[sIdx];
      for (let i = 0; i < cfg.count; i++) {
        const unit = fibonacciSpherePoint(i, cfg.count);
        const pos = focalCenter.clone().addScaledVector(unit, cfg.radius);

        // Keep clean opening along the camera's bullet-time flight corridor
        let tooCloseToCam = false;
        for (let sample = 0; sample <= 12; sample++) {
          this.bulletCamCurve.getPoint(sample / 12, tmpPt);
          if (pos.distanceToSquared(tmpPt) < 2.8 * 2.8) {
            tooCloseToCam = true;
            break;
          }
        }
        if (tooCloseToCam) {
          pos.addScaledVector(unit, 3.6);
        }

        // Aim inward with a crisp vortex skim offset so the 720 resuming blades weave
        // into a blazing swirling starburst instead of colliding into one blown-out pixel!
        const toCore = focalCenter.clone().sub(pos).normalize();
        const swirlTangent = new THREE.Vector3().crossVectors(toCore, this._up);
        if (swirlTangent.lengthSq() < 1e-4) swirlTangent.set(1, 0, 0);
        else swirlTangent.normalize();
        const vortexAim = toCore
          .addScaledVector(swirlTangent, (sIdx % 2 === 0 ? 1 : -1) * 0.24)
          .normalize();

        const accentColor =
          i % 7 === 0 ? cCrimson : i % 5 === 0 ? cDeepCyan : cfg.col;
        const accentStreak =
          i % 7 === 0 ? sCrimson : i % 5 === 0 ? sIce : cfg.sCol;

        // Materialize from poles/equator in graceful wave
        const latOrder = (unit.y + 1) * 0.5;
        this.knives.push({
          layer: 'cage',
          spawnTime: cfg.startT + latOrder * cfg.spanT + (i % 12) * 0.03,
          appearDuration: 0.45,
          basePos: pos,
          aimDir: vortexAim,
          roll: (i / cfg.count) * Math.PI * 6,
          baseScale: cfg.scale + (rand() - 0.5) * 0.1,
          preludeVelocity: new THREE.Vector3(),
          resumeDelay: sIdx * 0.14 + (i % 5) * 0.025,
          resumeSpeed: cfg.speed + rand() * 3.0,
          resumeAccel: 20.0,
          swirlRate: 0.0,
          color: accentColor.clone(),
          streakColor: accentStreak.clone(),
          glintPhase: rand(),
        });
      }
    }

    // =========================================================================
    // LAYER 4: Astral Clock 12-Hour Sculpted Radial Fan Petals (480 knives)
    // 12 symmetrical blade fans aligned with Roman numerals I - XII!
    // Materializes clockwise around the clock face during 7.2s..11.6s.
    // =========================================================================
    const hours = 12;
    const tiers = 4;
    const fanPerTier = 10;
    for (let h = 0; h < hours; h++) {
      const hourAngle = Math.PI / 2 - (h / hours) * Math.PI * 2;
      for (let tier = 0; tier < tiers; tier++) {
        const tierR = 7.4 + tier * 3.1;
        const tierZ = -6.8 - tier * 1.45;
        for (let f = 0; f < fanPerTier; f++) {
          const fanOffset = ((f / (fanPerTier - 1)) - 0.5) * 0.34;
          const angle = hourAngle + fanOffset;
          const r = tierR + Math.sin((f / (fanPerTier - 1)) * Math.PI) * 1.45;
          const pos = new THREE.Vector3(
            Math.cos(angle) * r,
            Math.sin(angle) * r,
            tierZ + Math.cos(fanOffset * 8) * 0.75,
          );

          // Blades radiate forward-outward like gleaming silver clockwork wings
          const aimDir = new THREE.Vector3(
            Math.cos(angle + fanOffset * 0.35) * 0.72,
            Math.sin(angle + fanOffset * 0.35) * 0.72,
            0.7,
          ).normalize();

          const isCrimsonBand = tier === 1 || (h % 3 === 0 && f % 3 === 0);
          const col = isCrimsonBand ? cCrimson : tier % 2 === 0 ? cSilver : cIceBlue;
          const sCol = isCrimsonBand ? sCrimson : tier % 2 === 0 ? sSilver : sIce;

          this.knives.push({
            layer: 'clockFan',
            spawnTime: 5.0 + (h / hours) * 2.4 + tier * 0.16 + Math.abs(fanOffset) * 0.6,
            appearDuration: 0.32,
            basePos: pos,
            aimDir,
            roll: angle + Math.PI * 0.5,
            baseScale: 0.98 + tier * 0.08,
            preludeVelocity: new THREE.Vector3(),
            resumeDelay: tier * 0.07 + (h % 2) * 0.04,
            resumeSpeed: 16.5 + tier * 2.8,
            resumeAccel: 19.0,
            swirlRate: (tier % 2 === 0 ? 1 : -1) * 0.24,
            color: col.clone(),
            streakColor: sCol.clone(),
            glintPhase: rand(),
          });
        }
      }
    }

    // =========================================================================
    // LAYER 5: Curated Foreground Hero Showcase Blades (32 blades)
    // Placed inches beside the camera's bullet-time flight path at dramatic
    // oblique silhouettes so beveled silver faces & needle tips gleam in close-up!
    // =========================================================================
    const heroCount = 32;
    for (let i = 0; i < heroCount; i++) {
      const u = 0.06 + (i / (heroCount - 1)) * 0.78;
      this.bulletCamCurve.getPoint(u, tmpPt);
      this.bulletCamCurve.getTangent(u, tmpTan).normalize();
      tmpRight.crossVectors(tmpTan, this._up);
      if (tmpRight.lengthSq() < 1e-4) tmpRight.set(1, 0, 0);
      else tmpRight.normalize();
      tmpUp.crossVectors(tmpRight, tmpTan).normalize();

      // Alternate left/right/upper/lower framing around the lens at 1.35..2.35 clearance
      const sideSign = i % 2 === 0 ? 1 : -1;
      const diagAngle = (i * 2.39996) % (Math.PI * 2);
      const dist = 1.45 + (i % 4) * 0.26;
      const offsetRight = Math.cos(diagAngle) * dist * (0.7 + 0.3 * sideSign);
      const offsetUp = Math.sin(diagAngle) * dist * 0.78;

      const pos = tmpPt
        .clone()
        .addScaledVector(tmpRight, offsetRight)
        .addScaledVector(tmpUp, offsetUp);

      // Oblique cross-frame angle so the viewer sees the full profile + beveled spine + needle tip!
      const aimDir = tmpTan
        .clone()
        .multiplyScalar(0.32)
        .addScaledVector(tmpRight, -sideSign * 0.85)
        .addScaledVector(tmpUp, (i % 3 === 0 ? 0.36 : -0.28))
        .normalize();

      const isScarletHero = i % 4 === 1;
      this.knives.push({
        layer: 'hero',
        spawnTime: 2.8 + u * 2.0,
        appearDuration: 0.38,
        basePos: pos,
        aimDir,
        roll: 0.45 + (i % 5) * 0.42,
        baseScale: 1.18 + (i % 3) * 0.14,
        preludeVelocity: new THREE.Vector3(),
        resumeDelay: 0.02,
        resumeSpeed: 22.0 + rand() * 5.0,
        resumeAccel: 24.0,
        swirlRate: 0.15,
        color: isScarletHero ? cCrimson.clone() : i % 3 === 0 ? cIceBlue.clone() : cSilver.clone(),
        streakColor: isScarletHero ? sCrimson.clone() : sSilver.clone(),
        glintPhase: rand(),
      });
    }
  }

  /**
   * Computes deterministic integrated world time:
   * - 0.0s .. 3.2s: normal flow (rate 1.0, crisp deceleration at 3.12..3.22s)
   * - 3.2s .. 14.8s: FROZEN SOLID (rate 0.0!)
   * - 14.8s .. 22.0s: rapid explosive resume (rate ramps up to 1.35x!)
   */
  public computeWorldTime(t: number): { worldTime: number; timeStopFactor: number } {
    if (t <= TH06_TIME_STOP_AT) {
      const stopEase = smoothstep(TH06_TIME_STOP_AT - 0.18, TH06_TIME_STOP_AT, t);
      return {
        worldTime: t - stopEase * 0.06,
        timeStopFactor: stopEase,
      };
    }

    const frozenWorldTime = TH06_TIME_STOP_AT - 0.06;
    if (t < TH06_TIME_RESUME_AT) {
      // Hold strong frozen atmosphere, dip slightly right as reverse shock snaps in
      const resumeAnticipation = smoothstep(TH06_TIME_RESUME_AT - 0.22, TH06_TIME_RESUME_AT, t);
      return {
        worldTime: frozenWorldTime,
        timeStopFactor: 1.0 - resumeAnticipation * 0.35,
      };
    }

    const after = t - TH06_TIME_RESUME_AT;
    const resumeFade = 1 - smoothstep(0.0, 0.32, after);
    return {
      worldTime: frozenWorldTime + after * 1.32,
      timeStopFactor: resumeFade * 0.65,
    };
  }

  /**
   * Deterministic camera director choreography matching the 4-Act sequence.
   */
  public evaluateCamera(t: number, outPose: CameraPose): void {
    if (t < TH06_TIME_STOP_AT) {
      // Act 0: Smooth dramatic push-in while spiral blades launch from magic circles
      const p = smootherstep(0.0, TH06_TIME_STOP_AT, t);
      outPose.position.set(
        lerp(0.0, 6.2, p),
        lerp(1.9, 2.0, p),
        lerp(22.4, 16.4, p),
      );
      outPose.lookAt.set(lerp(0.0, 1.4, p), lerp(0.0, 0.1, p), lerp(-2.5, -0.5, p));
      outPose.roll = lerp(0.0, -0.05, p);
      outPose.fov = lerp(50, 48, p);
      outPose.shake = 0.0;
      return;
    }

    if (t < 3.4) {
      // Act 1: "THE WORLD!" Time-Stop impact snap + dramatic tilt into tunnel mouth
      const p = easeOutCubic((t - TH06_TIME_STOP_AT) / 1.0);
      outPose.position.set(
        lerp(6.2, 8.2, p),
        lerp(2.0, 1.8, p),
        lerp(16.4, 14.4, p),
      );
      outPose.lookAt.set(lerp(1.4, 2.2, p), lerp(0.1, 0.1, p), lerp(-0.5, 3.2, p));
      outPose.roll = lerp(-0.05, -0.11, p);
      outPose.fov = lerp(48, 45.5, p);
      const impact = Math.exp(-(t - TH06_TIME_STOP_AT) * 5.8);
      outPose.shake = impact * 0.36;
      return;
    }

    if (t < TH06_TIME_RESUME_AT) {
      // Act 2: Buttery-smooth Bullet-Time weave through 2,200+ frozen metallic blades!
      const rawU = (t - 3.4) / (TH06_TIME_RESUME_AT - 3.4);
      const u = clamp(lerp(rawU, smootherstep(0, 1, rawU), 0.35), 0, 1);

      this.bulletCamCurve.getPoint(u, outPose.position);
      this.bulletLookCurve.getPoint(u, outPose.lookAt);

      const rollWave =
        Math.sin(u * Math.PI * 2.0) * 0.18 * (1 - smoothstep(0.76, 1.0, u)) -
        0.11 * (1 - smoothstep(0.0, 0.25, u));
      outPose.roll = rollWave;
      outPose.fov = 45.5 + Math.sin(u * Math.PI) * 3.5;

      const preTension = smoothstep(TH06_TIME_RESUME_AT - 0.45, TH06_TIME_RESUME_AT, t);
      outPose.shake = preTension * 0.045;
      return;
    }

    // Act 3: TIME RESUMES! Explosive Dolly-Out + FOV kick + high-energy barrage burst
    const after = t - TH06_TIME_RESUME_AT;
    const p = clamp(after / (TH06_DURATION - TH06_TIME_RESUME_AT), 0, 1);
    const kick = easeOutExpo(clamp(after / 1.4, 0, 1));
    const drift = smootherstep(0, 1, p);

    outPose.position.set(
      Math.sin(drift * Math.PI * 0.85) * 4.2,
      lerp(1.4, 3.4, drift),
      18.8 + kick * 6.4 + drift * 7.8,
    );
    outPose.lookAt.set(0, lerp(0.0, 0.3, drift), lerp(-3.0, -1.5, drift));
    outPose.roll = Math.sin(drift * Math.PI) * 0.07;
    outPose.fov = 45.5 + kick * 13.5 - smoothstep(0.55, 1.0, p) * 4.5;

    // Punchy shockwave recoil shaking down cleanly over ~1.1s
    const burstShock = Math.exp(-after * 3.4);
    outPose.shake = burstShock * 0.48;
  }

  /**
   * Updates every instanced metallic throwing knife and velocity streak deterministically at time `t`.
   */
  public update(t: number, worldTime: number, timeStopFactor: number): void {
    // Update custom blade-glint shader uniforms
    const preResumeGlint =
      smoothstep(TH06_TIME_RESUME_AT - 1.2, TH06_TIME_RESUME_AT - 0.1, t) *
      (1 - smoothstep(TH06_TIME_RESUME_AT + 0.1, TH06_TIME_RESUME_AT + 0.7, t));
    const resumeBurstEnergy =
      smoothstep(TH06_TIME_RESUME_AT - 0.05, TH06_TIME_RESUME_AT + 0.25, t) *
      (1 - smoothstep(TH06_DURATION - 2.4, TH06_DURATION - 0.2, t));

    this.shaderUniforms.uTime.value = t;
    this.shaderUniforms.uFrozen.value = timeStopFactor;
    this.shaderUniforms.uGlintSweep.value = preResumeGlint;
    this.shaderUniforms.uBurstEnergy.value = resumeBurstEnergy;

    const outroFade = 1 - smoothstep(TH06_DURATION - 1.6, TH06_DURATION - 0.05, t);
    const afterResume = Math.max(0, t - TH06_TIME_RESUME_AT);

    for (let i = 0; i < this.knives.length; i++) {
      const k = this.knives[i];

      // Not yet materialized
      if (t < k.spawnTime) {
        this._mat4.makeScale(0, 0, 0);
        this.knifeMesh.setMatrixAt(i, this._mat4);
        this.streakMesh.setMatrixAt(i, this._mat4);
        continue;
      }

      const appearP = clamp((t - k.spawnTime) / k.appearDuration, 0, 1);
      const appearEase = easeOutCubic(appearP);

      // Compute exact deterministic position & velocity vector
      this._dir.copy(k.aimDir);
      let currentSpeed = 0;

      if (k.layer === 'prelude') {
        // Flies with worldTime before freeze, freezes solid during 3.2..14.8, surges after resume!
        const activeFlight = Math.max(0, Math.min(worldTime, TH06_TIME_STOP_AT) - k.spawnTime);
        this._pos.copy(k.basePos).addScaledVector(k.preludeVelocity, activeFlight);

        if (t < TH06_TIME_STOP_AT) {
          currentSpeed = k.preludeVelocity.length() * (1 - timeStopFactor);
        }

        if (afterResume > k.resumeDelay) {
          const bt = afterResume - k.resumeDelay;
          const dist = k.resumeSpeed * bt + 0.5 * k.resumeAccel * bt * bt;
          currentSpeed = k.resumeSpeed + k.resumeAccel * bt;
          this._pos.addScaledVector(this._dir, dist);
        }
      } else {
        // Frozen-time placed layers (tunnel, kill-cage, clock fans, foreground hero blades)
        this._pos.copy(k.basePos);

        // Crisp materialization slide-in along blade axis (0.45 units back -> exact lock-in)
        if (appearP < 1) {
          const slideBack = (1 - appearEase) * 1.1;
          this._pos.addScaledVector(this._dir, -slideBack);
        }

        // Tiny anticipation recoil right before Time Resumes
        if (t > TH06_TIME_RESUME_AT - 0.35 && t < TH06_TIME_RESUME_AT) {
          const cockBack = smoothstep(TH06_TIME_RESUME_AT - 0.35, TH06_TIME_RESUME_AT, t) * 0.24;
          this._pos.addScaledVector(this._dir, -cockBack);
        }

        if (afterResume > k.resumeDelay) {
          const bt = afterResume - k.resumeDelay;
          const dist = k.resumeSpeed * bt + 0.5 * k.resumeAccel * bt * bt;
          currentSpeed = k.resumeSpeed + k.resumeAccel * bt;

          if (k.swirlRate !== 0) {
            // Subtle cyclone twist as tunnel & clock wings erupt outward
            const twist = k.swirlRate * bt;
            this._tangent.copy(this._dir).applyAxisAngle(this._up, twist * 0.45).normalize();
            this._pos.addScaledVector(this._tangent, dist);
            this._dir.copy(this._tangent);
          } else {
            this._pos.addScaledVector(this._dir, dist);
          }
        }
      }

      // Cull blades that flew far past the arena after burst
      const distSq = this._pos.lengthSq();
      if (distSq > 95 * 95 || outroFade <= 0.001) {
        this._mat4.makeScale(0, 0, 0);
        this.knifeMesh.setMatrixAt(i, this._mat4);
        this.streakMesh.setMatrixAt(i, this._mat4);
        continue;
      }

      // Subtle roll animation on spawn lock-in & high-speed spin on resume
      const spawnSpin = (1 - appearEase) * Math.PI * 0.65;
      const burstSpin = afterResume > k.resumeDelay ? (afterResume - k.resumeDelay) * 3.2 : 0;
      const roll = k.roll + spawnSpin + burstSpin;

      orientForwardWithRoll(this._dir, roll, this._quat);

      const farFade = 1 - smoothstep(68 * 68, 95 * 95, distSq);
      const scaleScalar = k.baseScale * (0.2 + 0.8 * appearEase) * outroFade * farFade;
      this._scale.setScalar(scaleScalar);
      this._mat4.compose(this._pos, this._quat, this._scale);
      this.knifeMesh.setMatrixAt(i, this._mat4);

      // Velocity streak lance (invisible during frozen time, ignites dynamically with speed!)
      const streakFactor = clamp((currentSpeed - 1.5) / 14.0, 0, 1);
      if (streakFactor > 0.02) {
        const streakLen = (0.4 + easeInQuart(clamp(streakFactor, 0, 1)) * 1.4 + streakFactor * 1.1) * scaleScalar;
        const streakWidth = (0.75 + streakFactor * 0.65) * scaleScalar;
        this._scale.set(streakWidth, streakWidth, streakLen);
        this._mat4.compose(this._pos, this._quat, this._scale);
        this.streakMesh.setMatrixAt(i, this._mat4);
      } else {
        this._mat4.makeScale(0, 0, 0);
        this.streakMesh.setMatrixAt(i, this._mat4);
      }
    }

    this.knifeMesh.instanceMatrix.needsUpdate = true;
    this.streakMesh.instanceMatrix.needsUpdate = true;

    // Suppress unused helper warnings
    void this._side;
    void this._perp;
  }

  public dispose(): void {
    this.knifeGeom.dispose();
    this.knifeMat.dispose();
    this.streakGeom.dispose();
    this.streakMat.dispose();
  }
}
