import * as THREE from 'three';
import type { SpellCardInstance, SpellMetadata, SpellUpdateContext } from '../types';
import type { TimelinePhase } from '../../core/Timeline';
import {
  clamp,
  createSeededRandom,
  lerp,
  smootherstep,
  smoothstep,
} from '../../prototypes/DanmakuMath';

export const TH17_METADATA: SpellMetadata = {
  id: 'th17-geometric-creature',
  gameCode: 'TH17',
  gameName: '东方鬼形兽',
  spellName: '"几何造物"',
  character: '埴安神袿姬',
  bgm: '将世界托付给偶像 ~ Idoratrize World',
  prototype: '特定3D模型实例化',
  spatialForm: '霓虹线框 + 赛博雕塑',
  visualHighlight:
    '风格突变的一代: 巨型嵌套霓虹 Wireframe 线框多面体数字雕塑, 搭配 2,400 个锐利几何棱锥弹幕与赛博矢量空间网格.',
  implemented: true,
};

export const TH17_DURATION = 12.5;

const TH17_PHASES: TimelinePhase[] = [
  { id: 'boot', label: '01 矢量塑形', start: 0.0, end: 2.8, badgeStyle: 'normal' },
  { id: 'assemble', label: '02 多面体嵌套', start: 2.8, end: 6.4, badgeStyle: 'frozen' },
  { id: 'cyber', label: '03 赛博偶像造物', start: 6.4, end: 10.6, badgeStyle: 'burst' },
  { id: 'deconstruct', label: '04 线框解构', start: 10.6, end: 12.5, badgeStyle: 'normal' },
];

interface PolyBullet {
  orbitR: number;
  angle0: number;
  yLayer: number;
  speed: number;
  spinAxis: THREE.Vector3;
  spinSpeed: number;
  scale: number;
  color: THREE.Color;
}

export class TH17GeometricCreatureSpell implements SpellCardInstance {
  public readonly metadata = TH17_METADATA;
  public readonly duration = TH17_DURATION;
  public readonly phases = TH17_PHASES;

