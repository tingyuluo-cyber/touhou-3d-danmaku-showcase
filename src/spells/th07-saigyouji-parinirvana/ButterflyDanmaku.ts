import * as THREE from 'three';
import {
  createBokehPetalTexture,
  createButterflyBulletGeometry,
  createSakuraPetalGeometry,
} from './ButterflyGeometry';
import {
  clamp,
  createSeededRandom,
  easeOutCubic,
  orientForwardWithRoll,
  smoothstep,
} from '../../prototypes/DanmakuMath';

interface ButterflySpec {
  spawnTime: number;
  waveDir: number; // +1 clockwise / -1 counter-clockwise
  azimuth: number;
  elevation: number;
  speed: number;
  swirlRate: number;
  petalK: number; // Rose curve petal harmonic
  scale: number;
  phase: number;
  color: THREE.Color;
}

interface PetalSpec {
  basePos: THREE.Vector3;
  driftVel: THREE.Vector3;
  spinAxis: THREE.Vector3;
  spinSpeed: number;
  scale: number;
  phase: number;
  color: THREE.Color;
}

/**
 * Manages TH07's 3 organic danmaku layers:
 * 1. 1,650 GPU-flapping 3D Butterfly bullets in authentic counter-rotating crimson/cyan waves
 * 2. 1,350 tumbling cupped 3D Sakura petals riding laminar wind currents
 * 3. 260 foreground shallow-DOF Bokeh cherry blossoms floating softly across the camera lens
 */
export class ButterflyDanmaku {
  public readonly root = new THREE.Group();
  public readonly butterflyMesh: THREE.InstancedMesh;
  public readonly petalMesh: THREE.InstancedMesh;
  public readonly bokehPoints: THREE.Points;

  private readonly butterflies: ButterflySpec[] = [];
  private readonly petals: PetalSpec[] = [];
  private readonly bokehCount = 260;

  private readonly butterflyGeom: THREE.BufferGeometry;
  private readonly butterflyMat: THREE.ShaderMaterial;
  private readonly petalGeom: THREE.BufferGeometry;
  private readonly petalMat: THREE.MeshStandardMaterial;
  private readonly bokehGeom: THREE.BufferGeometry;
  private readonly bokehMat: THREE.ShaderMaterial;
  private readonly bokehTex: THREE.CanvasTexture;

  private readonly _pos = new THREE.Vector3();
  private readonly _vel = new THREE.Vector3();
  private readonly _quat = new THREE.Quaternion();
  private readonly _spinQuat = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3();
  private readonly _mat4 = new THREE.Matrix4();

