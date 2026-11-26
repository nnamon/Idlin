import { describe, expect, it } from "vitest";
import { CONFUSED_TICKS, IDLE_TICKS } from "./brain.ts";
import { firstLight } from "./testing.ts";
import { BYTECODE_VERSION, FAULTS, OP, type Program, ProgramError, validateProgram } from "./vm.ts";
import {
  createWorld,
  hashWorld,
  type Programs,
  restore,
  SnapshotError,
  snapshot,
  step,
  type World,
} from "./world.ts";

const assemble = (code: number[], rules: string[] = []): Program =>
  validateProgram({ version: BYTECODE_VERSION, code, rules });

const SELF_X = 0;
const HOUR = 2;
const WALKABLE = 4;
const DISTANCE = 5;
const IDLE = 6;
const WAIT = 7;
const WALK_TO = 8;
const WANDER = 9;

const PROGRAMS: Programs = {
  // Walk between the bridge and the bank for ever, counting trips in slot 0.
  courier: assemble(
    [
      // Rule 0 (words 0-25): at the bank? then count the trip and go to the bridge.
      OP.RULE,
      0,
      OP.PUSH,
      16,
      OP.PUSH,
      10,
      OP.SENSE,
      DISTANCE,
      OP.PUSH,
      0,
      OP.EQ,
      OP.JZ,
      26,
      OP.LOAD,
      0,
      OP.PUSH,
      1,
      OP.ADD,
      OP.STORE,
      0,
      OP.PUSH,
      23,
      OP.PUSH,
      8,
      OP.ACT,
      WALK_TO,
      // Rule 1 (word 26 on): otherwise go to the bank.
      OP.RULE,
      1,
      OP.PUSH,
      16,
      OP.PUSH,
      10,
      OP.ACT,
      WALK_TO,
    ],
    ["at the bank: go to the bridge", "go to the bank"],
  ),
  rover: assemble([OP.RULE, 0, OP.ACT, WANDER], ["wander"]),
  broken: assemble([OP.PUSH, 1, OP.PUSH, 0, OP.DIV, OP.ACT, IDLE]),
  spinner: assemble([OP.JMP, 0]),
  sleeper: assemble([OP.PUSH, 100000, OP.ACT, WAIT]),
  napper: assemble([OP.PUSH, 1, OP.ACT, WAIT]),
  scribbler: assemble([OP.PUSH, 7, OP.STORE, 0, OP.PUSH, 1, OP.PUSH, 0, OP.DIV]),
  lost: assemble([OP.PUSH, -5, OP.PUSH, 9999, OP.ACT, WALK_TO]),
  probe: assemble([
    OP.SENSE,
    SELF_X,
    OP.STORE,
    0,
    OP.SENSE,
    HOUR,
    OP.STORE,
    1,
    OP.PUSH,
    15,
    OP.PUSH,
    8,
    OP.SENSE,
    WALKABLE,
    OP.STORE,
    2,
    OP.PUSH,
    14,
    OP.PUSH,
    9,
    OP.SENSE,
    WALKABLE,
    OP.STORE,
    3,
    OP.PUSH,
    -(2 ** 31),
    OP.PUSH,
    2 ** 31 - 1,
    OP.SENSE,
    DISTANCE,
    OP.STORE,
    4,
    OP.ACT,
    IDLE,
  ]),
};

const world = (spawns: [string, string, number, number][], seed = 1): World => {
  const w = createWorld(firstLight(), seed, PROGRAMS);
  step(
    w,
    spawns.map(([name, program, x, y]) => ({
      type: "spawn" as const,
      name,
      x,
      y,
      program,
    })),
  );
  return w;
};
const run = (w: World, ticks: number): World => {
  for (let i = 0; i < ticks; i++) step(w);
  return w;
};

