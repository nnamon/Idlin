import { describe, expect, it } from "vitest";
import { NO_THREAT } from "./brain.ts";
import { placeConstants } from "./map.ts";
import { compileBots } from "./tactics.ts";
import { firstLight } from "./testing.ts";
import {
  ADVENTURER,
  ADVENTURER_KIND,
  checkKinds,
  createWorld,
  DOWN_TICKS,
  hashWorld,
  type Input,
  KindError,
  type Kinds,
  MAX_ACTOR_ID,
  restore,
  SnapshotError,
  snapshot,
  step,
  type World,
  type WorldEvent,
} from "./world.ts";

const MAP = firstLight();
const KINDS: Kinds = {
  wolf: { hp: 12, damage: 5, windup: 10, recovery: 8, reach: 2 },
  brute: { hp: 500, damage: 30, windup: 10, recovery: 4, reach: 1 },
  thug: { hp: 500, damage: 12, windup: 10, recovery: 4, reach: 1 },
  slow: { hp: 500, damage: 1, windup: 30, recovery: 4, reach: 1 },
  snap: { hp: 500, damage: 30, windup: 1, recovery: 4, reach: 3 },
};
const PROGRAMS = compileBots(
  {
    // Strikes at whoever is nearest, wherever they are.
    biter: 'otherwise as "bite" -> attack(threat_x, threat_y)',
    stander: 'otherwise as "stand" -> wait(100)',
    dodger: `when danger_here > 0 as "step out" -> step_clear
otherwise as "watch" -> idle`,
    fighter: `when threat_distance <= 1 as "strike" -> attack(threat_x, threat_y)
otherwise as "wait for it" -> idle`,
    coward: `when threat_distance < 6 as "run" -> flee(threat_x, threat_y)
otherwise as "calm" -> idle`,
    lonely: `when threat_distance == ${NO_THREAT} and threat_hp == 0 and hp == max_hp as "alone" -> idle
otherwise as "company" -> idle`,
    meter: "otherwise -> set seen = danger_here; idle",
    east: "otherwise -> walk_to(27, 11)",
    wild: "otherwise -> attack(2147483647, 0 - 2147483647)",
    self: "otherwise -> attack(self_x, self_y)",
    far: "otherwise -> flee(2147483647, 2147483647)",
  },
  placeConstants(MAP),
);

// The camp is at (14, 9) with open ground round it.
const at = (name: string, program: string, x: number, y: number, kind?: string): Input => ({
  type: "spawn",
  name,
  program,
  x,
  y,
  ...(kind ? { kind } : {}),
});

function fight(inputs: Input[], seed = 1): World {
  const world = createWorld(MAP, seed, PROGRAMS, KINDS);
  step(world, inputs);
  return world;
}

function run(world: World, ticks: number): WorldEvent[] {
  const log: WorldEvent[] = [];
  for (let i = 0; i < ticks; i++) log.push(...step(world));
  return log;
}

const named = (world: World, name: string) => world.actors.find((a) => a.name === name);

