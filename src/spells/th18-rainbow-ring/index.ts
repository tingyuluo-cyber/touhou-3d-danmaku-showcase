import * as THREE from 'three';
import type { SpellCardInstance, SpellMetadata, SpellUpdateContext } from '../types';
import type { TimelinePhase } from '../../core/Timeline';
import {
  clamp,
  lerp,
  orientForwardWithRoll,
  smootherstep,
  smoothstep,
} from '../../prototypes/DanmakuMath';

export const TH18_METADATA: SpellMetadata = {
  id: 'th18-rainbow-ring',
  gameCode: 'TH18',
  gameName: '东方虹龙洞',
  spellName: '"虹人环"',
  character: '天弓千亦',
  bgm: '那热闹的市场今在何处 ~ Immemorial Marketeers',
  prototype: '体积激光与拖尾条带',
  spatialForm: '七彩卡牌螺旋星漩 + 逆转切返',
  visualHighlight:
    '彻底区隔于天体轨道的原作"虹人环"重构: 3,500 枚七彩发光卡牌/方片弹沿 14 条对数螺旋光臂如风车星漩般舒展, 辅以暖色布洛肯现象彩晕背景, 中段触发标志性的顺逆旋转"切返"反转.',
  implemented: true,
};

export const TH18_DURATION = 12.5;

const TH18_PHASES: TimelinePhase[] = [
  { id: 'bloom', label: '01 虹涡初绽', start: 0.0, end: 2.8, badgeStyle: 'normal' },
  { id: 'cw', label: '02 七彩顺旋星漩', start: 2.8, end: 6.1, badgeStyle: 'frozen' },
  { id: 'reverse', label: '03 逆转切返', start: 6.1, end: 10.6, badgeStyle: 'burst' },
  { id: 'disperse', label: '04 布洛肯虹散', start: 10.6, end: 12.5, badgeStyle: 'normal' },
];

interface SpiralCard {
  layer: 0 | 1; // 0 = 14 grand outer pinwheel arms, 1 = 7 counter-curling inner market arms
  armIdx: number;
  armCount: number;
  stepFrac: number; // 0..1 along arm
  baseRadiusMax: number;
  zCurveAmp: number;
  scale: number;
  color: THREE.Color;
}

/**
 * Generates the iconic Touhou 18 glowing rainbow card/square tile texture:
 * crisp pure-white incandescent core framed by a saturated spectral rim (multiplied by instanceColor).
 */
