import { describe, expect, it } from "vitest";
import { createRng, nextInt } from "./rng.ts";
import { SYSCALLS } from "./syscalls.ts";
import {
  BYTECODE_VERSION,
  type Decision,
  GAS_PER_DECISION,
  MEMORY_SLOTS,
  OP,
  type Program,
  ProgramError,
  runDecision,
  STACK_SIZE,
  validateProgram,
} from "./vm.ts";

const IDLE = 6;
const WAIT = 7;
const WALK_TO = 8;
const SELF_X = 0;
const DISTANCE = 5;

const program = (code: number[], rules: string[] = []): Program =>
  validateProgram({ version: BYTECODE_VERSION, code, rules });

/** Runs code with a sensor that answers 7 for anything, and returns the decision and memory. */
const run = (
  code: number[],
  memory = new Array<number>(MEMORY_SLOTS).fill(0),
): Decision & { memory: number[] } => ({
  ...runDecision(program(code), memory, () => 7),
  memory,
});

/** Runs `code`, then commits `wait` with whatever is on top of the stack, and returns that value. */
const top = (code: number[]): number => {
  const decision = run([...code, OP.ACT, WAIT]);
  expect(decision.fault).toBe("none");
  return decision.action?.args[0] as number;
};

describe("the system call table", () => {
  // Compiled programs refer to calls by number. These numbers never change.
  it("pins every call's number, kind and argument count", () => {
    expect(SYSCALLS.map((c) => `${c.id} ${c.name} ${c.kind} ${c.args}`)).toEqual([
      "0 self_x sensor 0",
      "1 self_y sensor 0",
      "2 hour sensor 0",
      "3 minute sensor 0",
      "4 walkable sensor 2",
      "5 distance sensor 2",
      "6 idle action 0",
      "7 wait action 1",
      "8 walk_to action 2",
      "9 wander action 0",
      "10 hp sensor 0",
      "11 max_hp sensor 0",
      "12 threat_x sensor 0",
      "13 threat_y sensor 0",
      "14 threat_distance sensor 0",
      "15 threat_hp sensor 0",
      "16 danger sensor 2",
      "17 danger_here sensor 0",
      "18 attack action 2",
      "19 step_clear action 0",
      "20 flee action 2",
      "21 threat_recovering sensor 0",
      "22 step_to action 2",
      "23 stalled sensor 0",
      "24 level sensor 1",
      "25 xp sensor 1",
      "26 bag_free sensor 0",
      "27 carrying sensor 1",
      "28 banked sensor 1",
      "29 at_bank sensor 0",
      "30 deposit action 2",
      "31 withdraw action 2",
      "32 bank_all action 0",
      "33 node_distance sensor 1",
      "34 node_x sensor 1",
      "35 node_y sensor 1",
      "36 chop action 0",
      "37 fish action 0",
      "38 at_fire sensor 0",
      "39 cook action 0",
      "40 eat action 0",
      "41 threat_friends sensor 0",
      "42 friends_near sensor 1",
      "43 lit_here sensor 0",
      "44 threat_lit sensor 0",
      "45 threat_moving sensor 0",
      "46 lit_enemies sensor 0",
      "47 lit_mending sensor 0",
      "48 weapon_reach sensor 0",
      "49 flask sensor 0",
      "50 drink action 0",
      "51 flagged sensor 0",
      "52 flag_x sensor 0",
      "53 flag_y sensor 0",
      "54 flag_age sensor 0",
      "55 flag_down sensor 0",
      "56 heard sensor 0",
      "57 lift_eta sensor 0",
      "58 way_home sensor 0",
    ]);
  });

  it("pins the opcode numbers", () => {
    expect(Object.entries(OP).map(([name, value]) => `${value} ${name}`)).toEqual([
      "0 HALT",
      "1 PUSH",
      "2 POP",
      "3 DUP",
      "4 SWAP",
      "5 ADD",
      "6 SUB",
      "7 MUL",
      "8 DIV",
      "9 MOD",
      "10 NEG",
      "11 ABS",
      "12 MIN",
      "13 MAX",
      "14 EQ",
      "15 NE",
      "16 LT",
      "17 LE",
      "18 GT",
      "19 GE",
      "20 NOT",
      "21 AND",
      "22 OR",
      "23 JMP",
      "24 JZ",
      "25 JNZ",
      "26 LOAD",
      "27 STORE",
      "28 SENSE",
      "29 ACT",
      "30 RULE",
      "31 PARAM",
    ]);
  });
});

