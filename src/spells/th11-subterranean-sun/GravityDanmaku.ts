import * as THREE from 'three';
import {
  clamp,
  createSeededRandom,
  fibonacciSpherePoint,
  orientForwardWithRoll,
  smoothstep,
} from '../../prototypes/DanmakuMath';
import { createSoftGlowTexture } from '../../prototypes/MagicCircleFactory';

interface InfallBullet {
  cycleOffset: number;
  cyclePeriod: number;
  startRadius: number;
  azimuth: number;
  elevation: number;
  spinSign: number;
  orbitTwist: number;
  scale: number;
  heatType: number; // 0 = crimson, 1 = magma orange, 2 = solar gold
}

interface GiantSolarOrb {
  spawnTime: number;
  dir: THREE.Vector3;
  startR: number;
  endR: number;
  scale: number;
  orbitSpeed: number;
}

/**
 * Centripetal gravitational-well danmaku for TH11 "Subterranean Sun":
 * - 3,200 glowing plasma bullets spiraling inward with real gravitational acceleration
 * - 1,400 tidal-stretched accretion streaks aligned along infall tangents
 * - 24 iconic Okuu giant nuclear fireballs orbiting & plunging
 * - 1,400 deep-cavern background embers (dramatically bent by the Einstein gravitational lens!)
 */
export class GravityDanmaku {
  public readonly root = new THREE.Group();

  private readonly bullets: InfallBullet[] = [];
  private readonly giantOrbs: GiantSolarOrb[] = [];

  private readonly orbMesh: THREE.InstancedMesh;
  private readonly streakMesh: THREE.InstancedMesh;
  private readonly giantMesh: THREE.InstancedMesh;
  private readonly bgEmbers: THREE.Points;

  private readonly orbGeom: THREE.BufferGeometry;
  private readonly orbMat: THREE.ShaderMaterial;
  private readonly streakGeom: THREE.BufferGeometry;
  private readonly streakMat: THREE.ShaderMaterial;
  private readonly giantGeom: THREE.BufferGeometry;
  private readonly giantMat: THREE.ShaderMaterial;
  private readonly emberGeom: THREE.BufferGeometry;
  private readonly emberMat: THREE.PointsMaterial;
  private readonly glowTex: THREE.CanvasTexture;

  private readonly _pos = new THREE.Vector3();
  private readonly _nextPos = new THREE.Vector3();
  private readonly _vel = new THREE.Vector3();
  private readonly _quat = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3();
  private readonly _mat4 = new THREE.Matrix4();
  private readonly _col = new THREE.Color();

  private readonly cCrimson = new THREE.Color(0xff2838);
  private readonly cOrange = new THREE.Color(0xff7818);
  private readonly cGold = new THREE.Color(0xffda5c);
  private readonly cWhiteGold = new THREE.Color(0xfff4d0);

