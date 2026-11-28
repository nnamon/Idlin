// The cost of a tick with a crowd on one large map: 150 residents and 450
// monsters is the load the slice needs (#361). The bar is a tick of 2 ms on
// average in the dev container, but how long a tick takes depends on the
// machine and on what else it is doing, so the time is only printed. What is
// checked is the work a tick does, counted (see field.ts), which is the same on
// every machine: a change that makes path-finding do more, or stops a crowd
// sharing its distance fields, changes these counts and fails here.
//
// The ticks are timed in a node process of their own, as the server runs the
// world: under the test runner's module loader the same code runs nearly
// twice as slowly. The gate times a short run; the full run, which also times
// 150 and 300 actors, runs with IDLIN_LONG=1. The world a crowd ends in is
// pinned by hash, so a change that makes the tick cheaper is also shown to
// leave what happens in it as it was.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { workOf } from "./field.ts";
import { crowd, type Timing } from "./testing.ts";
import { hashWorld, step } from "./world.ts";

const LONG = process.env.IDLIN_LONG === "1";
const TESTING = fileURLToPath(new URL("testing.ts", import.meta.url));

/** timeCrowd, run in a node process of its own. */
function timed(residents: number, monsters: number, warm: number, ticks: number): Timing {
  const script = `import { timeCrowd } from ${JSON.stringify(TESTING)};
console.log(JSON.stringify(timeCrowd(${residents}, ${monsters}, ${warm}, ${ticks})));`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  const timing = JSON.parse(out) as Timing;
  console.log(
    `${residents} residents and ${monsters} monsters: mean ${timing.mean.toFixed(2)} ms, worst ${timing.worst.toFixed(2)} ms`,
  );
  return timing;
}

describe("a tick at scale", () => {
  it("a crowd's world comes out the same every run, for the same work", () => {
    const world = crowd(150, 450);
    for (let i = 0; i < 300; i++) step(world);
    // Changed by the hit (#383), which changes who fights and so who walks; by
    // an actor that got nowhere going round the people in its way however far
    // (see wayTo in brain.ts); and by the weapons (#393): a blade's arc, times
    // and knockback, the wolf's hitpoints, and the fields snapshot version 10
    // hashes; and by bodies in a row being pushed from the far end (#398).
    // Changed by the statuses (#402): a hit of a tenth of a monster's life
    // staggers it, and version 11 hashes every actor's statuses. With no
    // stagger and the version 10 hash it is 845d29c3f38cdb9e again, with the
    // same work counts. #405 changed only what is hashed: the orders of
    // snapshot version 12 and Deckhand in the program table. As version 11
    // without Deckhand it is c9c56e2a16e6f737 still.
    expect(hashWorld(world)).toBe("1195d9ec95d3c73d");
    // Over the 300 ticks: some 3,150 field tiles and 2,600 search tiles a
    // tick. Before the fields were shared, walk_to and step_to took some
    // 83,000 tiles a tick off their queues at this load. A blow now moves every
    // body in a row it hits that has room, and a body that is moved loses its
    // walk and finds a new one, which took the counts up from 3,400 and 2,800.
    // A staggered monster stands through its wind-up again instead of
    // walking, which brought them down from 3,800 and 3,100.
    expect(workOf(world)).toEqual({
      fieldTiles: 945_674,
      fields: 2_754,
      searchTiles: 780_738,
      actors: 2_318_352,
    });
  });

  it("times a tick at 150 residents and 450 monsters, and prints it", () => {
    const t = timed(150, 450, 100, LONG ? 3000 : 300);
    if (LONG) {
      timed(38, 112, 100, 3000);
      timed(75, 225, 100, 3000);
    }
    expect(t.mean).toBeGreaterThan(0);
    // The long run times 9,300 ticks in all, well past the runner's 5 s default.
  }, 120_000);
});
