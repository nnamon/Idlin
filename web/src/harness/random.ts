// A small, fast, seeded PRNG (mulberry32). The scene fixture overrides the
// global `Math.random` with one of these before building the renderer, so the
// nondeterministic seeds scattered through the scene path — terrain texture
// noise (Terrain.ts), brazier phases (ZoneRenderer), per-entity idle-animation
// start phase (EntityVisuals), and three.js object UUIDs — all become a fixed,
// reproducible sequence. This is a test-only neutralization in the harness; it
// avoids threading a RNG parameter through every production render module.
export function makeSeededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
