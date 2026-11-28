// What chat changes on a citizen: params, the flag, tokens, and whether its
// program followed the flag (docs/chat.md, sections 3 and 8; pieces C5 and
// C6). The worlds here are the shipped one, with its monsters, and citizens
// who joined from chat on the shipped program, Deckhand.

import { describe, expect, it } from "vitest";
import { adopt } from "./adopt.ts";
import { parseMap, place, placeConstants } from "./map.ts";
import {
  FLAG_CITIZEN,
  FLAG_HOME,
  FLAG_NONE,
  FLAG_TILE,
  HEED_FOLLOWED,
  HEED_HELD,
  HEED_NONE,
  HEED_UNREAD,
  MAX_TOKENS,
  resolveGo,
  SIGHTING_TICKS,
  TOKEN_TICKS,
} from "./orders.ts";
import { compileBots } from "./tactics.ts";
import { botSources, shippedMonsters, shippedPrograms, shippedWorld } from "./testing.ts";
import type { Program } from "./vm.ts";
import {
  type Actor,
  ADVENTURER,
  createWorld,
  hashWorld,
  type Input,
  NIGHT_HOUR,
  type Programs,
  restore,
  START_HOUR,
  snapshot,
  step,
  TICKS_PER_GAME_HOUR,
  type World,
  type WorldEvent,
} from "./world.ts";

const ATLAS = shippedWorld();
const MONSTERS = shippedMonsters(ATLAS);
const PROGRAMS = { ...shippedPrograms(ATLAS), ...MONSTERS.programs };
/** The tick of nightfall on the first day, which stands in for the horde at the hull. */
const NIGHTFALL = (NIGHT_HOUR - START_HOUR) * TICKS_PER_GAME_HOUR;

const join = (account: string, name: string): Input => ({
  type: "join",
  account,
  name,
  role: "viewer",
});
const go = (account: string, words: string): Input => ({ type: "go", account, words });
const set = (account: string, name: string, value: string): Input => ({
  type: "param",
  account,
  name,
  value,
});

/** A world with the given chatters joined on its first tick, starting at `tick`. */
function newWorld(names: readonly string[], tick = 0, programs: Programs = PROGRAMS): World {
  const world = createWorld(ATLAS, 405, programs, MONSTERS.kinds, MONSTERS.spawns);
  world.tick = tick;
  step(
    world,
    names.map((name, i) => join(`${1001 + i}`, name)),
  );
  return world;
}

const citizen = (world: World, name: string): Actor =>
  world.actors.find((actor) => actor.name === name) as Actor;
const labelOf = (world: World, actor: Actor): string =>
  (world.programs[actor.program] as Program).rules[actor.rule] ?? "";

/** Steps the world `ticks` times, giving `inputs` on the first, and returns every event. */
function run(world: World, ticks: number, inputs: readonly Input[] = []): WorldEvent[] {
  const events: WorldEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...step(world, i === 0 ? inputs : []));
  return events;
}

