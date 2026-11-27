import {
  type Actor,
  compileBots,
  createWorld,
  DOWN_TICKS,
  goodId,
  placeConstants,
  step,
  TICKS_PER_GAME_HOUR,
  type World,
} from "@idlin/sim";
import { describe, expect, it } from "vitest";
import { shippedWorld } from "../../sim/src/testing.ts";
import { type Fight, NO_FIGHT, nextFight } from "./fight.ts";
import {
  bagList,
  HOLD_TICKS,
  type Line,
  type Lines,
  lineFor,
  NO_LINES,
  newsNow,
  newsText,
  nextLines,
  nextWalk,
  pageText,
  QUIET_TICKS,
  quietNews,
  type Walk,
} from "./line.ts";

const atlas = shippedWorld();
const KINDS = { wolf: { hp: 24, damage: 8, windup: 8, recovery: 20, reach: 2 } };
const STILL = compileBots({ still: "otherwise -> wait(600)" }, placeConstants(atlas));
/** The tick at a game hour of the first day; the world starts at 06:00. */
const at = (hour: number): number => Math.round((hour - 6) * TICKS_PER_GAME_HOUR);

/**
 * A world at `hour` with Ash and `wolves` wolves in it, all standing still,
 * put where the test wants them: Ash is actor 1, the wolves 2 on.
 */
function scene(hour: number, wolves = 0): { world: World; ash: Actor; wolf: Actor[] } {
  const world = createWorld(atlas, 1, STILL, KINDS);
  step(world, [
    { type: "spawn", name: "Ash", program: "still", x: 14, y: 8 },
    ...Array.from({ length: wolves }, (_, i) => ({
      type: "spawn" as const,
      name: "Wolf",
      program: "still",
      kind: "wolf",
      x: 20 + i,
      y: 2,
    })),
  ]);
  world.tick = at(hour);
  const [ash, ...wolf] = world.actors as [Actor, ...Actor[]];
  return { world, ash, wolf };
}

/** Puts an actor on (x, y), standing, or walking along `path` if one is given. */
function put(actor: Actor, x: number, y: number, path: { x: number; y: number }[] = []): void {
  Object.assign(actor, { x, y, fromX: x, fromY: y, path, moveTicksLeft: 0, wait: 0 });
}

const walkOf = (
  to: { x: number; y: number },
  from: { x: number; y: number },
  running = false,
): Walk => ({ to, from, running });

const fighting = (world: World, ...ids: number[]): Fight => ({
  ...NO_FIGHT,
  engaged: new Map(ids.map((id) => [id, world.tick])),
});

