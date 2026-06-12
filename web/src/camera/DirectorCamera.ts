import * as THREE from "three";

const FOLLOW_OFFSET = new THREE.Vector3(14, 16, 14);

/**
 * Smooth camera rig: follows the director's focus with damped motion, or
 * slowly orbits the zone when nothing is featured.
 */
export class DirectorCamera {
  private lookTarget = new THREE.Vector3();
  private center = new THREE.Vector3(30, 0, 30);
  private orbitRadius = 40;
  private orbitAngle = 0;
  private zoneW = 60;
  private zoneH = 60;
  private patrolT = 0;
  /** Trauma-based shake: hits add trauma, it decays, offset ∝ trauma². */
  private trauma = 0;
  private shakeT = 0;

  constructor(private camera: THREE.PerspectiveCamera) {}

  /** Add shake from an event AT a place — far-off fights don't rattle
   *  the lens. Amounts are small; trauma squares into the offset. */
  addTraumaAt(pos: THREE.Vector3, amount: number): void {
    const d = pos.distanceTo(this.lookTarget);
    if (d > 26) return;
    const falloff = d < 12 ? 1 : 1 - (d - 12) / 14;
    this.trauma = Math.min(1, this.trauma + amount * falloff);
  }

  /** Decaying positional noise, applied after lookAt each frame. */
  private applyShake(dt: number): void {
    if (this.trauma <= 0) return;
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    this.shakeT += dt;
    const s = this.trauma * this.trauma * 0.42;
    const t = this.shakeT;
    this.camera.position.x += Math.sin(t * 39.7) * s;
    this.camera.position.y += Math.sin(t * 47.3 + 1.7) * s * 0.6;
    this.camera.position.z += Math.sin(t * 33.1 + 3.9) * s;
  }

  setZoneSize(w: number, h: number): void {
    this.zoneW = w;
    this.zoneH = h;
    this.center.set(w / 2, 0, h / 2);
    this.orbitRadius = Math.min(w, h) * 0.9;
    this.lookTarget.copy(this.center);
  }

  follow(target: THREE.Vector3, dt: number, zoom = 1): void {
    const desired = target.clone().addScaledVector(FOLLOW_OFFSET, zoom);
    const k = 1 - Math.exp(-dt * 2.2);
    this.camera.position.lerp(desired, k);
    this.lookTarget.lerp(target.clone().setY(1), 1 - Math.exp(-dt * 3.5));
    this.camera.lookAt(this.lookTarget);
    this.applyShake(dt);
  }

  idle(dt: number): void {
    const { zoneW: w, zoneH: h } = this;
    let desired: THREE.Vector3;
    let look: THREE.Vector3;
    if (h > w * 1.6) {
      // Strip zones: patrol slowly along the strand instead of orbiting.
      this.patrolT += dt * 0.022;
      const s = (Math.sin(this.patrolT) + 1) / 2; // ping-pong 0..1
      const z = 12 + s * (h - 24);
      desired = new THREE.Vector3(w / 2 + w * 1.05, w * 0.85, z + w * 0.8);
      look = new THREE.Vector3(w / 2, 0.5, z - 4);
    } else {
      this.orbitAngle += dt * 0.06;
      desired = new THREE.Vector3(
        this.center.x + Math.cos(this.orbitAngle) * this.orbitRadius,
        this.orbitRadius * 0.6,
        this.center.z + Math.sin(this.orbitAngle) * this.orbitRadius,
      );
      look = this.center;
    }
    const k = 1 - Math.exp(-dt * 1.2);
    this.camera.position.lerp(desired, k);
    this.lookTarget.lerp(look, 1 - Math.exp(-dt * 2));
    this.camera.lookAt(this.lookTarget);
    this.applyShake(dt);
  }
}
