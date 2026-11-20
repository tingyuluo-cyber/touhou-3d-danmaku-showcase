import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { PostFXState } from '../spells/types';

const CinemaFXShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAspect: { value: 16 / 9 },
    uTime: { value: 0 },
    uTimeStop: { value: 0 },
    uWaveRadius: { value: -1 },
    uWaveWidth: { value: 0.14 },
    uWaveInvert: { value: 0 },
    uWaveDistort: { value: 0 },
    uChromatic: { value: 0.0016 },
    uFlash: { value: 0 },
    uVignette: { value: 0.38 },
    uLensStrength: { value: 0 },
    uLensRadius: { value: 0.16 },
    uLensCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uHeatHaze: { value: 0 },
    uWarmGrade: { value: 0 },
    uMirrorSplit: { value: 0 },
    uStageFade: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAspect;
    uniform float uTime;
    uniform float uTimeStop;
    uniform float uWaveRadius;
    uniform float uWaveWidth;
    uniform float uWaveInvert;
    uniform float uWaveDistort;
    uniform float uChromatic;
    uniform float uFlash;
    uniform float uVignette;
    uniform float uLensStrength;
    uniform float uLensRadius;
    uniform vec2 uLensCenter;
    uniform float uHeatHaze;
    uniform float uWarmGrade;
    uniform float uMirrorSplit;
    uniform float uStageFade;

    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 centered = vUv - 0.5;
      vec2 aspectVec = vec2(centered.x * uAspect, centered.y);
      float dist = length(aspectVec);
      vec2 dir = dist > 0.0001 ? aspectVec / dist : vec2(0.0);

      // Expanding Time-Stop refractive shockwave ring (avoid pow on negative values!)
      float waveDelta = dist - uWaveRadius;
      float waveNorm = waveDelta / max(uWaveWidth, 0.001);
      float ringProfile = exp(-(waveNorm * waveNorm));
      float innerWaveMask = smoothstep(uWaveRadius + uWaveWidth * 0.35, uWaveRadius - uWaveWidth * 0.6, dist);

      // Subtle lens displacement on shockwave crest
      vec2 uv = vUv;
      float seamGlow = 0.0;
      if (uMirrorSplit > 0.001) {
        // TH14 Reverse Ideology: tear screen diagonally/horizontally into inverted mirrored half-space
        float diag = (vUv.x - 0.5) * 0.35 + (vUv.y - 0.5);
        float seamDist = abs(diag);
        seamGlow = exp(-(seamDist * seamDist) / 0.00018) * uMirrorSplit;
        if (diag < 0.0) {
          vec2 mirrored = vec2(1.0 - vUv.x, 1.0 - vUv.y);
          uv = mix(vUv, mirrored, uMirrorSplit);
        }
      }
      if (uWaveDistort > 0.0001) {
        vec2 offset = vec2(dir.x / uAspect, dir.y) * ringProfile * uWaveDistort * sin(waveDelta * 36.0);
        uv -= offset;
      }

      // Gravitational lensing + thermal heat-haze refraction (TH11 Subterranean Sun & Prototype 4)
      float einsteinRing = 0.0;
      if (uLensStrength > 0.0001 || uHeatHaze > 0.0001) {
        vec2 toLens = vUv - uLensCenter;
        vec2 lensAspect = vec2(toLens.x * uAspect, toLens.y);
        float lDist = length(lensAspect);
        vec2 lDir = lDist > 0.0001 ? lensAspect / lDist : vec2(0.0);

        if (uLensStrength > 0.0001) {
          float rNorm = (lDist - uLensRadius) / max(uLensRadius * 0.62, 0.02);
          float ringMask = exp(-(rNorm * rNorm));
          float outerFalloff = smoothstep(uLensRadius * 0.55, uLensRadius * 1.08, lDist)
                             * (1.0 - smoothstep(uLensRadius * 1.1, uLensRadius * 3.2, lDist));
          float bend = (ringMask * 0.038 + outerFalloff * 0.018) * uLensStrength;
          uv -= vec2(lDir.x / uAspect, lDir.y) * bend;
          einsteinRing = ringMask * uLensStrength;
        }

        if (uHeatHaze > 0.0001) {
          float hazeZone = smoothstep(uLensRadius * 0.55, uLensRadius * 1.0, lDist)
                         * (1.0 - smoothstep(uLensRadius * 1.35, uLensRadius * 3.6, lDist));
          float wx = sin(vUv.y * 46.0 - uTime * 7.5 + vUv.x * 16.0)
                   + 0.5 * cos(vUv.y * 82.0 - uTime * 11.2 - vUv.x * 24.0);
          float wy = cos(vUv.x * 42.0 - uTime * 6.8 + vUv.y * 18.0);
          uv += vec2(wx, wy) * (0.0042 * uHeatHaze * (0.35 + hazeZone * 1.35));
        }
      }

      // Edge-weighted + shockwave-boosted + gravity-boosted chromatic aberration
      float caAmount = uChromatic * (0.35 + dist * 1.35)
                     + ringProfile * uWaveDistort * 0.45
                     + einsteinRing * 0.0045;
      vec2 caShift = vec2(dir.x / uAspect, dir.y) * caAmount;

      float r = texture2D(tDiffuse, clamp(uv + caShift, 0.001, 0.999)).r;
      float g = texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).g;
      float b = texture2D(tDiffuse, clamp(uv - caShift, 0.001, 0.999)).b;
      vec3 col = vec3(r, g, b);

      // Subtle incandescent Einstein refraction rim
      if (einsteinRing > 0.001) {
        col += vec3(1.0, 0.56, 0.18) * einsteinRing * 0.24;
      }

      // Iconic "The World" color-inversion wave band
      if (uWaveInvert > 0.001) {
        vec3 inverted = vec3(1.0) - col;
        // Shift inverted wave slightly cool violet-cyan so it feels astral rather than harsh raw negative
        inverted *= vec3(0.86, 0.92, 1.08);
        float invertMask = clamp(ringProfile * 0.92 + innerWaveMask * 0.38, 0.0, 1.0) * uWaveInvert;
        col = mix(col, inverted, invertMask);
        // Bright electric silver edge highlight along the wave rim
        col += vec3(0.45, 0.78, 1.15) * ringProfile * uWaveInvert * 0.42;
      }

      // Time-Stop nocturnal silver-cyan grading with selective crimson/ice highlight retention
      if (uTimeStop > 0.001) {
        float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
        float maxC = max(col.r, max(col.g, col.b));
        float minC = min(col.r, min(col.g, col.b));
        float chroma = maxC - minC;
        // Preserve vivid scarlet & cold blue blade accents while turning midtones eerie frozen steel
        float keepColor = smoothstep(0.12, 0.48, chroma) * 0.62;
        vec3 frozenTone = vec3(luma * 0.80, luma * 0.90, luma * 1.08);
        // Preserve deep obsidian blacks and crisp metallic highlights
        frozenTone = pow(max(frozenTone, vec3(0.0001)), vec3(1.06));
        col = mix(col, mix(frozenTone, col, keepColor), uTimeStop * 0.78);
      }

      // Scorching thermal warm-contrast grade (used during TH11 solar flare climax)
      if (uWarmGrade > 0.001) {
        vec3 warm = vec3(col.r * 1.08, col.g * 0.98, col.b * 0.88);
        col = mix(col, warm, uWarmGrade);
      }

      // Snap flash impulse on Time Stop / Time Resume
      if (uFlash > 0.001) {
        col += vec3(0.76, 0.9, 1.0) * uFlash;
      }

      // Crimson fault-line glow during TH14 mirror-space tear
      if (seamGlow > 0.001) {
        col += vec3(1.1, 0.16, 0.36) * seamGlow * 1.1;
      }

      // Aspect-balanced cinematic vignette (equally refined on 16:9 landscape & 9:16 portrait!)
      float vig = smoothstep(0.68, 1.62, length(centered * 2.0));
      col *= 1.0 - vig * uVignette;

      // Ultra-subtle film grain (prevents dark banding in video compression)
      float grain = (hash12(vUv * vec2(1280.0, 720.0) + fract(uTime * 17.3)) - 0.5) * 0.014;
      col = max(col + grain, 0.0);

      // Silky global dip-to-black curtain for cohesive spell-to-spell pacing
      col *= clamp(uStageFade, 0.0, 1.0);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostProcessingPipeline {
  public readonly composer: EffectComposer;
  public readonly bloomPass: UnrealBloomPass;
  public readonly cinemaPass: ShaderPass;
  private readonly renderTarget: THREE.WebGLRenderTarget;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
  ) {
    const pixelRatio = renderer.getPixelRatio();
    const rtWidth = Math.max(1, Math.floor(width * pixelRatio));
    const rtHeight = Math.max(1, Math.floor(height * pixelRatio));

    this.renderTarget = new THREE.WebGLRenderTarget(rtWidth, rtHeight, {
      type: THREE.HalfFloatType,
      samples: renderer.capabilities.isWebGL2 ? 4 : 0,
    });

    this.composer = new EffectComposer(renderer, this.renderTarget);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);

    const renderPass = new RenderPass(scene, camera);
    this.composer.addPass(renderPass);

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.58, 0.48, 0.8);
    this.composer.addPass(this.bloomPass);

    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);

    this.cinemaPass = new ShaderPass(CinemaFXShader);
    this.cinemaPass.uniforms.uAspect.value = width / Math.max(1, height);
    this.composer.addPass(this.cinemaPass);
  }

  public applyState(state: PostFXState, time: number): void {
    this.bloomPass.strength = state.bloomStrength;
    this.bloomPass.radius = state.bloomRadius;
    this.bloomPass.threshold = state.bloomThreshold;

    const u = this.cinemaPass.uniforms;
    u.uTime.value = time;
    u.uTimeStop.value = state.timeStopFactor;
    u.uWaveRadius.value = state.waveRadius;
    u.uWaveWidth.value = state.waveWidth;
    u.uWaveInvert.value = state.waveInvert;
    u.uWaveDistort.value = state.waveDistort;
    u.uChromatic.value = state.chromatic;
    u.uFlash.value = state.flash;
    u.uVignette.value = state.vignette;
    u.uLensStrength.value = state.lensStrength;
    u.uLensRadius.value = state.lensRadius;
    u.uLensCenter.value.set(state.lensCenterX, state.lensCenterY);
    u.uHeatHaze.value = state.heatHaze;
    u.uWarmGrade.value = state.warmGrade;
    u.uMirrorSplit.value = state.mirrorSplit;
    u.uStageFade.value = state.stageFade;
  }

  public setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.bloomPass.resolution.set(width, height);
    this.cinemaPass.uniforms.uAspect.value = width / Math.max(1, height);
  }

  public render(): void {
    this.composer.render();
  }

  public dispose(): void {
    this.bloomPass.dispose();
    this.renderTarget.dispose();
    this.composer.dispose();
  }
}