describe("fights", () => {
  it("a telegraphed hit lands on an actor that stays and misses one that steps out in time", () => {
    const stay = fight([at("Wolf", "biter", 14, 11, "wolf"), at("Ash", "stander", 15, 11)]);
    const stayed = run(stay, 60);
    const hits = stayed.filter((e) => e.type === "hit");
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits[0]).toMatchObject({ actor: 1, target: 2, damage: 5, hp: 15 });
    // The tiles were marked for the whole wind-up before the first blow.
    // (The very first attack began in the tick the two were spawned, before this log starts.)
    const began = stayed.find((e) => e.type === "attack");
    expect(began).toMatchObject({
      actor: 1,
      lands: 10,
      tiles: [
        { x: 15, y: 11 },
        { x: 16, y: 11 },
      ],
    });
    const landed = stayed.find((e) => e.type === "hit" && e.tick > (began as WorldEvent).tick);
    expect((landed as WorldEvent).tick - (began as WorldEvent).tick).toBe(10);

    const leave = fight([at("Wolf", "biter", 14, 11, "wolf"), at("Ash", "dodger", 15, 11)]);
    const left = run(leave, 600);
    expect(left.filter((e) => e.type === "hit")).toEqual([]);
    expect(left.filter((e) => e.type === "miss").length).toBeGreaterThan(20);
    expect(named(leave, "Ash")?.hp).toBe(ADVENTURER_KIND.hp);
  });

  it("an attacker stands still through wind-up and recovery, and its marks last exactly the wind-up", () => {
    const world = fight([at("Wolf", "biter", 14, 11, "wolf"), at("Ash", "stander", 20, 11)]);
    const wolf = named(world, "Wolf");
    let marked = 0;
    let busy = 0;
    for (let i = 0; i < 18; i++) {
      step(world);
      if (world.marks.length > 0) marked++;
      if ((wolf?.windup ?? 0) > 0 || (wolf?.recover ?? 0) > 0) busy++;
      expect([wolf?.x, wolf?.y]).toEqual([14, 11]);
    }
    // One attack: marks for the ten ticks before it lands, then recovery until the eighth tick after.
    expect(marked).toBe(10);
    expect(busy).toBe(17);
  });

  it("a monster with no hitpoints left is gone, with its marks, and the world carries on", () => {
    const world = fight([at("Wolf", "biter", 14, 11, "wolf"), at("Ash", "fighter", 15, 11)]);
    const log = run(world, 200);
    const down = log.find((e) => e.type === "down");
    expect(down).toMatchObject({ actor: 1, name: "Wolf", kind: "wolf", by: 2, x: 14, y: 11 });
    expect(world.actors.map((a) => a.name)).toEqual(["Ash"]);
    expect(world.marks).toEqual([]);
    // Three blows of four take twelve hitpoints.
    expect(log.filter((e) => e.type === "hit" && e.target === 1)).toHaveLength(3);
    // Ids are never reused, and the survivor goes on deciding.
    step(world, [at("Late", "stander", 14, 9)]);
    expect(named(world, "Late")?.id).toBe(3);
    expect(run(world, 50).some((e) => e.type === "decide" && e.actor === 2)).toBe(true);
  });

  it("an adventurer struck down wakes at camp with full hitpoints and rests", () => {
    const world = fight([at("Brute", "biter", 20, 9, "brute"), at("Ash", "stander", 21, 9)]);
    const log = run(world, 12);
    expect(log.find((e) => e.type === "down")).toMatchObject({
      actor: 2,
      name: "Ash",
      kind: ADVENTURER,
      by: 1,
      x: 21,
      y: 9,
    });
    const ash = named(world, "Ash");
    expect(ash).toMatchObject({ x: 14, y: 9, hp: ADVENTURER_KIND.hp, path: [], windup: 0 });
    expect(ash?.wait).toBeGreaterThan(DOWN_TICKS - 5);
    // It does nothing until the rest is over.
    const resting = run(world, DOWN_TICKS - 10);
    expect(resting.some((e) => e.type === "decide" && e.actor === 2)).toBe(false);
  });

  it("someone struck down in the same tick does not get its own blow in", () => {
    // Both begin at once; the brute's blow lands first (lower id) and takes Ash out.
    const kinds: Kinds = { brute: { hp: 500, damage: 30, windup: 6, recovery: 4, reach: 1 } };
    const world = createWorld(MAP, 1, PROGRAMS, kinds);
    step(world, [at("Brute", "biter", 20, 9, "brute"), at("Ash", "fighter", 21, 9)]);
    const log = run(world, 8);
    expect(log.some((e) => e.type === "down" && e.actor === 2)).toBe(true);
    expect(log.some((e) => e.type === "hit" && e.actor === 2)).toBe(false);
    expect(world.marks.every((m) => m.by === 1)).toBe(true);
  });

  it("sensors say who is near and what is coming; allies are not threats", () => {
    const alone = fight([at("Ash", "lonely", 14, 9), at("Birch", "lonely", 15, 9)]);
    run(alone, 10);
    expect(alone.actors.map((a) => alone.programs.lonely?.rules[a.rule])).toEqual([
      "alone",
      "alone",
    ]);
    const met = fight([at("Ash", "lonely", 14, 9), at("Wolf", "stander", 20, 9, "wolf")]);
    run(met, 10);
    expect(met.programs.lonely?.rules[named(met, "Ash")?.rule ?? -1]).toBe("company");
    // A wolf's marks are no danger to another wolf standing on them.
    const pack = fight([
      at("Wolf", "biter", 14, 11, "wolf"),
      at("Pup", "dodger", 15, 11, "wolf"),
      at("Ash", "stander", 17, 11),
    ]);
    const log = run(pack, 40);
    expect(named(pack, "Pup")).toMatchObject({ x: 15, y: 11, hp: 12 });
    expect(log.some((e) => e.type === "hit" && e.target === 2)).toBe(false);
  });

  it("an attack stops at whatever cannot be walked on", () => {
    // East of (15, 9) is the camp chest. A wolf reaches two tiles; here only one is open.
    const world = createWorld(MAP, 1, PROGRAMS, KINDS);
    const began = step(world, [at("Wolf", "biter", 14, 9, "wolf"), at("Ash", "stander", 17, 9)]);
    expect(began.find((e) => e.type === "attack")).toMatchObject({ tiles: [{ x: 15, y: 9 }] });
    expect(world.marks).toEqual([{ x: 15, y: 9, by: 1 }]);
    // Right against it there is nothing to strike, so no attack begins at all.
    const blocked = createWorld(MAP, 1, PROGRAMS, KINDS);
    step(blocked, [at("Wolf", "biter", 15, 9, "wolf"), at("Ash", "stander", 17, 9)]);
    expect(run(blocked, 50).some((e) => e.type === "attack")).toBe(false);
  });

  it("danger is the soonest blow coming, and the threat is the nearest enemy, lowest id first", () => {
    // A wolf's blow (ten ticks) and a slow one (thirty) are both coming at (15, 11).
    const world = createWorld(MAP, 1, PROGRAMS, KINDS);
    step(world, [
      at("Wolf", "biter", 14, 11, "wolf"),
      at("Slow", "biter", 15, 12, "slow"),
      at("Ash", "meter", 15, 11),
    ]);
    expect(named(world, "Ash")?.memory[0]).toBe(10);

    // Two wolves as near as each other: the one that came first is the threat.
    const between = createWorld(MAP, 1, PROGRAMS, KINDS);
    const began = step(between, [
      at("First", "stander", 14, 11, "wolf"),
      at("Second", "stander", 16, 11, "wolf"),
      at("Ash", "fighter", 15, 11),
    ]);
    expect(began.find((e) => e.type === "attack")).toMatchObject({ tiles: [{ x: 14, y: 11 }] });
  });

  it("the last blow gets the credit, and nobody is struck after going down", () => {
    // Two thugs' blows land together on one adventurer: twelve, then twelve more, from twenty.
    const pair = fight([
      at("One", "biter", 14, 11, "thug"),
      at("Two", "biter", 16, 11, "thug"),
      at("Ash", "stander", 15, 11),
    ]);
    const twice = run(pair, 12);
    expect(twice.filter((e) => e.type === "hit" && e.target === 3)).toHaveLength(2);
    expect(twice.find((e) => e.type === "down")).toMatchObject({ actor: 3, by: 2 });
    // Two brutes: the first blow is enough, and the second finds nobody there.
    const over = fight([
      at("One", "biter", 14, 11, "brute"),
      at("Two", "biter", 16, 11, "brute"),
      at("Ash", "stander", 15, 11),
    ]);
    const once = run(over, 12);
    expect(once.filter((e) => e.type === "hit")).toHaveLength(1);
    expect(once.find((e) => e.type === "down")).toMatchObject({ actor: 3, by: 1 });
    expect(once.some((e) => e.type === "miss" && e.actor === 2)).toBe(true);
  });

  it("several struck down at once each get a tile of their own at a camp that is not empty", () => {
    const world = fight([
      at("Keeper", "stander", 14, 9),
      at("B1", "biter", 20, 11, "brute"),
      at("V1", "stander", 21, 11),
      at("B2", "biter", 17, 11, "brute"),
      at("V2", "stander", 18, 11),
      at("B3", "biter", 11, 11, "brute"),
      at("V3", "stander", 12, 11),
    ]);
    const log = run(world, 12);
    expect(log.filter((e) => e.type === "down")).toHaveLength(3);
    const tiles = world.actors.map((a) => `${a.x},${a.y}`);
    expect(new Set(tiles).size).toBe(tiles.length);
    expect(named(world, "Keeper")).toMatchObject({ x: 14, y: 9 });
    for (const name of ["V1", "V2", "V3"]) {
      const victim = named(world, name);
      expect(Math.abs((victim?.x ?? 0) - 14) + Math.abs((victim?.y ?? 0) - 9)).toBeLessThanOrEqual(
        2,
      );
    }
  });

  it("someone struck down while walking wakes with nowhere to go, and the world still saves", () => {
    // Ash has just set off east when the blow lands; its path must not come back to camp with it.
    const world = createWorld(MAP, 1, PROGRAMS, KINDS);
    step(world, [at("Snap", "biter", 20, 11, "snap"), at("Ash", "east", 21, 11)]);
    expect(named(world, "Ash")?.path.length).toBeGreaterThan(0);
    const log = run(world, 1);
    expect(log.some((e) => e.type === "down" && e.actor === 2)).toBe(true);
    expect(named(world, "Ash")).toMatchObject({
      x: 14,
      y: 9,
      fromX: 14,
      fromY: 9,
      path: [],
      blocked: 0,
      moveTicksLeft: 0,
    });
    expect(restore(snapshot(world), MAP, PROGRAMS, KINDS)).toEqual(world);
    run(world, 400);
    expect(restore(snapshot(world), MAP, PROGRAMS, KINDS)).toEqual(world);
  });

  it("flee goes round someone standing in the way", () => {
    const world = fight([
      at("Wolf", "stander", 14, 11, "wolf"),
      at("Ash", "coward", 15, 11),
      at("Birch", "stander", 16, 11),
    ]);
    run(world, 200);
    const ash = named(world, "Ash");
    expect(Math.abs((ash?.x ?? 0) - 14) + Math.abs((ash?.y ?? 0) - 11)).toBeGreaterThanOrEqual(6);
  });

  it("flee walks away from a point, a few tiles at a time", () => {
    const world = fight([at("Wolf", "stander", 14, 11, "wolf"), at("Ash", "coward", 15, 11)]);
    run(world, 200);
    const ash = named(world, "Ash");
    expect(Math.abs((ash?.x ?? 0) - 14) + Math.abs((ash?.y ?? 0) - 11)).toBeGreaterThanOrEqual(6);
    expect(world.programs.coward?.rules[ash?.rule ?? -1]).toBe("calm");
  });
});

