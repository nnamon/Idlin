import * as THREE from "three";

const FOLLOW_OFFSET = new THREE.Vector3(14, 16, 14);
/** Tight follow damping (1/s): high enough that the subject stays
 *  visually ANCHORED center-screen while the world scrolls under them —
 *  the standard ARPG spectate. Low values read as the camera chasing
 *  (the world sloshes); this is a lock with just enough smoothing to
 *  swallow tick quantization. */
const FOLLOW_DAMP = 10;
/** A target jump past this is a teleport (respawn, world switch): CUT once,
 *  cleanly — never glide across half a zone. */
const CUT_DISTANCE = 24;

/**
 * The FOLLOW camera (operator rulings, both of them): the idler stays
 * centered and the world scrolls — smooth, tight tracking. The camera
 * NEVER moves on its own: no orbit, no idle patrol, no shake. Teleports
 * (respawn) and world switches are one clean cut. Unresolved focus
 * (transit, loading) HOLDS the last frame.
 */
export class DirectorCamera {
  private framed = new THREE.Vector3();
  private hasFrame = false;

  constructor(private camera: THREE.PerspectiveCamera) {}

  /** Kept for call-site compatibility; the stable camera never shakes. */
  addTraumaAt(_pos: THREE.Vector3, _amount: number): void {}

  setZoneSize(_w: number, _h: number): void {
    // A new zone always arrives with a focus cue; the first follow() cuts.
    this.hasFrame = false;
  }

  follow(target: THREE.Vector3, dt: number, zoom = 1): void {
    const want = target.clone().setY(0);
    if (!this.hasFrame || this.framed.distanceTo(want) > CUT_DISTANCE) {
      // First frame of a shot, or a teleport: one clean cut.
      this.framed.copy(want);
      this.hasFrame = true;
    } else {
      // Tight damped lock: the subject stays anchored center-screen.
      this.framed.lerp(want, 1 - Math.exp(-dt * FOLLOW_DAMP));
    }
    this.camera.position.copy(this.framed).addScaledVector(FOLLOW_OFFSET, zoom);
    this.camera.lookAt(this.framed.x, 1, this.framed.z);
  }

  /** Unresolved focus (transit, respawn in flight, loading): HOLD the
   *  last frame. The stable camera never wanders on its own. */
  idle(_dt: number): void {}
}