// The design direction's table (#296), every row the world can show today.
// Left out until what they need exists: fishing, chopping, cooking and banking
// (#236), coming home with a haul and its count (#236; the bag's count is
// tested below), answering a call (#299), going back for a drop and the
// "dropped 9 fish" after a down (#237), and "chopping, 5 logs" in another
// region (#236), which is shown here with what a resident does there today.
describe("the line under a resident's name", () => {
  const rows: [string, () => string][] = [
    [
      "walking to the river · bag 0/12",
      () => {
        const { world, ash } = scene(9);
        put(ash, 17, 8, [
          { x: 18, y: 8 },
          { x: 22, y: 10 },
        ]);
        return pageText(lineFor(world, ash, NO_FIGHT, walkOf({ x: 22, y: 10 }, { x: 16, y: 8 })));
      },
    ],
    [
      "followed by a wolf · 5 tiles",
      () => {
        const { world, ash, wolf } = scene(9, 1);
        put(ash, 19, 11);
        put(wolf[0] as Actor, 19, 16, [{ x: 19, y: 15 }]);
        return pageText(lineFor(world, ash, NO_FIGHT, undefined));
      },
    ],
    [
      "fighting a wolf · wolf 16/24",
      () => {
        const { world, ash, wolf } = scene(9, 1);
        put(ash, 19, 11);
        put(wolf[0] as Actor, 20, 11);
        (wolf[0] as Actor).hp = 16;
        return pageText(lineFor(world, ash, fighting(world, ash.id), undefined));
      },
    ],
    [
      "fighting 2 wolves · nearest 16/24",
      () => {
        const { world, ash, wolf } = scene(9, 2);
        put(ash, 19, 11);
        put(wolf[0] as Actor, 19, 13);
        put(wolf[1] as Actor, 20, 11);
        (wolf[1] as Actor).hp = 16;
        return pageText(lineFor(world, ash, fighting(world, ash.id), undefined));
      },
    ],
    [
      "running from 2 wolves · 9 tiles to camp",
      () => {
        const { world, ash, wolf } = scene(9, 2);
        put(ash, 23, 9, [
          { x: 22, y: 9 },
          { x: 21, y: 9 },
        ]);
        put(wolf[0] as Actor, 27, 9);
        put(wolf[1] as Actor, 26, 11);
        return pageText(
          lineFor(world, ash, NO_FIGHT, walkOf({ x: 21, y: 9 }, { x: 24, y: 9 }, true)),
        );
      },
    ],
    [
      "asleep at camp",
      () => {
        const { world, ash } = scene(23);
        put(ash, 14, 8);
        ash.wait = 100;
        return pageText(lineFor(world, ash, NO_FIGHT, undefined));
      },
    ],
    [
      "resting at the river",
      () => {
        const { world, ash } = scene(12);
        put(ash, 22, 10);
        ash.wait = 50;
        return pageText(lineFor(world, ash, NO_FIGHT, undefined));
      },
    ],
    [
      "downed by a wolf at the river",
      () => {
        const { world, ash } = scene(12);
        put(ash, 14, 8);
        ash.wait = DOWN_TICKS - 10;
        const since = world.tick - 10;
        const fight: Fight = {
          ...NO_FIGHT,
          downs: new Map([[ash.id, since]]),
          fallen: [{ since, x: 22, y: 10, kind: ash.kind, id: ash.id, facing: 1, by: "Wolf" }],
        };
        return pageText(lineFor(world, ash, fight, undefined));
      },
    ],
    [
      "mending at camp · up at 12:20",
      () => {
        const { world, ash } = scene(6);
        world.tick = 3700;
        put(ash, 14, 8);
        ash.wait = 100;
        const fight: Fight = { ...NO_FIGHT, downs: new Map([[ash.id, 3650]]) };
        return pageText(lineFor(world, ash, fight, undefined));
      },
    ],
    [
      "in the Pinewood · walking",
      () => {
        const { world, ash } = scene(9);
        put(ash, -17, 10, [
          { x: -16, y: 10 },
          { x: -15, y: 10 },
        ]);
        return pageText(
          lineFor(world, ash, NO_FIGHT, walkOf({ x: -15, y: 10 }, { x: -18, y: 10 })),
          "the Pinewood",
        );
      },
    ],
    [
      "stopped · program error",
      () => {
        const { world, ash } = scene(9);
        put(ash, 19, 11);
        ash.fault = 1;
        return pageText(lineFor(world, ash, NO_FIGHT, undefined));
      },
    ],
  ];
  for (const [expected, make] of rows)
    it(`reads "${expected}"`, () => expect(make()).toBe(expected));

  it("names where a walk ends: a place within 4 tiles, else the nearest with near in front", () => {
    const { world, ash } = scene(9);
    const walkTo = (x: number, y: number, from = { x: 20, y: 12 }): string => {
      put(ash, from.x, from.y, [{ x, y }]);
      return pageText(lineFor(world, ash, NO_FIGHT, walkOf({ x, y }, from)));
    };
    expect(walkTo(27, 13)).toBe("walking near the meadow");
    // A place called "near" something is one a walk goes by.
    expect(walkTo(8, 2)).toBe("walking by the near wood");
    expect(walkTo(3, 15)).toBe("walking to the den");
    // Home again: no number, as it is not leaving camp.
    expect(walkTo(14, 10)).toBe("walking to camp");
    // From another region, the place it is going to stays in the line.
    expect(walkTo(14, 9, { x: -17, y: 10 })).toBe("walking to camp");
    const away = lineFor(world, ash, NO_FIGHT, walkOf({ x: 14, y: 9 }, { x: -17, y: 10 }));
    expect(pageText(away, "the Pinewood")).toBe("in the Pinewood · walking to camp");
  });

  it("tells a walk towards a monster from being followed by one", () => {
    const { world, ash, wolf } = scene(9, 1);
    put(ash, 19, 11, [{ x: 20, y: 11 }]);
    put(wolf[0] as Actor, 22, 11);
    expect(
      pageText(lineFor(world, ash, NO_FIGHT, walkOf({ x: 20, y: 11 }, { x: 19, y: 11 }))),
    ).toBe("walking towards a wolf · 3 tiles");
    // A wolf standing near, or walking off, is not following anyone.
    put(ash, 19, 11);
    ash.wait = 30;
    expect(pageText(lineFor(world, ash, NO_FIGHT, undefined))).toBe("resting near the river");
    put(wolf[0] as Actor, 22, 11, [{ x: 23, y: 11 }]);
    expect(pageText(lineFor(world, ash, NO_FIGHT, undefined))).toBe("resting near the river");
  });

  it("counts what is in the bag on a walk, in place of anything else", () => {
    const bag = new Array(12).fill(0);
    bag.fill(goodId("raw_fish"), 0, 9);
    bag.fill(goodId("logs"), 9, 12);
    expect(bagList(bag)).toBe("9 fish, 3 logs");
    expect(bagList(new Array(12).fill(0))).toBe("");
    const { world, ash } = scene(17);
    put(ash, 20, 10, [{ x: 14, y: 10 }]);
    ash.bag = bag;
    expect(
      pageText(lineFor(world, ash, NO_FIGHT, walkOf({ x: 14, y: 10 }, { x: 22, y: 10 }))),
    ).toBe("walking to camp · 9 fish, 3 logs");
  });

  it("has at most one number, after the only dot, and no colon but a clock time's", () => {
    for (const [expected] of rows) {
      expect(expected.split(" · ").length).toBeLessThanOrEqual(2);
      expect(expected.replace(/\d\d:\d\d/, "")).not.toContain(":");
    }
  });

  it("tells news of what someone is doing as it is now, and drops it once they stop", () => {
    const { world, ash } = scene(9);
    const running: Line = {
      doing: "running",
      text: "running from a wolf",
      bare: "running from a wolf",
      number: "6 tiles to camp",
    };
    const queued = {
      text: "Ash is running from a wolf, 9 tiles to camp",
      who: ash.id,
      doing: "running",
    };
    const linesOf = (line: Line): Lines => ({
      ...NO_LINES,
      shown: new Map([[ash.id, { line, since: 0 }]]),
    });
    expect(newsNow(linesOf(running), world, queued)?.text).toBe(
      "Ash is running from a wolf, 6 tiles to camp",
    );
    const resting: Line = {
      doing: "resting",
      text: "resting at camp",
      bare: "resting",
      number: "",
    };
    expect(newsNow(linesOf(resting), world, queued)).toBeNull();
    // Other news is left as it is.
    const kill = { text: "Ash killed a wolf", who: ash.id };
    expect(newsNow(linesOf(resting), world, kill)).toBe(kill);
  });

  it("says running only while a monster is within 8 tiles", () => {
    const { world, ash, wolf } = scene(9, 1);
    const run = walkOf({ x: 21, y: 9 }, { x: 24, y: 9 }, true);
    put(ash, 23, 9, [
      { x: 22, y: 9 },
      { x: 21, y: 9 },
    ]);
    put(wolf[0] as Actor, 27, 9);
    expect(pageText(lineFor(world, ash, NO_FIGHT, run))).toBe(
      "running from a wolf · 9 tiles to camp",
    );
    // The wolf turned back: the walk is the same, but nothing is chasing.
    put(wolf[0] as Actor, 32, 9);
    expect(lineFor(world, ash, NO_FIGHT, run).doing).toBe("walking");
    // And with the wolf dead.
    world.actors = [ash];
    expect(lineFor(world, ash, NO_FIGHT, run).doing).toBe("walking");
  });

  it("does not take one step round something near a monster for running", () => {
    const { world, ash, wolf } = scene(9, 1);
    // Fen's step in the fight sheet: two tiles from the wolf, one step that ends three away.
    put(wolf[0] as Actor, 21, 6);
    put(ash, 23, 6, [{ x: 23, y: 5 }]);
    expect(nextWalk(world, ash, undefined)?.running).toBe(false);
    // A walk that ends well away from it is.
    put(ash, 23, 6, [
      { x: 23, y: 7 },
      { x: 23, y: 8 },
      { x: 23, y: 9 },
    ]);
    expect(nextWalk(world, ash, undefined)?.running).toBe(true);
  });

  it("reads fighting while striking, even with no blow yet traded", () => {
    const { world, ash, wolf } = scene(9, 1);
    put(ash, 21, 5);
    put(wolf[0] as Actor, 21, 6);
    (wolf[0] as Actor).hp = 4;
    ash.windup = 6;
    expect(pageText(lineFor(world, ash, NO_FIGHT, undefined))).toBe("fighting a wolf · wolf 4/24");
  });

  it("puts the name in front for the news", () => {
    const line: Line = {
      doing: "running",
      text: "running from 2 wolves",
      bare: "",
      number: "9 tiles to camp",
    };
    expect(newsText("Dara", line)).toBe("Dara is running from 2 wolves, 9 tiles to camp");
  });
});