describe("hostile input to a fight", () => {
  it("attacks and flights at absurd places change nothing they should not", () => {
    const world = fight([
      at("Wild", "wild", 14, 11),
      at("Self", "self", 16, 11),
      at("Far", "far", 18, 11),
      at("Wolf", "stander", 20, 13, "wolf"),
    ]);
    const log = run(world, 300);
    // Striking at oneself is no attack at all.
    expect(log.some((e) => e.type === "attack" && e.actor === 2)).toBe(false);
    // A far-off target only gives a direction: the tile next door is what gets marked.
    const wild = log.find((e) => e.type === "attack" && e.actor === 1);
    expect(wild).toMatchObject({ tiles: [{ x: 14, y: 10 }] });
    for (const actor of world.actors) {
      expect(Number.isInteger(actor.x) && Number.isInteger(actor.y)).toBe(true);
      expect(actor.hp).toBeGreaterThan(0);
    }
    expect(restore(snapshot(world), MAP, PROGRAMS, KINDS)).toEqual(world);
  });

  it("a spawn of an unknown kind is dropped, and bad kind tables are refused", () => {
    const world = fight([at("Ghost", "stander", 14, 9, "ghost")]);
    expect(world.actors).toEqual([]);
    step(world, [{ ...at("Odd", "stander", 14, 9), kind: 7 } as unknown as Input]);
    step(world, [at("Proto", "stander", 14, 9, "__proto__")]);
    // A world that has handed out every id takes no more actors, and can still be saved.
    const full = fight([at("Ash", "stander", 14, 9)]);
    full.nextActorId = MAX_ACTOR_ID;
    step(full, [at("Late", "stander", 15, 9)]);
    expect(full.actors.map((a) => a.name)).toEqual(["Ash"]);
    expect(restore(snapshot(full), MAP, PROGRAMS, KINDS)).toEqual(full);
    step(world, [at("Ctor", "stander", 14, 9, "constructor")]);
    expect(world.actors).toEqual([]);

    const wolf = { hp: 12, damage: 5, windup: 10, recovery: 8, reach: 2 };
    expect(() => checkKinds({ wolf })).not.toThrow();
    for (const bad of [
      { wolf: { ...wolf, hp: 0 } },
      { wolf: { ...wolf, windup: 0 } },
      { wolf: { ...wolf, reach: 4 } },
      { wolf: { ...wolf, damage: 1.5 } },
      { wolf: { ...wolf, recovery: "8" } },
      { wolf: null },
      { [ADVENTURER]: wolf },
      { "Bad Name": wolf },
      { wolf: { hp: 12 } },
    ]) {
      expect(() => checkKinds(bad as unknown as Kinds)).toThrow(KindError);
    }
    expect(() => createWorld(MAP, 1, PROGRAMS, { wolf: { ...wolf, hp: -1 } })).toThrow(KindError);
    // The table a world keeps cannot be changed afterwards.
    const kept = createWorld(MAP, 1, PROGRAMS, { wolf }).kinds;
    expect(Object.isFrozen(kept) && Object.isFrozen(kept.wolf)).toBe(true);
  });
});

