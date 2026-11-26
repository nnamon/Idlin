// The edge of a region of tiles, as smooth closed curves. A river laid out on
// a grid has square corners; drawn along these curves it has banks.

export type Pt = readonly [number, number];

/**
 * Traces the boundary of the tiles for which `inside` holds, on a grid of
 * `width` by `height`. Returns closed loops of corner points in tile units,
 * each with the region on its right-hand side as it is walked.
 */
export function regionLoops(width: number, height: number, inside: (x: number, y: number) => boolean): Pt[][] {
  const at = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && inside(x, y);
  // One directed edge per tile side that has the region on one side only, keyed by where it starts.
  const from = new Map<string, Pt[]>();
  const add = (a: Pt, b: Pt): void => {
    const key = `${a[0]},${a[1]}`;
    const list = from.get(key) ?? [];
    list.push(b);
    from.set(key, list);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) add([x, y], [x + 1, y]);
      if (!at(x + 1, y)) add([x + 1, y], [x + 1, y + 1]);
      if (!at(x, y + 1)) add([x + 1, y + 1], [x, y + 1]);
      if (!at(x - 1, y)) add([x, y + 1], [x, y]);
    }
  }
  const loops: Pt[][] = [];
  for (const startKey of [...from.keys()].sort()) {
    while ((from.get(startKey)?.length ?? 0) > 0) {
      const start = startKey.split(",").map(Number) as unknown as Pt;
      const loop: Pt[] = [start];
      let here = start;
      let heading: Pt = [0, 0];
      for (let guard = 0; guard < width * height * 4 + 8; guard++) {
        const options = from.get(`${here[0]},${here[1]}`) ?? [];
        if (options.length === 0) break;
        // Where two parts of the region touch at a corner, keep to the right so each loop stays simple.
        let pick = 0;
        if (options.length > 1) {
          const turn = (to: Pt): number => heading[0] * (to[1] - here[1]) - heading[1] * (to[0] - here[0]);
          pick = options.reduce((best, to, i) => (turn(to) > turn(options[best] as Pt) ? i : best), 0);
        }
        const next = options.splice(pick, 1)[0] as Pt;
        heading = [next[0] - here[0], next[1] - here[1]];
        here = next;
        if (here[0] === start[0] && here[1] === start[1]) break;
        loop.push(here);
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

/** Rounds a closed loop by cutting its corners, `rounds` times over. */
export function smoothLoop(loop: readonly Pt[], rounds = 2): Pt[] {
  let points = [...loop];
  for (let round = 0; round < rounds; round++) {
    const next: Pt[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i] as Pt;
      const b = points[(i + 1) % points.length] as Pt;
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    points = next;
  }
  return points;
}