describe("a row's line over time", () => {
  /** Steps the lines through ticks of one world, each set up by `at`, and returns what the row read at each. */
  function rows(world: World, ash: Actor, ticks: number, set: (t: number) => Fight): string[] {
    let lines: Lines = NO_LINES;
    const seen: string[] = [];
    const start = world.tick;
    for (let t = 0; t < ticks; t++) {
      world.tick = start + t;
      lines = nextLines(lines, world, set(t));
      seen.push(pageText(lines.shown.get(ash.id)?.line as Line));
    }
    return seen;
  }

  it("holds for two seconds before it changes", () => {
    const { world, ash } = scene(12);
    // Resting at the river, then a walk starts at tick 5 and ends at tick 8.
    const seen = rows(world, ash, 40, (t) => {
      if (t === 0) put(ash, 22, 10);
      if (t === 5) put(ash, 22, 10, [{ x: 21, y: 11 }]);
      if (t === 8) put(ash, 22, 10);
      ash.wait = t >= 8 && t < 30 ? 0 : 50;
      if (t === 30) put(ash, 22, 10, [{ x: 27, y: 13 }]);
      return NO_FIGHT;
    });
    // The short walk never shows: it was over before the rest had been up two seconds.
    expect(seen.slice(0, 30)).toEqual(new Array(30).fill("resting at the river"));
    // The next walk starts after the rest has been up for 30 ticks, and shows at once.
    expect(seen[30]).toBe("walking near the meadow");
  });

  it("goes to downed at once, and the number follows the world while the words stay", () => {
    const { world, ash, wolf } = scene(12, 1);
    put(ash, 19, 11);
    put(wolf[0] as Actor, 20, 11);
    const down = 6;
    const seen = rows(world, ash, 60, (t) => {
      (wolf[0] as Actor).hp = 24 - 4 * Math.min(t, 2);
      if (t < down) return fighting(world, ash.id);
      if (t === down) {
        put(ash, 14, 8);
        ash.wait = DOWN_TICKS;
        put(wolf[0] as Actor, 20, 11);
      }
      const since = world.tick - (t - down);
      return {
        ...NO_FIGHT,
        downs: new Map([[ash.id, since]]),
        fallen: [{ since, x: 19, y: 11, kind: ash.kind, id: ash.id, facing: 1, by: "Wolf" }],
      };
    });
    expect(seen.slice(0, 3)).toEqual([
      "fighting a wolf · wolf 24/24",
      "fighting a wolf · wolf 20/24",
      "fighting a wolf · wolf 16/24",
    ]);
    expect(seen[down - 1]).toBe("fighting a wolf · wolf 16/24");
    expect(seen[down]).toBe("downed by a wolf near the river");
    // It lies there for LIE_TICKS and fades for ARRIVE_TICKS, then mends at camp.
    expect(seen.slice(down, down + HOLD_TICKS).every((l) => l.startsWith("downed"))).toBe(true);
    expect(seen.at(-1)).toMatch(/^mending at camp · up at 12:\d\d$/);
  });
});

