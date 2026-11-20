import * as THREE from 'three';

/**
 * Generates a crisp luminous Utsuho / Subterranean Sun radioactive trefoil & containment ring texture.
 */
function createNuclearHazardRingTexture(size = 1024): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.46;

  ctx.clearRect(0, 0, size, size);

  ctx.strokeStyle = '#ff9838';
  ctx.fillStyle = '#ff7224';
  ctx.shadowColor = '#ff3814';
  ctx.shadowBlur = 14;

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

  ring(R * 0.99, 3.5, 0.9);
  ring(R * 0.92, 1.8, 0.65, [16, 10]);
  ring(R * 0.78, 3.0, 0.85);
  ring(R * 0.56, 2.0, 0.6);

  // Hazard warning diagonal chevron dashes along outer containment band
  const segments = 36;
  ctx.save();
  ctx.globalAlpha = 0.78;
  ctx.lineWidth = 4.2;
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / (segments * 2.1);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a0) * R * 0.80, cy + Math.sin(a0) * R * 0.80);
    ctx.lineTo(cx + Math.cos(a1) * R * 0.90, cy + Math.sin(a1) * R * 0.90);
    ctx.stroke();
  }
  ctx.restore();

  // Iconic 3-blade radioactive trefoil arc segments (geometric containment motif)
  ctx.save();
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < 3; i++) {
    const startA = (i / 3) * Math.PI * 2 - Math.PI / 6;
    const endA = startA + Math.PI / 3;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.74, startA, endA, false);
    ctx.arc(cx, cy, R * 0.59, endA, startA, true);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Hexagonal magnetic containment lattice
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 2.0;
  for (let k = 0; k < 2; k++) {
    const rot = (k * Math.PI) / 6;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = rot + (i / 6) * Math.PI * 2;
      const x = cx + Math.cos(a) * R * 0.78;
      const y = cy + Math.sin(a) * R * 0.78;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Multi-layered procedural miniature star for TH11 "Subterranean Sun":
 * - Animated 3D boiling photosphere plasma granulation (dark sunspots + molten gold/orange)
 * - Volumetric Fresnel solar corona shell
 * - 6 twisting 3D magnetic solar prominence plasma loops
 * - Swirling tilted gravitational accretion disk
 * - Dual rotating nuclear hazard containment rings
 */
export class NuclearSun {
  public readonly root = new THREE.Group();

  private readonly photosphere: THREE.Mesh;
  private readonly corona: THREE.Mesh;
  private readonly accretionDisk: THREE.Mesh;
  private readonly hazardRingA: THREE.Mesh;
  private readonly hazardRingB: THREE.Mesh;
  private readonly shockShell: THREE.Mesh;
  private readonly blastRing: THREE.Mesh;
  private readonly flareGroup = new THREE.Group();

  private readonly photoMat: THREE.ShaderMaterial;
  private readonly coronaMat: THREE.ShaderMaterial;
  private readonly diskMat: THREE.ShaderMaterial;
  private readonly flareMat: THREE.ShaderMaterial;
  private readonly shockMat: THREE.ShaderMaterial;
  private readonly blastRingMat: THREE.ShaderMaterial;

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];

  constructor() {
    // 1. Boiling Photosphere Core (3D procedural solar granulation -- preserves dark convective texture!)
    const coreGeom = new THREE.SphereGeometry(2.85, 64, 48);
    this.photoMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 1.0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vPos;
        varying vec3 vViewDir;

        void main() {
          vPos = position;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uIntensity;

        varying vec3 vNormal;
        varying vec3 vPos;
        varying vec3 vViewDir;

        // Smooth 3D trigonometric boiling-plasma turbulence (100% deterministic, zero NaN risk)
        float solarNoise(vec3 p) {
          float n = 0.0;
          float amp = 0.5;
          vec3 q = p;
          for (int i = 0; i < 4; i++) {
            float wave = sin(q.x + cos(q.y * 1.13 + uTime * 0.8))
                       * cos(q.y + sin(q.z * 1.27 - uTime * 0.65))
                       + sin(q.z * 1.19 + q.x * 0.91 + uTime * 0.5);
            n += (wave * 0.5 + 0.5) * amp;
            q = q * 2.08 + vec3(1.7, -2.3, 0.9);
            amp *= 0.52;
          }
          return clamp(n * 0.68, 0.0, 1.0);
        }

        void main() {
          vec3 p = normalize(vPos) * 2.8;
          float flow = solarNoise(p + vec3(uTime * 0.35, -uTime * 0.25, uTime * 0.2));
          float detail = solarNoise(p * 2.2 - vec3(uTime * 0.6, uTime * 0.45, -uTime * 0.3));
          float plasma = clamp(flow * 0.65 + detail * 0.45, 0.0, 1.0);

          // Volcanic dark-crimson sunspots -> molten orange -> blazing solar gold -> white-hot flare veins
          vec3 darkSpot = vec3(0.28, 0.02, 0.01);
          vec3 crimson = vec3(0.92, 0.14, 0.03);
          vec3 molten = vec3(1.15, 0.48, 0.06);
          vec3 solarGold = vec3(1.55, 1.08, 0.36);
          vec3 whiteHot = vec3(1.95, 1.75, 1.25);

          vec3 col = mix(darkSpot, crimson, smoothstep(0.14, 0.42, plasma));
          col = mix(col, molten, smoothstep(0.38, 0.66, plasma));
          col = mix(col, solarGold, smoothstep(0.64, 0.86, plasma));
          col = mix(col, whiteHot, smoothstep(0.84, 0.98, plasma));

          // Limb brightening (incandescent glowing solar rim!)
          float ndv = clamp(abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0);
          float rim = 1.0 - ndv;
          float rim3 = rim * rim * rim;
          col += vec3(1.4, 0.52, 0.1) * rim3 * 1.25;

          gl_FragColor = vec4(col * uIntensity, 1.0);
        }
      `,
    });
    this.photosphere = new THREE.Mesh(coreGeom, this.photoMat);
    this.root.add(this.photosphere);
    this.geometries.push(coreGeom);
    this.materials.push(this.photoMat);

    // 2. Volumetric Fresnel Solar Corona Shell
    const coronaGeom = new THREE.SphereGeometry(4.3, 48, 32);
    this.coronaMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 1.0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vPos;
        void main() {
          vPos = position;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uIntensity;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vPos;
        void main() {
          float ndv = clamp(abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0);
          float halo = ndv * ndv * ndv;
          vec3 dir = normalize(vPos);
          float rays = 0.78 + 0.22 * sin(dir.x * 12.0 + uTime * 2.6) * cos(dir.y * 10.0 - uTime * 2.1);
          vec3 col = mix(vec3(1.0, 0.2, 0.04), vec3(1.3, 0.72, 0.2), ndv);
          gl_FragColor = vec4(col * rays * uIntensity, halo * 0.78);
        }
      `,
    });
    this.corona = new THREE.Mesh(coronaGeom, this.coronaMat);
    this.root.add(this.corona);
    this.geometries.push(coronaGeom);
    this.materials.push(this.coronaMat);

    // 3. 6 Twisting Magnetic Solar Prominence Plasma Loops
    this.flareMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 1.0 },
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
        varying vec2 vUv;
        void main() {
          float endFade = sin(clamp(vUv.x, 0.0, 1.0) * 3.14159265);
          float pulse = 0.55 + 0.45 * sin(vUv.x * 18.0 - uTime * 5.2 + vUv.y * 6.2831);
          vec3 col = mix(vec3(1.0, 0.22, 0.05), vec3(1.45, 0.88, 0.3), pulse * endFade);
          gl_FragColor = vec4(col, endFade * pulse * 0.65 * uOpacity);
        }
      `,
    });
    this.materials.push(this.flareMat);

    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * Math.PI * 2;
      const tilt = ((i % 3) - 1) * 0.75;
      const apexR = 4.6 + (i % 2) * 1.4;
      const p0 = new THREE.Vector3(Math.cos(a0 - 0.35) * 2.5, Math.sin(tilt) * 1.4, Math.sin(a0 - 0.35) * 2.5);
      const p1 = new THREE.Vector3(Math.cos(a0 - 0.1) * apexR, Math.sin(tilt + 0.4) * apexR * 0.55, Math.sin(a0 - 0.1) * apexR);
      const p2 = new THREE.Vector3(Math.cos(a0 + 0.18) * apexR * 0.95, Math.sin(tilt - 0.3) * apexR * 0.5, Math.sin(a0 + 0.18) * apexR * 0.95);
      const p3 = new THREE.Vector3(Math.cos(a0 + 0.42) * 2.5, -Math.sin(tilt) * 1.2, Math.sin(a0 + 0.42) * 2.5);

      const curve = new THREE.CatmullRomCurve3([p0, p1, p2, p3]);
      const tubeGeom = new THREE.TubeGeometry(curve, 36, 0.14 + (i % 2) * 0.05, 8, false);
      const mesh = new THREE.Mesh(tubeGeom, this.flareMat);
      this.flareGroup.add(mesh);
      this.geometries.push(tubeGeom);
    }
    this.root.add(this.flareGroup);

    // 4. Swirling Tilted Gravitational Accretion Disk
    const diskGeom = new THREE.RingGeometry(3.4, 11.8, 96, 6);
    this.diskMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0.7 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uOpacity;
        varying vec3 vPos;
        void main() {
          float r = length(vPos.xy);
          float rNorm = clamp((r - 3.4) / 8.4, 0.0, 1.0);
          float angle = atan(vPos.y, vPos.x);

          // Spiraling accretion filaments spinning faster near the event horizon!
          float spiral1 = sin(angle * 4.0 + 18.0 / max(r, 1.0) - uTime * 3.8);
          float spiral2 = cos(angle * 7.0 + 26.0 / max(r, 1.0) - uTime * 5.4);
          float bands = clamp(0.45 + 0.35 * spiral1 + 0.25 * spiral2, 0.0, 1.0);

          float innerFade = smoothstep(0.0, 0.16, rNorm);
          float outerFade = 1.0 - smoothstep(0.32, 1.0, rNorm);
          float alpha = innerFade * outerFade * (0.25 + bands * 0.75) * uOpacity;

          vec3 innerCol = vec3(1.45, 0.88, 0.34);
          vec3 outerCol = vec3(0.95, 0.16, 0.05);
          vec3 col = mix(innerCol, outerCol, smoothstep(0.05, 0.78, rNorm));

          gl_FragColor = vec4(col * (0.7 + bands * 0.65), alpha * 0.62);
        }
      `,
    });
    this.accretionDisk = new THREE.Mesh(diskGeom, this.diskMat);
    this.accretionDisk.rotation.x = Math.PI * 0.44;
    this.accretionDisk.rotation.y = 0.22;
    this.root.add(this.accretionDisk);
    this.geometries.push(diskGeom);
    this.materials.push(this.diskMat);

    // 5. Dual Rotating Nuclear Hazard Containment Magic Rings
    const hazardTex = createNuclearHazardRingTexture(1024);
    this.textures.push(hazardTex);

    const ringAGeom = new THREE.PlaneGeometry(17.5, 17.5);
    const ringAMat = new THREE.MeshBasicMaterial({
      map: hazardTex,
      color: new THREE.Color(0xff7c2e),
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.hazardRingA = new THREE.Mesh(ringAGeom, ringAMat);
    this.hazardRingA.rotation.x = Math.PI * 0.44;
    this.hazardRingA.rotation.y = 0.22;

    const ringBGeom = new THREE.PlaneGeometry(13.2, 13.2);
    const ringBMat = new THREE.MeshBasicMaterial({
      map: hazardTex,
      color: new THREE.Color(0xff3c28),
      transparent: true,
      opacity: 0.56,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.hazardRingB = new THREE.Mesh(ringBGeom, ringBMat);
    this.hazardRingB.rotation.x = -Math.PI * 0.34;
    this.hazardRingB.rotation.y = -0.32;

    this.root.add(this.hazardRingA, this.hazardRingB);
    this.geometries.push(ringAGeom, ringBGeom);
    this.materials.push(ringAMat, ringBMat);

    // 6. 3D Expanding Spherical Supernova Plasma Shockwave Shell (detonates violently at Act 4!)
    const shockGeom = new THREE.SphereGeometry(1.0, 48, 32);
    this.shockMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uOpacity: { value: 0 },
        uHeat: { value: 1 },
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
        uniform float uHeat;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          float ndv = clamp(abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0);
          float rim = 1.0 - ndv;
          float rim2 = rim * rim;
          float rim4 = rim2 * rim2;
          vec3 col = mix(vec3(1.15, 0.34, 0.06), vec3(1.85, 1.55, 0.95), rim2 * uHeat);
          float alpha = (rim2 * 0.32 + rim4 * 0.92) * uOpacity;
          if (alpha < 0.005) discard;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
    this.shockShell = new THREE.Mesh(shockGeom, this.shockMat);
    this.shockShell.visible = false;
    this.root.add(this.shockShell);
    this.geometries.push(shockGeom);
    this.materials.push(this.shockMat);

    // 7. Blazing Equatorial Supernova Blast Wave Torus Ring
    const blastRingGeom = new THREE.TorusGeometry(1.0, 0.065, 16, 96);
    this.blastRingMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uOpacity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          float band = 0.68 + 0.32 * sin(vUv.x * 50.265);
          vec3 col = mix(vec3(1.25, 0.48, 0.1), vec3(1.9, 1.65, 1.05), band);
          gl_FragColor = vec4(col, uOpacity * band);
        }
      `,
    });
    this.blastRing = new THREE.Mesh(blastRingGeom, this.blastRingMat);
    this.blastRing.rotation.x = Math.PI * 0.44;
    this.blastRing.rotation.y = 0.22;
    this.blastRing.visible = false;
    this.root.add(this.blastRing);
    this.geometries.push(blastRingGeom);
    this.materials.push(this.blastRingMat);
  }

  public update(
    t: number,
    ignition: number,
    climax: number,
    implosion: number,
    supernova: number,
    blastAge: number,
    outroFade: number,
  ): void {
    // Dramatic gravitational implosion pinch right before violent Supernova rebound!
    const pinch = 1.0 - implosion * 0.44;
    const rebound = supernova > 0 ? 1.0 + supernova * 0.62 : 1.0;
    const sunScale = (0.28 + ignition * 0.72 + climax * 0.14) * pinch * rebound * (0.25 + 0.75 * outroFade);
    this.photosphere.scale.setScalar(sunScale);
    this.corona.scale.setScalar(sunScale * (1.0 + climax * 0.18 + supernova * 0.52));
    this.flareGroup.scale.setScalar(sunScale * (1.0 + supernova * 0.35));

    this.photosphere.rotation.y = t * (0.32 + implosion * 1.4);
    this.flareGroup.rotation.y = -t * (0.42 + implosion * 1.2);
    this.flareGroup.rotation.z = t * 0.18;

    this.photoMat.uniforms.uTime.value = t;
    this.photoMat.uniforms.uIntensity.value =
      (0.55 + ignition * 0.58 + implosion * 0.85 + supernova * 0.72) * outroFade;

    this.coronaMat.uniforms.uTime.value = t;
    this.coronaMat.uniforms.uIntensity.value =
      (0.35 + ignition * 0.75 + implosion * 0.65 + supernova * 0.9) * outroFade;

    this.flareMat.uniforms.uTime.value = t;
    this.flareMat.uniforms.uOpacity.value = ignition * outroFade;

    this.diskMat.uniforms.uTime.value = t;
    this.diskMat.uniforms.uOpacity.value = (0.18 + ignition * 0.65 + climax * 0.25) * outroFade;
    this.accretionDisk.scale.setScalar((0.55 + ignition * 0.55) * (1.0 - implosion * 0.24) + supernova * 0.65);

    // Hazard rings spin wildly during implosion, then blow outward on detonation!
    this.hazardRingA.rotation.z = t * (0.55 + climax * 0.65 + implosion * 2.2);
    this.hazardRingB.rotation.z = -t * (0.72 + climax * 0.8 + implosion * 2.5);
    this.hazardRingA.scale.setScalar(1.0 - implosion * 0.18 + supernova * 1.35);
    this.hazardRingB.scale.setScalar(1.0 - implosion * 0.22 + supernova * 1.55);

    const warnBlink = 0.68 + 0.32 * Math.sin(t * 7.8);
    (this.hazardRingA.material as THREE.MeshBasicMaterial).opacity =
      (0.55 + (1 - ignition) * 0.35 * warnBlink) * (1 - supernova * 0.65) * outroFade;
    (this.hazardRingB.material as THREE.MeshBasicMaterial).opacity =
      (0.42 + climax * 0.26) * (1 - supernova * 0.65) * outroFade;

    // 3D Spherical Supernova Shockwave Shell + Equatorial Plasma Blast Ring
    if (blastAge > 0.001 && blastAge < 2.6) {
      const waveProg = Math.min(1, blastAge / 1.9);
      const easeR = 1.0 - (1.0 - waveProg) * (1.0 - waveProg) * (1.0 - waveProg);
      const fadeWave = Math.exp(-blastAge * 1.65) * outroFade;

      this.shockShell.visible = true;
      this.shockShell.scale.setScalar(2.4 + easeR * 34.0);
      this.shockMat.uniforms.uOpacity.value = fadeWave * 0.95;
      this.shockMat.uniforms.uHeat.value = Math.max(0.2, 1.0 - waveProg * 0.7);

      this.blastRing.visible = true;
      this.blastRing.scale.setScalar(2.6 + easeR * 38.0);
      this.blastRingMat.uniforms.uOpacity.value = fadeWave * 0.92;
    } else {
      this.shockShell.visible = false;
      this.blastRing.visible = false;
    }
  }

  public dispose(): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
  }
}
