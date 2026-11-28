// Adopting a snapshot into content that changed after it was taken.

import { describe, expect, it } from "vitest";
import { adopt } from "./adopt.ts";
import { type Atlas, atlasOf, walkable } from "./atlas.ts";
import { MapError, parseMap, placeConstants } from "./map.ts";
import { NODE_KINDS } from "./nodes.ts";
import { compileBots } from "./tactics.ts";
import {
  botSources,
  campBotSources,
  campMap,
  campMonsters,
  rawCamp,
  spawnsNearCamp,
} from "./testing.ts";
import { MEMORY_SLOTS } from "./vm.ts";
import {
  type Actor,
  ADVENTURER,
  createCity,
  createWorld,
  DOWN_TICKS,
  hashStateAs,
  hashWorld,
  type Kinds,
  mending,
  type Programs,
  restore,
  SnapshotError,
  snapshot,
  step,
  type World,
} from "./world.ts";

const WORLD = atlasOf(campMap());
const MONSTERS = campMonsters(WORLD);
const BOTS = campBotSources();
const programsWith = (sources: Record<string, string>, atlas: Atlas = WORLD): Programs => ({
  ...compileBots(sources, placeConstants(atlas)),
  ...MONSTERS.programs,
});

interface Content {
  readonly atlas: Atlas;
  readonly programs: Programs;
  readonly kinds: Kinds;
}
const SHIPPED: Content = {
  atlas: WORLD,
  programs: programsWith(BOTS),
  kinds: MONSTERS.kinds,
};
const CAST = ["Ada", "Bram", "Cole", "Dena", "Edda", "Finn"].map((name, i) => ({
  name,
  program: (["homebody", "riverwalker", "wanderer"] as const)[i % 3] as string,
}));
/** A value in a memory slot that no shipped program uses, to see whether memory is kept. */
const MARK = 77;

/**
 * The camp after a morning: citizens with some experience and monsters
 * about, put in by hand as the camp has no spawn table now. Every actor's
 * last memory slot holds MARK.
 */
const lived = ((): string => {
  const world = createWorld(WORLD, 260, SHIPPED.programs, SHIPPED.kinds);
  step(world, spawnsNearCamp(world, CAST));
  const beast = (kind: string, at: string) => {
    const where = WORLD.places.find((p) => p.name === at) as { x: number; y: number };
    return {
      type: "spawn" as const,
      name: kind === "wolf" ? "Wolf" : "Goblin",
      program: kind,
      kind,
      ...where,
    };
  };
  step(world, [beast("wolf", "meadow"), beast("goblin", "den"), beast("goblin", "deep_wood")]);
  while (world.tick < 3000) step(world);
  if (!world.actors.some((a) => a.kind !== ADVENTURER)) step(world, [beast("wolf", "meadow")]);
  for (const actor of world.actors) actor.memory[MEMORY_SLOTS - 1] = MARK;
  return snapshot(world);
})();
const before = restore(lived, SHIPPED.atlas, SHIPPED.programs, SHIPPED.kinds);

