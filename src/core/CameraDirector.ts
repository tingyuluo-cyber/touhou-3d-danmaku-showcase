import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CameraPose } from '../spells/types';

export type CameraMode = 'cinema' | 'free';

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

  public setMode(mode: CameraMode, currentPose?: CameraPose): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.controls.enabled = mode === 'free';
    if (mode === 'free') {
      // Reset camera roll cleanly when handing over to free OrbitControls
      this.camera.up.set(0, 1, 0);
      if (currentPose) {
        this.controls.target.copy(currentPose.lookAt);
      }
      this.controls.update();
    }
  }

  public applyCinemaPose(pose: CameraPose, time: number): void {
    if (this.mode === 'free') {
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
