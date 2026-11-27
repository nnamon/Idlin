// Adopting a snapshot into content that changed after it was taken.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adopt } from "./adopt.ts";
import {
  type Atlas,
  atlasOf,
  parseWorld,
  pointOf,
  regionAt,
  terrainOf,
  walkable,
} from "./atlas.ts";
import { MapError, type Point, placeConstants } from "./map.ts";
import { NODE_KINDS } from "./nodes.ts";
import { compileBots } from "./tactics.ts";
import { botSources, firstLight, rawWorld, shippedMonsters, shippedWorld } from "./testing.ts";
import { MEMORY_SLOTS } from "./vm.ts";
import {
  type Actor,
  ADVENTURER,
  createWorld,
  hashStateAs,
  hashWorld,
  type Kinds,
  MONSTER_CAP,
  type Programs,
  restore,
  SnapshotError,
  type Spawns,
  snapshot,
  spawnsNearCamp,
  step,
  TICKS_PER_DAY,
  type World,
} from "./world.ts";

const WORLD = shippedWorld();
const MONSTERS = shippedMonsters(WORLD);
const BOTS = botSources();
const programsWith = (sources: Record<string, string>, atlas: Atlas = WORLD): Programs => ({
  ...compileBots(sources, placeConstants(atlas)),
  ...MONSTERS.programs,
});

interface Content {
  readonly atlas: Atlas;
  readonly programs: Programs;
  readonly kinds: Kinds;
  readonly spawns: Spawns;
}
const SHIPPED: Content = {
  atlas: WORLD,
  programs: programsWith(BOTS),
  kinds: MONSTERS.kinds,
  spawns: MONSTERS.spawns,
};
const CAST = ["Ada", "Bram", "Cole", "Dena", "Edda", "Finn"].map((name, i) => ({
  name,
  program: (["homebody", "riverwalker", "wanderer"] as const)[i % 3] as string,
}));
/** A value in a memory slot that no shipped program uses, to see whether memory is kept. */
const MARK = 77;

/**
 * The shipped world after a morning: residents with some experience and, once
 * one has come, monsters about. Every actor's last memory slot holds MARK.
 */
const lived = ((): string => {
  const world = createWorld(WORLD, 260, SHIPPED.programs, SHIPPED.kinds, SHIPPED.spawns);
  step(world, spawnsNearCamp(world, CAST));
  const monster = (): boolean => world.actors.some((a) => a.kind !== ADVENTURER);
  while ((world.tick < 3000 || !monster()) && world.tick < TICKS_PER_DAY) step(world);
  for (const actor of world.actors) actor.memory[MEMORY_SLOTS - 1] = MARK;
  return snapshot(world);
})();
const before = restore(lived, SHIPPED.atlas, SHIPPED.programs, SHIPPED.kinds, SHIPPED.spawns);

const adoptInto = (text: string, c: Content) => adopt(text, c.atlas, c.programs, c.kinds, c.spawns);

/** The shipped content with Homebody's idle wait a tick longer. */
const EDITED: Content = {
  ...SHIPPED,
  programs: programsWith({
    ...BOTS,
    homebody: BOTS.homebody?.replace("wander; wait(30)", "wander; wait(31)") as string,
  }),
};

type Data = Record<string, unknown> & { state: Record<string, unknown> };
/** The lived snapshot, parsed, to be changed. */
const data = (): Data => JSON.parse(lived);
const actors = (d: Data): Record<string, unknown>[] => d.state.actors as Record<string, unknown>[];
/** `d` as text, with the hash its state would need to pass as undamaged. */
const forge = (d: Data): string => {
  d.hash = hashStateAs(d.state as unknown as World, 9, {
    map: d.map as string,
    programs: d.programs as string,
    kinds: d.kinds as string,
    spawns: d.spawns as string,
  });
  return JSON.stringify(d);
};

/**
 * Adopts `text` into `c` twice and checks both give the same world, which runs
 * on to the same hash straight through as through a snapshot and a strict
 * restore halfway. Returns the adopted world, not stepped.
 */