const adoptInto = (text: string, c: Content) => adopt(text, c.atlas, c.programs, c.kinds);

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
  d.hash = hashStateAs(d.state as unknown as World, {
    map: d.map as string,
    programs: d.programs as string,
    kinds: d.kinds as string,
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
  const resumed = restore(snapshot(halfway), c.atlas, c.programs, c.kinds);
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
    expect(() => restore(lived, content.atlas, content.programs, content.kinds)).toThrow(
      /different programs/,
    );

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

  it("after a program is edited: one of its residents mending after a down still mends, and one waiting decides at once", () => {
    const d = data();
    const homebodies = actors(d).filter((a) => a.program === "homebody");
    expect(homebodies).toHaveLength(2);
    const [down, idle] = homebodies as [Record<string, unknown>, Record<string, unknown>];
    // As a down leaves one, and one partway through a wait its program chose.
    Object.assign(down, { wait: DOWN_TICKS, rule: -1, fault: 0 });
    Object.assign(idle, { wait: 100, rule: 0, fault: 0 });
    const text = forge(d);
    const saved = restore(text, SHIPPED.atlas, SHIPPED.programs, SHIPPED.kinds);
    const mender = saved.actors.find((a) => a.id === down.id) as Actor;
    const waiter = saved.actors.find((a) => a.id === idle.id) as Actor;
    expect([mending(mender), mending(waiter)]).toEqual([true, false]);

    const world = continues(text, EDITED);
    const after = (id: unknown) => world.actors.find((a) => a.id === id) as Actor;
    expect(after(down.id)).toMatchObject({ wait: DOWN_TICKS, rule: -1 });
    expect(mending(after(down.id))).toBe(true);
    expect(after(idle.id)).toMatchObject({ wait: 0, rule: -1 });
    expect(mending(after(idle.id))).toBe(false);
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
    // One with more than the new kind's 1 hitpoint, so there is something to cut.
    const monster = before.actors.find((a) => a.kind !== ADVENTURER && a.hp > 1) as Actor;
    const kind = MONSTERS.kinds[monster.kind] as Kinds[string];
    const weaker = { ...kind, hp: 1, windup: 1, recovery: 0, damage: kind.damage + 1 };
    const content = { ...SHIPPED, kinds: { ...MONSTERS.kinds, [monster.kind]: weaker } };
    expect(() => restore(lived, content.atlas, content.programs, content.kinds)).toThrow(
      /different monster kinds/,
    );

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

  it("after a monster kind walks faster: one saved further into a step than it now takes is cut to the new step", () => {
    // Wolves as a slower file had them: 6 ticks a tile, where the shipped file has 4.
    const fast = (MONSTERS.kinds.wolf as Kinds[string]).step;
    expect(fast).toBe(4);
    const slowWolf = { ...(MONSTERS.kinds.wolf as Kinds[string]), step: 6 };
    const slow: Content = { ...SHIPPED, kinds: { ...MONSTERS.kinds, wolf: slowWolf } };
    const world = createWorld(WORLD, 3, slow.programs, slow.kinds);
    step(world, [{ type: "spawn", name: "Wolf", program: "wolf", kind: "wolf", x: 4, y: 6 }]);
    const wolf = world.actors[0] as Actor;
    const mid: Record<number, string> = {};
    for (let t = 0; t < 600 && !(mid[5] && mid[6]); t++) {
      step(world);
      if (wolf.moveTicksLeft >= 5) mid[wolf.moveTicksLeft] ??= snapshot(world);
    }
    for (const ticks of [5, 6]) {
      const text = mid[ticks] as string;
      expect(text, `a wolf ${ticks} ticks into a step`).toBeDefined();
      expect(() => restore(text, SHIPPED.atlas, SHIPPED.programs, SHIPPED.kinds)).toThrow(
        /different monster kinds/,
      );
      const adopted = continues(text, SHIPPED);
      const saved = restore(text, slow.atlas, slow.programs, slow.kinds);
      const was = saved.actors.find((a) => a.kind === "wolf") as Actor;
      const now = adopted.actors.find((a) => a.id === was.id) as Actor;
      expect(was.moveTicksLeft).toBe(ticks);
      expect(now.moveTicksLeft).toBe(4);
      expect({ x: now.x, y: now.y, fromX: now.fromX, fromY: now.fromY }).toEqual({
        x: was.x,
        y: was.y,
        fromX: was.fromX,
        fromY: was.fromY,
      });
    }
  });

  it("after a monster kind is removed: its monsters go, with the reason", () => {
    const monster = before.actors.find((a) => a.kind !== ADVENTURER) as Actor;
    const { [monster.kind]: _, ...kinds } = MONSTERS.kinds;
    const content = { ...SHIPPED, kinds };
    const { changes } = adoptInto(lived, content);
    const world = continues(lived, content);
    expect(world.actors).toEqual(before.actors.filter((a) => a.kind !== monster.kind));
    expect(world.marks.every((m) => world.actors.some((a) => a.id === m.by))).toBe(true);
    expect(changes).toContain(
      `removed ${monster.name} (#${monster.id}): there is no monster kind "${monster.kind}" now`,
    );
  });

  it("after a map gains a node: everyone keeps their place and the new node stands full", () => {
    const camp = rawCamp() as { rows: string[]; nodes: { kind: string; x: number; y: number }[] };
    let atlas: Atlas | null = null;
    // The first tree in camp's map that is not a node yet and can be one.
    for (let y = 0; y < camp.rows.length && !atlas; y++) {
      for (let x = 0; x < (camp.rows[y] as string).length && !atlas; x++) {
        if (camp.rows[y]?.[x] !== "T" || camp.nodes.some((n) => n.x === x && n.y === y)) continue;
        const nodes = [...camp.nodes, { kind: "tree", x, y }];
        try {
          atlas = atlasOf(parseMap({ ...camp, nodes }));
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
    expect(changes).toEqual([
      "the map has changed",
      `all ${atlas.nodes.length} nodes stand full again`,
    ]);
  });

  it("after the ground under an actor turns to rock: it moves to the nearest tile it can stand on", () => {
    const camp = rawCamp() as { rows: string[] };
    let found: { atlas: Atlas; actor: Actor } | null = null;
    for (const actor of before.actors) {
      const rows = camp.rows.map((row, y) =>
        y === actor.y ? `${row.slice(0, actor.x)}#${row.slice(actor.x + 1)}` : row,
      );
      try {
        const atlas = atlasOf(parseMap({ ...camp, rows }));
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

describe("adopting a city's snapshot", () => {
  it("works its ground out of the saved cycle, and keeps everyone on it when a program changes", () => {
    const shipped = compileBots(botSources(), placeConstants(atlasOf(campMap())));
    const city = createCity(31, shipped);
    step(
      city,
      ["ana_", "brax", "cole99"].map((name, i) => ({
        type: "join" as const,
        account: String(500 + i),
        name,
        role: "viewer" as const,
      })),
    );
    while (city.tick < 3000) step(city);
    const text = snapshot(city);
    expect(adopt(text, null, shipped).changes).toEqual([]);
    const edited = compileBots(
      { deckhand: (botSources().deckhand as string).replace("wait(20)", "wait(21)") },
      placeConstants(atlasOf(campMap())),
    );
    const { world, changes } = adopt(text, null, edited);
    expect(changes[0]).toBe("the programs have changed");
    expect(world.atlas).toBe(city.atlas);
    expect(world.cycle).toEqual(city.cycle);
    expect(world.actors.map((a) => [a.id, a.x, a.y])).toEqual(
      city.actors.map((a) => [a.id, a.x, a.y]),
    );
    // And it runs on, and saves and resumes, as a city.
    for (let i = 0; i < 200; i++) step(world);
    expect(hashWorld(restore(snapshot(world), null, edited))).toBe(hashWorld(world));
  });
});