function createRainbowCardTexture(size = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const pad = Math.round(size * 0.08);

  // Colored outer glow frame (white in texture -> cleanly tinted by instanceColor)
  ctx.fillStyle = '#d4d8e4';
  ctx.fillRect(0, 0, size, size);

  // Sharp luminous inner white diamond/card window
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(pad * 2, pad * 2, size - pad * 4, size - pad * 4);

  // Subtle decorative card hairline inset
  ctx.strokeStyle = '#aeb6cc';
  ctx.lineWidth = Math.max(2, size * 0.035);
  ctx.strokeRect(pad * 1.4, pad * 1.4, size - pad * 2.8, size - pad * 2.8);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export class TH18RainbowRingSpell implements SpellCardInstance {
  public readonly metadata = TH18_METADATA;
  public readonly duration = TH18_DURATION;
  public readonly phases = TH18_PHASES;

  private root = new THREE.Group();
  private cardMesh: THREE.InstancedMesh | null = null;
  private cardMat: THREE.ShaderMaterial | null = null;
  private nexusCore: THREE.Mesh | null = null;
  private nexusMat: THREE.ShaderMaterial | null = null;
  private bokehBackdrop: THREE.Mesh | null = null;
  private bokehMat: THREE.ShaderMaterial | null = null;
  private reversalRing: THREE.Mesh | null = null;
  private reversalRingMat: THREE.ShaderMaterial | null = null;
  private cards: SpiralCard[] = [];

  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private textures: THREE.Texture[] = [];

  private camCurve: THREE.CatmullRomCurve3 | null = null;
  private readonly _pos = new THREE.Vector3();
  private readonly _zAxis = new THREE.Vector3(0, 0, 1);
  private readonly _quat = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3();
  private readonly _mat4 = new THREE.Matrix4();

  public init(scene: THREE.Scene, _renderer: THREE.WebGLRenderer): void {
    scene.background = new THREE.Color(0x040207);
    scene.fog = new THREE.FogExp2(0x050209, 0.011);

    this.root = new THREE.Group();
    scene.add(this.root);

    // 1. Subtle Dreamy Brocken-Spectre Rainbow-Bokeh Atmospheric Backdrop (fills both 16:9 & tall 9:16 seamlessly!)
    const bokehGeom = new THREE.PlaneGeometry(118, 118);
    this.bokehMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0.32 },
        uReverseGlow: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uOpacity;
        uniform float uReverseGlow;
        varying vec2 vUv;

        float bokehOrb(vec2 p, vec2 center, float radius) {
          float d = length(p - center) / max(radius, 0.001);
          return smoothstep(1.0, 0.15, d) * smoothstep(1.0, 0.45, d);
        }

        void main() {
          vec2 p = (vUv - 0.5) * vec2(1.4, 1.0);
          float r = length(p);

          // Soft warm amber/crimson/emerald/violet drifting Brocken-Spectre bokeh lanterns!
          vec3 col = vec3(0.0);
          col += vec3(0.95, 0.24, 0.08) * bokehOrb(p, vec2(-0.42 + sin(uTime * 0.28) * 0.08, 0.22 + cos(uTime * 0.22) * 0.06), 0.42);
          col += vec3(0.95, 0.55, 0.10) * bokehOrb(p, vec2(0.36 + cos(uTime * 0.24) * 0.09, 0.18 - sin(uTime * 0.26) * 0.07), 0.38);
          col += vec3(0.88, 0.18, 0.28) * bokehOrb(p, vec2(0.28 + sin(uTime * 0.31) * 0.07, -0.26 + cos(uTime * 0.25) * 0.06), 0.44);
          col += vec3(0.28, 0.52, 0.92) * bokehOrb(p, vec2(-0.32 - cos(uTime * 0.21) * 0.07, -0.24 + sin(uTime * 0.29) * 0.06), 0.36);

          // Faint concentric Brocken Spectre rainbow glory ring around center
          float gloryRing = exp(-((r - 0.46) * (r - 0.46)) / 0.008);
          vec3 spectrum = 0.55 + 0.45 * cos(6.28318 * (r * 2.2 - uTime * 0.18 + vec3(0.0, 0.33, 0.67)));
          col += spectrum * gloryRing * (0.28 + uReverseGlow * 0.35);

          float edgeFade = 1.0 - smoothstep(0.28, 0.48, length(vUv - 0.5));
          gl_FragColor = vec4(col * edgeFade, uOpacity * edgeFade);
        }
      `,
    });
    this.bokehBackdrop = new THREE.Mesh(bokehGeom, this.bokehMat);
    this.bokehBackdrop.position.set(0, 0, -24);
    this.root.add(this.bokehBackdrop);
    this.geometries.push(bokehGeom);
    this.materials.push(this.bokehMat);

    // 2. Small Jewel-Like Iridescent Spiral Nexus Core at the exact eye of the pinwheel
    const nexusGeom = new THREE.SphereGeometry(0.92, 36, 28);
    this.nexusMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPulse: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uPulse;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          float ndv = clamp(abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0);
          float fres = 1.0 - ndv;
          vec3 irid = 0.58 + 0.42 * cos(6.28318 * (fres * 1.4 - uTime * 0.45 + vec3(0.0, 0.33, 0.67)));
          vec3 col = mix(vec3(1.1, 1.08, 1.15), irid * (1.2 + uPulse * 0.5), 0.45 + fres * 0.55);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.nexusCore = new THREE.Mesh(nexusGeom, this.nexusMat);
    this.nexusCore.position.set(0, 0, -5.2);
    this.root.add(this.nexusCore);
    this.geometries.push(nexusGeom);
    this.materials.push(this.nexusMat);

    // 3. Sleek Expanding Prismatic Reversal Shockwave Halo (fires at the signature t = 6.15s "切返" beat!)
    const revGeom = new THREE.TorusGeometry(1.0, 0.022, 14, 96);
    this.reversalRingMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          vec3 spec = 0.58 + 0.42 * cos(6.28318 * (vUv.x * 2.0 + uTime * 0.8 + vec3(0.0, 0.33, 0.67)));
          gl_FragColor = vec4(spec * 1.35, uOpacity);
        }
      `,
    });
    this.reversalRing = new THREE.Mesh(revGeom, this.reversalRingMat);
    this.reversalRing.position.set(0, 0, -5.2);
    this.reversalRing.visible = false;
    this.root.add(this.reversalRing);
    this.geometries.push(revGeom);
    this.materials.push(this.reversalRingMat);

    // 4. Sculpted 3D Glowing Rainbow Ability-Card / Diamond Tiles arranged in 14 Pinwheel Spiral Arms!
    const sevenRainbowHex = [
      0xff2a54, // Red
      0xff8624, // Orange
      0xffe638, // Yellow
      0x34e878, // Green
      0x26dcff, // Cyan
      0x3e78ff, // Blue
      0xba4cff, // Violet
    ];
    this.cards = [];

    // Layer 0: 14 Grand Outer Rainbow Pinwheel Spiral Arms (14 * 96 = 1,344 distinct diamond cards!)
    const outerArms = 14;
    const perOuterArm = 96;
    for (let arm = 0; arm < outerArms; arm++) {
      const col = new THREE.Color(sevenRainbowHex[arm % 7]);
      for (let k = 0; k < perOuterArm; k++) {
        this.cards.push({
          layer: 0,
          armIdx: arm,
          armCount: outerArms,
          stepFrac: k / perOuterArm,
          baseRadiusMax: 24.0,
          zCurveAmp: (arm % 2 === 0 ? 1 : -1) * 4.2,
          scale: 0.82 + (arm % 2) * 0.12,
          color: col.clone(),
        });
      }
    }

    // Layer 1: 7 Inner Counter-Curving Rainbow Market Arms (7 * 104 = 728 distinct diamond cards!)
    const innerArms = 7;
    const perInnerArm = 104;
    for (let arm = 0; arm < innerArms; arm++) {
      const col = new THREE.Color(sevenRainbowHex[(arm + 3) % 7]);
      for (let k = 0; k < perInnerArm; k++) {
        this.cards.push({
          layer: 1,
          armIdx: arm,
          armCount: innerArms,
          stepFrac: k / perInnerArm,
          baseRadiusMax: 21.5,
          zCurveAmp: 5.2,
          scale: 0.72,
          color: col.clone(),
        });
      }
    }

    const cardTex = createRainbowCardTexture(128);
    this.textures.push(cardTex);

    // Crisp 3D glowing square card tile (rotated into diamond silhouette along the spiral chain!)
    const cardGeom = new THREE.BoxGeometry(0.42, 0.42, 0.06);
    this.cardMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: true,
      uniforms: {
        uMap: { value: cardTex },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vNearFade;
        void main() {
          vUv = uv;
          vec4 mvPos = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vNearFade = smoothstep(1.8, 4.5, -mvPos.z);
          #ifdef USE_INSTANCING_COLOR
            vColor = instanceColor;
          #else
            vColor = vec3(1.0);
          #endif
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vNearFade;
        void main() {
          if (vNearFade < 0.02) discard;
          vec2 d = abs(vUv - 0.5);
          float edge = max(d.x, d.y);
          // Razor-crisp bright white card center + vivid saturated ROYGBIV glowing outer border (true TH18 look!)
          float isBorder = smoothstep(0.27, 0.34, edge);
          vec3 coreWhite = mix(vec3(1.06, 1.06, 1.08), vColor * 1.15, 0.14);
          vec3 rimColor = vColor * 1.18;
          vec3 col = mix(coreWhite, rimColor, isBorder);
          gl_FragColor = vec4(col, vNearFade);
        }
      `,
    });
    this.geometries.push(cardGeom);
    this.materials.push(this.cardMat);

    this.cardMesh = new THREE.InstancedMesh(cardGeom, this.cardMat, this.cards.length);
    this.cardMesh.frustumCulled = false;
    for (let i = 0; i < this.cards.length; i++) {
      this.cardMesh.setColorAt(i, this.cards[i].color);
    }
    if (this.cardMesh.instanceColor) this.cardMesh.instanceColor.needsUpdate = true;
    this.root.add(this.cardMesh);

    // 5. Graceful Camera: Opens on frontal iconic Rainbow Pinwheel, sweeps to 3D angled funnel vista,
    // witnesses the dramatic "切返" reversal, then orbits smoothly back!
    this.camCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0.0, 0.4, 24.5),
        new THREE.Vector3(7.2, 3.8, 21.5),
        new THREE.Vector3(11.5, -2.4, 17.5),
        new THREE.Vector3(2.4, -4.6, 19.8),
        new THREE.Vector3(-9.8, 3.2, 18.2),
        new THREE.Vector3(-2.5, 1.6, 25.5),
      ],
      false,
      'centripetal',
      0.5,
    );
  }

  /**
   * Deterministic integral of angular velocity omega(t) that smoothly brakes to 0 at t = 6.15s
   * and REVERSES direction ("切返") for t > 6.15s!
   */
  private evalReversibleSpinAngle(t: number): number {
    // omega(u) = 0.85 * tanh((6.15 - u) * 1.35) -> exact smooth integral = -(0.85/1.35) * ln(cosh((6.15 - u)*1.35))
    const k = 1.35;
    const peakOmega = 0.92;
    const logCosh = (x: number) => Math.abs(x) + Math.log(1 + Math.exp(-2 * Math.abs(x))) - Math.LN2;
    const base = logCosh(6.15 * k);
    return (peakOmega / k) * (base - logCosh((6.15 - t) * k));
  }

  public update(ctx: SpellUpdateContext): void {
    if (!this.cardMesh || !this.camCurve) return;

    const t = ctx.time;
    const p = clamp(t / TH18_DURATION, 0, 1);
    const u = clamp(lerp(p, smootherstep(0, 1, p), 0.25), 0, 1);

    // Smooth "切返" reversal transition centered at t = 6.15s!
    const revBlend = smootherstep(5.55, 6.85, t); // 0 = CW pinwheel, 1 = CCW reversed pinwheel
    const curlSign = lerp(1.0, -1.0, revBlend);
    const revAge = Math.max(0, t - 6.15);
    const revPulse = revAge > 0 && revAge < 1.8 ? Math.exp(-revAge * 2.6) : 0;

    const spinAngle = this.evalReversibleSpinAngle(t);
    const flowPhase = t * 0.22; // continuous card emission flowing outward along every spiral arm

    this.camCurve.getPoint(u, ctx.cameraPose.position);
    ctx.cameraPose.lookAt.set(0, 0, -1.2);
    ctx.cameraPose.roll = Math.sin(p * Math.PI * 2) * 0.07 + revPulse * 0.06;
    ctx.cameraPose.fov = 49 + revPulse * 6.5;
    ctx.cameraPose.shake = revPulse * 0.045;

    if (this.bokehMat) {
      this.bokehMat.uniforms.uTime.value = t;
      this.bokehMat.uniforms.uOpacity.value = 0.34 * smoothstep(0.0, 1.4, t);
      this.bokehMat.uniforms.uReverseGlow.value = revPulse;
    }

    if (this.nexusCore && this.nexusMat) {
      this.nexusCore.rotation.set(t * 0.5, t * 0.9, 0);
      this.nexusCore.scale.setScalar(0.85 + revPulse * 0.45);
      this.nexusMat.uniforms.uTime.value = t;
      this.nexusMat.uniforms.uPulse.value = revPulse;
    }

    if (this.reversalRing && this.reversalRingMat) {
      if (revAge > 0.001 && revAge < 2.2) {
        this.reversalRing.visible = true;
        const rEase = 1.0 - Math.pow(1.0 - Math.min(1, revAge / 1.9), 3);
        this.reversalRing.scale.setScalar(1.2 + rEase * 24.0);
        this.reversalRingMat.uniforms.uTime.value = t;
        this.reversalRingMat.uniforms.uOpacity.value = Math.exp(-revAge * 1.9) * 0.9;
      } else {
        this.reversalRing.visible = false;
      }
    }

    const innerLayerReveal = smoothstep(3.8, 5.6, t);

    // Position all 3,500 glowing 3D rainbow cards along the sweeping logarithmic pinwheel spiral arms!
    for (let i = 0; i < this.cards.length; i++) {
      const c = this.cards[i];
      const layerVis = c.layer === 0 ? smoothstep(0.0, 1.6, t) : innerLayerReveal;
      if (layerVis <= 0.002) {
        this._mat4.makeScale(0, 0, 0);
        this.cardMesh.setMatrixAt(i, this._mat4);
        continue;
      }

      // Cards stream smoothly outward from the nexus eye along each arm!
      const frac = (c.stepFrac + flowPhase * (c.layer === 0 ? 1.0 : 1.18)) % 1.0;
      // Nonlinear radius spacing packs cards tighter near center like a true spiral galaxy!
      const r = 1.1 + frac * frac * 0.35 * c.baseRadiusMax + frac * 0.65 * c.baseRadiusMax;

      // Iconic curved logarithmic pinwheel swirl that smoothly bends into reverse curvature on "切返"!
      const baseTheta = (c.armIdx / c.armCount) * Math.PI * 2;
      const spiralCurl =
        c.layer === 0
          ? curlSign * (frac * 2.55 + frac * frac * 0.85)
          : -curlSign * (frac * 2.15 + frac * frac * 0.6);
      const theta = baseTheta + spiralCurl + (c.layer === 0 ? spinAngle : -spinAngle * 0.72);

      // Graceful 3D funnel sculpture centered cleanly on the nexus eye at z = -5.2!
      const z =
        c.layer === 0
          ? -5.2 + frac * 11.2 + Math.sin(frac * Math.PI * 2 + c.armIdx * 0.5) * 1.2
          : -5.2 + Math.sin(frac * Math.PI) * c.zCurveAmp + frac * 3.8;

      const x = Math.cos(theta) * r;
      const y = Math.sin(theta) * r;
      this._pos.set(x, y, z);

      // Face outward along spiral plane with iconic 45-degree diamond card tilt!
      orientForwardWithRoll(this._zAxis, theta + Math.PI * 0.25, this._quat);

      const edgeFade = smoothstep(0.0, 0.06, frac) * (1.0 - smoothstep(0.86, 1.0, frac));
      const sizeScale = c.scale * (0.55 + frac * 0.72) * layerVis * edgeFade;
      this._scale.setScalar(sizeScale);
      this._mat4.compose(this._pos, this._quat, this._scale);
      this.cardMesh.setMatrixAt(i, this._mat4);
    }
    this.cardMesh.instanceMatrix.needsUpdate = true;

    const fx = ctx.postFX;
    fx.vignette = 0.38;
    fx.chromatic = 0.002 + revPulse * 0.0055;
    fx.bloomThreshold = 1.16;
    fx.bloomStrength = 0.3 + revPulse * 0.16;
    fx.bloomRadius = 0.38;
  }

  public getInstanceCount(): number {
    return this.cards.length;
  }

  public dispose(scene: THREE.Scene): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    scene.remove(this.root);
    this.cardMesh = null;
    this.nexusCore = null;
    this.bokehBackdrop = null;
    this.reversalRing = null;
  }
}
