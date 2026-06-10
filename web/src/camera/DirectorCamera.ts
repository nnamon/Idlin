import * as THREE from "three";

const FOLLOW_OFFSET = new THREE.Vector3(7, 8, 7);

/**
 * Smooth camera rig: follows the director's focus with damped motion, or
 * slowly orbits the zone when nothing is featured.
 */
export class DirectorCamera {
  private lookTarget = new THREE.Vector3();
  private center = new THREE.Vector3(30, 0, 30);
  private orbitRadius = 40;
  private orbitAngle = 0;

  constructor(private camera: THREE.PerspectiveCamera) {}

  setZoneCenter(x: number, z: number, extent: number): void {
    this.center.set(x, 0, z);
    this.orbitRadius = extent * 0.55;
    this.lookTarget.copy(this.center);
  }

  follow(target: THREE.Vector3, dt: number, zoom = 1): void {
    const desired = target.clone().addScaledVector(FOLLOW_OFFSET, zoom);
    const k = 1 - Math.exp(-dt * 2.2);
    this.camera.position.lerp(desired, k);
    this.lookTarget.lerp(target.clone().setY(1), 1 - Math.exp(-dt * 3.5));
    this.camera.lookAt(this.lookTarget);
  }

  idle(dt: number): void {
    this.orbitAngle += dt * 0.06;
    const desired = new THREE.Vector3(
      this.center.x + Math.cos(this.orbitAngle) * this.orbitRadius,
      this.orbitRadius * 0.6,
      this.center.z + Math.sin(this.orbitAngle) * this.orbitRadius,
    );
    const k = 1 - Math.exp(-dt * 1.2);
    this.camera.position.lerp(desired, k);
    this.lookTarget.lerp(this.center, 1 - Math.exp(-dt * 2));
    this.camera.lookAt(this.lookTarget);
  }
}