describe("actors run programs", () => {
  it("a program walks its actor where it says, and its memory and rule are kept", () => {
    const w = world([["Ash", "courier", 14, 9]]);
    const ash = w.actors[0];
    if (!ash) throw new Error("no actor");
    expect(ash.rule).toBe(1);
    const visited = new Set<string>();
    for (let i = 0; i < 1200; i++) {
      step(w);
      if (ash.moveTicksLeft === 0) visited.add(`${ash.x},${ash.y}`);
    }
    expect(visited.has("16,10")).toBe(true);
    expect(visited.has("23,8")).toBe(true);
    expect(ash.memory[0]).toBeGreaterThanOrEqual(2);
    expect(ash.fault).toBe(0);
  });

  it("sensors report the world as it is", () => {
    const w = world([["Ash", "probe", 14, 9]]);
    expect(w.actors[0]?.memory.slice(0, 5)).toEqual([14, 6, 0, 1, 2 ** 31 - 1]);
  });

  it("a faulting program leaves its actor confused and the world running", () => {
    const w = world([
      ["Broke", "broken", 14, 9],
      ["Spin", "spinner", 13, 9],
      ["Rover", "rover", 12, 9],
    ]);
    const [broke, spin, rover] = w.actors;
    if (!broke || !spin || !rover) throw new Error("no actors");
    expect(FAULTS[broke.fault]).toBe("divide_by_zero");
    expect(FAULTS[spin.fault]).toBe("out_of_gas");
    expect(broke.wait).toBe(CONFUSED_TICKS);
    run(w, 600);
    expect([broke.x, broke.y, spin.x, spin.y]).toEqual([14, 9, 13, 9]);
    expect(FAULTS[broke.fault]).toBe("divide_by_zero");
    expect([rover.x, rover.y]).not.toEqual([12, 9]);
    expect(rover.fault).toBe(0);
    expect(w.tick).toBe(601);
  });

  it("step returns what happened: each decision with its rule and action, each fault with its name", () => {
    const w = createWorld(firstLight(), 1, PROGRAMS);
    const first = step(w, [
      { type: "spawn", name: "Ash", x: 14, y: 9, program: "courier" },
      { type: "spawn", name: "Broke", x: 13, y: 9, program: "broken" },
      { type: "spawn", name: "Nap", x: 12, y: 9, program: "napper" },
    ]);
    expect(first).toEqual([
      { type: "decide", tick: 1, actor: 1, rule: 1, action: "walk_to" },
      { type: "fault", tick: 1, actor: 2, fault: "divide_by_zero" },
      { type: "decide", tick: 1, actor: 3, rule: -1, action: "wait" },
    ]);
    // Nothing is reported on a tick where nobody decides, and events are not kept in the world.
    expect(step(w)).toEqual([]);
    const before = hashWorld(w);
    const log = [];
    for (let i = 0; i < 300; i++) log.push(...step(w));
    expect(log.filter((e) => e.type === "fault").every((e) => e.actor === 2)).toBe(true);
    expect(log.filter((e) => e.type === "decide" && e.actor === 3).length).toBeGreaterThan(40);
    expect(before).not.toBe(hashWorld(w));
    expect(Object.keys(w).sort()).toEqual([
      "actors",
      "map",
      "nextActorId",
      "programs",
      "rng",
      "tick",
    ]);
  });

  it("clamps what actions ask for", () => {
    const w = world([
      ["Sleepy", "sleeper", 14, 9],
      ["Lost", "lost", 13, 9],
    ]);
    expect(w.actors[0]?.wait).toBe(600);
    expect(w.actors[1]?.path).toEqual([]);
    expect(w.actors[1]?.wait).toBe(IDLE_TICKS);
    expect(w.actors[1]?.fault).toBe(0);
  });

  it("a standing actor decides at most once every IDLE_TICKS ticks, whatever it asks for", () => {
    const w = world([["Nap", "napper", 14, 9]]);
    const nap = w.actors[0];
    if (!nap) throw new Error("no actor");
    expect(nap.wait).toBe(IDLE_TICKS);
    let decisions = 0;
    for (let i = 0; i < 100; i++) {
      const before = nap.wait;
      step(w);
      if (nap.wait > before) decisions++;
    }
    expect(decisions).toBeLessThanOrEqual(Math.ceil(100 / (IDLE_TICKS + 1)));
    expect(decisions).toBeGreaterThan(10);
  });

  it("a faulting decision leaves the actor's memory untouched", () => {
    const w = run(world([["Scrib", "scribbler", 14, 9]]), 100);
    expect(FAULTS[w.actors[0]?.fault ?? 0]).toBe("divide_by_zero");
    expect(w.actors[0]?.memory.every((value) => value === 0)).toBe(true);
  });

  it("checks the program table when a world is made, and keeps its own frozen copy", () => {
    const map = firstLight();
    const unchecked = { version: BYTECODE_VERSION, code: [OP.SENSE, 77, OP.ACT, IDLE], rules: [] };
    expect(() => createWorld(map, 1, { bad: unchecked })).toThrow(ProgramError);
    for (const name of ["", "Rover", "9lives", "__proto__", "a b", "x".repeat(33)]) {
      const table = Object.fromEntries([[name, PROGRAMS.rover]]) as Programs;
      expect(() => createWorld(map, 1, table), name).toThrow(/not a valid program name/);
    }
    const code = [OP.ACT, IDLE];
    const mine = { walker: { version: BYTECODE_VERSION, code, rules: [] } };
    const w = createWorld(map, 1, mine);
    code[1] = 999;
    mine.walker.code = [OP.JMP, 0];
    step(w, [{ type: "spawn", name: "Ash", x: 14, y: 9, program: "walker" }]);
    expect(() => run(w, 50)).not.toThrow();
    expect(w.actors[0]?.fault).toBe(0);
    expect(Object.isFrozen(w.programs)).toBe(true);
    expect(Object.getPrototypeOf(w.programs)).toBeNull();
  });

  it("a program table that cannot be read is refused with a ProgramError, nothing else", () => {
    const map = firstLight();
    const saved = snapshot(run(world([["Ash", "rover", 14, 9]]), 20));
    const { proxy: revoked, revoke } = Proxy.revocable({}, {});
    revoke();
    const hostile: [string, unknown][] = [
      [
        "a getter that throws",
        Object.defineProperty({}, "rover", {
          enumerable: true,
          get: () => {
            throw new TypeError("no");
          },
        }),
      ],
      [
        "keys that throw",
        new Proxy(
          {},
          {
            ownKeys: () => {
              throw new RangeError("no");
            },
          },
        ),
      ],
      [
        "descriptors that throw",
        new Proxy(
          { rover: 1 },
          {
            getOwnPropertyDescriptor: () => {
              throw new SyntaxError("no");
            },
          },
        ),
      ],
      ["a revoked proxy", revoked],
      ["null", null],
    ];
    for (const [what, table] of hostile) {
      expect(() => createWorld(map, 1, table as Programs), what).toThrow(ProgramError);
      expect(() => restore(saved, map, table as Programs), what).toThrow(ProgramError);
    }
  });

  it("restore checks the program table it is given and keeps its own copy", () => {
    const map = firstLight();
    const saved = snapshot(run(world([["Ash", "rover", 14, 9]]), 20));
    // An invalid program in the table is refused before any state is read.
    const unchecked = { version: BYTECODE_VERSION, code: [OP.SENSE, 77, OP.ACT, IDLE], rules: [] };
    expect(() => restore(saved, map, { ...PROGRAMS, rover: unchecked })).toThrow(ProgramError);
    // A table changed after the restore does not change the restored world.
    const table: Record<string, Program> = { ...PROGRAMS };
    const resumed = restore(saved, map, table);
    table.rover = { version: BYTECODE_VERSION, code: [OP.SENSE, 77, OP.ACT, IDLE], rules: [] };
    expect(resumed.programs).not.toBe(table);
    expect(Object.isFrozen(resumed.programs)).toBe(true);
    expect(() => run(resumed, 200)).not.toThrow();
    expect(resumed.actors[0]?.fault).toBe(0);
    const straight = run(world([["Ash", "rover", 14, 9]]), 220);
    expect(hashWorld(resumed)).toBe(hashWorld(straight));
  });

  it("drops a spawn that names a program the world does not have", () => {
    const w = world([
      ["Ghost", "no-such-program", 14, 9],
      ["Proto", "constructor", 13, 9],
      ["Ash", "rover", 12, 9],
    ]);
    step(w, [{ type: "spawn", name: "Plain", x: 11, y: 8 } as never]);
    expect(w.actors.map((a) => [a.name, a.program])).toEqual([["Ash", "rover"]]);
  });
});

