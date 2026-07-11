import * as THREE from "three";

const FOLLOW_OFFSET = new THREE.Vector3(14, 16, 14);
/** The page-flip radius (world units): while the subject stays within
 *  this radius of the framed point, the camera DOES NOT MOVE — a fight
 *  plays out under a perfectly still frame. When they reach the edge the
 *  frame CUTS once to recenter on them, then holds again. No gliding,
 *  ever — a walking subject produces a slideshow of still frames, not a
 *  continuous pan. */
const DEADZONE = 11;
/** A target jump past this is a teleport (respawn, world switch): CUT once,
 *  cleanly — never glide across half a zone. */
const CUT_DISTANCE = 24;

/**
 * The STABLE camera (operator ruling): frame the subject, then hold still.
 * No orbiting, no idle patrol, no shake, no per-step tracking. The camera
 * moves for exactly two reasons: the subject walked out of the deadzone
 * (slow recenter glide) or teleported/switched (one hard cut). When the
 * subject is unresolved (transit, loading), the frame HOLDS where it is.
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

  follow(target: THREE.Vector3, _dt: number, zoom = 1): void {
    const want = target.clone().setY(0);
    if (!this.hasFrame || this.framed.distanceTo(want) > CUT_DISTANCE) {
      // First frame of a shot, or a teleport: one clean cut.
      this.framed.copy(want);
      this.hasFrame = true;
    } else {
      if (this.framed.distanceTo(want) > DEADZONE) {
        // The subject reached the frame edge: ONE cut recenters on them.
        this.framed.copy(want);
      }
      // Inside the radius: the frame point does not move AT ALL.
    }
    this.camera.position.copy(this.framed).addScaledVector(FOLLOW_OFFSET, zoom);
    this.camera.lookAt(this.framed.x, 1, this.framed.z);
  }

  /** Unresolved focus (transit, respawn in flight, loading): HOLD the
   *  last frame. The stable camera never wanders on its own. */
  idle(_dt: number): void {}
}