function continues(text: string, c: Content, ticks = 600): World {
  const { world } = adoptInto(text, c);
  const straight = adoptInto(text, c).world;
  const halfway = adoptInto(text, c).world;
  expect(straight).toEqual(world);
  expect(hashWorld(straight)).toBe(hashWorld(world));
  for (let i = 0; i < ticks; i++) step(straight);
  for (let i = 0; i < ticks / 2; i++) step(halfway);
  const resumed = restore(snapshot(halfway), c.atlas, c.programs, c.kinds, c.spawns);
  expect(hashWorld(resumed)).toBe(hashWorld(halfway));
  for (let i = 0; i < ticks / 2; i++) step(resumed);
  expect(hashWorld(resumed)).toBe(hashWorld(straight));
  return world;
}

/** What an actor keeps through adoption whatever changed. */
const kept = (a: Actor) => ({
  id: a.id,
  name: a.name,
  kind: a.kind,
  xp: a.xp,
  bag: a.bag,
  bank: a.bank,
  deaths: a.deaths,
});
const placed = (a: Actor) => ({ ...kept(a), x: a.x, y: a.y, hp: a.hp });

describe("adopting a snapshot", () => {
  it("is restore when the content is the same", () => {
    const { world, changes } = adoptInto(lived, SHIPPED);
    expect(changes).toEqual([]);
    expect(world).toEqual(before);
  });

  it("starts from a world with residents who have experience and a monster about", () => {
    expect(before.actors.some((a) => a.kind !== ADVENTURER)).toBe(true);
    expect(before.actors.some((a) => a.xp.some((n) => n > 0))).toBe(true);
  });

  it("after a program is edited: everyone stays, and only that program's actors forget", () => {
    const content = EDITED;
    expect(content.programs.homebody).not.toEqual(SHIPPED.programs.homebody);
    expect(() =>
      restore(lived, content.atlas, content.programs, content.kinds, content.spawns),
    ).toThrow(/different programs/);

    const { changes } = adoptInto(lived, content);
    const world = continues(lived, content);
    expect(world.tick).toBe(before.tick);
    expect(world.actors.map(placed)).toEqual(before.actors.map(placed));
    for (const actor of world.actors) {
      const was = before.actors.find((a) => a.id === actor.id) as Actor;
      if (actor.program === "homebody") {
        expect(actor.memory).toEqual(new Array(MEMORY_SLOTS).fill(0));
        expect(actor.rule).toBe(-1);
      } else {
        expect(actor.memory).toEqual(was.memory);
        expect(actor.rule).toBe(was.rule);
      }
    }
    expect(changes).toEqual([
      "the programs have changed",
      'cleared the memory and rule of 2 actor(s) running "homebody"',
    ]);
  });

  it("after a program is removed: its actors go, with the reason, and the rest stay as they were", () => {
    const { riverwalker: _, ...rest } = BOTS;
    const content = { ...SHIPPED, programs: programsWith(rest) };
    const { changes } = adoptInto(lived, content);
    const world = continues(lived, content);
    const staying = before.actors.filter((a) => a.program !== "riverwalker");
    expect(staying.length).toBe(before.actors.length - 2);
    expect(world.actors).toEqual(staying);
    expect(changes).toEqual([
      "the programs have changed",
      'removed Bram (#2): there is no program "riverwalker" now',
      'removed Edda (#5): there is no program "riverwalker" now',
    ]);
  });

  it("without the fingerprint of each program, as snapshots before it were: everyone forgets", () => {
    const data = JSON.parse(lived);
    delete data.byProgram;
    const text = JSON.stringify(data);
    const edited = BOTS.wanderer?.replace(/wait\((\d+)\)/, "wait(1$1)") as string;
    expect(edited).not.toBe(BOTS.wanderer);
    const content = { ...SHIPPED, programs: programsWith({ ...BOTS, wanderer: edited }) };
    const { world, changes } = adoptInto(text, content);
    continues(text, content);
    expect(world.actors.map(placed)).toEqual(before.actors.map(placed));
    expect(world.actors.every((a) => a.memory.every((n) => n === 0) && a.rule === -1)).toBe(true);
    expect(changes).toContain(
      "the snapshot does not say which programs changed, so all of them count as changed",
    );
  });

  it("after a monster kind's numbers change: monsters stay where they are, cut to the new numbers", () => {
    const monster = before.actors.find((a) => a.kind !== ADVENTURER) as Actor;
    const kind = MONSTERS.kinds[monster.kind] as Kinds[string];
    const weaker = { ...kind, hp: 1, windup: 1, recovery: 0, damage: kind.damage + 1 };
    const content = { ...SHIPPED, kinds: { ...MONSTERS.kinds, [monster.kind]: weaker } };
    expect(() =>
      restore(lived, content.atlas, content.programs, content.kinds, content.spawns),
    ).toThrow(/different monster kinds/);

    const { changes } = adoptInto(lived, content);
    const world = continues(lived, content);
    expect(world.actors.map((a) => ({ ...kept(a), x: a.x, y: a.y }))).toEqual(
      before.actors.map((a) => ({ ...kept(a), x: a.x, y: a.y })),
    );
    for (const actor of world.actors.filter((a) => a.kind === monster.kind)) {
      expect(actor.hp).toBe(1);
      expect(actor.windup).toBeLessThanOrEqual(1);
      expect(actor.recover).toBe(0);
    }
    expect(changes[0]).toBe("the monster kinds have changed");
    expect(changes).toContain(
      `${monster.name} (#${monster.id}): hitpoints cut from ${monster.hp} to 1`,
    );
  });

  it("after a monster kind is removed: its monsters go, with the reason", () => {
    const monster = before.actors.find((a) => a.kind !== ADVENTURER) as Actor;
    const { [monster.kind]: _, ...kinds } = MONSTERS.kinds;
    const spawns = MONSTERS.spawns.filter((s) => s.kind !== monster.kind);
    const content = { ...SHIPPED, kinds, spawns };
    const { changes } = adoptInto(lived, content);
    const world = continues(lived, content);
    expect(world.actors).toEqual(before.actors.filter((a) => a.kind !== monster.kind));
    expect(world.marks.every((m) => world.actors.some((a) => a.id === m.by))).toBe(true);
    expect(changes).toContain(
      `removed ${monster.name} (#${monster.id}): there is no monster kind "${monster.kind}" now`,
    );
  });

  it("after a map gains a node: everyone keeps their place and the new node stands full", () => {
    const { world: layout, maps } = rawWorld();
    const camp = maps.camp as { rows: string[]; nodes: { kind: string; x: number; y: number }[] };
    let atlas: Atlas | null = null;
    // The first tree in camp's map that is not a node yet and can be one.
    for (let y = 0; y < camp.rows.length && !atlas; y++) {
      for (let x = 0; x < (camp.rows[y] as string).length && !atlas; x++) {
        if (camp.rows[y]?.[x] !== "T" || camp.nodes.some((n) => n.x === x && n.y === y)) continue;
        const nodes = [...camp.nodes, { kind: "tree", x, y }];
        try {
          atlas = parseWorld(layout, { ...maps, camp: { ...camp, nodes } });
        } catch (error) {
          if (!(error instanceof MapError)) throw error;
        }
      }
    }
    if (!atlas) throw new Error("no tree in camp can be made a node");
    expect(atlas.nodes.length).toBe(WORLD.nodes.length + 1);
    const content = { ...SHIPPED, atlas, programs: programsWith(BOTS, atlas) };

    const { changes } = adoptInto(lived, content);
    const world = continues(lived, content);
    expect(world.actors.map(placed)).toEqual(before.actors.map(placed));
    expect(world.nodes).toEqual(
      atlas.nodes.map((n) => ({ left: NODE_KINDS[n.kind - 1]?.yield, back: 0 })),
    );
    expect(world.nextSpawn).toEqual(before.nextSpawn);
    expect(changes).toEqual([
      "the map has changed",
      `all ${atlas.nodes.length} nodes stand full again`,
    ]);
  });

  it("after the ground under an actor turns to rock: it moves to the nearest tile it can stand on", () => {
    const { world: layout, maps } = rawWorld();
    const regions = (layout as { regions: { map: string; x: number; y: number }[] }).regions;
    let found: { atlas: Atlas; actor: Actor } | null = null;
    for (const actor of before.actors) {
      const region = regions[regionAt(WORLD, actor.x, actor.y)] as (typeof regions)[number];
      const map = maps[region.map] as { rows: string[] };
      const [lx, ly] = [actor.x - region.x, actor.y - region.y];
      const rows = map.rows.map((row, y) =>
        y === ly ? `${row.slice(0, lx)}#${row.slice(lx + 1)}` : row,
      );
      try {
        const atlas = parseWorld(layout, { ...maps, [region.map]: { ...map, rows } });
        found = { atlas, actor };
        break;
      } catch (error) {
        if (!(error instanceof MapError)) throw error;
      }
    }
    if (!found) throw new Error("no actor's tile can be made rock");
    const { atlas, actor } = found;
    expect(walkable(atlas, actor.x, actor.y)).toBe(false);
    const content = { ...SHIPPED, atlas, programs: programsWith(BOTS, atlas) };

    const { changes } = adoptInto(lived, content);
    const world = continues(lived, content);
    const moved = world.actors.find((a) => a.id === actor.id) as Actor;
    expect(walkable(atlas, moved.x, moved.y)).toBe(true);
    expect(Math.abs(moved.x - actor.x) + Math.abs(moved.y - actor.y)).toBe(1);
    expect([moved.fromX, moved.fromY, moved.moveTicksLeft, moved.path]).toEqual([
      moved.x,
      moved.y,
      0,
      [],
    ]);
    expect(changes).toContain(
      `moved ${actor.name} (#${actor.id}) from (${actor.x}, ${actor.y}) to (${moved.x}, ${moved.y}): it can no longer stand where it was`,
    );
    // Everyone else stays put.
    expect(world.actors.filter((a) => a !== moved).map(kept)).toEqual(
      before.actors.filter((a) => a.id !== actor.id).map(kept),
    );
  });

  it("removes a monster that would take its region past the cap", () => {
    // A change of map can put more monsters in a region than it may hold. The
    // same state is made here by adding copies of a monster beside it.
    const d = data();
    const raw = actors(d) as (Record<string, unknown> & Point)[];
    const monster = raw.find((a) => a.kind !== ADVENTURER) as (typeof raw)[number];
    const region = regionAt(WORLD, monster.x, monster.y);
    const monstersThere = () =>
      raw.filter((a) => a.kind !== ADVENTURER && regionAt(WORLD, a.x, a.y) === region).length;
    const free: Point[] = [];
    for (let tile = 0; tile < WORLD.width * WORLD.height; tile++) {
      const p = pointOf(WORLD, tile);
      if (regionAt(WORLD, p.x, p.y) !== region || !walkable(WORLD, p.x, p.y)) continue;
      if (terrainOf(WORLD, p.x, p.y) === "camp" || raw.some((a) => a.x === p.x && a.y === p.y))
        continue;
      free.push(p);
    }
    let last = 0;
    while (monstersThere() <= MONSTER_CAP) {
      const { x, y } = free.shift() as Point;
      last = d.state.nextActorId as number;
      d.state.nextActorId = last + 1;
      raw.push({ ...monster, id: last, x, y, fromX: x, fromY: y, moveTicksLeft: 0, path: [] });
      Object.assign(raw.at(-1) as object, { blocked: 0, windup: 0, recover: 0 });
    }
    const text = forge(d);
    expect(() =>
      restore(text, SHIPPED.atlas, SHIPPED.programs, SHIPPED.kinds, SHIPPED.spawns),
    ).toThrow(/damaged/);

    const { world, changes } = adoptInto(text, EDITED);
    const there = world.actors.filter(
      (a) => a.kind !== ADVENTURER && regionAt(WORLD, a.x, a.y) === region,
    );
    expect(there.length).toBe(MONSTER_CAP);
    expect(there.some((a) => a.id === last)).toBe(false);
    const name = WORLD.regions[region]?.map.name;
    expect(changes).toContain(
      `removed ${monster.name} (#${last}): ${name} already holds ${MONSTER_CAP} monsters`,
    );
  });

  it("still migrates an older snapshot first: version 8, after its program was edited", () => {
    const map = firstLight();
    const sources = {
      stroller:
        'bot "Stroller"\nwhen threat_distance <= 1 -> attack(threat_x, threat_y)\notherwise -> walk_to(deep_wood); wait(21)\n',
      biter:
        'bot "Biter"\nwhen threat_distance <= 1 -> attack(threat_x, threat_y)\nwhen threat_distance < 12 -> walk_to(threat_x, threat_y)\notherwise -> wander; wait(10)\n',
    };
    const kinds = { wolf: { hp: 60, damage: 5, windup: 8, recovery: 10, reach: 1 } };
    const spawns = [
      {
        kind: "wolf",
        name: "Wolf",
        program: "biter",
        group: 2,
        day: [{ x: 4, y: 6 }],
        night: [{ x: 4, y: 6 }],
      },
    ];
    const text = readFileSync(new URL("./fixtures/snapshot-v8.json", import.meta.url), "utf8");
    const programs = compileBots(sources, placeConstants(map));
    const content = { atlas: atlasOf(map), programs, kinds, spawns };
    expect(() => restore(text, map, programs, kinds, spawns)).toThrow(/different programs/);
    const { world, changes } = adoptInto(text, content);
    continues(text, content);
    expect(world.tick).toBe(3001);
    expect(world.actors.map((a) => a.name)).toEqual(["Ash", "Bryn", "Cole"]);
    expect(world.actors[0]?.bank).toEqual([5, 2, 7, 0]);
    expect(world.actors.every((a) => a.memory.every((n) => n === 0))).toBe(true);
    expect(changes.slice(0, 2)).toEqual([
      "the programs have changed",
      "the snapshot does not say which programs changed, so all of them count as changed",
    ]);
  });
});