describe("params", () => {
  const margin = { name: "margin", value: 120, min: 0, max: 240, values: [] };
  const stance = {
    name: "stance",
    value: 0,
    min: 0,
    max: 2,
    values: ["gather", "fight", "careful"],
  };
  const withParams = (params: unknown, code = [OP.PARAM, 0, OP.ACT, WAIT]) =>
    validateProgram({ version: BYTECODE_VERSION, code, rules: [], params });

  it("PARAM pushes the value the actor has, or the default if it has none", () => {
    const checked = withParams([margin, stance], [OP.PARAM, 1, OP.PARAM, 0, OP.ADD, OP.ACT, WAIT]);
    const memory = new Array<number>(MEMORY_SLOTS).fill(0);
    expect(runDecision(checked, memory, () => 0, [150, 2]).action?.args).toEqual([152]);
    expect(runDecision(checked, memory, () => 0).action?.args).toEqual([120]);
    expect(checked.params).toEqual([margin, stance]);
    expect(Object.isFrozen(checked.params[1]?.values)).toBe(true);
  });

  it("refuses params that are not what a program can declare", () => {
    const bad = (params: unknown, pattern: RegExp) =>
      expect(() => withParams(params), JSON.stringify(params)).toThrow(pattern);
    bad("margin", /at most 8/);
    bad(new Array(9).fill(margin), /at most 8/);
    bad([margin, margin], /declared twice/);
    bad([{ ...margin, name: "Margin" }], /no usable name/);
    bad([{ ...margin, value: 241 }], /min <= value <= max/);
    bad([{ ...margin, min: 10, max: 5, value: 7 }], /min <= value <= max/);
    bad([{ ...margin, value: 1.5 }], /min <= value <= max/);
    bad([{ ...stance, values: ["gather", "gather", "x"] }], /not usable/);
    bad([{ ...stance, max: 3 }], /one less than its value names/);
    bad([{ ...margin, values: "abc" }], /no list of values/);
    // A PARAM past the program's params is refused before it can run.
    expect(() => withParams([], [OP.PARAM, 0, OP.ACT, WAIT])).toThrow(/no param 0/);
    expect(() => withParams([margin], [OP.PARAM, -1, OP.ACT, WAIT])).toThrow(/no param -1/);
  });
});