describe("a held line", () => {
  it("goes to fighting at once, and drops it at once when the wolf is killed", () => {
    const { world, ash, wolf } = scene(12, 1);
    const w = wolf[0] as Actor;
    let lines: Lines = NO_LINES;
    const read = (fight: Fight): string => {
      lines = nextLines(lines, world, fight);
      world.tick++;
      return pageText(lines.shown.get(ash.id)?.line as Line);
    };
    // Walking up to the wolf.
    put(w, 21, 6);
    put(ash, 21, 4, [{ x: 21, y: 5 }]);
    expect(read(NO_FIGHT)).toBe("walking towards a wolf · 2 tiles");
    // One tick later it winds up a blow: the line says so, not two seconds on.
    put(ash, 21, 5);
    ash.windup = 6;
    w.hp = 4;
    expect(read(fighting(world, ash.id))).toBe("fighting a wolf · wolf 4/24");
    // The blow lands and the wolf is gone. Nothing says it is still at 4/24.
    ash.windup = 0;
    world.actors = [ash];
    const after = read(fighting(world, ash.id));
    expect(after).not.toMatch(/wolf/);
    expect(after).toMatch(/^resting/);
  });

  it("keeps its words for two seconds but its number follows the world", () => {
    const { world, ash, wolf } = scene(12, 2);
    const [near, far] = wolf as [Actor, Actor];
    let lines: Lines = NO_LINES;
    const read = (fight: Fight): string => {
      lines = nextLines(lines, world, fight);
      world.tick++;
      return pageText(lines.shown.get(ash.id)?.line as Line);
    };
    put(ash, 19, 11);
    put(near, 20, 11);
    put(far, 25, 11);
    near.hp = 8;
    expect(read(fighting(world, ash.id))).toBe("fighting a wolf · wolf 8/24");
    // The near wolf dies; the other is 6 tiles off. The words hold, the number is the live one's.
    world.actors = [ash, far];
    far.hp = 20;
    expect(read(fighting(world, ash.id))).toBe("fighting a wolf · wolf 20/24");
    // And it keeps following it.
    far.hp = 12;
    expect(read(fighting(world, ash.id))).toBe("fighting a wolf · wolf 12/24");
  });

  it("counts the tiles to camp down while running is held", () => {
    const { world, ash, wolf } = scene(9, 2);
    const [first, second] = wolf as [Actor, Actor];
    let lines: Lines = NO_LINES;
    put(first, 27, 9);
    put(second, 27, 30);
    const seen: string[] = [];
    for (let x = 23; x >= 20; x--) {
      put(ash, x, 9, [{ x: 19, y: 9 }]);
      ash.fromX = x + 1;
      // A second wolf comes near after the first tick, so the fresh line has other words.
      if (x === 22) put(second, 26, 10);
      lines = nextLines(lines, world, NO_FIGHT);
      world.tick++;
      seen.push(pageText(lines.shown.get(ash.id)?.line as Line));
    }
    expect(seen).toEqual([
      "running from a wolf · 9 tiles to camp",
      "running from a wolf · 8 tiles to camp",
      "running from a wolf · 7 tiles to camp",
      "running from a wolf · 6 tiles to camp",
    ]);
  });
});

