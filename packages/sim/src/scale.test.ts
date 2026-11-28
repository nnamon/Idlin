// The cost of a tick with a crowd on one large map: 150 residents and 450
// monsters is the load the slice needs (#361), and the bar is a tick of 4 ms
// on average and 25 ms at worst there, in the dev container. The gate runs a
// short sample; the full run, which also times 150 and 300 actors, runs with
// IDLIN_LONG=1. Both print what they measured.
//
// The ticks are timed in a node process of their own, as the server runs the
// world: under the test runner's module loader the same code runs nearly
// twice as slowly. The world a crowd ends in is pinned by hash here, so a
// change that makes the tick cheaper is also shown to leave what happens in it
// exactly as it was.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
  it("a crowd's world comes out the same every run", () => {
    const world = crowd(150, 450);
    for (let i = 0; i < 300; i++) step(world);
    // Changed by the hit (#383): blows from the Melee level, one crit roll a
    // swing, and the goblin's and the wolf's hitpoints. With a resident's blow
    // put back to 4, no crit roll and the old hitpoints, it is 941335f9a94ad9e0 again.
    expect(hashWorld(world)).toBe("b41c1d03f92787ba");
  });

  it("times a tick at 150 residents and 450 monsters, and checks it in the long run", () => {
    const t = timed(150, 450, 100, LONG ? 3000 : 300);
    if (LONG) {
      timed(38, 112, 100, 3000);
      timed(75, 225, 100, 3000);
    }
    // How long a tick takes depends on what else the machine is doing, so
    // the gate only prints it; the long run checks it, at four times the bar
    // of docs/plan.md section 3.5, since a shared runner is slower than the
    // dev container.
    if (!LONG) return;
    expect(t.mean).toBeLessThanOrEqual(4 * 4);
    expect(t.worst).toBeLessThanOrEqual(25 * 4);
  });
});