describe("instructions", () => {
  const binary = (op: number, a: number, b: number): number => top([OP.PUSH, a, OP.PUSH, b, op]);

  it("does arithmetic in wrapping 32-bit integers", () => {
    expect(binary(OP.ADD, 2, 3)).toBe(5);
    expect(binary(OP.ADD, 2 ** 31 - 1, 1)).toBe(-(2 ** 31));
    expect(binary(OP.SUB, -(2 ** 31), 1)).toBe(2 ** 31 - 1);
    expect(binary(OP.MUL, 65536, 65536)).toBe(0);
    expect(binary(OP.MUL, -7, 6)).toBe(-42);
    expect(binary(OP.DIV, 7, 2)).toBe(3);
    expect(binary(OP.DIV, -7, 2)).toBe(-3);
    expect(binary(OP.DIV, -(2 ** 31), -1)).toBe(-(2 ** 31));
    expect(binary(OP.MOD, 7, 3)).toBe(1);
    expect(binary(OP.MOD, -7, 3)).toBe(-1);
    expect(binary(OP.MOD, -(2 ** 31), -1)).toBe(0);
    expect(binary(OP.MIN, 4, -9)).toBe(-9);
    expect(binary(OP.MAX, 4, -9)).toBe(4);
    expect(top([OP.PUSH, 5, OP.NEG])).toBe(-5);
    expect(top([OP.PUSH, -(2 ** 31), OP.NEG])).toBe(-(2 ** 31));
    expect(top([OP.PUSH, -5, OP.ABS])).toBe(5);
    expect(top([OP.PUSH, -(2 ** 31), OP.ABS])).toBe(-(2 ** 31));
  });

  it("compares and combines truth values as 1 and 0", () => {
    expect([OP.EQ, OP.NE, OP.LT, OP.LE, OP.GT, OP.GE].map((op) => binary(op, 2, 3))).toEqual([
      0, 1, 1, 1, 0, 0,
    ]);
    expect([OP.EQ, OP.NE, OP.LT, OP.LE, OP.GT, OP.GE].map((op) => binary(op, 3, 3))).toEqual([
      1, 0, 0, 1, 0, 1,
    ]);
    expect([
      binary(OP.AND, 5, -1),
      binary(OP.AND, 5, 0),
      binary(OP.OR, 0, 9),
      binary(OP.OR, 0, 0),
    ]).toEqual([1, 0, 1, 0]);
    expect([top([OP.PUSH, 0, OP.NOT]), top([OP.PUSH, 12, OP.NOT])]).toEqual([1, 0]);
  });

  it("moves values on the stack", () => {
    expect(top([OP.PUSH, 4, OP.DUP, OP.ADD])).toBe(8);
    expect(top([OP.PUSH, 9, OP.PUSH, 2, OP.SWAP, OP.SUB])).toBe(-7);
    expect(top([OP.PUSH, 1, OP.PUSH, 2, OP.POP])).toBe(1);
  });

  it("jumps: taken and not taken, forward and back", () => {
    // if (0) push 111 else push 222
    expect(top([OP.PUSH, 0, OP.JZ, 7, OP.PUSH, 111, OP.HALT, OP.PUSH, 222])).toBe(222);
    expect(top([OP.PUSH, 5, OP.JNZ, 7, OP.PUSH, 111, OP.HALT, OP.PUSH, 222])).toBe(222);
    expect(top([OP.PUSH, 5, OP.JZ, 8, OP.PUSH, 111, OP.JMP, 10, OP.PUSH, 222])).toBe(111);
    // Count down from 5 in slot 0, adding 3 to slot 1 each time round.
    const loop = run([
      OP.PUSH,
      5,
      OP.STORE,
      0,
      OP.LOAD,
      1,
      OP.PUSH,
      3,
      OP.ADD,
      OP.STORE,
      1,
      OP.LOAD,
      0,
      OP.PUSH,
      1,
      OP.SUB,
      OP.DUP,
      OP.STORE,
      0,
      OP.JNZ,
      4,
      OP.ACT,
      IDLE,
    ]);
    expect(loop.fault).toBe("none");
    expect(loop.memory.slice(0, 2)).toEqual([0, 15]);
  });

  it("keeps memory between decisions", () => {
    const memory = new Array<number>(MEMORY_SLOTS).fill(0);
    const counter = [OP.LOAD, 3, OP.PUSH, 1, OP.ADD, OP.DUP, OP.STORE, 3, OP.ACT, WAIT];
    expect(run(counter, memory).action?.args).toEqual([1]);
    expect(run(counter, memory).action?.args).toEqual([2]);
    expect(memory[3]).toBe(2);
  });

  it("passes arguments to sensors and actions in the order they were pushed", () => {
    const seen: number[][] = [];
    const decision = runDecision(
      program([OP.PUSH, 10, OP.PUSH, 20, OP.SENSE, DISTANCE, OP.PUSH, 30, OP.ACT, WALK_TO]),
      new Array<number>(MEMORY_SLOTS).fill(0),
      (id, args) => {
        seen.push([id, ...args]);
        return 99;
      },
    );
    expect(seen).toEqual([[DISTANCE, 10, 20]]);
    expect(decision.action).toEqual({ id: WALK_TO, args: [99, 30] });
  });

  it("folds whatever a sensor returns into a 32-bit integer", () => {
    const answer = (value: number): number =>
      runDecision(program([OP.SENSE, SELF_X, OP.ACT, WAIT]), [], () => value).action
        ?.args[0] as number;
    expect([
      answer(2 ** 32 + 5),
      answer(1.9),
      answer(Number.NaN),
      answer(Number.POSITIVE_INFINITY),
    ]).toEqual([5, 1, 0, 0]);
  });

  it("reports the rule that was running when the action was committed", () => {
    const code = [OP.RULE, 0, OP.PUSH, 0, OP.JZ, 8, OP.ACT, IDLE, OP.RULE, 1, OP.ACT, IDLE];
    const decision = runDecision(program(code, ["first", "second"]), [], () => 0);
    expect(decision.rule).toBe(1);
    expect(run([OP.ACT, IDLE]).rule).toBe(-1);
  });
});

