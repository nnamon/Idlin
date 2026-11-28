// Elements and statuses in the world (docs/slice.md, sections 1 and 4): a
// landing's element on its monsters, and what each status does to the bodies
// it is on, to the tick. Nobody wears gear yet, so a citizen's elemental
// lines are fed to `strike` by hand, as piece 4's examples were fed to `hit`.

import { describe, expect, it } from "vitest";
import { adopt } from "./adopt.ts";
import { terrainOf, walkable } from "./atlas.ts";
import type { Element, Modifier } from "./hit.ts";
import { BIOMES, generateLanding } from "./landing.ts";
import { parseMap, type TileMap } from "./map.ts";
import { noStatus, slowed } from "./status.ts";
import { compileBots } from "./tactics.ts";
import { putMonster } from "./testing.ts";
import {
  type Actor,
  blowsOf,
  createWorld,
  defenderOf,
  hashWorld,
  kindOf,
  readMessage,
  restore,
  SnapshotError,
  snapshot,
  step,
  strike,
  swingerOf,
  viewerMessage,
  type World,
  type WorldEvent,
} from "./world.ts";

const PROGRAMS = compileBots({
  still: "otherwise -> wait(100)",
  bite: "when threat_distance <= 1 -> attack(threat_x, threat_y)\notherwise -> wait(1)",
  smash: "when threat_distance <= 3 -> attack(threat_x, threat_y)\notherwise -> wait(1)",
  walker: "otherwise -> walk_to(15, 4)",
});
const KINDS = {
  // Level-27 pack monsters: a status lasts 40 ticks on them, an element's line is 10.
  post: { hp: 1000, damage: 0, windup: 30, recovery: 5, reach: 1, rank: "pack", level: 27 },
  frail: { hp: 40, damage: 0, windup: 30, recovery: 5, reach: 1, rank: "pack", level: 27 },
  // Level-1 fodder, whose line is 0.
  biter: { hp: 100, damage: 10, windup: 4, recovery: 5, reach: 1, step: 4 },
  slow: { hp: 100, damage: 1, windup: 30, recovery: 5, reach: 1 },
  heavy: { hp: 200, damage: 1, windup: 30, recovery: 5, reach: 1 },
  brute: { hp: 1275, damage: 144, windup: 6, recovery: 14, reach: 1, rank: "brute", level: 27 },
  // A status lasts 10 ticks on an elite.
  elite: { hp: 1000, damage: 0, windup: 30, recovery: 5, reach: 1, rank: "elite", level: 27 },
} as const;

/** An open field, 20 by 9, with the camp in a corner, of `element` if given. */
function field(element?: Element): TileMap {
  const rows = Array.from({ length: 9 }, (_, y) =>
    Array.from({ length: 20 }, (_, x) =>
      x === 0 || y === 0 || x === 19 || y === 8 ? "#" : x === 1 && y === 1 ? "c" : ".",
    ).join(""),
  );
  const map = parseMap({
    name: "field",
    width: 20,
    height: 9,
    legend: { ".": "grass", "#": "rock", c: "camp" },
    rows,
    places: { camp: { x: 1, y: 1 } },
  });
  return element === undefined ? map : { ...map, element };
}

