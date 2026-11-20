import * as THREE from 'three';
import type { SpellCardInstance, SpellMetadata, SpellUpdateContext } from '../types';
import type { TimelinePhase } from '../../core/Timeline';
import {
  clamp,
  createSeededRandom,
  createStarBulletGeometry,
  lerp,
  smootherstep,
  smoothstep,
} from '../../prototypes/DanmakuMath';
import { createSoftGlowTexture } from '../../prototypes/MagicCircleFactory';

export const TH08_METADATA: SpellMetadata = {
  id: 'th08-astronomical-entombing',
  gameCode: 'TH08',
  gameName: '东方永夜抄',
  spellName: '秘术 "天文密葬法"',
  character: '八意永琳',
  bgm: '千年幻想乡 ~ History of the Moon',
  prototype: 'InstancedMesh粒子系统',
  spatialForm: '天体轨道 + 宏观深空',
  visualHighlight:
    '尺度骤然拉大. 多层倾斜 3D 开普勒行星公转轨道与 5,200+ 发光星体弹幕, 镜头从星群内部缓缓拉远 (Dolly Out) 呈现宇宙级秩序感.',
  implemented: true,
};

export const TH08_DURATION = 12.5;

const TH08_PHASES: TimelinePhase[] = [
  { id: 'inner', label: '01 星核苏醒', start: 0.0, end: 3.0, badgeStyle: 'normal' },
  { id: 'orbits', label: '02 轨道展开', start: 3.0, end: 6.4, badgeStyle: 'frozen' },
  { id: 'orrery', label: '03 宏观天球拉远', start: 6.4, end: 10.4, badgeStyle: 'burst' },
  { id: 'eternity', label: '04 永夜星渊', start: 10.4, end: 12.5, badgeStyle: 'normal' },
];

interface OrbitPlaneSpec {
  radiusX: number;
  radiusZ: number;
  tiltX: number;
  tiltZ: number;
  angularSpeed: number;
  color: THREE.Color;
  quat: THREE.Quaternion;
}

interface CelestialBullet {
  planeIdx: number;
  angle0: number;
  radialJitter: number;
  heightJitter: number;
  speedMult: number;
  scale: number;
  color: THREE.Color;
}

export class TH08AstronomicalEntombingSpell implements SpellCardInstance {
  public readonly metadata = TH08_METADATA;
  public readonly duration = TH08_DURATION;
  public readonly phases = TH08_PHASES;

  private root = new THREE.Group();
  private moonMesh: THREE.Mesh | null = null;
  private moonMat: THREE.ShaderMaterial | null = null;
  private armillaryGroup = new THREE.Group();
  private orbitRingMeshes: THREE.Mesh[] = [];
  private familiarPlanets: { mesh: THREE.Mesh; planeIdx: number; angle0: number; speed: number }[] = [];
  private constellationLines: THREE.LineSegments | null = null;
  private bulletMesh: THREE.InstancedMesh | null = null;
  private starBulletMesh: THREE.InstancedMesh | null = null;
  private starfield: THREE.Points | null = null;

