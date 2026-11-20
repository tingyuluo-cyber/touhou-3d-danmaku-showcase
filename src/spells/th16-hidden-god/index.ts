import * as THREE from 'three';
import type { SpellCardInstance, SpellMetadata, SpellUpdateContext } from '../types';
import type { TimelinePhase } from '../../core/Timeline';
import {
  createVolumetricBeamGeometry,
  createVolumetricBeamMaterial,
} from '../../prototypes/VolumetricLaserSystem';
import {
  clamp,
  createSeededRandom,
  easeOutCubic,
  lerp,
  orientForwardWithRoll,
  smootherstep,
  smoothstep,
} from '../../prototypes/DanmakuMath';

export const TH16_METADATA: SpellMetadata = {
  id: 'th16-hidden-god',
  gameCode: 'TH16',
  gameName: '东方天空璋',
  spellName: '后符 "绝对秘神的后光"',
  character: '摩多罗隐岐奈',
  bgm: '秘匿的四季 / 秘神摩多罗 ~ Hidden Star in All Seasons',
  prototype: '后期Shader特效',
  spatialForm: '非欧几里得传送门',
  visualHighlight:
    '8 扇金色雕花发光"后门"悬浮于 3D 虚空的非欧几里得角度, 门内呈现四季星空异次元视差, 春夏秋冬四色弹幕与体积光束从门洞倾泻而出.',
  implemented: true,
};

export const TH16_DURATION = 12.5;

const TH16_PHASES: TimelinePhase[] = [
  { id: 'appear', label: '01 秘神后门显现', start: 0.0, end: 2.8, badgeStyle: 'normal' },
  { id: 'open', label: '02 四季门洞洞开', start: 2.8, end: 6.4, badgeStyle: 'frozen' },
  { id: 'seasons', label: '03 四季弹幕倾泻', start: 6.4, end: 10.6, badgeStyle: 'burst' },
  { id: 'close', label: '04 秘匿闭门', start: 10.6, end: 12.5, badgeStyle: 'normal' },
];

interface BackdoorRig {
  group: THREE.Group;
  portalMat: THREE.ShaderMaterial;
  beamMat: THREE.ShaderMaterial;
  origin: THREE.Vector3;
  normalDir: THREE.Vector3;
  openAt: number;
  seasonIdx: number; // 0 Spring, 1 Summer, 2 Autumn, 3 Winter
}

interface SeasonBullet {
  doorIdx: number;
  cycleOffset: number;
  speed: number;
  spreadX: number;
  spreadY: number;
  scale: number;
  color: THREE.Color;
}

const SEASON_COLORS = [
  0xff84ca, // Spring Sakura Pink
  0x42eb9c, // Summer Emerald Green
  0xff7a2e, // Autumn Maple Amber-Red
  0x68d4ff, // Winter Glacial Ice-Blue
];

export class TH16HiddenGodSpell implements SpellCardInstance {
  public readonly metadata = TH16_METADATA;
  public readonly duration = TH16_DURATION;
  public readonly phases = TH16_PHASES;

