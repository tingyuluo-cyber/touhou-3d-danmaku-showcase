import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CameraPose } from '../spells/types';

export type CameraMode = 'cinema' | 'locked' | 'free';

interface LockedCameraPreset {
  position: [number, number, number];
  lookAt: [number, number, number];
  fov?: number;
}

/**
 * Curated dead-steady static tripod vantage points for every mainline spell (TH06 - TH20).
 * Used in `locked` mode so an entire 15-game Medley plays & records cleanly with zero camera movement!
 */
export const LOCKED_CAMERA_PRESETS: Record<string, LockedCameraPreset> = {
  TH06: { position: [0.0, 0.8, 25.5], lookAt: [0.0, 0.0, -2.5], fov: 50 },
  TH07: { position: [0.0, 1.4, 27.5], lookAt: [0.0, 0.4, -3.5], fov: 50 },
  TH08: { position: [0.0, 7.5, 29.5], lookAt: [0.0, 0.0, 0.0], fov: 50 },
  TH09: { position: [0.0, 5.2, 23.5], lookAt: [0.0, 0.0, 0.0], fov: 50 },
  TH10: { position: [0.0, -2.6, 18.2], lookAt: [0.0, 4.2, -22.0], fov: 50 },
  TH11: { position: [0.0, 3.6, 23.5], lookAt: [0.0, 0.0, 0.0], fov: 50 },
  TH12: { position: [4.6, -1.5, 16.5], lookAt: [0.0, 0.0, -28.0], fov: 54 },
  TH13: { position: [0.0, 1.6, 25.5], lookAt: [0.0, 1.2, -5.2], fov: 50 },
  TH14: { position: [0.0, 2.2, 23.5], lookAt: [0.0, 0.0, 0.0], fov: 50 },
  TH15: { position: [0.0, 3.8, 25.5], lookAt: [0.0, 0.0, 0.0], fov: 50 },
  TH16: { position: [0.0, 1.4, 25.5], lookAt: [0.0, 0.0, -3.5], fov: 52 },
  TH17: { position: [0.0, 3.5, 24.5], lookAt: [0.0, 0.0, 0.0], fov: 50 },
  TH18: { position: [0.0, 0.5, 24.5], lookAt: [0.0, 0.0, -5.2], fov: 50 },
  TH19: { position: [0.0, 8.2, 25.5], lookAt: [0.0, 0.0, 0.0], fov: 48 },
  TH20: { position: [0.0, 5.2, 24.5], lookAt: [0.0, 0.0, 0.0], fov: 50 },
};

export class CameraDirector {
  public mode: CameraMode = 'cinema';
  public readonly controls: OrbitControls;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly upVec = new THREE.Vector3();
  private readonly forwardVec = new THREE.Vector3();
  private readonly rightVec = new THREE.Vector3();
  private readonly shakeOffset = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.72;
    this.controls.zoomSpeed = 0.9;
    this.controls.minDistance = 2.0;
    this.controls.maxDistance = 85.0;
    this.controls.enabled = false;
  }

  public setMode(mode: CameraMode, currentPose?: CameraPose, gameCode?: string): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.controls.enabled = mode !== 'cinema';
    if (mode === 'locked') {
      this.applyLockedPreset(gameCode ?? 'TH06');
    } else if (mode === 'free') {
      // Reset camera roll cleanly when handing over to manual free OrbitControls
      this.camera.up.set(0, 1, 0);
      if (currentPose) {
        this.controls.target.copy(currentPose.lookAt);
      }
      this.controls.update();
    }
  }

  /**
   * Snaps the static tripod cleanly to a spell's curated panoramic master framing (zero roll/shake/drift).
   */
  public applyLockedPreset(gameCode: string): void {
    const preset = LOCKED_CAMERA_PRESETS[gameCode] ?? LOCKED_CAMERA_PRESETS.TH06;
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(...preset.position);
    this.controls.target.set(...preset.lookAt);
    const fov = preset.fov ?? 50;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  public applyCinemaPose(pose: CameraPose, time: number): void {
    if (this.mode !== 'cinema') {
      this.controls.update();
      return;
    }

    // Deterministic subtle micro-shake driven by sin harmonics (identical during frame export!)
    this.shakeOffset.set(0, 0, 0);
    if (pose.shake > 0.0001) {
      this.shakeOffset.set(
        Math.sin(time * 47.3) * 0.65 + Math.cos(time * 83.1) * 0.35,
        Math.cos(time * 53.7) * 0.65 + Math.sin(time * 79.4) * 0.35,
        Math.sin(time * 41.2) * 0.4,
      );
      this.shakeOffset.multiplyScalar(pose.shake);
    }

    this.camera.position.copy(pose.position).add(this.shakeOffset);

    // Apply roll around the camera's forward axis
    this.forwardVec.subVectors(pose.lookAt, this.camera.position).normalize();
    this.upVec.set(0, 1, 0);
    if (Math.abs(this.forwardVec.dot(this.upVec)) > 0.995) {
      this.upVec.set(0, 0, 1);
    }
    this.rightVec.crossVectors(this.forwardVec, this.upVec).normalize();
    this.upVec.crossVectors(this.rightVec, this.forwardVec).normalize();

    if (Math.abs(pose.roll) > 1e-5) {
      this.upVec.applyAxisAngle(this.forwardVec, pose.roll);
    }

    this.camera.up.copy(this.upVec);
    this.camera.lookAt(pose.lookAt);

    if (Math.abs(this.camera.fov - pose.fov) > 0.01) {
      this.camera.fov = pose.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  public dispose(): void {
    this.controls.dispose();
  }
}