describe("the quiet news line", () => {
  const listed = (actors: readonly Actor[]): Set<number> => new Set(actors.map((a) => a.id));

  it("names a resident the page does not list, and goes round them", () => {
    const world = createWorld(atlas, 1, STILL, KINDS);
    world.tick = at(9);
    step(world, [
      { type: "spawn", name: "Ash", program: "still", x: 14, y: 8 },
      { type: "spawn", name: "Birch", program: "still", x: 22, y: 10 },
      { type: "spawn", name: "Cedar", program: "still", x: 15, y: 9 },
    ]);
    const [ash, birch, cedar] = world.actors as [Actor, Actor, Actor];
    const lines = nextLines(NO_LINES, world, NO_FIGHT);
    const quiet = (shown: Set<number>, tick: number): string =>
      quietNews(lines, world.actors, shown, tick)?.text ?? "";
    const told = new Set<string>();
    for (let tick = 0; tick < 4 * QUIET_TICKS; tick += QUIET_TICKS)
      told.add(quiet(listed([ash]), tick));
    expect([...told].sort()).toEqual(["Birch is resting at the river", "Cedar is resting at camp"]);
    // It says whom it is about, so they can have a slip on the map.
    expect(quietNews(lines, world.actors, listed([ash]), 0)?.who).not.toBe(ash.id);
    // It holds one name for QUIET_TICKS.
    expect(quiet(listed([ash]), 1)).toBe(quiet(listed([ash]), QUIET_TICKS - 1));
    // With everyone listed, it goes round everyone.
    const all = new Set([0, 1, 2].map((i) => quiet(listed([ash, birch, cedar]), i * QUIET_TICKS)));
    expect(all.size).toBe(3);
    for (const line of all) expect(line).toMatch(/^(Ash|Birch|Cedar) is /);
    // No one yet: nothing to say.
    expect(quietNews(NO_LINES, [], new Set(), 0)).toBeNull();
  });
});