describe("faults", () => {
  it("ends the decision with a typed fault and no action", () => {
    const cases: [string, number[]][] = [
      ["no_action", [OP.HALT]],
      ["ran_off_end", [OP.PUSH, 1]],
      ["stack_underflow", [OP.ADD]],
      ["stack_underflow", [OP.PUSH, 1, OP.ACT, WALK_TO]],
      ["stack_underflow", [OP.PUSH, 1, OP.SENSE, DISTANCE]],
      ["divide_by_zero", [OP.PUSH, 1, OP.PUSH, 0, OP.DIV]],
      ["divide_by_zero", [OP.PUSH, 1, OP.PUSH, 0, OP.MOD]],
      ["out_of_gas", [OP.JMP, 0]],
      ["stack_overflow", [OP.PUSH, 1, OP.JMP, 0]],
    ];
    for (const [fault, code] of cases) {
      const decision = run(code);
      expect(decision.fault, JSON.stringify(code)).toBe(fault);
      expect(decision.action).toBeNull();
    }
  });

  it("checks the stack before every instruction, at both ends", () => {
    // How many values each instruction takes, and whether it leaves more than it took.
    const table: [string, number[], number, boolean][] = [
      ["PUSH", [OP.PUSH, 1], 0, true],
      ["POP", [OP.POP], 1, false],
      ["DUP", [OP.DUP], 1, true],
      ["SWAP", [OP.SWAP], 2, false],
      ["NEG", [OP.NEG], 1, false],
      ["ABS", [OP.ABS], 1, false],
      ["NOT", [OP.NOT], 1, false],
      ["LOAD", [OP.LOAD, 0], 0, true],
      ["STORE", [OP.STORE, 0], 1, false],
      ["SENSE self_x", [OP.SENSE, SELF_X], 0, true],
      ["SENSE distance", [OP.SENSE, DISTANCE], 2, false],
      ["ACT wait", [OP.ACT, WAIT], 1, false],
      ["ACT walk_to", [OP.ACT, WALK_TO], 2, false],
      ...[
        OP.ADD,
        OP.SUB,
        OP.MUL,
        OP.DIV,
        OP.MOD,
        OP.MIN,
        OP.MAX,
        OP.EQ,
        OP.NE,
        OP.LT,
        OP.LE,
        OP.GT,
        OP.GE,
        OP.AND,
        OP.OR,
      ].map((op): [string, number[], number, boolean] => [`binary ${op}`, [op], 2, false]),
    ];
    const pushes = (n: number): number[] => Array.from({ length: n }, () => [OP.PUSH, 3]).flat();
    for (const [name, instruction, takes, grows] of table) {
      if (takes > 0) {
        expect(
          run([...pushes(takes - 1), ...instruction, OP.ACT, IDLE]).fault,
          `${name} one short`,
        ).toBe("stack_underflow");
      }
      expect(
        run([...pushes(takes), ...instruction, OP.HALT]).fault,
        `${name} with enough`,
      ).not.toBe("stack_underflow");
      const full = run([...pushes(STACK_SIZE), ...instruction, OP.HALT]).fault;
      // An action ends the decision; everything else runs on to the HALT.
      const settled = name.startsWith("ACT") ? "none" : "no_action";
      expect(full, `${name} on a full stack`).toBe(grows ? "stack_overflow" : settled);
      if (grows) {
        expect(
          run([...pushes(STACK_SIZE - 1), ...instruction, OP.HALT]).fault,
          `${name} one below full`,
        ).toBe("no_action");
      }
    }
    // JZ and JNZ take one value; a jump to the next instruction keeps the test simple.
    for (const op of [OP.JZ, OP.JNZ]) {
      expect(run([op, 2, OP.HALT]).fault).toBe("stack_underflow");
      expect(run([OP.PUSH, 1, op, 4, OP.HALT]).fault).toBe("no_action");
    }
    // A loop that grows the stack without PUSH must overflow, not run out of gas.
    expect(run([OP.PUSH, 1, OP.DUP, OP.JMP, 2]).fault).toBe("stack_overflow");
    expect(run([OP.LOAD, 0, OP.JMP, 0]).fault).toBe("stack_overflow");
    expect(run([OP.SENSE, SELF_X, OP.JMP, 0]).fault).toBe("stack_overflow");
  });

  it("a decision that faults leaves memory as it was", () => {
    const memory = new Array<number>(MEMORY_SLOTS).fill(0);
    memory[2] = 44;
    const faulted = run([OP.PUSH, 9, OP.STORE, 2, OP.PUSH, 9, OP.STORE, 5, OP.JMP, 8], memory);
    expect(faulted.fault).toBe("out_of_gas");
    expect(memory[2]).toBe(44);
    expect(memory[5]).toBe(0);
    expect(run([OP.PUSH, 9, OP.STORE, 2, OP.PUSH, 1, OP.PUSH, 0, OP.DIV], memory).fault).toBe(
      "divide_by_zero",
    );
    expect(memory[2]).toBe(44);
    // The same writes are kept when the decision commits an action.
    expect(run([OP.PUSH, 9, OP.STORE, 2, OP.ACT, IDLE], memory).fault).toBe("none");
    expect(memory[2]).toBe(9);
  });

  it("never runs more than its budget, and allows exactly the full stack", () => {
    expect(run([OP.JMP, 0]).gasUsed).toBe(GAS_PER_DECISION);
    const fill = (n: number): number[] => [
      ...Array.from({ length: n }, () => [OP.PUSH, 1]).flat(),
      OP.ACT,
      IDLE,
    ];
    expect(run(fill(STACK_SIZE)).fault).toBe("none");
    expect(run(fill(STACK_SIZE + 1)).fault).toBe("stack_overflow");
  });
});