describe("adopting a snapshot refuses what it cannot trust", () => {
  const content = EDITED;

  it("checks its own hash: an altered state is damaged", () => {
    const d = data();
    const first = actors(d)[1] as Record<string, unknown>;
    first.hp = first.hp === 1 ? 2 : 1;
    expect(() => adoptInto(JSON.stringify(d), content)).toThrow(/damaged/);
    // The same state with the hash made to match is let through, so the cases
    // below are refused for what they hold, not for their hash.
    expect(adoptInto(forge(d), content).world.actors[1]?.hp).toBe(first.hp);
  });

  it("refuses garbage, another version and a forged hash over state no world holds", () => {
    const cases: [string, string][] = [
      ["{ not json", "not valid JSON"],
      ["[]", "not an object"],
      [JSON.stringify({ ...data(), version: 99 }), "version 99"],
    ];
    for (const [text, why] of cases) {
      expect(() => adoptInto(text, content), why).toThrow(SnapshotError);
      expect(() => adoptInto(text, content), why).toThrow(why);
    }
    const hostile: ((d: ReturnType<typeof data>) => void)[] = [
      (d) => {
        (actors(d)[1] as Record<string, unknown>).x = "3";
      },
      (d) => {
        (actors(d)[1] as Record<string, unknown>).hp = 0;
      },
      (d) => {
        (actors(d)[1] as Record<string, unknown>).path = [{ x: 1 }];
      },
      (d) => {
        // Bram runs riverwalker, which did not change, so his memory is kept and read.
        (actors(d)[1] as Record<string, unknown>).memory = "lots";
      },
      (d) => {
        (actors(d)[1] as Record<string, unknown>).id = 1;
      },
      (d) => {
        d.state.actors = { length: 1 };
      },
      (d) => {
        d.state.marks = [{ x: 0, y: 0, by: 9999 }];
      },
      (d) => {
        d.state.nodes = [];
      },
      (d) => {
        d.state = null as unknown as Record<string, unknown>;
      },
    ];
    for (const [i, change] of hostile.entries()) {
      const d = data();
      change(d);
      let text: string;
      try {
        text = forge(d);
      } catch {
        text = JSON.stringify(d);
      }
      expect(() => adoptInto(text, content), `case ${i}`).toThrow(SnapshotError);
    }
  });

  it("with the same content as the snapshot, is as strict as restore", () => {
    const d = data();
    (actors(d)[1] as Record<string, unknown>).hp = 0;
    expect(() => adoptInto(forge(d), SHIPPED)).toThrow(/damaged/);
  });
});
