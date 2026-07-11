import * as THREE from "three";

const FOLLOW_OFFSET = new THREE.Vector3(14, 16, 14);
/** Tight follow damping (1/s): high enough that the subject stays
 *  visually ANCHORED center-screen while the world scrolls under them —
 *  the standard ARPG spectate. Low values read as the camera chasing
 *  (the world sloshes); this is a lock with just enough smoothing to
 *  swallow tick quantization. */
const FOLLOW_DAMP = 10;
/** Combat-jitter deadband (world units): knockbacks, separation shoves,
 *  and stagger displace the subject a unit or two — the frame ignores
 *  excursions inside this radius entirely, tracking only the excess
 *  beyond it (continuous, no pop at the boundary). Walking is sustained
 *  displacement and tracks normally. */
const JITTER_DEADBAND = 2.2;
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
  private zoneW = 0;
  private zoneH = 0;

  constructor(private camera: THREE.PerspectiveCamera) {}

  /** Kept for call-site compatibility; the stable camera never shakes. */
  addTraumaAt(_pos: THREE.Vector3, _amount: number): void {}

  setZoneSize(w: number, h: number): void {
    // Terrain REBUILDS happen for fog-reveal drift in the SAME zone every
    // ~2.5s — resetting the frame there hard-cut the camera mid-shot
    // (codex). Only a genuine zone change re-frames.
    if (w === this.zoneW && h === this.zoneH) return;
    this.zoneW = w;
    this.zoneH = h;
    this.hasFrame = false;
  }

  follow(target: THREE.Vector3, dt: number, zoom = 1): void {
    const want = target.clone().setY(0);
    if (!this.hasFrame || this.framed.distanceTo(want) > CUT_DISTANCE) {
      // First frame of a shot, or a teleport: one clean cut.
      this.framed.copy(want);
      this.hasFrame = true;
    } else {
      const d = this.framed.distanceTo(want);
      if (d > JITTER_DEADBAND) {
        // Track only the excess beyond the deadband: a knockback that
        // shoves the subject 2u moves the frame ZERO; a walk tracks
        // smoothly. Pulling `want` back to the band edge keeps the
        // motion continuous at the boundary.
        const edge = want.clone().lerp(this.framed, JITTER_DEADBAND / d);
        this.framed.lerp(edge, 1 - Math.exp(-dt * FOLLOW_DAMP));
      }
    }
    this.camera.position.copy(this.framed).addScaledVector(FOLLOW_OFFSET, zoom);
    this.camera.lookAt(this.framed.x, 1, this.framed.z);
  }

  /** Unresolved focus (transit, respawn in flight, loading): HOLD the
   *  last frame. The stable camera never wanders on its own. */
  idle(_dt: number): void {}
}
