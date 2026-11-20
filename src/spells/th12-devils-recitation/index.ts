import * as THREE from 'three';
import type { SpellCardInstance, SpellMetadata, SpellUpdateContext } from '../types';
import type { TimelinePhase } from '../../core/Timeline';
import { createPrismaticRibbonMaterial } from '../../prototypes/VolumetricLaserSystem';
import {
  clamp,
  createSeededRandom,
  createStarBulletGeometry,
  lerp,
  smootherstep,
  smoothstep,
} from '../../prototypes/DanmakuMath';

export const TH12_METADATA: SpellMetadata = {
  id: 'th12-devils-recitation',
  gameCode: 'TH12',
  gameName: '东方星莲船',
  spellName: '大魔法 "魔神复诵"',
  character: '圣白莲',
  bgm: '感情的摩天楼 ~ Cosmic Mind',
  prototype: '体积激光与拖尾条带',
  spatialForm: '同轴法阵隧道',
  visualHighlight:
    '14 层宗教/魔导法阵沿 Z 轴排列成旋转纵深光环隧道, 24 道炫彩弯曲激光彩带与螺旋星弹缠绕, 镜头沿中轴线高速推进.',
  implemented: true,
};

export const TH12_DURATION = 12.5;

const TH12_PHASES: TimelinePhase[] = [
  { id: 'chant', label: '01 咏唱启阵', start: 0.0, end: 2.8, badgeStyle: 'normal' },
  { id: 'tunnel', label: '02 同轴法阵推进', start: 2.8, end: 6.6, badgeStyle: 'frozen' },
  { id: 'recitation', label: '03 魔神复诵高潮', start: 6.6, end: 10.6, badgeStyle: 'burst' },
  { id: 'nirvana', label: '04 彼岸光门', start: 10.6, end: 12.5, badgeStyle: 'normal' },
];

/**
 * Generates an intricate Buddhist/esoteric lotus-mandala spell circle for TH12 Byakuren.
 */