describe("params from chat", () => {
  it("sets a number and a named value, refuses what the program does not allow, and costs a token", () => {
    const world = newWorld(["goofguy"]);
    const tim = citizen(world, "goofguy");
    expect(tim.params).toEqual([0, 120, 0, 10, 6, 0]);
    run(world, 1, [set("1001", "margin", "150"), set("1001", "stance", "fight")]);
    expect(tim.params).toEqual([1, 150, 0, 10, 6, 0]);
    expect(tim.tokens).toBe(0);
    // Refused, and so free: out of range, a name for a number, a number for a
    // name, a value the param does not have, a param the program does not declare.
    const before = hashWorld(world);
    const refused = newWorld(["goofguy"]);
    run(refused, 1, [
      set("1001", "margin", "241"),
      set("1001", "margin", "fight"),
      set("1001", "stance", "1"),
      set("1001", "stance", "run"),
      set("1001", "speed", "3"),
      set("1001", "margin", "-1"),
    ]);
    expect(citizen(refused, "goofguy")).toMatchObject({
      params: [0, 120, 0, 10, 6, 0],
      tokens: MAX_TOKENS,
    });
    expect(hashWorld(world)).toBe(before);
  });

  it("holds two tokens and gives one back every 200 ticks; a repeat costs nothing", () => {
    const world = newWorld(["goofguy"]);
    const tim = citizen(world, "goofguy");
    run(world, 1, [set("1001", "margin", "10"), set("1001", "margin", "20")]);
    run(world, 1, [set("1001", "margin", "30")]);
    expect(tim.params[1]).toBe(20);
    // The value it has already: nothing happens, and nothing is spent.
    run(world, TOKEN_TICKS - 3, [set("1001", "margin", "20")]);
    run(world, 1, [set("1001", "margin", "30")]);
    expect(tim.params[1]).toBe(20);
    run(world, 1, [set("1001", "margin", "30")]);
    expect(tim.params[1]).toBe(30);
    expect(tim.tokens).toBe(0);
    // Two come back after 400 ticks idle, and no more.
    run(world, 2 * TOKEN_TICKS + 50, [set("1001", "margin", "30")]);
    run(world, 1, [
      set("1001", "margin", "40"),
      set("1001", "margin", "50"),
      set("1001", "margin", "60"),
    ]);
    expect(tim.params[1]).toBe(50);
  });

  it("stance fight and stance careful differ in kills and in downs over a landing's length", () => {
    const names = ["joshyboy88", "goofguy", "pixel_pete", "moss_and_mud", "tinytoaster", "zzz_jen"];
    const outcome = (stance: string) => {
      const world = newWorld(names);
      const inputs = names.map((_, i) => set(`${1001 + i}`, "stance", stance));
      const events = run(world, 6000, inputs);
      const ours = new Set(names.map((name) => citizen(world, name).id));
      const downs = events.filter((e) => e.type === "down");
      return {
        kills: downs.filter((e) => e.kind !== ADVENTURER && ours.has(e.by)).length,
        downs: downs.filter((e) => ours.has(e.actor)).length,
      };
    };
    const fight = outcome("fight");
    const careful = outcome("careful");
    expect(fight.kills).not.toBe(careful.kills);
    expect(fight.downs).not.toBe(careful.downs);
    expect(fight.kills).toBeGreaterThan(careful.kills);
  });

  it("margin 0 and margin 240 differ in the time a citizen spends out", () => {
    const out = (margin: string): number => {
      const world = newWorld(["goofguy"], NIGHTFALL - SIGHTING_TICKS - 600);
      run(world, 1, [set("1001", "margin", margin)]);
      const tim = citizen(world, "goofguy");
      const camp = place(ATLAS, "camp");
      let ticks = 0;
      while (world.tick < NIGHTFALL) {
        step(world);
        if (Math.abs(tim.x - camp.x) + Math.abs(tim.y - camp.y) > 4) ticks++;
      }
      return ticks;
    };
    const early = out("240");
    const late = out("0");
    // 240 seconds turns back a minute after the horde is sighted, 300 seconds
    // before nightfall; 0 cuts it to the walk home. The two are some 2,400
    // ticks apart, less the walks.
    expect(early).toBeGreaterThan(0);
    expect(late - early).toBeGreaterThan(1800);
  });
});