  private planes: OrbitPlaneSpec[] = [];
  private bullets: CelestialBullet[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private textures: THREE.Texture[] = [];

  private camCurve: THREE.CatmullRomCurve3 | null = null;
  private readonly _pos = new THREE.Vector3();
  private readonly _quat = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3();
  private readonly _mat4 = new THREE.Matrix4();

  public init(scene: THREE.Scene, _renderer: THREE.WebGLRenderer): void {
    scene.background = new THREE.Color(0x02030c);
    scene.fog = new THREE.FogExp2(0x020410, 0.0065);

    this.root = new THREE.Group();
    scene.add(this.root);

    // 1. Central Luminous Lunar Core (silver-crimson full moon with lunar maria shading)
    const moonGeom = new THREE.SphereGeometry(2.6, 48, 36);
    this.moonMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBloodShift: { value: 0 },
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
        uniform float uBloodShift;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vPos;

        void main() {
          vec3 p = normalize(vPos) * 3.4;
          float maria = sin(p.x * 1.4 + cos(p.y * 1.7)) * cos(p.z * 1.5 - sin(p.x * 1.2));
          float craters = sin(p.x * 4.5 + p.z * 3.8) * cos(p.y * 4.2);
          float tex = clamp(0.55 + maria * 0.28 + craters * 0.12, 0.0, 1.0);

          vec3 silverDark = vec3(0.32, 0.40, 0.62);
          vec3 silverBright = vec3(0.96, 0.98, 1.15);
          vec3 bloodTint = vec3(1.18, 0.30, 0.42);

          vec3 col = mix(silverDark, silverBright, tex);
          col = mix(col, bloodTint * (0.45 + tex * 0.75), uBloodShift * 0.55);

          float ndv = clamp(abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0);
          float rim = 1.0 - ndv;
          col += mix(vec3(0.6, 0.85, 1.3), vec3(1.3, 0.4, 0.55), uBloodShift) * (rim * rim * rim) * 1.4;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.moonMesh = new THREE.Mesh(moonGeom, this.moonMat);
    this.root.add(this.moonMesh);
    this.geometries.push(moonGeom);
    this.materials.push(this.moonMat);

    // 2. Sculpted Armillary Sphere Rings around the Moon Core
    this.armillaryGroup = new THREE.Group();
    const armMat = new THREE.MeshBasicMaterial({
      color: 0xaad8ff,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.materials.push(armMat);
    for (let i = 0; i < 3; i++) {
      const rGeom = new THREE.TorusGeometry(3.7 + i * 0.65, 0.032, 10, 96);
      const rMesh = new THREE.Mesh(rGeom, armMat);
      rMesh.rotation.set(i * 0.85, i * 1.1, 0.4);
      this.armillaryGroup.add(rMesh);
      this.geometries.push(rGeom);
    }
    this.root.add(this.armillaryGroup);

    // 3. 7 Multi-Tilt Keplerian Elliptical Planetary Orbit Planes
    const orbitDefs: { rx: number; rz: number; tx: number; tz: number; spd: number; col: number }[] = [
      { rx: 6.4, rz: 6.0, tx: 0.18, tz: 0.08, spd: 0.95, col: 0x70c8ff },
      { rx: 9.2, rz: 8.6, tx: -0.42, tz: 0.26, spd: -0.78, col: 0xff527a },
      { rx: 12.5, rz: 11.4, tx: 0.62, tz: -0.32, spd: 0.62, col: 0x9eb8ff },
      { rx: 16.0, rz: 14.8, tx: -0.22, tz: -0.58, spd: -0.48, col: 0x52e0ff },
      { rx: 20.2, rz: 18.4, tx: 0.88, tz: 0.42, spd: 0.38, col: 0xb688ff },
      { rx: 24.8, rz: 22.6, tx: -0.76, tz: 0.52, spd: -0.31, col: 0xff7096 },
      { rx: 30.0, rz: 27.5, tx: 0.35, tz: -0.78, spd: 0.24, col: 0x8cc8ff },
    ];

    this.planes = [];
    this.orbitRingMeshes = [];
    const euler = new THREE.Euler();

    for (let i = 0; i < orbitDefs.length; i++) {
      const d = orbitDefs[i];
      euler.set(d.tx, 0, d.tz);
      const q = new THREE.Quaternion().setFromEuler(euler);
      const col = new THREE.Color(d.col);
      this.planes.push({
        radiusX: d.rx,
        radiusZ: d.rz,
        tiltX: d.tx,
        tiltZ: d.tz,
        angularSpeed: d.spd,
        color: col,
        quat: q,
      });

      // Glowing elliptical orbital track ring
      const ringGeom = new THREE.TorusGeometry(1.0, 0.0024, 8, 128);
      ringGeom.rotateX(Math.PI * 0.5);
      ringGeom.scale(d.rx, 1.0, d.rz);
      const ringMat = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const ringMesh = new THREE.Mesh(ringGeom, ringMat);
      ringMesh.quaternion.copy(q);
      this.root.add(ringMesh);
      this.orbitRingMeshes.push(ringMesh);
      this.geometries.push(ringGeom);
      this.materials.push(ringMat);
    }

    // 4. 5,200 Instanced Luminous Celestial Orbs orbiting along the 7 tilted planes!
    const rand = createSeededRandom(20040815); // Touhou 08 IN release date seed!
    const bulletCount = 5200;
    this.bullets = [];

    const cMoonWhite = new THREE.Color(0xf4f8ff);
    const cCrimson = new THREE.Color(0xff426c);
    const cSapphire = new THREE.Color(0x52b6ff);
    const cViolet = new THREE.Color(0xa67eff);

    for (let i = 0; i < bulletCount; i++) {
      const planeIdx = i % this.planes.length;
      const plane = this.planes[planeIdx];
      // Dense structured satellite trains + subtle orbital belt spread
      const trainSlot = Math.floor(i / this.planes.length);
      const isMajorPlanet = trainSlot % 36 === 0;
      const angle0 = (trainSlot / (bulletCount / this.planes.length)) * Math.PI * 2 * 6 + rand() * 0.08;
      const bandJitter = isMajorPlanet ? 0 : (rand() - 0.5) * 1.45;
      const hJitter = isMajorPlanet ? 0 : (rand() - 0.5) * 0.65;

      const cPick = isMajorPlanet
        ? cMoonWhite
        : i % 9 === 0
          ? cCrimson
          : i % 5 === 0
            ? cViolet
            : i % 3 === 0
              ? cSapphire
              : plane.color;

      this.bullets.push({
        planeIdx,
        angle0,
        radialJitter: bandJitter,
        heightJitter: hJitter,
        speedMult: isMajorPlanet ? 1.0 : 0.88 + rand() * 0.24,
        scale: isMajorPlanet ? 0.55 + rand() * 0.25 : 0.12 + rand() * 0.16,
        color: cPick.clone(),
      });
    }

    const orbGeom = new THREE.SphereGeometry(1.0, 20, 14);
    const orbMat = new THREE.ShaderMaterial({
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
          vNearFade = smoothstep(1.8, 4.8, -mvPos.z);
          #ifdef USE_INSTANCING_COLOR
            vColor = instanceColor;
          #else
            vColor = vec3(0.7, 0.88, 1.0);
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
          vec3 col = mix(vColor * 0.95, mix(vColor, vec3(1.05, 1.08, 1.16), 0.55), smoothstep(0.58, 0.96, core));
          float alpha = (0.16 + core * 0.68) * vNearFade;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
    this.geometries.push(orbGeom);
    this.materials.push(orbMat);

    this.bulletMesh = new THREE.InstancedMesh(orbGeom, orbMat, bulletCount);
    this.bulletMesh.frustumCulled = false;
    for (let i = 0; i < bulletCount; i++) {
      this.bulletMesh.setColorAt(i, this.bullets[i].color);
    }
    if (this.bulletMesh.instanceColor) this.bulletMesh.instanceColor.needsUpdate = true;
    this.root.add(this.bulletMesh);

    // 4b. Authentic TH08 Eirin Signatures:
    // - 14 Glowing Miniature Moon/Planet Familiars (使魔天体) orbiting on the 7 tilted planes
    // - Luminous Constellation Web Lines (天文星图连线) connecting orbiting familiars
    // - 900 Sculpted 5-Point Touhou Star Bullets (`星弹`) trailing behind the planets!
    const famGeom = new THREE.SphereGeometry(0.92, 20, 14);
    this.geometries.push(famGeom);
    this.familiarPlanets = [];
    for (let i = 0; i < 14; i++) {
      const planeIdx = i % this.planes.length;
      const pCol = this.planes[planeIdx].color;
      const famMat = new THREE.MeshBasicMaterial({
        color: pCol.clone().lerp(new THREE.Color(0xffffff), 0.35),
        transparent: true,
        opacity: 0.92,
      });
      this.materials.push(famMat);
      const mesh = new THREE.Mesh(famGeom, famMat);
      this.root.add(mesh);
      this.familiarPlanets.push({
        mesh,
        planeIdx,
        angle0: (i / 14) * Math.PI * 2 + planeIdx * 0.7,
        speed: this.planes[planeIdx].angularSpeed,
      });
    }

    // Dynamic constellation web connecting adjacent orbiting planet familiars (28 glowing astronomical edges!)
    const webPos = new Float32Array(28 * 2 * 3);
    const webGeom = new THREE.BufferGeometry();
    webGeom.setAttribute('position', new THREE.BufferAttribute(webPos, 3));
    const webMat = new THREE.LineBasicMaterial({
      color: 0x7ac8ff,
      transparent: true,
      opacity: 0.48,
      blending: THREE.AdditiveBlending,
    });
    this.constellationLines = new THREE.LineSegments(webGeom, webMat);
    this.root.add(this.constellationLines);
    this.geometries.push(webGeom);
    this.materials.push(webMat);

    // 900 Sculpted 5-Point Star Bullets (`星弹`) cascading along the outer ecliptic planes!
    const starBulletGeom = createStarBulletGeometry(0.46, 0.2, 0.12);
    const starBulletMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.geometries.push(starBulletGeom);
    this.materials.push(starBulletMat);
    this.starBulletMesh = new THREE.InstancedMesh(starBulletGeom, starBulletMat, 900);
    this.starBulletMesh.frustumCulled = false;
    const starCols = [cSapphire, cCrimson, cViolet, cMoonWhite];
    for (let i = 0; i < 900; i++) {
      this.starBulletMesh.setColorAt(i, starCols[i % starCols.length]);
    }
    if (this.starBulletMesh.instanceColor) this.starBulletMesh.instanceColor.needsUpdate = true;
    this.root.add(this.starBulletMesh);

    // 5. 3,000 Deep Space Starfield & Milky Way Dust
    const glowTex = createSoftGlowTexture(128);
    this.textures.push(glowTex);
    const starCount = 3000;
    const sPos = new Float32Array(starCount * 3);
    const sCol = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 42 + rand() * 75;
      const th = rand() * Math.PI * 2;
      const ph = Math.acos(2 * rand() - 1);
      sPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      sPos[i * 3 + 1] = r * Math.cos(ph);
      sPos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      const tint = rand();
      sCol[i * 3] = tint < 0.3 ? 1.0 : 0.72;
      sCol[i * 3 + 1] = tint < 0.3 ? 0.78 : 0.86;
      sCol[i * 3 + 2] = 1.0;
    }
    const starGeom = new THREE.BufferGeometry();
    starGeom.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    starGeom.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
    const starMat = new THREE.PointsMaterial({
      size: 0.52,
      map: glowTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.starfield = new THREE.Points(starGeom, starMat);
    this.root.add(this.starfield);
    this.geometries.push(starGeom);
    this.materials.push(starMat);

    // 6. Signature Cosmic Dolly-Out Camera:
    // Begins right inside the inner planetary shells, weaves past glowing moons,
    // then pulls majestically backward to reveal the entire 60-unit celestial mechanism!
    this.camCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(3.4, 1.2, 7.6),
        new THREE.Vector3(8.2, 3.4, 12.8),
        new THREE.Vector3(11.6, 6.8, 19.6),
        new THREE.Vector3(6.4, 10.6, 28.4),
        new THREE.Vector3(-4.5, 13.8, 36.2),
        new THREE.Vector3(-10.2, 15.2, 42.5),
      ],
      false,
      'centripetal',
      0.5,
    );
  }

  public update(ctx: SpellUpdateContext): void {
    if (!this.bulletMesh || !this.camCurve || !this.moonMesh || !this.moonMat) return;

    const t = ctx.time;
    const p = clamp(t / TH08_DURATION, 0, 1);
    const u = clamp(lerp(p, smootherstep(0, 1, p), 0.3), 0, 1);

    // 1. Majestic Cosmic Dolly-Out Camera
    this.camCurve.getPoint(u, ctx.cameraPose.position);
    ctx.cameraPose.lookAt.set(0, 0, 0);
    ctx.cameraPose.roll = Math.sin(p * Math.PI) * 0.09;
    ctx.cameraPose.fov = lerp(52, 45, u);
    ctx.cameraPose.shake = 0;

    // 2. Moon & Armillary Sphere rotation
    this.moonMesh.rotation.y = t * 0.16;
    this.moonMat.uniforms.uTime.value = t;
    this.moonMat.uniforms.uBloodShift.value = smoothstep(3.2, 8.8, t);

    this.armillaryGroup.rotation.y = t * 0.25;
    this.armillaryGroup.rotation.x = t * 0.14;

    // 3. Staggered reveal of the 7 tilted orbital planes
    for (let i = 0; i < this.orbitRingMeshes.length; i++) {
      const reveal = smoothstep(i * 0.45, i * 0.45 + 1.6, t);
      const ring = this.orbitRingMeshes[i];
      ring.scale.setScalar(0.7 + 0.3 * reveal);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.42 * reveal;
    }

    // 4. Update all 5,200 Keplerian celestial bullets deterministically
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      const plane = this.planes[b.planeIdx];
      const reveal = smoothstep(b.planeIdx * 0.42, b.planeIdx * 0.42 + 1.4, t);
      if (reveal <= 0.002) {
        this._mat4.makeScale(0, 0, 0);
        this.bulletMesh.setMatrixAt(i, this._mat4);
        continue;
      }

      const angle = b.angle0 + t * plane.angularSpeed * b.speedMult;
      const rx = plane.radiusX + b.radialJitter;
      const rz = plane.radiusZ + b.radialJitter;

      this._pos.set(Math.cos(angle) * rx, b.heightJitter, Math.sin(angle) * rz);
      this._pos.applyQuaternion(plane.quat);

      this._quat.identity();
      this._scale.setScalar(b.scale * reveal);
      this._mat4.compose(this._pos, this._quat, this._scale);
      this.bulletMesh.setMatrixAt(i, this._mat4);
    }
    this.bulletMesh.instanceMatrix.needsUpdate = true;

    // Update 14 orbiting Moon/Planet Familiars + live Constellation Star-Web Lines!
    for (let i = 0; i < this.familiarPlanets.length; i++) {
      const f = this.familiarPlanets[i];
      const pl = this.planes[f.planeIdx];
      const reveal = smoothstep(f.planeIdx * 0.4, f.planeIdx * 0.4 + 1.2, t);
      const a = f.angle0 + t * f.speed;
      this._pos.set(Math.cos(a) * pl.radiusX, 0, Math.sin(a) * pl.radiusZ).applyQuaternion(pl.quat);
      f.mesh.position.copy(this._pos);
      f.mesh.scale.setScalar(reveal * (0.75 + 0.15 * Math.sin(t * 3.0 + i)));
    }

    if (this.constellationLines && this.familiarPlanets.length === 14) {
      const posAttr = this.constellationLines.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      let ptr = 0;
      for (let i = 0; i < 14; i++) {
        const pA = this.familiarPlanets[i].mesh.position;
        const pB = this.familiarPlanets[(i + 1) % 14].mesh.position;
        const pC = this.familiarPlanets[(i + 4) % 14].mesh.position;
        arr[ptr++] = pA.x; arr[ptr++] = pA.y; arr[ptr++] = pA.z;
        arr[ptr++] = pB.x; arr[ptr++] = pB.y; arr[ptr++] = pB.z;
        arr[ptr++] = pA.x; arr[ptr++] = pA.y; arr[ptr++] = pA.z;
        arr[ptr++] = pC.x; arr[ptr++] = pC.y; arr[ptr++] = pC.z;
      }
      posAttr.needsUpdate = true;
      (this.constellationLines.material as THREE.LineBasicMaterial).opacity = 0.42 * smoothstep(1.5, 4.0, t);
    }

    // Update 900 sculpted 5-point Star Bullets (`星弹`) flowing along the celestial rings
    if (this.starBulletMesh) {
      const starReveal = smoothstep(1.2, 3.6, t);
      for (let i = 0; i < 900; i++) {
        const plIdx = i % this.planes.length;
        const pl = this.planes[plIdx];
        const a = (i / 900) * Math.PI * 2 * 7 - t * pl.angularSpeed * 0.72;
        const rJitter = ((i % 7) - 3) * 0.65;
        this._pos
          .set(Math.cos(a) * (pl.radiusX + rJitter), ((i % 5) - 2) * 0.4, Math.sin(a) * (pl.radiusZ + rJitter))
          .applyQuaternion(pl.quat);
        this._quat.setFromEuler(new THREE.Euler(t * 1.4 + i, t * 2.1 + i * 0.5, a));
        this._scale.setScalar((0.68 + (i % 3) * 0.2) * starReveal);
        this._mat4.compose(this._pos, this._quat, this._scale);
        this.starBulletMesh.setMatrixAt(i, this._mat4);
      }
      this.starBulletMesh.instanceMatrix.needsUpdate = true;
    }

    if (this.starfield) {
      this.starfield.rotation.y = t * 0.018;
    }

    const fx = ctx.postFX;
    fx.vignette = 0.38;
    fx.chromatic = 0.0012;
    fx.bloomThreshold = 1.18;
    fx.bloomStrength = 0.28;
    fx.bloomRadius = 0.36;
  }

  public getInstanceCount(): number {
    return this.bullets.length + 900 + 14 + 3000;
  }

  public dispose(scene: THREE.Scene): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    scene.remove(this.root);
    this.bulletMesh = null;
    this.starBulletMesh = null;
    this.familiarPlanets = [];
    this.orbitRingMeshes = [];
  }
}