function createMandalaTunnelTexture(size = 1024): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.46;

  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = '#ffffff';
  ctx.shadowColor = '#b488ff';
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

  ring(R * 0.98, 4.0, 0.94);
  ring(R * 0.90, 2.2, 0.72, [12, 10]);
  ring(R * 0.74, 3.0, 0.85);
  ring(R * 0.56, 2.0, 0.65);

  // 16 lotus petals blooming around the ring rim (open center for tunnel visibility!)
  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 2.4;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, -R * 0.56);
    ctx.quadraticCurveTo(R * 0.14, -R * 0.78, 0, -R * 0.96);
    ctx.quadraticCurveTo(-R * 0.14, -R * 0.78, 0, -R * 0.56);
    ctx.stroke();
    ctx.restore();
  }

  // Inscribed 8-point mystic dharma star around mid ring
  ctx.globalAlpha = 0.65;
  ctx.lineWidth = 2.2;
  for (let k = 0; k < 2; k++) {
    const rot = (k * Math.PI) / 4;
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const a = rot + (i / 4) * Math.PI * 2;
      const x = cx + Math.cos(a) * R * 0.74;
      const y = cy + Math.sin(a) * R * 0.74;
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

interface TunnelOrb {
  z0: number;
  angle0: number;
  radius: number;
  spinRate: number;
  scale: number;
  color: THREE.Color;
}

export class TH12DevilsRecitationSpell implements SpellCardInstance {
  public readonly metadata = TH12_METADATA;
  public readonly duration = TH12_DURATION;
  public readonly phases = TH12_PHASES;

  private root = new THREE.Group();
  private mandalaRings: THREE.Mesh[] = [];
  private ribbonMats: THREE.ShaderMaterial[] = [];
  private wingLaserGroups: THREE.Group[] = [];
  private pillarBeams: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; baseAngle: number }[] = [];
  private cannonCore: THREE.Mesh | null = null;
  private cannonCoreMat: THREE.ShaderMaterial | null = null;
  private cannonSheath: THREE.Mesh | null = null;
  private cannonSheathMat: THREE.ShaderMaterial | null = null;
  private cannonRings: THREE.Mesh[] = [];
  private orbMesh: THREE.InstancedMesh | null = null;
  private starMesh: THREE.InstancedMesh | null = null;
  private orbs: TunnelOrb[] = [];

  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private textures: THREE.Texture[] = [];

  private readonly _pos = new THREE.Vector3();
  private readonly _euler = new THREE.Euler();
  private readonly _quat = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3();
  private readonly _mat4 = new THREE.Matrix4();

  public init(scene: THREE.Scene, _renderer: THREE.WebGLRenderer): void {
    scene.background = new THREE.Color(0x04020d);
    scene.fog = new THREE.FogExp2(0x050211, 0.014);

    this.root = new THREE.Group();
    scene.add(this.root);

    const mandalaTex = createMandalaTunnelTexture(1024);
    this.textures.push(mandalaTex);

    // 1. 14 Giant Coaxial Rotating Dharma-Mandala Magic Rings along Z (+8 -> -76)
    const ringColors = [0xc27cff, 0x58d4ff, 0xffd264, 0xff5a9c, 0x62f0ba];
    const ringGeom = new THREE.PlaneGeometry(24, 24);
    this.geometries.push(ringGeom);
    this.mandalaRings = [];

    for (let i = 0; i < 14; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: mandalaTex,
        color: new THREE.Color(ringColors[i % ringColors.length]),
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(ringGeom, mat);
      mesh.position.set(0, 0, 8 - i * 6.5);
      mesh.scale.setScalar(0.88 + (i % 3) * 0.14);
      this.root.add(mesh);
      this.mandalaRings.push(mesh);
    }

    // 2. 24 Sweeping Helical Iridescent Laser Ribbons threading the entire 90-unit coaxial tunnel!
    this.ribbonMats = [];
    for (let i = 0; i < 24; i++) {
      const baseAngle = (i / 24) * Math.PI * 2;
      const twistDir = i % 2 === 0 ? 1 : -1;
      const radBase = 5.4 + (i % 3) * 2.2;
      const pts: THREE.Vector3[] = [];
      for (let s = 0; s <= 32; s++) {
        const frac = s / 32;
        const z = 14 - frac * 98;
        const a = baseAngle + twistDir * frac * Math.PI * 3.2;
        const r = radBase + Math.sin(frac * Math.PI * 6 + i) * 1.1;
        pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tubeGeom = new THREE.TubeGeometry(curve, 110, 0.085, 6, false);
      const mat = createPrismaticRibbonMaterial(ringColors[i % ringColors.length], i * 0.52);
      this.geometries.push(tubeGeom);
      this.materials.push(mat);
      this.ribbonMats.push(mat);

      const mesh = new THREE.Mesh(tubeGeom, mat);
      this.root.add(mesh);
    }

    // 2b. Authentic Byakuren "魔神复诵" Signature:
    // Symmetrical blooming CURVED RAINBOW LASER WINGS (曲线激光扇) unfurling across key mandala gates!
    this.wingLaserGroups = [];
    const wingColors = [0xff4c78, 0xffaa38, 0xffe452, 0x4ae898, 0x4cc4ff, 0x9c6eff];
    const wingCurvePts = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(3.8, 1.8, -1.2),
      new THREE.Vector3(8.5, 4.2, 0.8),
      new THREE.Vector3(13.2, 2.2, 3.6),
      new THREE.Vector3(15.5, -2.5, 5.2),
    ];
    const wingCurve = new THREE.CatmullRomCurve3(wingCurvePts);
    const wingGeom = new THREE.TubeGeometry(wingCurve, 36, 0.11, 6, false);
    this.geometries.push(wingGeom);

    for (let g = 0; g < 5; g++) {
      const gateGroup = new THREE.Group();
      gateGroup.position.set(0, 0, -6 - g * 13.5);
      for (let side = -1; side <= 1; side += 2) {
        for (let b = 0; b < 6; b++) {
          const mat = createPrismaticRibbonMaterial(wingColors[b], g * 1.1 + b * 0.6);
          this.materials.push(mat);
          this.ribbonMats.push(mat);
          const beam = new THREE.Mesh(wingGeom, mat);
          beam.scale.x = side;
          beam.rotation.z = side * (-0.55 + (b / 5) * 1.15);
          gateGroup.add(beam);
        }
      }
      this.root.add(gateGroup);
      this.wingLaserGroups.push(gateGroup);
    }

    // 2c. 1,000 Sculpted 5-Point Glowing Star Bullets (`星弹`) weaving through Byakuren's tunnel!
    const starGeom = createStarBulletGeometry(0.42, 0.18, 0.1);
    const starMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.geometries.push(starGeom);
    this.materials.push(starMat);
    this.starMesh = new THREE.InstancedMesh(starGeom, starMat, 1000);
    this.starMesh.frustumCulled = false;
    const starPalette = wingColors.map((h) => new THREE.Color(h));
    for (let i = 0; i < 1000; i++) {
      this.starMesh.setColorAt(i, starPalette[i % starPalette.length]);
    }
    if (this.starMesh.instanceColor) this.starMesh.instanceColor.needsUpdate = true;
    this.root.add(this.starMesh);

    // 3. 2,800 Luminous Helical Lotus-Star Orbs spiraling down the tunnel walls!
    const rand = createSeededRandom(20090815); // Touhou 12 UFO release date seed!
    const orbCount = 2800;
    this.orbs = [];
    const orbPalette = ringColors.map((h) => new THREE.Color(h));

    for (let i = 0; i < orbCount; i++) {
      this.orbs.push({
        z0: 14 - rand() * 96,
        angle0: rand() * Math.PI * 2,
        radius: 3.4 + rand() * 7.8,
        spinRate: (i % 2 === 0 ? 1 : -1) * (0.45 + rand() * 0.55),
        scale: 0.14 + rand() * 0.18,
        color: orbPalette[i % orbPalette.length].clone(),
      });
    }

    const orbGeom = new THREE.SphereGeometry(1.0, 18, 12);
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
          vNearFade = smoothstep(1.6, 4.5, -mvPos.z);
          #ifdef USE_INSTANCING_COLOR
            vColor = instanceColor;
          #else
            vColor = vec3(0.8, 0.65, 1.0);
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
          vec3 col = mix(vColor * 0.92, mix(vColor, vec3(1.08, 1.06, 1.16), 0.45), smoothstep(0.58, 0.96, core));
          float alpha = (0.14 + core * 0.62) * vNearFade;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
    this.geometries.push(orbGeom);
    this.materials.push(orbMat);

    this.orbMesh = new THREE.InstancedMesh(orbGeom, orbMat, orbCount);
    this.orbMesh.frustumCulled = false;
    for (let i = 0; i < orbCount; i++) {
      this.orbMesh.setColorAt(i, this.orbs[i].color);
    }
    if (this.orbMesh.instanceColor) this.orbMesh.instanceColor.needsUpdate = true;
    this.root.add(this.orbMesh);

    // 4. Shinki-Homage 6 Straight Volumetric Demon-Wing Laser Pillars running along the mandala walls!
    const pillarGeom = new THREE.CylinderGeometry(0.28, 0.28, 104, 16, 1, true);
    pillarGeom.rotateX(Math.PI / 2);
    this.geometries.push(pillarGeom);
    this.pillarBeams = [];
    const pillarPalette = [0xc878ff, 0x4ad8ff, 0xffd260, 0xff5a9c, 0x4ad8ff, 0xc878ff];

    for (let i = 0; i < 6; i++) {
      const baseAngle = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const pMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uOpacity: { value: 0 },
          uColor: { value: new THREE.Color(pillarPalette[i]) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vNormal;
          varying vec3 vViewDir;
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
            vNormal = normalize(normalMatrix * normal);
            vViewDir = normalize(-mvPos.xyz);
            gl_Position = projectionMatrix * mvPos;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform float uOpacity;
          uniform vec3 uColor;
          varying vec3 vNormal;
          varying vec3 vViewDir;
          varying vec2 vUv;
          void main() {
            float ndv = clamp(abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0);
            float core = ndv * ndv;
            float surge = 0.72 + 0.28 * sin(vUv.y * 42.0 - uTime * 14.0);
            vec3 col = mix(uColor * 1.15, vec3(1.5, 1.45, 1.65), smoothstep(0.52, 0.94, core));
            float alpha = (0.14 + core * 0.78) * surge * uOpacity;
            if (alpha < 0.005) discard;
            gl_FragColor = vec4(col, alpha);
          }
        `,
      });
      this.materials.push(pMat);
      const mesh = new THREE.Mesh(pillarGeom, pMat);
      mesh.position.set(Math.cos(baseAngle) * 6.4, Math.sin(baseAngle) * 6.4, -32);
      this.root.add(mesh);
      this.pillarBeams.push({ mesh, mat: pMat, baseAngle });
    }

    // 5. GRAND MASTER-SPARK-SCALE MAGIC CANNON ("大魔法 · 魔神复诵贯通魔炮") firing straight down the tunnel!
    const coreGeom = new THREE.CylinderGeometry(1.15, 0.75, 108, 28, 1, true);
    coreGeom.rotateX(Math.PI / 2);
    this.cannonCoreMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uOpacity;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec2 vUv;
        void main() {
          float ndv = clamp(abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0);
          float core = ndv * ndv;
          float energy = 0.78 + 0.22 * sin(vUv.y * 55.0 - uTime * 22.0);
          vec3 col = mix(vec3(0.95, 0.45, 1.35), vec3(1.65, 1.58, 1.8), smoothstep(0.35, 0.88, core));
          gl_FragColor = vec4(col * energy, (0.22 + core * 0.78) * uOpacity);
        }
      `,
    });
    this.cannonCore = new THREE.Mesh(coreGeom, this.cannonCoreMat);
    this.cannonCore.position.set(0, 0, -28);
    this.cannonCore.visible = false;
    this.root.add(this.cannonCore);
    this.geometries.push(coreGeom);
    this.materials.push(this.cannonCoreMat);

    const sheathGeom = new THREE.CylinderGeometry(2.35, 1.45, 108, 32, 1, true);
    sheathGeom.rotateX(Math.PI / 2);
    this.cannonSheathMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uOpacity;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec2 vUv;
        void main() {
          float ndv = clamp(abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0);
          float edge = 1.0 - ndv;
          float helix = 0.5 + 0.5 * sin(vUv.x * 25.132 + vUv.y * 34.0 - uTime * 18.0);
          vec3 spec = 0.58 + 0.42 * cos(6.28318 * (vUv.x + vUv.y * 1.4 - uTime * 0.75 + vec3(0.0, 0.33, 0.67)));
          vec3 col = mix(vec3(0.75, 0.32, 1.15), spec * 1.35, 0.55 + helix * 0.45);
          float alpha = (0.18 + edge * edge * 0.55 + helix * 0.25) * uOpacity;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
    this.cannonSheath = new THREE.Mesh(sheathGeom, this.cannonSheathMat);
    this.cannonSheath.position.set(0, 0, -28);
    this.cannonSheath.visible = false;
    this.root.add(this.cannonSheath);
    this.geometries.push(sheathGeom);
    this.materials.push(this.cannonSheathMat);

    // 6 Traveling Shock-Rings rushing down the Grand Magic Cannon barrel!
    const shockTorusGeom = new THREE.TorusGeometry(2.35, 0.12, 12, 64);
    const shockTorusMat = new THREE.MeshBasicMaterial({
      color: 0xe6b8ff,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.geometries.push(shockTorusGeom);
    this.materials.push(shockTorusMat);
    this.cannonRings = [];
    for (let i = 0; i < 6; i++) {
      const rMesh = new THREE.Mesh(shockTorusGeom, shockTorusMat);
      rMesh.visible = false;
      this.root.add(rMesh);
      this.cannonRings.push(rMesh);
    }
  }

  public update(ctx: SpellUpdateContext): void {
    if (!this.orbMesh) return;

    const t = ctx.time;
    const p = clamp(t / TH12_DURATION, 0, 1);
    const climax = smoothstep(5.5, 8.2, t) * (1 - smoothstep(10.8, 12.2, t));

    // Grand Master-Spark Cannon charge (5.2s->6.3s) -> BLAZING IGNITION (6.35s->10.8s)!
    const cannonCharge = smoothstep(5.0, 6.28, t) * (1 - smoothstep(6.32, 6.5, t));
    const cannonFire = smoothstep(6.3, 6.55, t) * (1 - smoothstep(10.6, 11.4, t));
    const cannonBlastAge = Math.max(0, t - 6.35);
    const cannonImpulse = cannonBlastAge > 0 && cannonBlastAge < 1.5 ? Math.exp(-cannonBlastAge * 4.5) : 0;

    // Thrilling flight down the coaxial mandala tunnel — banks cleanly off-center during Cannon Fire
    // so the colossal rainbow-amethyst Master Spark beam roars heroically past the viewer's flank!
    const zTravel = lerp(17.5, -52.0, lerp(p, smootherstep(0, 1, p), 0.28));
    const flankOffset = smoothstep(5.2, 6.6, t) * (1 - smoothstep(10.8, 12.2, t));
    const swayX = Math.sin(t * 0.85) * 1.1 + flankOffset * 4.6;
    const swayY = Math.cos(t * 0.72) * 0.85 - flankOffset * 1.65;

    ctx.cameraPose.position.set(swayX, swayY, zTravel);
    ctx.cameraPose.lookAt.set(swayX * 0.12, swayY * 0.12, zTravel - 26.0);
    ctx.cameraPose.roll = Math.sin(p * Math.PI * 2.0) * 0.24 + flankOffset * 0.18;
    ctx.cameraPose.fov = 53 + climax * 8.0 + cannonImpulse * 9.0;
    ctx.cameraPose.shake = climax * 0.03 + cannonFire * 0.045 + cannonImpulse * 0.22;

    // Counter-rotating coaxial dharma rings with pulsing opacity relative to active camera Z
    const activeCamZ = ctx.isFreeCamera ? ctx.cameraWorldPosition.z : zTravel;
    for (let i = 0; i < this.mandalaRings.length; i++) {
      const m = this.mandalaRings[i];
      const dir = i % 2 === 0 ? 1 : -1;
      m.rotation.z = t * dir * (0.38 + (i % 3) * 0.14) + i * 0.4;
      const dz = m.position.z - activeCamZ;
      const passFade = smoothstep(-0.8, -5.5, dz);
      (m.material as THREE.MeshBasicMaterial).opacity = (0.58 + climax * 0.25) * passFade;
    }

    for (let i = 0; i < this.ribbonMats.length; i++) {
      this.ribbonMats[i].uniforms.uTime.value = t * (1.2 + climax * 0.45);
      this.ribbonMats[i].uniforms.uOpacity.value = 0.58 + climax * 0.34;
    }

    // Animate 6 Flanking Shinki-Homage Straight Laser Pillars (thin charge sightlines -> full pillars!)
    const pillarCharge = smoothstep(2.2, 3.2, t);
    const pillarFull = smoothstep(3.3, 3.8, t) * (1 - smoothstep(11.0, 12.1, t));
    for (let i = 0; i < this.pillarBeams.length; i++) {
      const pb = this.pillarBeams[i];
      const a = pb.baseAngle + t * 0.16;
      pb.mesh.position.x = Math.cos(a) * 6.4;
      pb.mesh.position.y = Math.sin(a) * 6.4;
      const thick = 0.16 + pillarFull * 0.95 + cannonFire * 0.35;
      pb.mesh.scale.set(thick, thick, 1.0);
      pb.mat.uniforms.uTime.value = t;
      pb.mat.uniforms.uOpacity.value = pillarCharge * (0.28 + pillarFull * 0.62);
    }

    // Animate Grand Central Master-Spark Magic Cannon + hypersonic shock-rings!
    if (this.cannonCore && this.cannonCoreMat && this.cannonSheath && this.cannonSheathMat) {
      const active = cannonCharge > 0.01 || cannonFire > 0.01;
      this.cannonCore.visible = active;
      this.cannonSheath.visible = cannonFire > 0.01;
      if (active) {
        const coreWidth = 0.08 * cannonCharge + cannonFire * (0.88 + 0.1 * Math.sin(t * 28.0));
        this.cannonCore.scale.set(coreWidth, coreWidth, 1.0);
        this.cannonCoreMat.uniforms.uTime.value = t;
        this.cannonCoreMat.uniforms.uOpacity.value = Math.min(0.82, cannonCharge * 0.5 + cannonFire * 0.82);

        const sheathWidth = cannonFire * (0.95 + 0.12 * Math.cos(t * 22.0));
        this.cannonSheath.scale.set(sheathWidth, sheathWidth, 1.0);
        this.cannonSheathMat.uniforms.uTime.value = t;
        this.cannonSheathMat.uniforms.uOpacity.value = cannonFire * 0.44;
      }
      for (let i = 0; i < this.cannonRings.length; i++) {
        const rMesh = this.cannonRings[i];
        rMesh.visible = cannonFire > 0.02;
        if (rMesh.visible) {
          const frac = ((t * 1.45 + i / this.cannonRings.length) % 1.0);
          rMesh.position.set(0, 0, lerp(-76, 22, frac));
          rMesh.scale.setScalar((0.75 + frac * 1.15) * cannonFire);
          rMesh.rotation.z = t * 2.5 + i;
        }
      }
    }

    // Animate Byakuren's curved rainbow laser wings pulsing open & closed like breathing lotus wings!
    for (let g = 0; g < this.wingLaserGroups.length; g++) {
      const grp = this.wingLaserGroups[g];
      const breathe = 0.72 + 0.32 * Math.sin(t * 2.2 - g * 0.85);
      grp.scale.set(breathe, breathe, 1.0);
      grp.rotation.z = Math.sin(t * 0.8 + g) * 0.35;
    }

    // Update 1,000 sculpted 5-point Star Bullets spiraling down the dharma tunnel
    if (this.starMesh) {
      for (let i = 0; i < 1000; i++) {
        const z = 12 - (i / 1000) * 86;
        const a = i * 0.47 + t * (i % 2 === 0 ? 0.65 : -0.65);
        const r = 4.6 + (i % 5) * 1.45;
        this._pos.set(Math.cos(a) * r, Math.sin(a) * r, z);
        this._euler.set(0, 0, t * 2.4 + i);
        this._quat.setFromEuler(this._euler);
        this._scale.setScalar(0.58 + (i % 3) * 0.16);
        this._mat4.compose(this._pos, this._quat, this._scale);
        this.starMesh.setMatrixAt(i, this._mat4);
      }
      this.starMesh.instanceMatrix.needsUpdate = true;
    }

    for (let i = 0; i < this.orbs.length; i++) {
      const o = this.orbs[i];
      const a = o.angle0 + t * o.spinRate;
      const pulseR = o.radius + Math.sin(t * 2.2 + o.z0 * 0.2) * 0.45;
      this._pos.set(Math.cos(a) * pulseR, Math.sin(a) * pulseR, o.z0);
      this._quat.identity();
      this._scale.setScalar(o.scale * (0.85 + climax * 0.35));
      this._mat4.compose(this._pos, this._quat, this._scale);
      this.orbMesh.setMatrixAt(i, this._mat4);
    }
    this.orbMesh.instanceMatrix.needsUpdate = true;

    const fx = ctx.postFX;
    fx.vignette = 0.4;
    fx.chromatic = 0.0016 + climax * 0.0022 + cannonImpulse * 0.0065;
    fx.flash = cannonImpulse * 0.26;
    fx.bloomThreshold = 1.14 - cannonImpulse * 0.12;
    fx.bloomStrength = 0.32 + climax * 0.1 + cannonImpulse * 0.25;
    fx.bloomRadius = 0.4;
  }

  public getInstanceCount(): number {
    return 14 + 24 + 60 + 8 + 1000 + this.orbs.length;
  }

  public dispose(scene: THREE.Scene): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    scene.remove(this.root);
    this.mandalaRings = [];
    this.ribbonMats = [];
    this.wingLaserGroups = [];
    this.pillarBeams = [];
    this.cannonRings = [];
    this.cannonCore = null;
    this.cannonSheath = null;
    this.orbMesh = null;
    this.starMesh = null;
  }
}