type Weapon = "blade" | "maul" | "spear" | "bow";
/** A world on `ground` with Ash, an adventurer, at (x, y); Ash is the first actor, id 1. */
function withAsh(
  ground: TileMap,
  x: number,
  y: number,
  program = "still",
  weapon: Weapon = "blade",
) {
  const world = createWorld(ground, 1, PROGRAMS, KINDS);
  step(world, [{ type: "spawn", name: "Ash", program, x, y, weapon }]);
  return { world, ash: world.actors[0] as Actor };
}
const put = (world: World, kind: string, x: number, y: number, program = "still"): Actor => {
  putMonster(world, kind, { x, y }, program);
  return world.actors.at(-1) as Actor;
};
/** Ash's hit on `target` with these lines, as a blow landing now; the events it made. */
function struckBy(world: World, ash: Actor, target: Actor, lines: Modifier[]): WorldEvent[] {
  const events: WorldEvent[] = [];
  strike(
    world,
    ash,
    target,
    swingerOf(world, ash, kindOf(world, ash)),
    false,
    events,
    new Map(),
    lines,
  );
  return events;
}
const fire = (amount: number): Modifier => ({ kind: "added", type: "fire", amount });
const cold = (amount: number): Modifier => ({ kind: "added", type: "cold", amount });
const lightning = (amount: number): Modifier => ({ kind: "added", type: "lightning", amount });
/** Steps the world `ticks` times and returns every event, in order. */
function run(world: World, ticks: number): WorldEvent[] {
  const events: WorldEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...step(world));
  return events;
}

describe("a landing's element, from its biome (section 1)", () => {
  const EXPECTED = {
    meadow: undefined,
    pinewood: undefined,
    fen: "cold",
    crags: "lightning",
    ash_waste: "fire",
  } as const;
  const STATUS = { cold: "chill", lightning: "shock", fire: "burn" } as const;

  for (const biome of BIOMES) {
    const element = EXPECTED[biome];
    it(`${biome}: its monsters deal half their blow as ${element ?? "nothing"} and resist it by 40%`, () => {
      const landing = generateLanding({ seed: 3, size: "small", biome, level: 5 });
      expect(landing.element).toBe(element ?? "none");
      // A landing has no camp yet; the ramp stands in for it, so a world can be set on it.
      const places = [...landing.places, { name: "camp", ...landing.ramp }].sort((p, q) =>
        p.name < q.name ? -1 : 1,
      );
      const world = createWorld({ ...landing, places }, 1, PROGRAMS, KINDS);
      // Two tiles side by side off the city's ground.
      let at: { x: number; y: number } | undefined;
      for (let i = 0; i < landing.width * landing.height && !at; i++) {
        const x = i % landing.width;
        const y = (i - x) / landing.width;
        const ground = (gx: number) =>
          walkable(world.atlas, gx, y) && terrainOf(world.atlas, gx, y) !== "camp";
        if (ground(x) && ground(x + 1)) at = { x, y };
      }
      if (!at) throw new Error("no ground on the landing");
      step(world, [{ type: "spawn", name: "Ash", program: "still", x: at.x, y: at.y }]);
      const ash = world.actors[0] as Actor;
      const biter = put(world, "biter", at.x + 1, at.y, "bite");
      const swinger = swingerOf(world, biter, kindOf(world, biter));
      expect(swinger.element).toBe(element);
      expect(defenderOf(world, biter)).toEqual(
        element === undefined ? { armour: 0 } : { armour: 0, resist: { [element]: 4_000 } },
      );
      // Its blow of 10 is 5 and 5, and 5 is over a citizen's line: 1 of 20.
      const events = run(world, 10);
      const bite = events.find((e) => e.type === "hit" && e.actor === biter.id);
      expect(bite).toMatchObject({ target: ash.id, damage: 10, damageType: "physical" });
      const set = events.filter((e) => e.type === "status" && e.actor === ash.id);
      expect(set.map((e) => (e.type === "status" ? e.status : ""))).toEqual(
        element === undefined ? [] : [STATUS[element]],
      );
      // A citizen is never staggered.
      expect(ash.status.staggerLock).toBe(0);
    });
  }

  it("a brute on an ash waste resists a citizen's fire by 40%, and has armour of four times its level", () => {
    const { world, ash } = withAsh(field("fire"), 5, 4);
    const brute = put(world, "brute", 6, 4);
    expect(defenderOf(world, brute)).toEqual({ armour: 108, resist: { fire: 4_000 } });
    // A blade at Arms 1 is 7 physical, of which armour 108 takes 5; of 50 fire, 40% is 20.
    const [hit] = struckBy(world, ash, brute, [fire(50)]);
    expect(hit).toMatchObject({ type: "hit", damage: 2 + 30, damageType: "fire" });
  });

  it("a monster on a landing of no element deals and resists nothing but physical", () => {
    const { world } = withAsh(field(), 5, 4);
    const biter = put(world, "biter", 6, 4);
    expect(swingerOf(world, biter, kindOf(world, biter))).toEqual({ blow: 10, family: 10_000 });
    expect(defenderOf(world, biter)).toEqual({ armour: 0 });
  });
});

