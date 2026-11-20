import * as THREE from 'three';
import type { TimelinePhase } from '../core/Timeline';

export type PrototypeCategory =
  | 'InstancedMesh粒子系统'
  | '体积激光与拖尾条带'
  | '特定3D模型实例化'
  | '后期Shader特效';

export interface SpellMetadata {
  id: string;
  gameCode: string;
  gameName: string;
  spellName: string;
  character: string;
  bgm: string;
  prototype: PrototypeCategory;
  spatialForm: string;
  visualHighlight: string;
  implemented: boolean;
}

export interface CameraPose {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
  roll: number;
  fov: number;
  shake: number;
}

export interface PostFXState {
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  timeStopFactor: number;
  waveRadius: number;
  waveWidth: number;
  waveInvert: number;
  waveDistort: number;
  chromatic: number;
  flash: number;
  vignette: number;
  // Prototype 4 (Shader FX): Gravitational lensing, thermal heat haze & mirror tear
  lensStrength: number;
  lensRadius: number;
  lensCenterX: number;
  lensCenterY: number;
  lensWorldPos: THREE.Vector3 | null;
  heatHaze: number;
  warmGrade: number;
  mirrorSplit: number;
  stageFade: number;
}

export interface SpellUpdateContext {
  time: number;
  dt: number;
  duration: number;
  isFreeCamera: boolean;
  cameraPose: CameraPose;
  postFX: PostFXState;
  cameraWorldPosition: THREE.Vector3;
  cameraWorldDirection: THREE.Vector3;
}

export interface SpellCardInstance {
  readonly metadata: SpellMetadata;
  readonly duration: number;
  readonly phases: TimelinePhase[];
  init(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void;
  update(ctx: SpellUpdateContext): void;
  getInstanceCount(): number;
  dispose(scene: THREE.Scene): void;
}