describe("programs and determinism", () => {
  const cast: [string, string, number, number][] = [
    ["Ash", "courier", 14, 9],
    ["Birch", "rover", 13, 9],
    ["Cedar", "broken", 12, 9],
    ["Dara", "rover", 11, 8],
  ];

  it("worlds with programs stay identical from one seed and resume from a snapshot", () => {
    const a = world(cast, 5);
    const b = world(cast, 5);
    for (let i = 0; i < 40; i++) {
      run(a, 50);
      run(b, 50);
      expect(hashWorld(a)).toBe(hashWorld(b));
    }
    const resumed = restore(snapshot(run(world(cast, 5), 777)), firstLight(), PROGRAMS);
    expect(hashWorld(run(resumed, 1223))).toBe(hashWorld(a));
  });

  it("program state is part of the hash", () => {
    const w = run(world(cast, 5), 300);
    const before = hashWorld(w);
    const ash = w.actors[0];
    if (!ash) throw new Error("no actor");
    ash.memory[7] = 1;
    const memoryChanged = hashWorld(w);
    ash.memory[7] = 0;
    ash.rule = ash.rule === 0 ? 1 : 0;
    const ruleChanged = hashWorld(w);
    expect(new Set([before, memoryChanged, ruleChanged]).size).toBe(3);
  });

  it("refuses a snapshot taken with other programs, or holding impossible program state", () => {
    const map = firstLight();
    const saved = snapshot(run(world(cast, 5), 100));
    expect(() => restore(saved, map, {})).toThrow(/different programs/);
    expect(() => restore(saved, map, { ...PROGRAMS, rover: PROGRAMS.broken as Program })).toThrow(
      /different programs/,
    );
    type Saved = { hash: string; state: { actors: Record<string, unknown>[] } };
    const forgeries: [string, (actor: Record<string, unknown>) => void][] = [
      ["a program the world lacks", (a) => (a.program = "nobody")],
      ["memory of the wrong size", (a) => (a.memory = [0])],
      ["memory outside 32 bits", (a) => ((a.memory as number[])[0] = 2 ** 32 + 1)],
      ["a rule the program lacks", (a) => (a.rule = 2)],
      ["an unknown fault", (a) => (a.fault = 99)],
    ];
    for (const [what, change] of forgeries) {
      for (const rehash of [false, true]) {
        const data = JSON.parse(saved) as Saved;
        change(data.state.actors[0] as Record<string, unknown>);
        if (rehash) {
          try {
            data.hash = hashWorld({ ...(data.state as unknown as World), map, programs: PROGRAMS });
          } catch {
            // Not hashable; the saved hash stays.
          }
        }
        expect(() => restore(JSON.stringify(data), map, PROGRAMS), what).toThrow(SnapshotError);
      }
    }
    expect(hashWorld(restore(saved, map, PROGRAMS))).toBe((JSON.parse(saved) as Saved).hash);
  });
});