describe("fights and determinism", () => {
  const melee = (seed: number): World =>
    fight(
      [
        at("Wolf", "biter", 14, 11, "wolf"),
        at("Ash", "fighter", 15, 11),
        at("Birch", "dodger", 14, 12),
        at("Brute", "biter", 16, 12, "brute"),
        at("Cedar", "coward", 13, 11),
      ],
      seed,
    );

  it("the same fight from the same seed ends in the same state", () => {
    const a = melee(5);
    const b = melee(5);
    for (let i = 0; i < 30; i++) {
      run(a, 100);
      run(b, 100);
      expect(hashWorld(a)).toBe(hashWorld(b));
    }
  });

  it("a snapshot taken between wind-up and hit resumes to the same state", () => {
    const straight = melee(3);
    const paused = melee(3);
    let saved: string | undefined;
    for (let i = 0; i < 400 && !saved; i++) {
      step(straight);
      step(paused);
      if (paused.marks.length > 0 && paused.actors.some((a) => a.windup > 2))
        saved = snapshot(paused);
    }
    expect(saved).toBeDefined();
    const resumed = restore(saved as string, MAP, PROGRAMS, KINDS);
    expect(resumed).toEqual(paused);
    run(straight, 1000);
    run(resumed, 1000);
    expect(hashWorld(resumed)).toBe(hashWorld(straight));
  });

  it("a snapshot that could not be a real fight is refused", () => {
    const world = melee(3);
    while (world.marks.length === 0) step(world);
    const good = JSON.parse(snapshot(world));
    interface Saved {
      marks: { x: number; y: number; by: number }[];
      actors: { id: number; hp: number; windup: number; recover: number; kind: string }[];
      nextActorId: number;
    }
    // A hostile snapshot can carry the right hash for an impossible world, so each
    // forgery is tried with the saved hash and with one worked out for it.
    const tamper = (change: (state: Saved) => void, rehash: boolean): string => {
      const copy = structuredClone(good);
      change(copy.state);
      if (rehash) {
        try {
          copy.hash = hashWorld({ ...copy.state, map: MAP, programs: PROGRAMS, kinds: KINDS });
        } catch {
          // Not even hashable; the saved hash stays.
        }
      }
      return JSON.stringify(copy);
    };
    const attacker = world.actors.findIndex((a) => a.windup > 0);
    const striker = world.actors[attacker] as World["actors"][number];
    const idle = world.actors.find((a) => a.windup === 0) as World["actors"][number];
    const cases: ((state: Saved) => void)[] = [
      (s) => s.marks.push({ x: 14, y: 9, by: 99 }),
      // A mark from someone who is not attacking, and one on the attacker's own tile.
      (s) => s.marks.push({ x: idle.x + 1, y: idle.y, by: idle.id }),
      (s) => s.marks.push({ x: striker.x, y: striker.y, by: striker.id }),
      // Marks in more than one direction, and a line with its first tile missing.
      (s) => {
        const first = s.marks.find((m) => m.by === striker.id) as Saved["marks"][number];
        s.marks.push({
          x: striker.x - (first.x - striker.x),
          y: striker.y - (first.y - striker.y),
          by: striker.id,
        });
      },
      (s) => {
        s.marks = s.marks.filter((m) => m.by !== striker.id);
        s.marks.push({ x: striker.x + 2, y: striker.y, by: striker.id });
      },
      (s) => {
        s.nextActorId = 2 ** 31;
      },
      (s) => s.marks.push({ ...(s.marks[0] as Saved["marks"][number]) }),
      (s) => {
        s.marks = [];
      },
      (s) => {
        (s.marks[0] as Saved["marks"][number]).x += 5;
      },
      (s) => {
        (s.actors[0] as Saved["actors"][number]).hp = 100_000;
      },
      (s) => {
        (s.actors[0] as Saved["actors"][number]).hp = 0;
      },
      (s) => {
        (s.actors[attacker] as Saved["actors"][number]).windup = 99;
      },
      (s) => {
        (s.actors[attacker] as Saved["actors"][number]).recover = 1;
      },
      (s) => {
        (s.actors[0] as Saved["actors"][number]).kind = "ghost";
      },
      (s) => {
        (s.actors[1] as Saved["actors"][number]).id = 1;
      },
      (s) => {
        s.nextActorId = 2;
      },
      (s) => {
        delete (s as Partial<Saved>).marks;
      },
    ];
    for (const change of cases) {
      expect(() => restore(tamper(change, false), MAP, PROGRAMS, KINDS)).toThrow(SnapshotError);
      expect(() => restore(tamper(change, true), MAP, PROGRAMS, KINDS)).toThrow(SnapshotError);
    }
    // Two attacks' marks shuffled together: each attack's marks are stored side by side.
    const two = fight([
      at("West", "biter", 14, 11, "wolf"),
      at("East", "biter", 20, 11, "wolf"),
      at("Ash", "stander", 17, 11),
    ]);
    expect(two.marks.map((m) => m.by)).toEqual([1, 1, 2, 2]);
    const shuffled = JSON.parse(snapshot(two));
    const [a0, a1, b0, b1] = shuffled.state.marks;
    shuffled.state.marks = [a0, b0, a1, b1];
    shuffled.hash = hashWorld({ ...shuffled.state, map: MAP, programs: PROGRAMS, kinds: KINDS });
    expect(() => restore(JSON.stringify(shuffled), MAP, PROGRAMS, KINDS)).toThrow(SnapshotError);
    expect(restore(snapshot(two), MAP, PROGRAMS, KINDS)).toEqual(two);

    // An empty world still needs a next id of at least one.
    const empty = JSON.parse(snapshot(createWorld(MAP, 1, PROGRAMS, KINDS)));
    for (const next of [0, -5]) {
      empty.state.nextActorId = next;
      empty.hash = hashWorld({ ...empty.state, map: MAP, programs: PROGRAMS, kinds: KINDS });
      expect(() => restore(JSON.stringify(empty), MAP, PROGRAMS, KINDS)).toThrow(SnapshotError);
    }
    // Other monster numbers than the ones it was taken with.
    expect(() =>
      restore(snapshot(world), MAP, PROGRAMS, {
        ...KINDS,
        wolf: { ...KINDS.wolf, hp: 13 },
      } as Kinds),
    ).toThrow(/different monster kinds/);
    expect(restore(snapshot(world), MAP, PROGRAMS, KINDS)).toEqual(world);
  });
});