describe("stagger, wind-ups and knockback (4.2)", () => {
  /** Ash with a maul at (5, 4) and a monster of `kind` beside it, both swinging at each other. */
  function fight(kind: "slow" | "heavy") {
    const { world, ash } = withAsh(field(), 5, 4, "smash", "maul");
    const foe = put(world, kind, 6, 4, "bite");
    const hits: { tick: number; before: number; windup: number; x: number; marks: string }[] = [];
    const staggers: number[] = [];
    for (let i = 0; i < 40 && hits.length < 2; i++) {
      const before = foe.windup;
      const events = step(world);
      for (const e of events) {
        if (e.type === "status" && e.status === "stagger") staggers.push(e.tick);
        if (e.type === "hit" && e.actor === ash.id)
          hits.push({
            tick: e.tick,
            before,
            windup: foe.windup,
            x: foe.x,
            marks: world.marks
              .filter((m) => m.by === foe.id)
              .map((m) => `${m.x},${m.y}`)
              .join(" "),
          });
      }
    }
    return { foe, hits, staggers };
  }

  it("a maul's 15 staggers a monster of 100 hitpoints in its wind-up: the wind-up starts again, and goes with it when knocked back", () => {
    const { hits, staggers } = fight("slow");
    const [first, second] = hits;
    if (!first || !second) throw new Error("two blows should have landed");
    expect(staggers).toEqual([first.tick]);
    // Started again at 30, and counted down once in the same tick, after
    // Ash's blow, since the monster comes after Ash in update order. It had
    // been winding up for a while already.
    expect(first.before).toBeLessThan(29);
    expect(first.windup).toBe(29);
    // Knocked two tiles east, facing west still, its mark in front of it.
    expect(first.x).toBe(8);
    expect(first.marks).toBe("7,4");
    // The second blow comes within 2 seconds, so it does not stagger: the
    // wind-up runs on from where it was.
    expect(second.tick - first.tick).toBeLessThan(20);
    expect(second.windup).toBe(29 - (second.tick - first.tick));
    expect(second.x).toBe(10);
    expect(second.marks).toBe("9,4");
  });

  it("a monster of 200 hitpoints is not staggered by 15, and its wind-up runs on", () => {
    const { hits, staggers } = fight("heavy");
    const [first] = hits;
    if (!first) throw new Error("a blow should have landed");
    expect(staggers).toEqual([]);
    // One tick off the wind-up, as on any other tick.
    expect(first.before).toBeLessThan(29);
    expect(first.windup).toBe(first.before - 1);
    expect(first.x).toBe(8);
  });

  it("a hit with no physical part knocks nobody back", () => {
    const { world, ash } = withAsh(field(), 5, 4, "smash", "maul");
    const post = put(world, "post", 6, 4);
    // Arms 1's blow at a share of nothing: a maul's swing with only cold in it.
    const events: WorldEvent[] = [];
    const swinger = { blow: 0, family: 22_000 };
    const { parts } = strike(world, ash, post, swinger, false, events, new Map(), [cold(20)]);
    expect(parts).toEqual([0, 0, 44, 0]);
    expect(events.some((e) => e.type === "knock")).toBe(false);
  });

  it("a frozen body stands still under a maul's knockback, and is knocked back once it thaws", () => {
    const { world, ash } = withAsh(field(), 5, 4, "smash", "maul");
    const post = put(world, "post", 6, 4);
    post.status.chill = 40;
    post.status.freeze = 20;
    let frozenBlows = 0;
    const knocks: WorldEvent[] = [];
    for (let i = 0; i < 40 && post.x === 6; i++) {
      const frozen = post.status.freeze > 1;
      for (const e of step(world)) {
        if (e.type === "hit" && e.actor === ash.id && frozen) frozenBlows++;
        if (e.type === "knock") knocks.push(e);
      }
    }
    // The maul swings every 10 ticks, so it lands at least once on the frozen
    // body, which does not move, and then on the thawed one, which does.
    expect(frozenBlows).toBeGreaterThanOrEqual(1);
    expect(knocks).toEqual([
      expect.objectContaining({ type: "knock", actor: post.id, fromX: 6, x: 8 }),
    ]);
    expect(post.status.freeze).toBe(0);
  });

  it("the maul blow that freezes a body loses its own knockback", () => {
    const { world, ash } = withAsh(field(), 5, 4, "still", "maul");
    const post = put(world, "post", 6, 4);
    post.status.chill = 40;
    const events = struckBy(world, ash, post, [cold(20)]);
    expect(post.status.freeze).toBe(20);
    expect(events.some((e) => e.type === "knock")).toBe(false);
    expect(post.x).toBe(6);
  });
});