  constructor() {
    const rand = createSeededRandom(20080816); // Touhou 11 SA release date seed!
    this.glowTex = createSoftGlowTexture(128);

    // 1. 3,200 Centripetal Infall Plasma Bullets (continuously recycling deterministically!)
    const bulletCount = 3200;
    for (let i = 0; i < bulletCount; i++) {
      const unit = fibonacciSpherePoint(i, bulletCount);
      const elev = Math.asin(clamp(unit.y, -0.96, 0.96));
      // Cluster ~60% near tilted accretion bands and ~40% across full 3D sphere for cosmic depth
      const bandedElev = i % 5 < 3 ? elev * 0.42 : elev;
      const azimuth = Math.atan2(unit.z, unit.x);

      this.bullets.push({
        cycleOffset: rand() * 5.2,
        cyclePeriod: 3.6 + rand() * 2.4,
        startRadius: 20.0 + rand() * 19.0,
        azimuth,
        elevation: bandedElev,
        spinSign: i % 2 === 0 ? 1 : -1,
        orbitTwist: 1.8 + rand() * 2.2,
        scale: 0.16 + rand() * 0.18,
        heatType: i % 3,
      });
    }

    this.orbGeom = new THREE.SphereGeometry(1.0, 14, 10);
    // Luminous Touhou energy-orb Fresnel shader: hot incandescent white-gold core + fiery colored halo
    // + smooth near-camera lens fade so close bullets never block the miniature sun!
    this.orbMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vColor;
        varying float vNearFade;

        void main() {
          vec4 mvPos = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
          vViewDir = normalize(-mvPos.xyz);
          vNearFade = smoothstep(2.4, 6.8, -mvPos.z);
          #ifdef USE_INSTANCING_COLOR
            vColor = instanceColor;
          #else
            vColor = vec3(1.0, 0.5, 0.15);
          #endif
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vColor;
        varying float vNearFade;

        void main() {
          float ndv = clamp(abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0);
          float core = ndv * ndv;
          float rim = ndv * ndv * ndv;
          vec3 hotCore = vec3(1.55, 1.38, 0.92);
          vec3 col = mix(vColor * 1.15, hotCore, smoothstep(0.45, 0.96, core));
          float alpha = (0.18 + rim * 0.82) * vNearFade;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
    this.orbMesh = new THREE.InstancedMesh(this.orbGeom, this.orbMat, bulletCount);
    this.orbMesh.frustumCulled = false;

    for (let i = 0; i < bulletCount; i++) {
      const h = this.bullets[i].heatType;
      this._col.copy(h === 0 ? this.cCrimson : h === 1 ? this.cOrange : this.cGold);
      this.orbMesh.setColorAt(i, this._col);
    }
    if (this.orbMesh.instanceColor) this.orbMesh.instanceColor.needsUpdate = true;
    this.root.add(this.orbMesh);

    // 2. 1,400 Tidal-Stretched Infall Streaks (paired with fastest bullets!)
    const streakCount = 1400;
    const sPos: number[] = [];
    const sUv: number[] = [];
    const pushQuad = (
      p0: [number, number, number],
      p1: [number, number, number],
      p2: [number, number, number],
      p3: [number, number, number],
    ) => {
      sPos.push(
        p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2],
        p0[0], p0[1], p0[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2],
      );
      sUv.push(0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0);
    };
    pushQuad([-0.08, 0, 0.2], [0.08, 0, 0.2], [0.01, 0, -2.6], [-0.01, 0, -2.6]);
    pushQuad([0, -0.08, 0.2], [0, 0.08, 0.2], [0, 0.01, -2.6], [0, -0.01, -2.6]);

    this.streakGeom = new THREE.BufferGeometry();
    this.streakGeom.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
    this.streakGeom.setAttribute('uv', new THREE.Float32BufferAttribute(sUv, 2));

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
            vColor = vec3(1.0, 0.55, 0.15);
          #endif
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vColor;
        void main() {
          float s = clamp(sin(clamp(vUv.x, 0.0, 1.0) * 3.14159265), 0.0, 1.0);
          float ty = clamp(vUv.y, 0.0, 1.0);
          float alpha = s * ty * ty * 0.45;
          vec3 col = mix(vColor, vec3(1.0, 0.94, 0.72), ty * 0.45);
          gl_FragColor = vec4(col * 1.1, alpha);
        }
      `,
    });

    this.streakMesh = new THREE.InstancedMesh(this.streakGeom, this.streakMat, streakCount);
    this.streakMesh.frustumCulled = false;
    for (let i = 0; i < streakCount; i++) {
      this._col.copy(i % 2 === 0 ? this.cOrange : this.cGold);
      this.streakMesh.setColorAt(i, this._col);
    }
    if (this.streakMesh.instanceColor) this.streakMesh.instanceColor.needsUpdate = true;
    this.root.add(this.streakMesh);

    // 3. 24 Iconic Okuu Giant Glowing Nuclear Spheres (classic giant white-core/red-rim orbs!)
    const giantCount = 24;
    for (let i = 0; i < giantCount; i++) {
      const unit = fibonacciSpherePoint(i, giantCount);
      this.giantOrbs.push({
        spawnTime: 2.2 + (i % 6) * 1.55,
        dir: unit.clone(),
        startR: 15.5 + (i % 4) * 3.5,
        endR: 5.5 + (i % 3) * 1.8,
        scale: 0.78 + (i % 3) * 0.24,
        orbitSpeed: (i % 2 === 0 ? 1 : -1) * (0.28 + (i % 4) * 0.07),
      });
    }

    this.giantGeom = new THREE.SphereGeometry(1.0, 28, 20);
    this.giantMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying float vNearFade;
        void main() {
          vec4 mvPos = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
          vViewDir = normalize(-mvPos.xyz);
          vNearFade = smoothstep(3.2, 7.5, -mvPos.z);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying float vNearFade;
        void main() {
          float ndv = clamp(abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0);
          float core = ndv * ndv;
          vec3 rimCol = vec3(1.15, 0.16, 0.05);
          vec3 midCol = vec3(1.35, 0.62, 0.12);
          vec3 hotCol = vec3(1.65, 1.48, 1.02);
          vec3 col = mix(rimCol, midCol, smoothstep(0.18, 0.68, ndv));
          col = mix(col, hotCol, smoothstep(0.64, 0.95, core));
          gl_FragColor = vec4(col, (0.28 + core * 0.68) * vNearFade);
        }
      `,
    });
    this.giantMesh = new THREE.InstancedMesh(this.giantGeom, this.giantMat, giantCount);
    this.giantMesh.frustumCulled = false;
    this.root.add(this.giantMesh);