describe("validateProgram", () => {
  const bad = (raw: unknown, message: RegExp): void => {
    expect(() => validateProgram(raw)).toThrow(ProgramError);
    expect(() => validateProgram(raw)).toThrow(message);
  };
  const withCode = (code: unknown, rules: unknown = []) => ({
    version: BYTECODE_VERSION,
    code,
    rules,
  });

  it("refuses anything that is not a well-formed program", () => {
    bad(null, /must be an object/);
    bad({ version: 99, code: [0], rules: [] }, /bytecode version must be 1/);
    bad(withCode([]), /1 to 4096 words/);
    bad(withCode(new Array(5000).fill(0)), /1 to 4096 words/);
    bad(withCode("code"), /1 to 4096 words/);
    bad(withCode([0], "rules"), /rules must be a list/);
    bad(withCode([0], [""]), /rule label/);
    bad(withCode([0], ["x".repeat(41)]), /rule label/);
    bad(withCode([0.5]), /word 0 is not a 32-bit integer/);
    bad(withCode([2 ** 40]), /word 0 is not a 32-bit integer/);
    bad(withCode(["1"]), /word 0 is not a 32-bit integer/);
    bad(withCode([99]), /word 0: unknown opcode 99/);
    bad(withCode([-1]), /unknown opcode -1/);
    bad(withCode([OP.HALT, OP.PUSH]), /word 1: instruction is cut short/);
    bad(withCode([OP.JMP, 5]), /jump to 5 is not an instruction/);
    bad(withCode([OP.JMP, -1]), /jump to -1/);
    // A jump into the middle of an instruction: word 1 is PUSH's operand.
    bad(withCode([OP.PUSH, 0, OP.JMP, 1]), /jump to 1 is not an instruction/);
    bad(withCode([OP.LOAD, MEMORY_SLOTS]), /no memory slot 16/);
    bad(withCode([OP.STORE, -1]), /no memory slot -1/);
    bad(withCode([OP.SENSE, 999]), /system call 999 is not a sensor/);
    bad(withCode([OP.SENSE, IDLE]), /system call 6 is not a sensor/);
    bad(withCode([OP.ACT, SELF_X]), /system call 0 is not a action/);
    bad(withCode([OP.RULE, 0]), /no rule 0/);
  });

  it("returns a frozen copy, so nothing done to the original can change what was checked", () => {
    const code = [OP.SENSE, SELF_X, OP.ACT, WAIT];
    const rules = ["only"];
    const checked = validateProgram({ version: BYTECODE_VERSION, code, rules });
    code[1] = 99;
    rules[0] = "changed";
    expect(checked.code).toEqual([OP.SENSE, SELF_X, OP.ACT, WAIT]);
    expect(checked.rules).toEqual(["only"]);
    expect(
      Object.isFrozen(checked) && Object.isFrozen(checked.code) && Object.isFrozen(checked.rules),
    ).toBe(true);
    expect(runDecision(checked, [], () => 3).action).toEqual({ id: WAIT, args: [3] });
  });

  it("reads each value once: an object that answers differently later is checked as it will run", () => {
    // Says 0 (a sensor) the first time word 1 is read, and 1234 (no such call) after that.
    let reads = 0;
    const shifty = new Proxy([OP.SENSE, 0, OP.ACT, IDLE], {
      get: (target, key, receiver) =>
        key === "1" && reads++ > 0 ? 1234 : Reflect.get(target, key, receiver),
    });
    const checked = validateProgram({ version: BYTECODE_VERSION, code: shifty, rules: [] });
    expect(checked.code).toEqual([OP.SENSE, 0, OP.ACT, IDLE]);
    expect(() => runDecision(checked, [], () => 0)).not.toThrow();

    // Rule labels that iterate as strings but index as objects.
    const labels: unknown[] = [{}];
    Object.defineProperty(labels, Symbol.iterator, { value: () => ["fine"][Symbol.iterator]() });
    bad(withCode([OP.HALT], labels), /rule label/);
  });

  it("turns anything thrown while reading a program into a ProgramError", () => {
    const throwing = {
      get version(): number {
        throw new TypeError("no");
      },
      code: [0],
      rules: [],
    };
    bad(throwing, /could not be read/);
    bad(
      new Proxy(
        {},
        {
          get: () => {
            throw new RangeError("no");
          },
        },
      ),
      /could not be read/,
    );
    bad(
      withCode(
        new Proxy([0], {
          get: () => {
            throw new Error("no");
          },
        }),
      ),
      /could not be read/,
    );
  });

  it("accepts a well-formed program and returns it", () => {
    const ok = validateProgram(withCode([OP.RULE, 0, OP.ACT, IDLE], ["rest"]));
    expect(ok).toEqual({
      version: 1,
      code: [OP.RULE, 0, OP.ACT, IDLE],
      rules: ["rest"],
      params: [],
    });
  });
});