describe("the line in a running world", () => {
  /** Steps `world` for `ticks`, reading the fight and the lines, and returns each tick's rows and news. */
  function play(world: World, ticks: number): { rows: string[][]; news: string[] } {
    let fight = NO_FIGHT;
    let lines: Lines = NO_LINES;
    const out = { rows: [] as string[][], news: [] as string[] };
    for (let t = 0; t < ticks; t++) {
      step(world);
      fight = nextFight(fight, world);
      lines = nextLines(lines, world, fight);
      out.rows.push([...lines.shown.values()].map((s) => pageText(s.line)));
      out.news.push(...lines.news.map((n) => n.text));
    }
    return out;
  }

  const programs = compileBots(
    {
      still: "otherwise -> wait(600)",
      runner: "when threat_distance <= 5 -> flee(threat_x, threat_y)\notherwise -> wait(10)",
      biter:
        "when threat_distance <= 2 -> attack(threat_x, threat_y)\notherwise -> step_to(threat_x, threat_y)",
    },
    placeConstants(atlas),
  );

  it("fights, is downed and mends, and the news tells of the fight starting", () => {
    const world = createWorld(atlas, 1, programs, KINDS);
    world.tick = at(10);
    step(world, [
      { type: "spawn", name: "Ash", program: "still", x: 19, y: 11 },
      { type: "spawn", name: "Wolf", program: "biter", kind: "wolf", x: 19, y: 15 },
    ]);
    const { rows, news } = play(world, 400);
    const seen = new Set(rows.flat());
    expect([...seen]).toContain("followed by a wolf · 3 tiles");
    expect(seen).toContain("fighting a wolf · wolf 24/24");
    expect([...seen].some((l) => /^downed by a wolf (at|near) the river$/.test(l))).toBe(true);
    expect([...seen].some((l) => /^mending at camp · up at 10:\d\d$/.test(l))).toBe(true);
    expect(news).toContain("Ash is fighting a wolf, wolf 24/24");
    // No row ever shows a rule's name.
    for (const line of seen) expect(line).not.toMatch(/still|biter|threat/);
  });

  it("runs from a monster and says how far camp is", () => {
    const world = createWorld(atlas, 1, programs, KINDS);
    world.tick = at(10);
    step(world, [
      { type: "spawn", name: "Ash", program: "runner", x: 19, y: 11 },
      { type: "spawn", name: "Wolf", program: "biter", kind: "wolf", x: 19, y: 17 },
    ]);
    const { rows, news } = play(world, 120);
    expect(rows.flat().some((l) => /^running from a wolf · \d+ tiles? to camp$/.test(l))).toBe(
      true,
    );
    expect(news.some((n) => /^Ash is running from a wolf, \d+ tiles? to camp$/.test(n))).toBe(true);
  });
});