  private root = new THREE.Group();
  private backlightHalo: THREE.Mesh | null = null;
  private haloMat: THREE.ShaderMaterial | null = null;
  private doors: BackdoorRig[] = [];
  private bulletMesh: THREE.InstancedMesh | null = null;
  private bullets: SeasonBullet[] = [];

  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];

  private camCurve: THREE.CatmullRomCurve3 | null = null;
  private readonly _pos = new THREE.Vector3();
  private readonly _dir = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _up = new THREE.Vector3();
  private readonly _worldUp = new THREE.Vector3(0, 1, 0);
  private readonly _quat = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3();
  private readonly _mat4 = new THREE.Matrix4();

  public init(scene: THREE.Scene, _renderer: THREE.WebGLRenderer): void {
    scene.background = new THREE.Color(0x040309);
    scene.fog = new THREE.FogExp2(0x05040c, 0.013);

    this.root = new THREE.Group();
    scene.add(this.root);

    const amb = new THREE.AmbientLight(0x8874a8, 0.8);
    const goldKey = new THREE.PointLight(0xffd278, 28, 60, 1.4);
    goldKey.position.set(0, 10, 14);
    this.root.add(amb, goldKey);

    // 0. Authentic Okina "绝对秘神的后光" (Absolute Secret God's Backlight Halo)!
    // Colossal 4-quadrant rotating Spring/Summer/Autumn/Winter sacred Buddhist aura ring behind the doors!
    const haloGeom = new THREE.PlaneGeometry(34, 34);
    this.haloMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0.72 },
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
          vec2 p = (vUv - 0.5) * 2.0;
          float r = length(p);
          if (r > 1.0) discard;
          float a = atan(p.y, p.x);

          // 4 Season quadrants rotating smoothly around the sacred Backlight Halo!
          float rotA = a - uTime * 0.25;
          float q = fract((rotA + 3.14159265) / 6.2831853);
          vec3 cSpring = vec3(1.0, 0.50, 0.78);
          vec3 cSummer = vec3(0.24, 0.90, 0.58);
          vec3 cAutumn = vec3(1.0, 0.46, 0.16);
          vec3 cWinter = vec3(0.38, 0.82, 1.0);

          vec3 seasonCol = mix(cSpring, cSummer, smoothstep(0.20, 0.30, q));
          seasonCol = mix(seasonCol, cAutumn, smoothstep(0.45, 0.55, q));
          seasonCol = mix(seasonCol, cWinter, smoothstep(0.70, 0.80, q));
          seasonCol = mix(seasonCol, cSpring, smoothstep(0.95, 1.0, q));

          // Sacred concentric gold-rimmed rings + 24 radiating "后光" sunburst rays
          float outerRing = exp(-((r - 0.88) * (r - 0.88)) / 0.0008);
          float midRing = exp(-((r - 0.58) * (r - 0.58)) / 0.0007);
          float innerRing = exp(-((r - 0.30) * (r - 0.30)) / 0.0009);
          float rays = (0.5 + 0.5 * sin(rotA * 24.0)) * smoothstep(0.26, 0.55, r) * (1.0 - smoothstep(0.72, 0.96, r));

          vec3 gold = vec3(1.25, 0.98, 0.45);
          vec3 col = seasonCol * (rays * 0.52 + midRing * 0.45) + gold * (outerRing * 0.85 + innerRing * 0.72 + midRing * 0.5);
          float alpha = clamp(outerRing * 0.85 + midRing * 0.65 + innerRing * 0.7 + rays * 0.32, 0.0, 1.0) * uOpacity;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
    this.backlightHalo = new THREE.Mesh(haloGeom, this.haloMat);
    this.backlightHalo.position.set(0, 0.2, -13.5);
    this.root.add(this.backlightHalo);
    this.geometries.push(haloGeom);
    this.materials.push(this.haloMat);

    // 1. 8 Floating Non-Euclidean Backdoor Portals suspended at dramatic tilted 3D angles!
    const doorConfigs: { pos: [number, number, number]; look: [number, number, number]; roll: number }[] = [
      { pos: [-11.5, 4.2, -3.5], look: [1.5, -0.5, 1.0], roll: 0.14 },
      { pos: [11.5, 4.2, -3.5], look: [-1.5, -0.5, 1.0], roll: -0.14 },
      { pos: [-9.2, -4.8, 2.5], look: [1.0, 2.2, -2.0], roll: -0.22 },
      { pos: [9.2, -4.8, 2.5], look: [-1.0, 2.2, -2.0], roll: 0.22 },
      { pos: [0.0, 9.8, -6.5], look: [0.0, -3.0, 1.0], roll: Math.PI }, // Upside-down non-Euclidean sky door!
      { pos: [0.0, -9.2, -5.5], look: [0.0, 3.0, 1.0], roll: 0.0 },
      { pos: [-14.2, 0.5, -10.5], look: [0.0, 0.0, 3.5], roll: 0.32 },
      { pos: [14.2, 0.5, -10.5], look: [0.0, 0.0, 3.5], roll: -0.32 },
    ];

    const frameMat = new THREE.MeshStandardMaterial({
      color: 0xffd678,
      metalness: 0.88,
      roughness: 0.22,
      emissive: new THREE.Color(0x9a6418),
      emissiveIntensity: 0.72,
    });
    this.materials.push(frameMat);

    const sidePostGeom = new THREE.BoxGeometry(0.26, 6.4, 0.28);
    const lintelGeom = new THREE.BoxGeometry(4.4, 0.28, 0.3);
    const portalPlaneGeom = new THREE.PlaneGeometry(3.8, 5.9);
    const beamGeom = createVolumetricBeamGeometry(1.4, 3.4, 24, 16);
    this.geometries.push(sidePostGeom, lintelGeom, portalPlaneGeom, beamGeom);

    this.doors = [];
    for (let i = 0; i < doorConfigs.length; i++) {
      const cfg = doorConfigs[i];
      const seasonIdx = i % 4;
      const seasonCol = new THREE.Color(SEASON_COLORS[seasonIdx]);

      const group = new THREE.Group();
      const origin = new THREE.Vector3(...cfg.pos);
      const lookTarget = new THREE.Vector3(...cfg.look);
      const normalDir = new THREE.Vector3().subVectors(lookTarget, origin).normalize();

      group.position.copy(origin);
      group.lookAt(lookTarget);
      group.rotateZ(cfg.roll);

      // Ornate golden doorway frame (left/right posts + top/bottom lintels + inner arch bar)
      const leftPost = new THREE.Mesh(sidePostGeom, frameMat);
      leftPost.position.x = -2.0;
      const rightPost = new THREE.Mesh(sidePostGeom, frameMat);
      rightPost.position.x = 2.0;
      const topBar = new THREE.Mesh(lintelGeom, frameMat);
      topBar.position.y = 3.1;
      const botBar = new THREE.Mesh(lintelGeom, frameMat);
      botBar.position.y = -3.1;

      // Custom Parallax Seasonal Dimension Portal Shader inside each doorway!
      const portalMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uOpen: { value: 0 },
          uColor: { value: seasonCol },
          uSeed: { value: i * 1.73 },
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
          uniform float uOpen;
          uniform vec3 uColor;
          uniform float uSeed;
          varying vec2 vUv;

          void main() {
            vec2 p = (vUv - 0.5) * vec2(1.0, 1.55);
            float r = length(p);
            float a = atan(p.y, p.x);

            // Swirling starry dimensional vortex visible inside the open backdoor!
            float vortex = 0.5 + 0.5 * sin(a * 5.0 - r * 12.0 + uTime * 3.4 + uSeed);
            float rings = 0.5 + 0.5 * cos(r * 18.0 - uTime * 4.2);
            float core = exp(-(r * r) * 3.2);

            // Sliding double-door reveal mask from center outward
            float slit = abs(vUv.x - 0.5) * 2.0;
            float doorMask = smoothstep(uOpen + 0.05, max(0.0, uOpen - 0.08), slit);

            vec3 deepBg = uColor * 0.16;
            vec3 swirlCol = mix(uColor, vec3(1.0, 0.96, 0.92), core * 0.65 + rings * 0.22);
            vec3 col = mix(deepBg, swirlCol * (0.75 + vortex * 0.7), 0.4 + core * 0.6);

            // Crisp golden edge glow framing the open doorway
            float border = smoothstep(0.42, 0.5, max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)));
            col += vec3(1.4, 1.15, 0.55) * border * 0.8;

            gl_FragColor = vec4(col, doorMask * 0.92);
          }
        `,
      });
      this.materials.push(portalMat);
      const portalMesh = new THREE.Mesh(portalPlaneGeom, portalMat);

      // Volumetric seasonal light shaft pouring straight out of the doorway (+Z)
      const beamMat = createVolumetricBeamMaterial(0xffffff, SEASON_COLORS[seasonIdx], 'halo');
      this.materials.push(beamMat);
      const beamMesh = new THREE.Mesh(beamGeom, beamMat);

      group.add(leftPost, rightPost, topBar, botBar, portalMesh, beamMesh);
      this.root.add(group);

      this.doors.push({
        group,
        portalMat,
        beamMat,
        origin,
        normalDir,
        openAt: 1.0 + i * 0.36,
        seasonIdx,
      });
    }

    // 2. 3,600 Four-Season Luminous Bullets pouring out of all 8 backdoors!
    const rand = createSeededRandom(20170811); // Touhou 16 HSiFS release date seed!
    const count = 3600;
    this.bullets = [];

    for (let i = 0; i < count; i++) {
      const doorIdx = i % this.doors.length;
      const baseCol = new THREE.Color(SEASON_COLORS[this.doors[doorIdx].seasonIdx]);
      if (i % 7 === 0) baseCol.lerp(new THREE.Color(0xfff4d0), 0.55);
      this.bullets.push({
        doorIdx,
        cycleOffset: rand() * 3.8,
        speed: 7.2 + rand() * 4.8,
        spreadX: (rand() - 0.5) * 3.4,
        spreadY: (rand() - 0.5) * 5.0,
        scale: 0.11 + rand() * 0.12,
        color: baseCol,
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
          vNearFade = smoothstep(3.5, 9.5, -mvPos.z);
          #ifdef USE_INSTANCING_COLOR
            vColor = instanceColor;
          #else
            vColor = vec3(1.0);
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
          vec3 col = mix(vColor * 0.78, mix(vColor, vec3(1.04, 1.02, 0.98), 0.32), smoothstep(0.66, 0.96, core));
          float alpha = (0.08 + core * 0.36) * vNearFade;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
    this.geometries.push(orbGeom);
    this.materials.push(orbMat);

    this.bulletMesh = new THREE.InstancedMesh(orbGeom, orbMat, count);
    this.bulletMesh.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      this.bulletMesh.setColorAt(i, this.bullets[i].color);
    }
    if (this.bulletMesh.instanceColor) this.bulletMesh.instanceColor.needsUpdate = true;
    this.root.add(this.bulletMesh);

    // 3. Sweeping Camera framing the 8 golden backdoors & rotating 4-season Backlight Halo crisply
    this.camCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0.0, 1.2, 24.5),
        new THREE.Vector3(9.6, 2.8, 20.5),
        new THREE.Vector3(7.4, -1.6, 16.5),
        new THREE.Vector3(-8.4, 2.4, 17.0),
        new THREE.Vector3(-6.4, 4.4, 22.0),
        new THREE.Vector3(0.0, 2.0, 25.5),
      ],
      false,
      'centripetal',
      0.5,
    );
  }

  public update(ctx: SpellUpdateContext): void {
    if (!this.bulletMesh || !this.camCurve) return;

    const t = ctx.time;
    const p = clamp(t / TH16_DURATION, 0, 1);
    const u = clamp(lerp(p, smootherstep(0, 1, p), 0.25), 0, 1);
    const closeFade = 1 - smoothstep(10.6, 12.1, t);

    this.camCurve.getPoint(u, ctx.cameraPose.position);
    ctx.cameraPose.lookAt.set(0, 0, -2.5);
    ctx.cameraPose.roll = Math.sin(p * Math.PI * 2) * 0.11;
    ctx.cameraPose.fov = 52 + Math.sin(p * Math.PI) * 5.0;
    ctx.cameraPose.shake = 0;

    if (this.haloMat && this.backlightHalo) {
      this.haloMat.uniforms.uTime.value = t;
      this.haloMat.uniforms.uOpacity.value = smoothstep(0.4, 2.2, t) * closeFade * 0.78;
      this.backlightHalo.scale.setScalar(0.85 + 0.15 * smoothstep(0.4, 3.0, t));
    }

    // Animate all 8 floating non-Euclidean doors opening & pouring seasonal light
    const doorOpenAmounts: number[] = [];
    for (let i = 0; i < this.doors.length; i++) {
      const d = this.doors[i];
      const openAmt = easeOutCubic(clamp((t - d.openAt) / 1.15, 0, 1)) * closeFade;
      doorOpenAmounts.push(openAmt);
      d.portalMat.uniforms.uTime.value = t;
      d.portalMat.uniforms.uOpen.value = openAmt;
      d.beamMat.uniforms.uTime.value = t;
      d.beamMat.uniforms.uOpacity.value = openAmt * 0.24;
      // Gentle zero-gravity mystical hover
      d.group.position.y = d.origin.y + Math.sin(t * 1.1 + i * 1.4) * 0.45;
    }

    // Stream 3,600 seasonal bullets straight out of each open doorway!
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      const door = this.doors[b.doorIdx];
      const openAmt = doorOpenAmounts[b.doorIdx];
      if (openAmt <= 0.05) {
        this._mat4.makeScale(0, 0, 0);
        this.bulletMesh.setMatrixAt(i, this._mat4);
        continue;
      }

      const cycle = (t + b.cycleOffset) % 3.8;
      const dist = cycle * b.speed;
      const fade = smoothstep(0.0, 0.25, cycle) * (1 - smoothstep(2.9, 3.8, cycle));

      this._dir.copy(door.normalDir);
      this._right.crossVectors(this._dir, this._worldUp);
      if (this._right.lengthSq() < 1e-4) this._right.set(1, 0, 0);
      else this._right.normalize();
      this._up.crossVectors(this._right, this._dir).normalize();

      const expand = 0.65 + dist * 0.085;
      this._pos
        .copy(door.group.position)
        .addScaledVector(this._dir, dist)
        .addScaledVector(this._right, b.spreadX * expand + Math.sin(cycle * 2.4 + i) * 0.35)
        .addScaledVector(this._up, b.spreadY * expand + Math.cos(cycle * 2.1 + i) * 0.35);

      orientForwardWithRoll(this._dir, cycle * 2.5 + i, this._quat);
      this._scale.setScalar(b.scale * openAmt * fade);
      this._mat4.compose(this._pos, this._quat, this._scale);
      this.bulletMesh.setMatrixAt(i, this._mat4);
    }
    this.bulletMesh.instanceMatrix.needsUpdate = true;

    const fx = ctx.postFX;
    fx.vignette = 0.4;
    fx.chromatic = 0.0014;
    fx.bloomThreshold = 1.18;
    fx.bloomStrength = 0.28;
    fx.bloomRadius = 0.36;
  }

  public getInstanceCount(): number {
    return 8 + this.bullets.length;
  }

  public dispose(scene: THREE.Scene): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    scene.remove(this.root);
    this.doors = [];
    this.bulletMesh = null;
  }
}