describe("the flag", () => {
  it("is decided on within 6 ticks of the order, whatever the citizen was doing", () => {
    const world = newWorld(["goofguy"]);
    run(world, 20);
    let longest = 0;
    for (let t = 0; t < 120; t++) {
      run(world, 1);
      const copy = restore(snapshot(world), ATLAS, PROGRAMS, MONSTERS.kinds, MONSTERS.spawns);
      const tim = citizen(copy, "goofguy");
      const ordered = copy.tick;
      const events = run(copy, 12, [go("1001", "lower river")]);
      const decided = events.find((e) => e.type === "decide" && e.actor === tim.id);
      if (decided?.type !== "decide") throw new Error(`no decision after the order at ${ordered}`);
      longest = Math.max(longest, decided.tick - ordered);
      expect((copy.programs.deckhand as Program).rules[decided.rule]).toBe("to the flag");
    }
    expect(longest).toBeLessThanOrEqual(6);
  });

  it("is reported as held under a winning turn back, and as unread by a program that never reads it", () => {
    const world = newWorld(["goofguy"], NIGHTFALL - 600);
    const tim = citizen(world, "goofguy");
    run(world, 10, [go("1001", "lower river")]);
    expect(tim.flag).toBe(FLAG_TILE);
    expect(labelOf(world, tim)).toBe("turn back");
    expect(tim.heed).toBe(HEED_HELD);
    const wanderers = { ...PROGRAMS, deckhand: shippedPrograms(ATLAS).wanderer as Program };
    const other = newWorld(["goofguy"], 0, wanderers);
    run(other, 10, [go("1001", "lower river")]);
    expect(citizen(other, "goofguy").heed).toBe(HEED_UNREAD);
  });

  it("is reported as followed by a citizen chopping within 6 tiles of it", () => {
    const world = newWorld(["goofguy"]);
    const tim = citizen(world, "goofguy");
    const flag = place(ATLAS, "near_wood");
    let chops = 0;
    for (let t = 0; t < 1500; t++) {
      const events = step(world, t === 0 ? [go("1001", "near wood")] : []);
      for (const e of events) {
        if (e.type !== "decide" || e.actor !== tim.id || labelOf(world, tim) !== "chop") continue;
        chops++;
        expect(Math.abs(tim.x - flag.x) + Math.abs(tim.y - flag.y)).toBeLessThanOrEqual(6);
        expect(tim.heed).toBe(HEED_FOLLOWED);
      }
    }
    expect(chops).toBeGreaterThan(10);
  });

  it("gives two programs that are sent to the same place different hauls", () => {
    const haul = (programs: Programs): number => {
      const world = newWorld(["goofguy"], 0, programs);
      run(world, 4000, [go("1001", "lower river")]);
      const tim = citizen(world, "goofguy");
      // What it carries, a good a slot, and what it has banked.
      return tim.bag.filter((good) => good !== 0).length + tim.bank.reduce((sum, n) => sum + n, 0);
    };
    const wanderers = { ...PROGRAMS, deckhand: shippedPrograms(ATLAS).wanderer as Program };
    const deckhand = haul(PROGRAMS);
    expect(deckhand).toBeGreaterThan(0);
    expect(haul(wanderers)).not.toBe(deckhand);
  });

  it("follows a citizen, and comes down with !free; home is the camp", () => {
    const world = newWorld(["goofguy", "brax_"]);
    const tim = citizen(world, "goofguy");
    const brax = citizen(world, "brax_");
    run(world, 1, [go("1001", "@bra")]);
    expect(tim).toMatchObject({ flag: FLAG_CITIZEN, flagOn: brax.id, flagX: 0, flagY: 0 });
    run(world, 300);
    expect(Math.abs(tim.x - brax.x) + Math.abs(tim.y - brax.y)).toBeLessThanOrEqual(8);
    run(world, 1, [{ type: "free", account: "1001" }]);
    expect(tim).toMatchObject({ flag: FLAG_NONE, heed: HEED_NONE, flagOn: 0, flagAt: 0 });
    run(world, TOKEN_TICKS, [go("1001", "home")]);
    const camp = place(ATLAS, "camp");
    expect(tim).toMatchObject({ flag: FLAG_HOME, flagX: camp.x, flagY: camp.y });
    // A citizen cannot be sent to itself; another chatter's order cannot move this one.
    run(world, 1, [go("1001", "goofguy"), go("1002", "home")]);
    expect(tim.flag).toBe(FLAG_HOME);
    expect(brax.flag).toBe(FLAG_HOME);
  });
});

describe("names typed in !go", () => {
  const map = parseMap({
    name: "names",
    width: 12,
    height: 5,
    legend: { ".": "grass", c: "camp" },
    rows: ["............", "............", ".....c......", "............", "............"],
    places: {
      camp: { x: 5, y: 2 },
      bank: { x: 6, y: 2 },
      hill: { x: 1, y: 1 },
      hills: { x: 10, y: 1 },
      brackwater: { x: 1, y: 3 },
      waist_hatch: { x: 10, y: 3 },
    },
  });
  const world = createWorld(
    map,
    1,
    compileBots({ deckhand: botSources().deckhand as string }, placeConstants(map)),
  );
  step(world, [join("1", "brax"), join("2", "Bryony"), join("3", "goofguy")]);
  const self = citizen(world, "goofguy");
  const at = (words: string) => resolveGo(world, self, words);

  it("refuses a prefix two places share, and takes an exact name", () => {
    expect(at("hil")).toBeNull();
    expect(at("hill")).toEqual({ flag: FLAG_TILE, x: 1, y: 1 });
    expect(at("HILLS")).toEqual({ flag: FLAG_TILE, x: 10, y: 1 });
    // Places before citizens: bra is Brackwater, though brax is aboard.
    expect(at("bra")).toEqual({ flag: FLAG_TILE, x: 1, y: 3 });
    expect(at("@bra")).toEqual({ flag: FLAG_CITIZEN, on: citizen(world, "brax").id });
    expect(at("@br")).toBeNull();
    expect(at("BRAX")).toEqual({ flag: FLAG_CITIZEN, on: citizen(world, "brax").id });
    expect(at("@bry")).toEqual({ flag: FLAG_CITIZEN, on: citizen(world, "Bryony").id });
    expect(at("waist  hatch")).toEqual({ flag: FLAG_TILE, x: 10, y: 3 });
    expect(at("wa")).toBeNull();
    expect(at("nowhere")).toBeNull();
    expect(at("@goofguy")).toBeNull();
    expect(at("home")).toEqual({ flag: FLAG_HOME, x: 5, y: 2 });
    expect(at("e")).toEqual({ flag: FLAG_TILE, x: 11, y: 2 });
    expect(at("northwest")).toEqual({ flag: FLAG_TILE, x: 0, y: 0 });
  });

  it("a refused order costs nothing and changes nothing but when its chatter was heard", () => {
    const copy = restore(snapshot(world), map, world.programs);
    const same = restore(snapshot(world), map, world.programs);
    step(copy, [go("3", "hil"), go("3", "nowhere"), go("3", "@goofguy")]);
    step(same, [{ type: "heard", account: "3" }]);
    expect(hashWorld(copy)).toBe(hashWorld(same));
  });
});