  private root = new THREE.Group();
  private sculptureOuter = new THREE.Group();
  private sculptureMid = new THREE.Group();
  private sculptureCore = new THREE.Group();
  private polygonLaserCages: { group: THREE.Group; mat: THREE.MeshBasicMaterial; sides: number }[] = [];
  private gridFloor: THREE.GridHelper | null = null;
  private gridCeil: THREE.GridHelper | null = null;
  private polyMesh: THREE.InstancedMesh | null = null;
  private wirePolyMesh: THREE.InstancedMesh | null = null;
  private bullets: PolyBullet[] = [];

  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];

  private camCurve: THREE.CatmullRomCurve3 | null = null;
  private readonly _pos = new THREE.Vector3();
  private readonly _quat = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3();
  private readonly _mat4 = new THREE.Matrix4();

  public init(scene: THREE.Scene, _renderer: THREE.WebGLRenderer): void {
    scene.background = new THREE.Color(0x03050a);
    scene.fog = new THREE.FogExp2(0x03060c, 0.014);

    this.root = new THREE.Group();
    scene.add(this.root);

    const amb = new THREE.AmbientLight(0x3a6482, 0.9);
    const cyanLight = new THREE.PointLight(0x30f0ff, 36, 60, 1.4);
    cyanLight.position.set(14, 8, 12);
    const amberLight = new THREE.PointLight(0xffb432, 34, 60, 1.4);
    amberLight.position.set(-14, -6, 10);
    const magLight = new THREE.PointLight(0xff3494, 28, 56, 1.4);
    magLight.position.set(0, 12, -12);
    this.root.add(amb, cyanLight, amberLight, magLight);

    // 1. Cyber Vector Space Grid Floor & Ceiling
    this.gridFloor = new THREE.GridHelper(90, 36, 0x38e8ff, 0x102840);
    this.gridFloor.position.y = -12.5;
    this.gridCeil = new THREE.GridHelper(90, 36, 0xffb838, 0x241a10);
    this.gridCeil.position.y = 12.5;
    this.root.add(this.gridFloor, this.gridCeil);

    // 2. Colossal Nested Neon Wireframe Polyhedral Sculptures (Outer Icosahedron -> Mid Octahedron -> Core Dodecahedron!)
    const darkGlassMat = new THREE.MeshStandardMaterial({
      color: 0x0a101d,
      metalness: 0.92,
      roughness: 0.14,
      transparent: true,
      opacity: 0.68,
    });
    const cyanLineMat = new THREE.LineBasicMaterial({
      color: 0x48f2ff,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
    });
    const amberLineMat = new THREE.LineBasicMaterial({
      color: 0xffc042,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
    });
    const magLineMat = new THREE.LineBasicMaterial({
      color: 0xff42a0,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
    });
    this.materials.push(darkGlassMat, cyanLineMat, amberLineMat, magLineMat);

    // Outer nested Icosahedron wireframe cage
    this.sculptureOuter = new THREE.Group();
    const icoGeom = new THREE.IcosahedronGeometry(7.2, 1);
    const icoEdges = new THREE.EdgesGeometry(icoGeom);
    const icoLines = new THREE.LineSegments(icoEdges, cyanLineMat);
    this.sculptureOuter.add(icoLines);
    this.geometries.push(icoGeom, icoEdges);

    // Mid counter-rotating faceted Octahedron sculpture (dark metallic core + neon amber edges)
    this.sculptureMid = new THREE.Group();
    const octGeom = new THREE.OctahedronGeometry(4.6, 0);
    const octEdges = new THREE.EdgesGeometry(octGeom);
    this.sculptureMid.add(new THREE.Mesh(octGeom, darkGlassMat), new THREE.LineSegments(octEdges, amberLineMat));
    this.geometries.push(octGeom, octEdges);

    // Inner glowing sacred Dodecahedron heart
    this.sculptureCore = new THREE.Group();
    const dodGeom = new THREE.DodecahedronGeometry(2.3, 0);
    const dodEdges = new THREE.EdgesGeometry(dodGeom);
    const coreGlowMat = new THREE.MeshBasicMaterial({
      color: 0xffb838,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });
    this.materials.push(coreGlowMat);
    this.sculptureCore.add(
      new THREE.Mesh(dodGeom, coreGlowMat),
      new THREE.LineSegments(dodEdges, magLineMat),
    );
    this.geometries.push(dodGeom, dodEdges);

    this.root.add(this.sculptureOuter, this.sculptureMid, this.sculptureCore);

    // 2b. Authentic Keiki "Geometric Creature" Signature:
    // Rotating 3D Glowing Laser-Traced Polygon Cages (Triangle △, Square □, Hexagon ⬡) built with crisp TubeGeometry!
    this.polygonLaserCages = [];
    const cageSpecs: { sides: number; radius: number; col: number; tilt: [number, number, number] }[] = [
      { sides: 3, radius: 10.5, col: 0x38f2ff, tilt: [0.35, 0.0, 0.2] },
      { sides: 4, radius: 13.4, col: 0xffc442, tilt: [-0.48, 0.35, -0.15] },
      { sides: 6, radius: 16.5, col: 0xff44a4, tilt: [0.22, -0.52, 0.4] },
    ];
    for (let c = 0; c < cageSpecs.length; c++) {
      const spec = cageSpecs[c];
      const cageGrp = new THREE.Group();
      cageGrp.rotation.set(...spec.tilt);
      const pts: THREE.Vector3[] = [];
      for (let v = 0; v <= spec.sides; v++) {
        const a = (v / spec.sides) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * spec.radius, Math.sin(a) * spec.radius, 0));
      }
      const mat = new THREE.MeshBasicMaterial({
        color: spec.col,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this.materials.push(mat);

      // Build paired front & back parallel laser polygon frames joined by glowing corner struts
      for (let s = 0; s < spec.sides; s++) {
        const p0 = pts[s];
        const p1 = pts[s + 1];
        const edgeCurveA = new THREE.LineCurve3(
          new THREE.Vector3(p0.x, p0.y, 1.4),
          new THREE.Vector3(p1.x, p1.y, 1.4),
        );
        const edgeCurveB = new THREE.LineCurve3(
          new THREE.Vector3(p0.x, p0.y, -1.4),
          new THREE.Vector3(p1.x, p1.y, -1.4),
        );
        const strutCurve = new THREE.LineCurve3(
          new THREE.Vector3(p0.x, p0.y, -1.4),
          new THREE.Vector3(p0.x, p0.y, 1.4),
        );
        const gA = new THREE.TubeGeometry(edgeCurveA, 2, 0.085, 6, false);
        const gB = new THREE.TubeGeometry(edgeCurveB, 2, 0.085, 6, false);
        const gS = new THREE.TubeGeometry(strutCurve, 2, 0.075, 6, false);
        this.geometries.push(gA, gB, gS);
        cageGrp.add(new THREE.Mesh(gA, mat), new THREE.Mesh(gB, mat), new THREE.Mesh(gS, mat));
      }
      this.root.add(cageGrp);
      this.polygonLaserCages.push({ group: cageGrp, mat, sides: spec.sides });
    }

    // 3. 2,400 Instanced Sharp Geometric Polyhedral Bullets (solid dark cyber prism + glowing wireframe shell!)
    const rand = createSeededRandom(20190812); // Touhou 17 WBaWC release date seed!
    const count = 2400;
    this.bullets = [];

    const cCyan = new THREE.Color(0x38f0ff);
    const cAmber = new THREE.Color(0xffbd3c);
    const cMag = new THREE.Color(0xff429e);
    const cWhite = new THREE.Color(0xeefaff);

    for (let i = 0; i < count; i++) {
      const band = i % 5;
      const orbitR = 7.8 + band * 3.1 + (rand() - 0.5) * 1.4;
      const yLayer = ((i % 9) - 4) * 2.1 + (rand() - 0.5) * 0.7;
      const cPick = band === 0 ? cAmber : band === 1 || band === 3 ? cCyan : band === 2 ? cMag : cWhite;

      this.bullets.push({
        orbitR,
        angle0: (i / count) * Math.PI * 2 * 11,
        yLayer,
        speed: (band % 2 === 0 ? 1 : -1) * (0.32 + (4 - band) * 0.08),
        spinAxis: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
        spinSpeed: 1.6 + rand() * 2.4,
        scale: 0.34 + (i % 4) * 0.12,
        color: cPick.clone(),
      });
    }

    // Precision-machined 20-faced Icosahedron prisms with clearcoat dark glass + crisp neon wireframe edges
    const tetraGeom = new THREE.IcosahedronGeometry(0.68, 0);
    const solidMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a1120,
      metalness: 0.94,
      roughness: 0.12,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
    });
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });
    this.geometries.push(tetraGeom);
    this.materials.push(solidMat, wireMat);

    this.polyMesh = new THREE.InstancedMesh(tetraGeom, solidMat, count);
    this.wirePolyMesh = new THREE.InstancedMesh(tetraGeom, wireMat, count);
    this.polyMesh.frustumCulled = false;
    this.wirePolyMesh.frustumCulled = false;

    for (let i = 0; i < count; i++) {
      this.wirePolyMesh.setColorAt(i, this.bullets[i].color);
    }
    if (this.wirePolyMesh.instanceColor) this.wirePolyMesh.instanceColor.needsUpdate = true;
    this.root.add(this.polyMesh, this.wirePolyMesh);

    // 4. Crisp Architectural Orbit Camera sweeping around the digital polyhedral sculpture
    this.camCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0.0, 2.2, 22.0),
        new THREE.Vector3(12.6, 5.4, 15.8),
        new THREE.Vector3(15.2, -2.6, 4.2),
        new THREE.Vector3(3.6, -5.2, 13.8),
        new THREE.Vector3(-13.8, 3.8, 12.6),
        new THREE.Vector3(-5.2, 6.4, 21.5),
      ],
      false,
      'centripetal',
      0.5,
    );
  }

  public update(ctx: SpellUpdateContext): void {
    if (!this.polyMesh || !this.wirePolyMesh || !this.camCurve) return;

    const t = ctx.time;
    const p = clamp(t / TH17_DURATION, 0, 1);
    const u = clamp(lerp(p, smootherstep(0, 1, p), 0.25), 0, 1);
    const climax = smoothstep(5.8, 7.6, t) * (1 - smoothstep(10.8, 12.2, t));
    const assemble = smoothstep(0.4, 3.8, t);

    this.camCurve.getPoint(u, ctx.cameraPose.position);
    ctx.cameraPose.lookAt.set(0, 0, 0);
    ctx.cameraPose.roll = Math.sin(p * Math.PI * 2) * 0.09;
    ctx.cameraPose.fov = 48 + climax * 7.0;
    ctx.cameraPose.shake = 0;

    // Nested geometric digital sculpture rotations & scale breathing
    const pulse = 1.0 + Math.sin(t * 3.2) * 0.04 * climax;
    this.sculptureOuter.rotation.set(t * 0.22, t * 0.34, t * 0.14);
    this.sculptureOuter.scale.setScalar((0.45 + 0.55 * assemble) * pulse);
    this.sculptureMid.rotation.set(-t * 0.45, -t * 0.38, t * 0.26);
    this.sculptureMid.scale.setScalar((0.35 + 0.65 * assemble) * (1.0 + climax * 0.12));
    this.sculptureCore.rotation.set(t * 0.78, -t * 0.64, -t * 0.52);

    // Step-rotate Keiki's △ / □ / ⬡ laser-traced polygon cages smoothly!
    for (let c = 0; c < this.polygonLaserCages.length; c++) {
      const cage = this.polygonLaserCages[c];
      const reveal = smoothstep(1.2 + c * 1.1, 2.6 + c * 1.1, t);
      const dir = c % 2 === 0 ? 1 : -1;
      cage.group.rotation.z = t * dir * (0.38 - c * 0.06);
      cage.group.rotation.y = Math.sin(t * 0.45 + c) * 0.55;
      cage.group.scale.setScalar(0.55 + 0.45 * reveal + climax * 0.08);
      cage.mat.opacity = (0.62 + climax * 0.32) * reveal;
    }

    // Update all 2,400 dual-pass (solid dark prism + neon wireframe) geometric bullets!
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      const a = b.angle0 + t * b.speed * (1.0 + climax * 0.45);
      // Quantized geometric wave expansion during climax
      const r = b.orbitR * (0.75 + 0.25 * assemble) + Math.sin(t * 2.6 + i * 0.08) * 0.85 * climax;
      const y = b.yLayer + Math.cos(a * 3.0 + t * 1.4) * 0.9;

      this._pos.set(Math.cos(a) * r, y, Math.sin(a) * r);
      this._quat.setFromAxisAngle(b.spinAxis, t * b.spinSpeed + i);
      const sc = b.scale * assemble;
      this._scale.setScalar(sc);
      this._mat4.compose(this._pos, this._quat, this._scale);
      this.polyMesh.setMatrixAt(i, this._mat4);

      // Slightly larger wireframe shell (1.04x) prevents z-fighting and makes neon edges razor sharp!
      this._scale.setScalar(sc * 1.04);
      this._mat4.compose(this._pos, this._quat, this._scale);
      this.wirePolyMesh.setMatrixAt(i, this._mat4);
    }
    this.polyMesh.instanceMatrix.needsUpdate = true;
    this.wirePolyMesh.instanceMatrix.needsUpdate = true;

    const fx = ctx.postFX;
    fx.vignette = 0.36;
    fx.chromatic = 0.0018 + climax * 0.0022;
    fx.bloomThreshold = 0.92;
    fx.bloomStrength = 0.46 + climax * 0.14;
    fx.bloomRadius = 0.42;
  }

  public getInstanceCount(): number {
    return this.bullets.length + 3;
  }

  public dispose(scene: THREE.Scene): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    scene.remove(this.root);
    this.polyMesh = null;
    this.wirePolyMesh = null;
  }
}
