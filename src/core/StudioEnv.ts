import * as THREE from 'three';

/**
 * Generates a high-contrast procedural HDR studio PMREM environment map.
 * Essential for dark-void metallic showcases (e.g. TH06 silver throwing knives):
 * the background stays pure obsidian black while blade bevels catch crisp,
 * sweeping cold-silver, ice-blue, and subtle crimson specular reflections.
 */
export function createMetallicStudioEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x040710);

  const addPanel = (
    colorHex: number,
    intensity: number,
    width: number,
    height: number,
    position: [number, number, number],
    lookAt: [number, number, number] = [0, 0, 0],
  ) => {
    const geom = new THREE.PlaneGeometry(width, height);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorHex).multiplyScalar(intensity),
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(...position);
    mesh.lookAt(...lookAt);
    envScene.add(mesh);
  };

  // Sharp cool-white overhead blade-key softboxes (create razor specular glints with deep dark contrast)
  addPanel(0xdcf2ff, 4.4, 24, 1.5, [0, 15, 4]);
  addPanel(0x8ecaff, 3.0, 20, 1.2, [-13, 8, -11]);
  addPanel(0xeef8ff, 5.2, 2.0, 18, [15, 2, 8]);
  addPanel(0x6aa8ff, 2.6, 22, 1.4, [0, -14, 6]);

  // Subtle scarlet rim strips (echoes Scarlet Devil Mansion mood without muddying silver)
  addPanel(0xff2e5c, 2.8, 14, 1.2, [-15, -3, 9]);
  addPanel(0xc840ff, 2.0, 11, 1.1, [12, -6, -14]);

  // Crisp narrow catchlights around azimuth so bevel angles flash sharply against dark steel
  const catchlightCount = 10;
  for (let i = 0; i < catchlightCount; i++) {
    const angle = (i / catchlightCount) * Math.PI * 2;
    const elev = (i % 2 === 0 ? 1 : -1) * (4 + (i % 3) * 3);
    const r = 16;
    addPanel(
      i % 3 === 0 ? 0xffffff : 0x98d4ff,
      i % 3 === 0 ? 5.6 : 3.2,
      0.9,
      4.2,
      [Math.cos(angle) * r, elev, Math.sin(angle) * r],
    );
  }

  // Deep obsidian-steel ambient dome so shadowed blade facets read as dark forged metal
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(28, 24, 16),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x050914),
      side: THREE.BackSide,
    }),
  );
  envScene.add(dome);

  const renderTarget = pmrem.fromScene(envScene, 0.018);

  // Dispose temporary scene resources
  envScene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
  });
  pmrem.dispose();

  return renderTarget.texture;
}