describe("burn (4.2)", () => {
  it("burns for its fire part each second for 4 seconds, and jumps once, at half strength, to one monster within a tile", () => {
    const { world, ash } = withAsh(field(), 2, 4);
    const first = put(world, "post", 5, 4);
    const next = put(world, "post", 6, 4);
    const far = put(world, "post", 7, 4);
    const t0 = world.tick;
    const events = struckBy(world, ash, first, [fire(30)]);
    expect(events.filter((e) => e.type === "status")).toEqual([
      { type: "status", tick: t0, actor: first.id, by: ash.id, status: "burn" },
    ]);
    expect(first.hp).toBe(1000 - 37);
    const after = run(world, 60);
    const burns = (id: number) =>
      after.flatMap((e) => (e.type === "burn" && e.actor === id ? [[e.tick - t0, e.damage]] : []));
    expect(burns(first.id)).toEqual([
      [10, 30],
      [20, 30],
      [30, 30],
      [40, 30],
    ]);
    expect(first.hp).toBe(1000 - 37 - 120);
    // The jump, at the first second: 15 a second for its own 4 seconds, and no further.
    expect(after.filter((e) => e.type === "status")).toEqual([
      { type: "status", tick: t0 + 10, actor: next.id, by: ash.id, status: "burn" },
    ]);
    expect(burns(next.id)).toEqual([
      [20, 15],
      [30, 15],
      [40, 15],
      [50, 15],
    ]);
    expect(burns(far.id)).toEqual([]);
    expect([first, next, far].map((p) => p.status)).toEqual([noStatus(), noStatus(), noStatus()]);
  });

  it("does not jump to a monster that is burning already", () => {
    const { world, ash } = withAsh(field(), 2, 4);
    const first = put(world, "post", 5, 4);
    const next = put(world, "post", 6, 4);
    struckBy(world, ash, first, [fire(30)]);
    struckBy(world, ash, next, [fire(12)]);
    const after = run(world, 10);
    expect(after.filter((e) => e.type === "status")).toEqual([]);
    expect(next.status).toMatchObject({ burnDamage: 12 });
  });

  it("a kill by a burn is its setter's", () => {
    const { world, ash } = withAsh(field(), 2, 4);
    const frail = put(world, "frail", 5, 4);
    ash.flask = 2;
    struckBy(world, ash, frail, [fire(30)]);
    expect(frail.hp).toBe(3);
    const after = run(world, 10);
    expect(after.find((e) => e.type === "down")).toMatchObject({ actor: frail.id, by: ash.id });
    expect(world.actors).not.toContain(frail);
    // It counts towards the flask's next drink like any kill of Ash's.
    expect(ash.kills).toBe(1);
  });
});