    // 4. 1,400 Deep Background Volcanic Embers & Distant Stars (showcases Gravitational Lensing warp!)
    const emberCount = 1400;
    const ePos = new Float32Array(emberCount * 3);
    const eCol = new Float32Array(emberCount * 3);
    for (let i = 0; i < emberCount; i++) {
      const r = 24 + rand() * 38;
      const th = rand() * Math.PI * 2;
      const ph = Math.acos(2 * rand() - 1);
      ePos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      ePos[i * 3 + 1] = r * Math.cos(ph);
      ePos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);

      const pick = rand();
      const c = pick < 0.4 ? this.cCrimson : pick < 0.78 ? this.cOrange : this.cWhiteGold;
      eCol[i * 3] = c.r;
      eCol[i * 3 + 1] = c.g;
      eCol[i * 3 + 2] = c.b;
    }
    this.emberGeom = new THREE.BufferGeometry();
    this.emberGeom.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
    this.emberGeom.setAttribute('color', new THREE.BufferAttribute(eCol, 3));
    this.emberMat = new THREE.PointsMaterial({
      size: 0.42,
      map: this.glowTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.68,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.bgEmbers = new THREE.Points(this.emberGeom, this.emberMat);
    this.root.add(this.bgEmbers);
  }

  public get instanceCount(): number {
    return this.bullets.length + 1400 + this.giantOrbs.length + 1400;
  }

  private evalBulletPos(b: InfallBullet, t: number, gravityPull: number, supernovaPush: number, out: THREE.Vector3): { p: number; radius: number } {
    // Smooth periodic infall accelerated by gravityPull
    const speedMult = 0.55 + gravityPull * 0.95;
    const rawPhase = ((t * speedMult + b.cycleOffset) % b.cyclePeriod) / b.cyclePeriod;
    // Accelerating radial collapse: slow far away, plunging violently fast near the sun!
    const infall = rawPhase * rawPhase * Math.sqrt(rawPhase);
    let r = b.startRadius * (1.0 - infall * 0.89);

    // During Act 3 Supernova Flare, shockwave blasts bullets violently back outward!
    if (supernovaPush > 0.001) {
      r += supernovaPush * (18.0 + (b.startRadius - 20.0) * 0.5);
    }

    // Angular momentum conservation: spins faster as radius shrinks!
    const angle = b.azimuth + b.spinSign * b.orbitTwist * (rawPhase + infall * 1.45);
    const elev = b.elevation * (1.0 - infall * 0.35);

    const cosE = Math.cos(elev);
    out.set(r * cosE * Math.cos(angle), r * Math.sin(elev), r * cosE * Math.sin(angle));
    return { p: rawPhase, radius: r };
  }

  public update(t: number, gravityPull: number, supernovaPush: number, outroFade: number): void {
    const introFade = smoothstep(0.0, 1.6, t);
    const vis = introFade * outroFade;

    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      const { p, radius } = this.evalBulletPos(b, t, gravityPull, supernovaPush, this._pos);
      this.evalBulletPos(b, t + 0.04, gravityPull, supernovaPush, this._nextPos);
      this._vel.subVectors(this._nextPos, this._pos);

      // Fade in smoothly at outer shell & fade out cleanly right as swallowed by photosphere
      const edgeFade = smoothstep(0.0, 0.14, p) * (1 - smoothstep(0.88, 1.0, p));
      const sc = b.scale * edgeFade * vis * (1.0 + smoothstep(10.0, 3.8, radius) * 0.55);

      if (sc <= 0.002) {
        this._mat4.makeScale(0, 0, 0);
        this.orbMesh.setMatrixAt(i, this._mat4);
        if (i < 1400) this.streakMesh.setMatrixAt(i, this._mat4);
        continue;
      }

      this._quat.identity();
      this._scale.setScalar(sc);
      this._mat4.compose(this._pos, this._quat, this._scale);
      this.orbMesh.setMatrixAt(i, this._mat4);

      // Paired tidal-stretched velocity streak for first 1,400 bullets
      if (i < 1400) {
        const speed = this._vel.length() * 25.0;
        const stretch = clamp((speed - 3.0) / 14.0, 0, 2.2) * edgeFade * vis;
        if (stretch > 0.05) {
          orientForwardWithRoll(this._vel, 0, this._quat);
          this._scale.set(sc * 2.2, sc * 2.2, 0.45 + stretch * 1.15);
          this._mat4.compose(this._pos, this._quat, this._scale);
          this.streakMesh.setMatrixAt(i, this._mat4);
        } else {
          this._mat4.makeScale(0, 0, 0);
          this.streakMesh.setMatrixAt(i, this._mat4);
        }
      }
    }
    this.orbMesh.instanceMatrix.needsUpdate = true;
    this.streakMesh.instanceMatrix.needsUpdate = true;

    // Giant Okuu nuclear fireballs orbiting and plunging smoothly
    for (let i = 0; i < this.giantOrbs.length; i++) {
      const g = this.giantOrbs[i];
      const appear = smoothstep(g.spawnTime, g.spawnTime + 0.9, t);
      if (appear <= 0.001 || outroFade <= 0.001) {
        this._mat4.makeScale(0, 0, 0);
        this.giantMesh.setMatrixAt(i, this._mat4);
        continue;
      }
      const age = Math.max(0, t - g.spawnTime);
      const r =
        Math.max(g.endR, g.startR - age * (0.9 + gravityPull * 0.9)) +
        supernovaPush * 16.0;
      const angle = age * g.orbitSpeed;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      this._pos.set(
        (g.dir.x * c - g.dir.z * s) * r,
        g.dir.y * r,
        (g.dir.x * s + g.dir.z * c) * r,
      );
      this._quat.identity();
      this._scale.setScalar(g.scale * appear * outroFade);
      this._mat4.compose(this._pos, this._quat, this._scale);
      this.giantMesh.setMatrixAt(i, this._mat4);
    }
    this.giantMesh.instanceMatrix.needsUpdate = true;

    this.bgEmbers.rotation.y = t * 0.04;
    this.emberMat.opacity = 0.65 * outroFade;
  }

  public dispose(): void {
    this.orbGeom.dispose();
    this.orbMat.dispose();
    this.streakGeom.dispose();
    this.streakMat.dispose();
    this.giantGeom.dispose();
    this.giantMat.dispose();
    this.emberGeom.dispose();
    this.emberMat.dispose();
    this.glowTex.dispose();
  }
}
