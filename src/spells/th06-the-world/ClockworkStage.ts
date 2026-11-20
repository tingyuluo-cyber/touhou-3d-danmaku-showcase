import * as THREE from 'three';
import {
  createAstralClockTexture,
  createClockGearRingTexture,
  createHexagramCircleTexture,
  createSoftGlowTexture,
} from '../../prototypes/MagicCircleFactory';
import { createSeededRandom, easeOutExpo, smoothstep } from '../../prototypes/DanmakuMath';

export interface EmitterCircleInfo {
  mesh: THREE.Mesh;
  basePosition: THREE.Vector3;
  baseOrbitAngle: number;
  orbitRadius: number;
  elevation: number;
}

/**
 * Builds the pure 3D astral stage for TH06 "The World":
 * - Giant Roman-numeral astral clock face & counter-rotating gear rings
 * - 3D metallic clock hands that freeze solid on Time Stop and whip forward on Resume
 * - 6 floating glowing hexagram spell circles (emulating classic 3D danmaku emitters)
 * - 3D expanding Time-Stop shockwave shell + frozen drifting silver time-dust motes
 */
export class ClockworkStage {
  public readonly root = new THREE.Group();
  public readonly emitters: EmitterCircleInfo[] = [];

  private readonly clockGroup = new THREE.Group();
  private readonly clockDialMesh: THREE.Mesh;
  private readonly gearRingOuter: THREE.Mesh;
  private readonly gearRingInner: THREE.Mesh;
  private readonly hourHandPivot = new THREE.Group();
  private readonly minuteHandPivot = new THREE.Group();
  private readonly secondHandPivot = new THREE.Group();

  private readonly shockwaveRing: THREE.Mesh;
  private readonly shockwaveShell: THREE.Mesh;
  private readonly dustPoints: THREE.Points;
  private readonly dustBasePositions: Float32Array;
  private readonly dustDrifts: Float32Array;
  private readonly dustCount = 1100;