describe("chill and freeze (4.2)", () => {
  it("a chilled monster's steps and blows take half as long again", () => {
    const { world } = withAsh(field(), 2, 6);
    const walker = put(world, "biter", 5, 4, "walker");
    walker.status.chill = 40;
    const plain = put(world, "biter", 5, 2, "walker");
    let chilledStep = 0;
    let plainStep = 0;
    for (let i = 0; i < 5; i++) {
      step(world);
      chilledStep = Math.max(chilledStep, walker.moveTicksLeft);
      plainStep = Math.max(plainStep, plain.moveTicksLeft);
    }
    expect(plainStep).toBe(4);
    expect(chilledStep).toBe(slowed(4));
    // A wind-up begun chilled: 4 ticks become 6, and its recovery 5 becomes 7,
    // of which one is spent in the tick the blow lands.
    const { world: w2, ash } = withAsh(field(), 5, 4);
    const biter = put(w2, "biter", 6, 4, "bite");
    biter.status.chill = 40;
    step(w2);
    expect(biter.windup).toBe(6);
    let recovered = 0;
    for (let i = 0; i < 8; i++) {
      step(w2);
      recovered = Math.max(recovered, biter.recover);
    }
    expect(recovered).toBe(slowed(5) - 1);
    expect(ash.hp).toBe(20 - 10);
  });

  it("a second cold hit freezes a chilled monster for 2 seconds: its wind-up stands still, then runs on", () => {
    const { world, ash } = withAsh(field(), 5, 4);
    const biter = put(world, "biter", 6, 4, "bite");
    step(world);
    expect(biter.windup).toBe(4);
    const t0 = world.tick;
    struckBy(world, ash, biter, [cold(5)]);
    expect(biter.status).toMatchObject({ chill: 40, freeze: 0 });
    const events = struckBy(world, ash, biter, [cold(5)]);
    expect(
      events.filter((e) => e.type === "status").map((e) => e.type === "status" && e.status),
    ).toEqual(["chill", "freeze"]);
    expect(biter.status).toMatchObject({ chill: 40, freeze: 20 });
    // Frozen through tick t0 + 19: nothing counts down, and nothing lands on Ash.
    for (let t = 1; t <= 19; t++) {
      step(world);
      expect(biter.windup).toBe(4);
    }
    expect(ash.hp).toBe(20);
    step(world);
    expect(world.tick).toBe(t0 + 20);
    expect(biter.status).toMatchObject({ freeze: 0, freezeLock: 20 });
    expect(biter.windup).toBe(3);
  });

  it("a frozen monster that goes down shatters and chills every monster within 2 tiles", () => {
    const { world, ash } = withAsh(field(), 2, 4);
    const frozen = put(world, "post", 5, 4);
    const near = put(world, "post", 7, 4);
    const far = put(world, "post", 8, 4);
    frozen.status.chill = 40;
    struckBy(world, ash, frozen, [cold(20)]);
    expect(frozen.status.freeze).toBe(20);
    struckBy(world, ash, frozen, [{ kind: "added", type: "physical", amount: 10_000 }]);
    const after = run(world, 1);
    expect(after.find((e) => e.type === "shatter")).toMatchObject({ actor: frozen.id, x: 5, y: 4 });
    expect(near.status.chill).toBe(40);
    expect(far.status.chill).toBe(0);
  });

  it("a shatter passes over citizens, the one who downed it among them", () => {
    const { world, ash } = withAsh(field(), 4, 4);
    step(world, [{ type: "spawn", name: "Bo", program: "still", x: 5, y: 5 }]);
    const bo = world.actors.find((a) => a.name === "Bo") as Actor;
    const frozen = put(world, "post", 5, 4);
    const near = put(world, "post", 6, 4);
    frozen.status.chill = 40;
    frozen.status.freeze = 20;
    struckBy(world, ash, frozen, [{ kind: "added", type: "physical", amount: 10_000 }]);
    const after = run(world, 1);
    expect(after.find((e) => e.type === "shatter")).toMatchObject({ actor: frozen.id });
    const chilled = after.flatMap((e) =>
      e.type === "status" && e.status === "chill" ? [e.actor] : [],
    );
    expect(chilled).toEqual([near.id]);
    expect(ash.status.chill).toBe(0);
    expect(bo.status.chill).toBe(0);
    expect(near.status.chill).toBe(40);
  });

  it("one that goes down unfrozen does not shatter", () => {
    const { world, ash } = withAsh(field(), 2, 4);
    const post = put(world, "post", 5, 4);
    const near = put(world, "post", 6, 4);
    post.status.chill = 40;
    struckBy(world, ash, post, [{ kind: "added", type: "physical", amount: 10_000 }]);
    expect(run(world, 1).some((e) => e.type === "shatter")).toBe(false);
    expect(near.status.chill).toBe(0);
  });
});