describe("hostile programs", () => {
  const OPERAND_COUNT = (op: number): number =>
    [1, 23, 24, 25, 26, 27, 28, 29, 30, 31].includes(op) ? 1 : 0;
  const TWO_PARAMS = [
    { name: "a", value: 1, min: -5, max: 5, values: [] },
    { name: "b", value: 0, min: 0, max: 1, values: ["x", "y"] },
  ];

  it("random words: every one is refused or runs to a clean end", () => {
    const rng = createRng(1234);
    let accepted = 0;
    for (let i = 0; i < 10_000; i++) {
      const code = Array.from({ length: 1 + nextInt(rng, 24) }, () => nextInt(rng, 40) - 4);
      let checked: Program;
      try {
        checked = validateProgram({
          version: BYTECODE_VERSION,
          code,
          rules: ["a", "b"],
          params: TWO_PARAMS,
        });
      } catch (error) {
        expect(error).toBeInstanceOf(ProgramError);
        continue;
      }
      accepted++;
      const decision = runDecision(
        checked,
        new Array<number>(MEMORY_SLOTS).fill(0),
        () => nextInt(rng, 100) - 50,
      );
      expect(decision.gasUsed).toBeLessThanOrEqual(GAS_PER_DECISION);
      expect(decision.action === null).toBe(decision.fault !== "none");
    }
    expect(accepted).toBeGreaterThan(100);
  });

  it("random well-formed programs: none throws, none exceeds its budget, memory stays 32-bit", () => {
    const rng = createRng(99);
    const faults = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const ops: number[] = [];
      const starts: number[] = [];
      const length = 2 + nextInt(rng, 30);
      for (let k = 0; k < length; k++) {
        starts.push(ops.length);
        const op = nextInt(rng, 32);
        ops.push(op);
        if (OPERAND_COUNT(op)) ops.push(0);
      }
      // Fill in operands that the validator will accept.
      for (const at of starts) {
        const op = ops[at] as number;
        if (!OPERAND_COUNT(op)) continue;
        if (op === OP.PUSH) ops[at + 1] = nextInt(rng, 2 ** 32) | 0;
        else if (op === OP.JMP || op === OP.JZ || op === OP.JNZ)
          ops[at + 1] = starts[nextInt(rng, starts.length)] as number;
        else if (op === OP.LOAD || op === OP.STORE) ops[at + 1] = nextInt(rng, MEMORY_SLOTS);
        else if (op === OP.SENSE) ops[at + 1] = nextInt(rng, 6);
        else if (op === OP.ACT) ops[at + 1] = 6 + nextInt(rng, 4);
        else ops[at + 1] = nextInt(rng, 2);
      }
      const checked = validateProgram({
        version: BYTECODE_VERSION,
        code: ops,
        rules: ["a", "b"],
        params: TWO_PARAMS,
      });
      const memory = new Array<number>(MEMORY_SLOTS).fill(0);
      const decision = runDecision(checked, memory, () => nextInt(rng, 2 ** 32) | 0, [-5]);
      faults.add(decision.fault);
      expect(decision.gasUsed).toBeLessThanOrEqual(GAS_PER_DECISION);
      expect(memory.every((value) => (value | 0) === value)).toBe(true);
      for (const arg of decision.action?.args ?? []) expect((arg | 0) === arg).toBe(true);
    }
    // The fuzz reaches every way a decision can end.
    expect([...faults].sort()).toEqual([
      "divide_by_zero",
      "no_action",
      "none",
      "out_of_gas",
      "ran_off_end",
      "stack_overflow",
      "stack_underflow",
    ]);
  });
});