  private readonly textures: THREE.Texture[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  constructor() {
    const clockTex = createAstralClockTexture(1024);
    const gearTex = createClockGearRingTexture(1024);
    const hexTex = createHexagramCircleTexture(512);
    const glowTex = createSoftGlowTexture(128);
    this.textures.push(clockTex, gearTex, hexTex, glowTex);

    // 1. Giant Astral Clock positioned behind the knife arena along -Z
    this.clockGroup.position.set(0, 0, -14.5);
    this.root.add(this.clockGroup);

    const dialGeom = new THREE.PlaneGeometry(34, 34);
    const dialMat = new THREE.MeshBasicMaterial({
      map: clockTex,
      color: new THREE.Color(0x9bd6ff),
      transparent: true,
      opacity: 0.56,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.clockDialMesh = new THREE.Mesh(dialGeom, dialMat);
    this.clockGroup.add(this.clockDialMesh);
    this.geometries.push(dialGeom);
    this.materials.push(dialMat);

    const gearOuterGeom = new THREE.PlaneGeometry(25, 25);
    const gearOuterMat = new THREE.MeshBasicMaterial({
      map: gearTex,
      color: new THREE.Color(0x62a8ff),
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.gearRingOuter = new THREE.Mesh(gearOuterGeom, gearOuterMat);
    this.gearRingOuter.position.z = 0.6;
    this.clockGroup.add(this.gearRingOuter);
    this.geometries.push(gearOuterGeom);
    this.materials.push(gearOuterMat);

    const gearInnerGeom = new THREE.PlaneGeometry(15.5, 15.5);
    const gearInnerMat = new THREE.MeshBasicMaterial({
      map: gearTex,
      color: new THREE.Color(0xd8e8ff),
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.gearRingInner = new THREE.Mesh(gearInnerGeom, gearInnerMat);
    this.gearRingInner.position.z = 1.2;
    this.clockGroup.add(this.gearRingInner);
    this.geometries.push(gearInnerGeom);
    this.materials.push(gearInnerMat);

    // 2. 3D Sculpted Metallic Clock Hands
    const handSilverMat = new THREE.MeshStandardMaterial({
      color: 0xeaf4ff,
      metalness: 0.94,
      roughness: 0.18,
      emissive: new THREE.Color(0x3a74b8),
      emissiveIntensity: 0.28,
    });
    const secondCrimsonMat = new THREE.MeshStandardMaterial({
      color: 0xff5a78,
      metalness: 0.78,
      roughness: 0.22,
      emissive: new THREE.Color(0xff2955),
      emissiveIntensity: 0.95,
    });
    this.materials.push(handSilverMat, secondCrimsonMat);

    const buildClockHand = (
      length: number,
      width: number,
      mat: THREE.Material,
      zOffset: number,
    ): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.z = zOffset;

      const shape = new THREE.Shape();
      shape.moveTo(0, -length * 0.16);
      shape.lineTo(width, length * 0.08);
      shape.lineTo(width * 0.35, length * 0.78);
      shape.lineTo(0, length);
      shape.lineTo(-width * 0.35, length * 0.78);
      shape.lineTo(-width, length * 0.08);
      shape.closePath();

      const geom = new THREE.ExtrudeGeometry(shape, {
        depth: 0.14,
        bevelEnabled: true,
        bevelThickness: 0.04,
        bevelSize: 0.04,
        bevelSegments: 1,
      });
      geom.translate(0, 0, -0.07);
      const mesh = new THREE.Mesh(geom, mat);
      pivot.add(mesh);
      this.geometries.push(geom);
      return pivot;
    };

    this.hourHandPivot = buildClockHand(8.6, 0.42, handSilverMat, 1.55);
    this.minuteHandPivot = buildClockHand(12.6, 0.3, handSilverMat, 1.85);
    this.secondHandPivot = buildClockHand(13.9, 0.11, secondCrimsonMat, 2.1);

    // Central clock boss hub
    const hubGeom = new THREE.OctahedronGeometry(0.7, 1);
    const hubMesh = new THREE.Mesh(hubGeom, handSilverMat);
    hubMesh.position.z = 1.9;
    this.geometries.push(hubGeom);

    this.clockGroup.add(this.hourHandPivot, this.minuteHandPivot, this.secondHandPivot, hubMesh);

    // 3. 6 Floating Hexagram Spell Emitters framing the 3D arena
    const emitterGeom = new THREE.PlaneGeometry(4.4, 4.4);
    this.geometries.push(emitterGeom);

    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const orbitRadius = 11.8;
      const elevation = (i % 2 === 0 ? 1 : -1) * 2.2;
      const mat = new THREE.MeshBasicMaterial({
        map: hexTex,
        color: new THREE.Color(i % 2 === 0 ? 0xdff2ff : 0xffb8cc),
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.materials.push(mat);

      const mesh = new THREE.Mesh(emitterGeom, mat);
      const basePos = new THREE.Vector3(
        Math.cos(angle) * orbitRadius,
        Math.sin(angle) * orbitRadius * 0.72,
        elevation - 2.0,
      );
      mesh.position.copy(basePos);
      this.root.add(mesh);
      this.emitters.push({
        mesh,
        basePosition: basePos,
        baseOrbitAngle: angle,
        orbitRadius,
        elevation,
      });
    }

    // 4. Expanding 3D Time-Stop Shockwave Shell & Rim Ring
    const ringGeom = new THREE.TorusGeometry(1, 0.028, 12, 96);
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xc8ecff),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.shockwaveRing = new THREE.Mesh(ringGeom, ringMat);
    this.root.add(this.shockwaveRing);
    this.geometries.push(ringGeom);
    this.materials.push(ringMat);

    const shellGeom = new THREE.SphereGeometry(1, 36, 24);
    const shellMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uOpacity: { value: 0 },
        uColor: { value: new THREE.Color(0x9edaff) },
      },
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
        uniform float uOpacity;
        uniform vec3 uColor;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          float f = clamp(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0);
          float fresnel = f * f * sqrt(f);
          float alpha = fresnel * uOpacity;
          gl_FragColor = vec4(uColor * (1.2 + fresnel * 1.4), alpha);
        }
      `,
    });
    this.shockwaveShell = new THREE.Mesh(shellGeom, shellMat);
    this.root.add(this.shockwaveShell);
    this.geometries.push(shellGeom);
    this.materials.push(shellMat);

    // 5. Frozen Silver Time-Dust Motes (subtle ambient depth cues)
    const rand = createSeededRandom(6062002);
    this.dustBasePositions = new Float32Array(this.dustCount * 3);
    this.dustDrifts = new Float32Array(this.dustCount * 3);
    const dustPositions = new Float32Array(this.dustCount * 3);
    const dustColors = new Float32Array(this.dustCount * 3);

    for (let i = 0; i < this.dustCount; i++) {
      const r = 4 + Math.pow(rand(), 0.7) * 34;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.cos(phi) * 0.78;
      const z = r * Math.sin(phi) * Math.sin(theta) - 3;

      this.dustBasePositions[i * 3] = x;
      this.dustBasePositions[i * 3 + 1] = y;
      this.dustBasePositions[i * 3 + 2] = z;

      dustPositions[i * 3] = x;
      dustPositions[i * 3 + 1] = y;
      dustPositions[i * 3 + 2] = z;

      this.dustDrifts[i * 3] = (rand() - 0.5) * 1.4;
      this.dustDrifts[i * 3 + 1] = (rand() - 0.5) * 1.1;
      this.dustDrifts[i * 3 + 2] = (rand() - 0.5) * 1.4;

      const tint = rand();
      if (tint < 0.72) {
        dustColors[i * 3] = 0.75;
        dustColors[i * 3 + 1] = 0.9;
        dustColors[i * 3 + 2] = 1.0;
      } else if (tint < 0.9) {
        dustColors[i * 3] = 1.0;
        dustColors[i * 3 + 1] = 0.42;
        dustColors[i * 3 + 2] = 0.58;
      } else {
        dustColors[i * 3] = 1.0;
        dustColors[i * 3 + 1] = 1.0;
        dustColors[i * 3 + 2] = 1.0;
      }
    }

    const dustGeom = new THREE.BufferGeometry();
    dustGeom.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    dustGeom.setAttribute('color', new THREE.BufferAttribute(dustColors, 3));
    const dustMat = new THREE.PointsMaterial({
      size: 0.24,
      map: glowTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.dustPoints = new THREE.Points(dustGeom, dustMat);
    this.root.add(this.dustPoints);
    this.geometries.push(dustGeom);
    this.materials.push(dustMat);
  }

  /**
   * Deterministic update driven by:
   * - `t`: real showcase timeline seconds (0..22)
   * - `worldTime`: integrated active world time (pauses completely during 3.2s..14.8s!)
   * - `timeStopFactor`: 0 (normal) -> 1 (frozen)
   */
  public update(
    t: number,
    worldTime: number,
    timeStopFactor: number,
    cameraPos: THREE.Vector3,
  ): void {
    // Clock dial & gears freeze solid during Time Stop!
    const introFade = smoothstep(0.0, 1.0, t);
    const outroFade = 1 - smoothstep(13.4, 15.0, t);
    const stageAlpha = introFade * outroFade;

    this.clockDialMesh.rotation.z = -worldTime * 0.06;
    this.gearRingOuter.rotation.z = worldTime * 0.14;
    this.gearRingInner.rotation.z = -worldTime * 0.24;

    const dialMat = this.clockDialMesh.material as THREE.MeshBasicMaterial;
    dialMat.opacity = (0.48 + timeStopFactor * 0.16) * stageAlpha;
    (this.gearRingOuter.material as THREE.MeshBasicMaterial).opacity =
      (0.32 + timeStopFactor * 0.1) * stageAlpha;
    (this.gearRingInner.material as THREE.MeshBasicMaterial).opacity =
      (0.28 + timeStopFactor * 0.08) * stageAlpha;

    // Hands tick forward cleanly, slam frozen near 11:59 -> 12:00, then race on resume
    const secondAngle = -worldTime * 1.45 - 0.85;
    const minuteAngle = -worldTime * 0.28 - 0.35;
    const hourAngle = -worldTime * 0.07 + 0.55;
    this.secondHandPivot.rotation.z = secondAngle;
    this.minuteHandPivot.rotation.z = minuteAngle;
    this.hourHandPivot.rotation.z = hourAngle;

    // Floating hexagram emitters slowly orbit when time flows, freeze when stopped, face softly inward
    for (let i = 0; i < this.emitters.length; i++) {
      const em = this.emitters[i];
      const orbitAngle = em.baseOrbitAngle + worldTime * 0.22;
      em.mesh.position.set(
        Math.cos(orbitAngle) * em.orbitRadius,
        Math.sin(orbitAngle) * em.orbitRadius * 0.72,
        em.elevation - 2.0 + Math.sin(worldTime * 0.9 + i) * 0.8,
      );
      em.mesh.lookAt(cameraPos);
      em.mesh.rotateZ(worldTime * (i % 2 === 0 ? 0.75 : -0.75) + i);

      const pulse = 0.92 + 0.1 * Math.sin(t * 2.8 + i * 1.1);
      const resumeBoost = smoothstep(10.1, 10.5, t) * (1 - smoothstep(11.6, 13.8, t));
      const mat = em.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.min(1, (0.68 + resumeBoost * 0.32) * pulse * stageAlpha);
      const scale = (0.94 + resumeBoost * 0.22) * (0.4 + 0.6 * introFade);
      em.mesh.scale.setScalar(scale);
    }

    // 3D Time-Stop Shockwave (expands outward at t=2.35..3.6, snaps inward at t=9.95..10.95)
    let waveScale = 0.01;
    let waveAlpha = 0;
    let waveColorHex = 0xa8e0ff;

    if (t >= 2.35 && t <= 3.7) {
      const p = (t - 2.35) / 1.35;
      waveScale = 0.4 + easeOutExpo(p) * 34;
      waveAlpha = Math.sin(Math.min(1, p) * Math.PI) * 0.92;
      waveColorHex = 0x9edbff;
    } else if (t >= 9.95 && t <= 11.0) {
      const p = (t - 9.95) / 1.05;
      if (p < 0.32) {
        // Quick snap-in
        const k = p / 0.32;
        waveScale = (1 - k) * 24 + 0.5;
        waveAlpha = k * 0.75;
        waveColorHex = 0xffffff;
      } else {
        // Explosive crimson-cyan burst shockwave
        const k = (p - 0.32) / 0.68;
        waveScale = 0.5 + easeOutExpo(k) * 38;
        waveAlpha = (1 - k) * 0.95;
        waveColorHex = 0xff6284;
      }
    }

    this.shockwaveShell.visible = waveAlpha > 0.005;
    this.shockwaveRing.visible = waveAlpha > 0.005;
    if (waveAlpha > 0.005) {
      this.shockwaveShell.scale.setScalar(waveScale);
      const shellMat = this.shockwaveShell.material as THREE.ShaderMaterial;
      shellMat.uniforms.uOpacity.value = waveAlpha * 0.7;
      shellMat.uniforms.uColor.value.setHex(waveColorHex);

      this.shockwaveRing.scale.setScalar(waveScale * 0.96);
      this.shockwaveRing.lookAt(cameraPos);
      const ringMat = this.shockwaveRing.material as THREE.MeshBasicMaterial;
      ringMat.opacity = waveAlpha;
      ringMat.color.setHex(waveColorHex);
    }

    // Frozen silver dust motes (drift with worldTime, erupt radially after resume!)
    const posAttr = this.dustPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    const resumeBurst = Math.max(0, t - 10.25);
    const burstPush = resumeBurst * resumeBurst * 1.15;

    for (let i = 0; i < this.dustCount; i++) {
      const i3 = i * 3;
      const bx = this.dustBasePositions[i3] + this.dustDrifts[i3] * worldTime * 0.75;
      const by = this.dustBasePositions[i3 + 1] + this.dustDrifts[i3 + 1] * worldTime * 0.75;
      const bz = this.dustBasePositions[i3 + 2] + this.dustDrifts[i3 + 2] * worldTime * 0.75;

      if (burstPush > 0.001) {
        const invLen = 1 / Math.max(1.0, Math.hypot(bx, by, bz));
        arr[i3] = bx + bx * invLen * burstPush;
        arr[i3 + 1] = by + by * invLen * burstPush;
        arr[i3 + 2] = bz + bz * invLen * burstPush;
      } else {
        arr[i3] = bx;
        arr[i3 + 1] = by;
        arr[i3 + 2] = bz;
      }
    }
    posAttr.needsUpdate = true;
    (this.dustPoints.material as THREE.PointsMaterial).opacity = (0.48 + timeStopFactor * 0.16) * stageAlpha;
  }

  public dispose(): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
  }
}