describe("shock (4.2)", () => {
  it("a shocked target takes 20% more from every hit, whoever lands it", () => {
    const { world, ash } = withAsh(field(), 5, 4);
    const post = put(world, "post", 6, 4);
    expect(struckBy(world, ash, post, [])[0]).toMatchObject({ damage: 7 });
    post.status.shock = 40;
    expect(struckBy(world, ash, post, [])[0]).toMatchObject({ damage: 8 });
    // A monster's blow on a shocked citizen too.
    const biter = put(world, "biter", 4, 4);
    ash.status.shock = 40;
    const events: WorldEvent[] = [];
    strike(
      world,
      biter,
      ash,
      swingerOf(world, biter, kindOf(world, biter)),
      false,
      events,
      new Map(),
    );
    expect(events[0]).toMatchObject({ type: "hit", target: ash.id, damage: 12 });
  });

  it("a hit on a shocked monster arcs to the nearest other within 3 tiles for 30% of its lightning part, and the arc leaves nothing", () => {
    const { world, ash } = withAsh(field(), 2, 4);
    const shocked = put(world, "post", 5, 4);
    const nearest = put(world, "post", 6, 5);
    put(world, "post", 7, 4);
    shocked.status.shock = 40;
    const events = struckBy(world, ash, shocked, [lightning(100)]);
    const hits = events.filter((e) => e.type === "hit");
    // 7 physical and 100 lightning, 20% more: 8 and 120.
    expect(hits[0]).toMatchObject({ target: shocked.id, damage: 128, damageType: "lightning" });
    expect(hits[1]).toMatchObject({
      actor: ash.id,
      target: nearest.id,
      damage: 36,
      damageType: "lightning",
      arcFrom: shocked.id,
    });
    expect(hits[0]).not.toHaveProperty("arcFrom");
    expect(hits).toHaveLength(2);
    expect(nearest.status).toEqual(noStatus());
    // The viewer is told which blow is an arc, and where it came from.
    const blows = blowsOf(events);
    expect(blows.map((b) => b.arcFrom)).toEqual([undefined, shocked.id]);
    const { blows: seen } = readMessage(viewerMessage(world, blows), field(), PROGRAMS, KINDS);
    expect(seen).toEqual(blows);
  });

  it("the hit that downs a shocked monster arcs too", () => {
    const { world, ash } = withAsh(field(), 2, 4);
    const shocked = put(world, "post", 5, 4);
    const next = put(world, "post", 6, 4);
    shocked.status.shock = 40;
    shocked.hp = 5;
    const hits = struckBy(world, ash, shocked, [lightning(100)]).filter((e) => e.type === "hit");
    expect(hits).toEqual([
      expect.objectContaining({ target: shocked.id, damage: 128, hp: -123 }),
      expect.objectContaining({ target: next.id, damage: 36, arcFrom: shocked.id }),
    ]);
    expect(next.hp).toBe(1000 - 36);
    // Downed, it takes no status from the hit.
    expect(shocked.status).toEqual({ ...noStatus(), shock: 40 });
  });

  it("does not arc past 3 tiles, nor from a hit with no lightning in it", () => {
    const { world, ash } = withAsh(field(), 2, 4);
    const shocked = put(world, "post", 5, 4);
    put(world, "post", 9, 4);
    shocked.status.shock = 40;
    expect(
      struckBy(world, ash, shocked, [lightning(100)]).filter((e) => e.type === "hit"),
    ).toHaveLength(1);
    const near = put(world, "post", 6, 4);
    expect(struckBy(world, ash, shocked, [fire(100)]).filter((e) => e.type === "hit")).toHaveLength(
      1,
    );
    expect(near.hp).toBe(1000);
  });
});

