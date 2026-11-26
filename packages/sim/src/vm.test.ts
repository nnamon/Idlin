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
    ]);
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

  it("accepts a well-formed program and returns it", () => {
    const ok = validateProgram(withCode([OP.RULE, 0, OP.ACT, IDLE], ["rest"]));
    expect(ok).toEqual({ version: 1, code: [OP.RULE, 0, OP.ACT, IDLE], rules: ["rest"] });
  });
});

describe("hostile programs", () => {
  const OPERAND_COUNT = (op: number): number =>
    [1, 23, 24, 25, 26, 27, 28, 29, 30].includes(op) ? 1 : 0;

  it("random words: every one is refused or runs to a clean end", () => {
    const rng = createRng(1234);
    let accepted = 0;
    for (let i = 0; i < 6000; i++) {
      const code = Array.from({ length: 1 + nextInt(rng, 24) }, () => nextInt(rng, 40) - 4);
      let checked: Program;
      try {
        checked = validateProgram({ version: BYTECODE_VERSION, code, rules: ["a", "b"] });
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
    expect(accepted).toBeGreaterThan(50);
  });

  it("random well-formed programs: none throws, none exceeds its budget, memory stays 32-bit", () => {
    const rng = createRng(99);
    const faults = new Set<string>();
    for (let i = 0; i < 6000; i++) {
      const ops: number[] = [];
      const starts: number[] = [];
      const length = 2 + nextInt(rng, 30);
      for (let k = 0; k < length; k++) {
        starts.push(ops.length);
        const op = nextInt(rng, 31);
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
      const checked = validateProgram({ version: BYTECODE_VERSION, code: ops, rules: ["a", "b"] });
      const memory = new Array<number>(MEMORY_SLOTS).fill(0);
      const decision = runDecision(checked, memory, () => nextInt(rng, 2 ** 32) | 0);
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