describe("saving orders", () => {
  it("a world with flags, params and spent tokens snapshots and resumes to the same hash", () => {
    const world = newWorld(["goofguy", "brax_", "zzz_jen"]);
    run(world, 30, [
      go("1001", "@brax_"),
      set("1001", "stance", "fight"),
      go("1002", "river"),
      { type: "say", account: "1003", id: "m1", text: "hello" },
    ]);
    const saved = snapshot(world);
    const resumed = restore(saved, ATLAS, PROGRAMS, MONSTERS.kinds, MONSTERS.spawns);
    expect(resumed).toEqual(world);
    run(world, 500);
    run(resumed, 500);
    expect(hashWorld(resumed)).toBe(hashWorld(world));
  });

  it("refuses saved orders no world could hold", () => {
    const world = newWorld(["goofguy", "brax_"]);
    run(world, 5, [go("1001", "@brax_")]);
    const text = snapshot(world);
    const reload = (t: string) => restore(t, ATLAS, PROGRAMS, MONSTERS.kinds, MONSTERS.spawns);
    // Each is changed on a world and saved again, so its hash matches and only
    // readState stands between it and a running world.
    const forged = (change: (tim: Actor, brax: Actor) => void): string => {
      const copy = reload(text);
      change(citizen(copy, "goofguy"), citizen(copy, "brax_"));
      return snapshot(copy);
    };
    expect(() => reload(forged(() => {}))).not.toThrow();
    for (const change of [
      (tim: Actor) => Object.assign(tim, { flagOn: 999 }),
      (tim: Actor) => Object.assign(tim, { flagOn: tim.id }),
      (tim: Actor) => Object.assign(tim, { params: [0, 120] }),
      (tim: Actor) => Object.assign(tim, { params: [0, 241, 0, 10, 6, 0] }),
      (tim: Actor) => Object.assign(tim, { tokens: 3 }),
      (tim: Actor) => Object.assign(tim, { tokenAt: 0 }),
      (tim: Actor) => Object.assign(tim, { heard: 1e9 }),
      (tim: Actor) => Object.assign(tim, { account: "has space" }),
      (tim: Actor) => Object.assign(tim, { account: "" }),
      (tim: Actor, brax: Actor) => Object.assign(tim, { account: brax.account }),
      (tim: Actor) => Object.assign(tim, { flag: 4 }),
      (tim: Actor) => Object.assign(tim, { flag: FLAG_TILE, flagOn: 0, flagX: -50 }),
    ]) {
      expect(() => reload(forged(change))).toThrow(/damaged/);
    }
  });

  it("is carried over to a changed program: params back to the defaults, a flag on a removed citizen down", () => {
    const world = newWorld(["goofguy", "brax_"]);
    const camp = place(ATLAS, "camp");
    step(world, [{ type: "spawn", name: "Ash", program: "homebody", x: camp.x, y: camp.y + 2 }]);
    run(world, 5, [go("1001", "ash"), go("1002", "@goofguy"), set("1002", "margin", "30")]);
    expect(citizen(world, "goofguy").flag).toBe(FLAG_CITIZEN);
    const edited = (botSources().deckhand as string).replace("wait(20)", "wait(21)");
    const { homebody: _, ...rest } = PROGRAMS;
    const programs = {
      ...rest,
      deckhand: compileBots({ deckhand: edited }, placeConstants(ATLAS)).deckhand as Program,
    };
    const { world: kept, changes } = adopt(
      snapshot(world),
      ATLAS,
      programs,
      MONSTERS.kinds,
      MONSTERS.spawns,
    );
    // Deckhand changed, so brax_'s margin is the default again; its flag on goofguy stands.
    expect(citizen(kept, "brax_")).toMatchObject({
      flag: FLAG_CITIZEN,
      params: [0, 120, 0, 10, 6, 0],
    });
    // Ash ran a program that is gone, so it went, and goofguy's flag on it came down.
    expect(kept.actors.some((a) => a.name === "Ash")).toBe(false);
    expect(citizen(kept, "goofguy")).toMatchObject({ flag: FLAG_NONE, heed: HEED_NONE });
    expect(changes).toContain(
      "1 flag(s) came down: the ground or the citizen they were on is gone",
    );
  });
});