describe("statuses in snapshots and the viewer's message", () => {
  /** A world mid-fight with every status and lockout on someone. */
  function busy(): World {
    const { world, ash } = withAsh(field("cold"), 5, 4, "smash", "maul");
    const a = put(world, "post", 6, 4, "bite");
    const b = put(world, "post", 7, 4);
    put(world, "biter", 4, 5, "bite");
    put(world, "elite", 12, 4);
    struckBy(world, ash, a, [fire(30), lightning(20)]);
    struckBy(world, ash, b, [cold(20)]);
    struckBy(world, ash, b, [cold(20)]);
    run(world, 3);
    return world;
  }
  const reload = (text: string): World => restore(text, field("cold"), PROGRAMS, KINDS);

  it("round-trips with statuses on, and goes on the same", () => {
    const world = busy();
    const statuses = world.actors.map((a) => a.status);
    expect(statuses.some((s) => s.burn > 0)).toBe(true);
    expect(statuses.some((s) => s.freeze > 0)).toBe(true);
    expect(statuses.some((s) => s.shock > 0)).toBe(true);
    const resumed = reload(snapshot(world));
    expect(resumed).toEqual(world);
    run(world, 120);
    run(resumed, 120);
    expect(hashWorld(resumed)).toBe(hashWorld(world));
  });

  it("round-trips an elite the world froze, through the freeze, the thaw and the lockout", () => {
    const { world, ash } = withAsh(field("cold"), 5, 4);
    const elite = put(world, "elite", 6, 4);
    struckBy(world, ash, elite, [cold(20)]);
    struckBy(world, ash, elite, [cold(20)]);
    expect(elite.status).toMatchObject({ chill: 10, freeze: 5 });
    // A snapshot on every tick from frozen to the lockout's end loads as the
    // world it was taken from.
    const whileFrozen = reload(snapshot(world));
    for (let t = 0; t < 30; t++) {
      expect(reload(snapshot(world))).toEqual(world);
      run(world, 1);
    }
    expect(elite.status).toMatchObject({ freeze: 0, freezeLock: 0 });
    // And the one taken while frozen goes on the same.
    run(whileFrozen, 30);
    expect(hashWorld(whileFrozen)).toBe(hashWorld(world));
  });

  it("are in the viewer's message", () => {
    const world = busy();
    const { world: seen } = readMessage(viewerMessage(world, []), field("cold"), PROGRAMS, KINDS);
    expect(seen.actors.map((a) => a.status)).toEqual(world.actors.map((a) => a.status));
  });

  it("hash: a changed status changes the hash", () => {
    const world = busy();
    const before = hashWorld(world);
    (world.actors[1] as Actor).status.shock++;
    expect(hashWorld(world)).not.toBe(before);
  });

  it("a status no world could hold is refused", () => {
    const text = snapshot(busy());
    // Actor 1 is burning and shocked, actor 2 frozen.
    const edited = (index: number, change: (status: Record<string, unknown>) => void): string => {
      const data = JSON.parse(text);
      change(data.state.actors[index].status);
      // The hash is made to match, so it is the reading of the state that refuses.
      data.hash = hashWorld({ ...reload(text), ...data.state });
      return JSON.stringify(data);
    };
    // Ones the world could hold load: actor 0 is Ash, actor 4 an elite.
    expect(reload(edited(1, (s) => (s.shock = 5))).actors[1]?.status.shock).toBe(5);
    const eliteFrozen = (s: Record<string, unknown>) => Object.assign(s, { chill: 10, freeze: 5 });
    expect(reload(edited(4, eliteFrozen)).actors[4]?.status).toMatchObject({ freeze: 5 });
    const ashBurning = { burn: 40, burnDamage: 1, burnBy: 4, burnJumps: 0 };
    const ashBurns = (s: Record<string, unknown>) => Object.assign(s, ashBurning);
    expect(reload(edited(0, ashBurns)).actors[0]?.status).toMatchObject(ashBurning);
    const refused: [number, (s: Record<string, unknown>) => void][] = [
      // Over what lasts on an elite: 10 ticks, and 5 for a freeze.
      [4, (s) => (s.chill = 11)],
      [4, (s) => (s.shock = 40)],
      [4, (s) => Object.assign(s, { chill: 10, freeze: 6 })],
      [4, (s) => Object.assign(s, { burn: 11, burnDamage: 5, burnBy: 1 })],
      // A burn that does nothing, and a freeze that outlasts its chill.
      [1, (s) => (s.burnDamage = 0)],
      [2, (s) => (s.chill = s.freeze)],
      // A citizen is never staggered, and its burn never jumps.
      [0, (s) => (s.staggerLock = 5)],
      [0, (s) => Object.assign(s, { ...ashBurning, burnJumps: 1 })],
      [1, (s) => (s.burn = 0)],
      [1, (s) => (s.burnBy = 99)],
      [1, (s) => (s.burnJumps = 2)],
      [2, (s) => (s.freeze = 21)],
      [2, (s) => (s.freezeLock = 1)],
      [2, (s) => (s.chill = -1)],
      [2, (s) => (s.chill = "5")],
      [2, (s) => (s.burnDamage = 4)],
      [2, (s) => delete s.shock],
    ];
    for (const [index, change] of refused)
      expect(() => reload(edited(index, change))).toThrow(SnapshotError);
  });

  it("adopted into kinds where a monster's rank lasts less, its statuses are cut to it", () => {
    const world = busy();
    const [, a, b] = world.actors as Actor[];
    if (!a || !b) throw new Error("busy has its monsters");
    expect(a.status).toMatchObject({ burn: 37, shock: 37 });
    expect(b.status).toMatchObject({ chill: 37, freeze: 17 });
    const kinds = { ...KINDS, post: { ...KINDS.post, rank: "elite" as const } };
    const { world: adopted, changes } = adopt(snapshot(world), field("cold"), PROGRAMS, kinds);
    const [, a2, b2] = adopted.actors as Actor[];
    expect(a2?.status).toMatchObject({ burn: 10, shock: 10 });
    expect(b2?.status).toMatchObject({ chill: 10, freeze: 5 });
    expect(changes).toContain(
      `${a.name} (#${a.id}): its statuses cut to the 10 ticks they last now`,
    );
    // Ash's and the elite's statuses are left as they were.
    expect(adopted.actors[0]?.status).toEqual(world.actors[0]?.status);
  });

  it("a count that is not a whole number is refused by adopt, not cut to fit", () => {
    const data = JSON.parse(snapshot(busy()));
    data.state.actors[1].status.burn = 37.5;
    // The hash reads 37.5 as 37, so it matches, and the state's reader refuses.
    data.hash = hashWorld({ ...reload(snapshot(busy())), ...data.state });
    const text = JSON.stringify(data);
    expect(() => reload(text)).toThrow(SnapshotError);
    const kinds = { ...KINDS, post: { ...KINDS.post, rank: "elite" as const } };
    expect(() => adopt(text, field("cold"), PROGRAMS, kinds)).toThrow(SnapshotError);
  });
});