  constructor() {
    const rand = createSeededRandom(7072003);

    // =========================================================================
    // 1. 1,650 Sculpted 3D Flapping Butterfly Bullets (Counter-rotating waves!)
    // =========================================================================
    const cCrimson = new THREE.Color(0xff4a88);
    const cSakura = new THREE.Color(0xff92d0);
    const cGhostBlue = new THREE.Color(0x66cfff);
    const cViolet = new THREE.Color(0xa976ff);
    const cMoon = new THREE.Color(0xffeaf7);

    // 11 blooming waves across the 16s performance (alternating crimson-pink & cyan-violet like PCB!)
    const waves = 11;
    const perWave = 150;
    for (let w = 0; w < waves; w++) {
      const spawnTime = 0.25 + w * 1.12;
      const isCrimsonWave = w % 2 === 0;
      const waveDir = isCrimsonWave ? 1 : -1;
      const rings = 5;
      const perRing = perWave / rings;

      for (let r = 0; r < rings; r++) {
        // Elevation dome tiers from -0.78 rad to +0.78 rad
        const elev = ((r / (rings - 1)) - 0.5) * 1.56;
        for (let j = 0; j < perRing; j++) {
          const frac = j / perRing;
          const azimuth = frac * Math.PI * 2 + w * 0.38 + r * 0.21;
          const petalHarmonic = 1.0 + 0.24 * Math.cos(frac * Math.PI * 2 * 5 + w);

          const col = isCrimsonWave
            ? j % 4 === 0
              ? cMoon
              : j % 2 === 0
                ? cCrimson
                : cSakura
            : j % 4 === 0
              ? cMoon
              : j % 2 === 0
                ? cGhostBlue
                : cViolet;

          this.butterflies.push({
            spawnTime: spawnTime + r * 0.08,
            waveDir,
            azimuth,
            elevation: elev,
            speed: (3.2 + (r % 2) * 0.45) * petalHarmonic,
            swirlRate: waveDir * (0.28 + (r % 3) * 0.06),
            petalK: 5,
            scale: 0.72 + rand() * 0.28,
            phase: rand() * Math.PI * 2,
            color: col.clone(),
          });
        }
      }
    }

    this.butterflyGeom = createButterflyBulletGeometry();
    const bCount = this.butterflies.length;

    // Store per-instance flap phase so butterflies beat asynchronously on the GPU!
    const phases = new Float32Array(bCount);
    for (let i = 0; i < bCount; i++) phases[i] = this.butterflies[i].phase;
    this.butterflyGeom.setAttribute('aFlapPhase', new THREE.InstancedBufferAttribute(phases, 1));

    this.butterflyMat = new THREE.ShaderMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uGlow: { value: 1.0 },
      },
      vertexShader: /* glsl */ `
        attribute float aFlapPhase;
        uniform float uTime;

        varying vec3 vColor;
        varying float vTip;

        void main() {
          vec3 p = position;
          float side = uv.x;
          float span = uv.y;

          // GPU wingbeat rotation around Z axis (body spine)
          if (abs(side) > 0.1) {
            float flap = sin(uTime * 11.5 + aFlapPhase) * 0.72;
            float angle = flap * side;
            float c = cos(angle);
            float s = sin(angle);
            p = vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
          }

          #ifdef USE_INSTANCING_COLOR
            vColor = instanceColor * color;
          #else
            vColor = color;
          #endif
          vTip = span;

          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uGlow;
        varying vec3 vColor;
        varying float vTip;

        void main() {
          float edgeBright = 0.65 + vTip * 0.55;
          vec3 col = mix(vColor, vec3(1.0, 0.96, 1.0), vTip * 0.25) * edgeBright * uGlow;
          float alpha = 0.56 + vTip * 0.34;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    this.butterflyMesh = new THREE.InstancedMesh(this.butterflyGeom, this.butterflyMat, bCount);
    this.butterflyMesh.frustumCulled = false;
    for (let i = 0; i < bCount; i++) {
      this.butterflyMesh.setColorAt(i, this.butterflies[i].color);
    }
    if (this.butterflyMesh.instanceColor) this.butterflyMesh.instanceColor.needsUpdate = true;
    this.root.add(this.butterflyMesh);

    // =========================================================================
    // 2. 1,350 Tumbling 3D Midground Sakura Petals (Laminar wind fluid)
    // =========================================================================
    const petalCount = 1350;
    const pPink = new THREE.Color(0xff9cd2);
    const pLight = new THREE.Color(0xffd6ec);
    const pLav = new THREE.Color(0xd2a8ff);
    const pCyan = new THREE.Color(0x9ce2ff);

    for (let i = 0; i < petalCount; i++) {
      const colRoll = rand();
      const col =
        colRoll < 0.52 ? pPink : colRoll < 0.78 ? pLight : colRoll < 0.92 ? pLav : pCyan;

      this.petals.push({
        basePos: new THREE.Vector3(
          (rand() - 0.5) * 44,
          (rand() - 0.5) * 28,
          (rand() - 0.5) * 38 - 1.5,
        ),
        driftVel: new THREE.Vector3(
          -1.25 - rand() * 1.1,
          -0.65 - rand() * 0.85,
          0.5 + (rand() - 0.5) * 1.2,
        ),
        spinAxis: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
        spinSpeed: 1.4 + rand() * 2.6,
        scale: 0.45 + rand() * 0.58,
        phase: rand() * Math.PI * 2,
        color: col.clone(),
      });
    }

    this.petalGeom = createSakuraPetalGeometry();
    this.petalMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.78,
      metalness: 0.0,
      envMapIntensity: 0.22,
      emissive: new THREE.Color(0x9a4678),
      emissiveIntensity: 0.56,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
    });

    this.petalMesh = new THREE.InstancedMesh(this.petalGeom, this.petalMat, petalCount);
    this.petalMesh.frustumCulled = false;
    for (let i = 0; i < petalCount; i++) {
      this.petalMesh.setColorAt(i, this.petals[i].color);
    }
    if (this.petalMesh.instanceColor) this.petalMesh.instanceColor.needsUpdate = true;
    this.root.add(this.petalMesh);

    // =========================================================================
    // 3. 260 Foreground Shallow-DOF Bokeh Sakura Petals
    // Soft out-of-focus bokeh discs that enlarge & soften near the camera lens!
    // =========================================================================
    this.bokehTex = createBokehPetalTexture(256);
    const bokehPos = new Float32Array(this.bokehCount * 3);
    const bokehDrift = new Float32Array(this.bokehCount * 3);
    const bokehCol = new Float32Array(this.bokehCount * 3);
    const bokehSize = new Float32Array(this.bokehCount);

    for (let i = 0; i < this.bokehCount; i++) {
      // Spread across foreground lens zone around the arena
      bokehPos[i * 3] = (rand() - 0.5) * 32;
      bokehPos[i * 3 + 1] = (rand() - 0.5) * 20;
      bokehPos[i * 3 + 2] = 2.0 + rand() * 22;

      bokehDrift[i * 3] = -1.1 - rand() * 1.3;
      bokehDrift[i * 3 + 1] = -0.55 - rand() * 0.9;
      bokehDrift[i * 3 + 2] = (rand() - 0.5) * 0.8;

      const pick = rand();
      const c = pick < 0.58 ? pPink : pick < 0.82 ? pLav : pCyan;
      bokehCol[i * 3] = c.r;
      bokehCol[i * 3 + 1] = c.g;
      bokehCol[i * 3 + 2] = c.b;

      bokehSize[i] = 0.8 + rand() * 1.45;
    }

    this.bokehGeom = new THREE.BufferGeometry();
    this.bokehGeom.setAttribute('position', new THREE.BufferAttribute(bokehPos, 3));
    this.bokehGeom.setAttribute('aDrift', new THREE.BufferAttribute(bokehDrift, 3));
    this.bokehGeom.setAttribute('aColor', new THREE.BufferAttribute(bokehCol, 3));
    this.bokehGeom.setAttribute('aSize', new THREE.BufferAttribute(bokehSize, 1));
    this.bokehGeom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 10), 40);

    this.bokehMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uMap: { value: this.bokehTex },
        uTime: { value: 0 },
        uOpacity: { value: 1.0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aDrift;
        attribute vec3 aColor;
        attribute float aSize;

        uniform float uTime;
        uniform float uPixelRatio;

        varying vec3 vColor;
        varying float vDofAlpha;

        void main() {
          // Wrap deterministically inside foreground volume so petals flow continuously
          vec3 p = position + aDrift * uTime;
          p.x = mod(p.x + 16.0, 32.0) - 16.0;
          p.y = mod(p.y + 10.0, 20.0) - 10.0;
          p.x += sin(uTime * 1.1 + position.y) * 0.7;
          p.y += cos(uTime * 0.9 + position.x) * 0.5;

          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;

          float dist = max(0.6, -mvPosition.z);
          // Shallow DOF Circle-of-Confusion: closer to camera = larger, softer bokeh!
          float nearFactor = smoothstep(14.0, 2.2, dist);
          float tooCloseFade = smoothstep(0.9, 2.6, dist);
          float farFade = 1.0 - smoothstep(12.0, 24.0, dist);

          float sz = aSize * (1.0 + nearFactor * 2.4);
          gl_PointSize = clamp((sz * 240.0 * uPixelRatio) / dist, 4.0, 118.0);

          vColor = aColor;
          // Soft translucent bokeh never obscures the crisp giant wings behind
          vDofAlpha = (0.14 + nearFactor * 0.24) * tooCloseFade * farFade;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform float uOpacity;
        varying vec3 vColor;
        varying float vDofAlpha;

        void main() {
          vec4 tex = texture2D(uMap, gl_PointCoord);
          float alpha = tex.a * vDofAlpha * uOpacity;
          if (alpha < 0.005) discard;
          gl_FragColor = vec4(vColor * tex.rgb * 0.95, alpha);
        }
      `,
    });

    this.bokehPoints = new THREE.Points(this.bokehGeom, this.bokehMat);
    this.bokehPoints.frustumCulled = false;
    this.root.add(this.bokehPoints);
  }

  public get instanceCount(): number {
    return this.butterflies.length + this.petals.length + this.bokehCount;
  }

  public update(t: number, bloomClimax: number, outroFade: number, pixelRatio: number): void {
    this.butterflyMat.uniforms.uTime.value = t;
    this.butterflyMat.uniforms.uGlow.value = 0.88 + bloomClimax * 0.34;

    this.bokehMat.uniforms.uTime.value = t;
    this.bokehMat.uniforms.uOpacity.value = outroFade;
    this.bokehMat.uniforms.uPixelRatio.value = pixelRatio;

    const originZ = -3.0;

    // 1. Update 1,650 counter-rotating 3D butterfly danmaku deterministically
    for (let i = 0; i < this.butterflies.length; i++) {
      const b = this.butterflies[i];
      if (t < b.spawnTime) {
        this._mat4.makeScale(0, 0, 0);
        this.butterflyMesh.setMatrixAt(i, this._mat4);
        continue;
      }

      const age = t - b.spawnTime;
      const lifeFade = 1 - smoothstep(7.2, 9.8, age);
      if (lifeFade <= 0.002 || outroFade <= 0.002) {
        this._mat4.makeScale(0, 0, 0);
        this.butterflyMesh.setMatrixAt(i, this._mat4);
        continue;
      }

      const appear = easeOutCubic(clamp(age / 0.55, 0, 1));
      const r = 1.2 + age * b.speed + age * age * 0.22;
      const theta = b.azimuth + age * b.swirlRate;
      const elev = b.elevation + Math.sin(age * 0.9 + b.phase) * 0.14;

      const cosE = Math.cos(elev);
      const sinE = Math.sin(elev);
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      this._pos.set(r * cosE * cosT, r * sinE, originZ + r * cosE * sinT);

      // Analytical tangent velocity along expanding 3D spiral so butterflies fly nose-first!
      const dr = b.speed + 0.44 * age;
      const dTheta = b.swirlRate;
      this._vel.set(
        dr * cosE * cosT - r * cosE * sinT * dTheta,
        dr * sinE + r * cosE * Math.cos(age * 0.9 + b.phase) * 0.12,
        dr * cosE * sinT + r * cosE * cosT * dTheta,
      );

      const bankRoll = b.waveDir * 0.45 + Math.sin(t * 2.2 + b.phase) * 0.22;
      orientForwardWithRoll(this._vel, bankRoll, this._quat);

      const sc = b.scale * (0.25 + 0.75 * appear) * lifeFade * outroFade;
      this._scale.setScalar(sc);
      this._mat4.compose(this._pos, this._quat, this._scale);
      this.butterflyMesh.setMatrixAt(i, this._mat4);
    }
    this.butterflyMesh.instanceMatrix.needsUpdate = true;

    // 2. Update 1,350 tumbling 3D sakura petals with gentle curl-like wind sway
    for (let i = 0; i < this.petals.length; i++) {
      const p = this.petals[i];
      // Deterministic wrapping inside 44 x 28 x 38 stage volume
      let x = p.basePos.x + p.driftVel.x * t + Math.sin(t * 0.9 + p.phase) * 1.4;
      let y = p.basePos.y + p.driftVel.y * t + Math.cos(t * 0.75 + p.phase) * 0.9;
      let z = p.basePos.z + p.driftVel.z * t + Math.sin(t * 0.6 + p.phase * 1.3) * 1.1;

      x = ((((x + 22) % 44) + 44) % 44) - 22;
      y = ((((y + 14) % 28) + 28) % 28) - 14;
      z = ((((z + 20.5) % 38) + 38) % 38) - 20.5;

      this._pos.set(x, y, z);
      this._spinQuat.setFromAxisAngle(p.spinAxis, t * p.spinSpeed + p.phase);
      this._scale.setScalar(p.scale * (0.35 + 0.65 * outroFade));
      this._mat4.compose(this._pos, this._spinQuat, this._scale);
      this.petalMesh.setMatrixAt(i, this._mat4);
    }
    this.petalMesh.instanceMatrix.needsUpdate = true;
  }

  public dispose(): void {
    this.butterflyGeom.dispose();
    this.butterflyMat.dispose();
    this.petalGeom.dispose();
    this.petalMat.dispose();
    this.bokehGeom.dispose();
    this.bokehMat.dispose();
    this.bokehTex.dispose();
  }
}
