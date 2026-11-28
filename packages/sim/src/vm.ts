// The machine every actor's program runs on. A stack machine over 32-bit
// integers with a fixed stack, a few memory slots that persist between
// decisions, and a fixed budget of instructions per decision. A program can
// read the world through sensors and must end a decision by committing exactly
// one action. Nothing a program does can throw or run on: every failure is a
// fault, and a fault only costs that actor its turn.

import { isInt32 } from "./hash.ts";
import { SYSCALLS, syscall } from "./syscalls.ts";

/** Bump when the meaning or layout of bytecode changes; older programs are then refused. */
export const BYTECODE_VERSION = 1;
export const STACK_SIZE = 64;
export const MEMORY_SLOTS = 16;
/** Instructions a program may run in one decision. */
export const GAS_PER_DECISION = 2000;
export const MAX_CODE_LENGTH = 4096;
export const MAX_RULES = 64;
export const MAX_RULE_LABEL_LENGTH = 40;

/** Opcode numbers are part of the bytecode format. Append only. */
export const OP = {
  HALT: 0,
  PUSH: 1,
  POP: 2,
  DUP: 3,
  SWAP: 4,
  ADD: 5,
  SUB: 6,
  MUL: 7,
  DIV: 8,
  MOD: 9,
  NEG: 10,
  ABS: 11,
  MIN: 12,
  MAX: 13,
  EQ: 14,
  NE: 15,
  LT: 16,
  LE: 17,
  GT: 18,
  GE: 19,
  NOT: 20,
  AND: 21,
  OR: 22,
  JMP: 23,
  JZ: 24,
  JNZ: 25,
  LOAD: 26,
  STORE: 27,
  SENSE: 28,
  ACT: 29,
  RULE: 30,
  /** Pushes the value of the program's param with the operand's index, as its chatter set it. */
  PARAM: 31,
} as const;

/** How many operand words follow each opcode, indexed by opcode. */
const OPERANDS: readonly number[] = [
  0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1,
];

/** Program names: a lower-case letter, then letters, digits or underscores. */
export const PROGRAM_NAME = /^[a-z][a-z0-9_]{0,31}$/;

/** The most params a program may declare (docs/chat.md, section 3.3). */
export const MAX_PARAMS = 8;
/** The most names one param's values may have. */
export const MAX_PARAM_VALUES = 16;
/** Param names and the names of their values: what a chatter types, so plain lower-case words. */
export const PARAM_NAME = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * A number a program declares for its chatter to set. A param with named
 * values (`of gather, fight, careful`) runs from 0 to one less than their
 * count, and `value` is one of them.
 */
export interface Param {
  readonly name: string;
  /** The default, which every citizen starts with. */
  readonly value: number;
  readonly min: number;
  readonly max: number;
  /** The names of the values 0, 1, 2 and on, or none for a plain number. */
  readonly values: readonly string[];
}

/** How many operand words follow opcode `op`; 0 for one that is not an opcode. */
export const operandsOf = (op: number): number => OPERANDS[op] ?? 0;

/** How many instructions a word list holds, given that it is well formed. */
export function countInstructions(code: readonly number[]): number {
  let count = 0;
  for (let at = 0; at < code.length; at += 1 + (OPERANDS[code[at] as number] ?? 0)) count++;
  return count;
}

export interface Program {
  readonly version: number;
  /** Opcodes and their operands, one 32-bit integer per word. */
  readonly code: readonly number[];
  /** A short label per rule, for showing which rule chose the action. */
  readonly rules: readonly string[];
  /** The params it declares, in the order PARAM numbers them. */
  readonly params: readonly Param[];
}

export const FAULTS = [
  "none",
  "out_of_gas",
  "stack_overflow",
  "stack_underflow",
  "divide_by_zero",
  "ran_off_end",
  "no_action",
] as const;
export type Fault = (typeof FAULTS)[number];

export interface Decision {
  /** The committed action, or null if the decision ended in a fault. */
  readonly action: { readonly id: number; readonly args: readonly number[] } | null;
  /** Index of the rule that was running when the decision ended, or -1. */
  readonly rule: number;
  readonly fault: Fault;
  readonly gasUsed: number;
}

/** Answers a sensor. Must be a pure read; the machine calls it with a valid sensor id. */
export type Sense = (id: number, args: readonly number[]) => number;

export class ProgramError extends Error {
  override name = "ProgramError";
}

/**
 * Checks a program before it is ever run, and returns a frozen copy of it.
 * Throws a ProgramError naming the first problem. After this, running the
 * program can fault but cannot misbehave: every opcode is known, every operand
 * is present, every jump lands on an instruction, every slot and system call
 * exists. The copy is what makes that hold: nothing the caller does to its own
 * object afterwards can change what was checked.
 */
export function validateProgram(raw: unknown): Program {
  let version: unknown;
  let ints: number[];
  let rules: string[];
  let params: Param[];
  try {
    // Each value is read exactly once, so an object that answers differently
    // on a second read cannot show the checks one thing and the machine another.
    [version, ints, rules, params] = readProgram(raw);
  } catch (error) {
    if (error instanceof ProgramError) throw error;
    throw new ProgramError("a program could not be read");
  }
  if (version !== BYTECODE_VERSION) {
    throw new ProgramError(`bytecode version must be ${BYTECODE_VERSION}`);
  }

  const starts = new Set<number>();
  for (let at = 0; at < ints.length; ) {
    const op = ints[at] as number;
    const operands = OPERANDS[op];
    if (operands === undefined) throw new ProgramError(`word ${at}: unknown opcode ${op}`);
    if (at + operands >= ints.length) {
      throw new ProgramError(`word ${at}: instruction is cut short`);
    }
    starts.add(at);
    at += 1 + operands;
  }
  for (const at of starts) {
    const op = ints[at] as number;
    const operand = ints[at + 1] as number;
    if (op === OP.JMP || op === OP.JZ || op === OP.JNZ) {
      if (!starts.has(operand))
        throw new ProgramError(`word ${at}: jump to ${operand} is not an instruction`);
    } else if (op === OP.LOAD || op === OP.STORE) {
      if (operand < 0 || operand >= MEMORY_SLOTS)
        throw new ProgramError(`word ${at}: no memory slot ${operand}`);
    } else if (op === OP.SENSE || op === OP.ACT) {
      const call = syscall(operand);
      const kind = op === OP.SENSE ? "sensor" : "action";
      if (!call || call.kind !== kind)
        throw new ProgramError(`word ${at}: system call ${operand} is not a ${kind}`);
      if (call.retired) throw new ProgramError(`word ${at}: system call ${operand} is retired`);
    } else if (op === OP.RULE) {
      if (operand < 0 || operand >= rules.length)
        throw new ProgramError(`word ${at}: no rule ${operand}`);
    } else if (op === OP.PARAM) {
      if (operand < 0 || operand >= params.length)
        throw new ProgramError(`word ${at}: no param ${operand}`);
    }
  }
  return Object.freeze({
    version,
    code: Object.freeze(ints),
    rules: Object.freeze(rules),
    params: Object.freeze(params),
  });
}

/** Copies a would-be program out of whatever was passed in, checking types and sizes on the way. */
function readProgram(raw: unknown): [unknown, number[], string[], Param[]] {
  if (typeof raw !== "object" || raw === null)
    throw new ProgramError("a program must be an object");
  const { version, code, rules, params } = raw as Record<string, unknown>;
  if (!Array.isArray(code)) throw new ProgramError(`code must hold 1 to ${MAX_CODE_LENGTH} words`);
  const codeLength: unknown = code.length;
  if (!isInt32(codeLength) || codeLength < 1 || codeLength > MAX_CODE_LENGTH) {
    throw new ProgramError(`code must hold 1 to ${MAX_CODE_LENGTH} words`);
  }
  const ints: number[] = [];
  for (let i = 0; i < codeLength; i++) {
    const word: unknown = code[i];
    if (!isInt32(word)) throw new ProgramError(`word ${i} is not a 32-bit integer`);
    // `| 0` stores a negative zero as zero.
    ints.push(word | 0);
  }
  if (!Array.isArray(rules))
    throw new ProgramError(`rules must be a list of at most ${MAX_RULES} labels`);
  const ruleCount: unknown = rules.length;
  if (!isInt32(ruleCount) || ruleCount < 0 || ruleCount > MAX_RULES) {
    throw new ProgramError(`rules must be a list of at most ${MAX_RULES} labels`);
  }
  const labels: string[] = [];
  for (let i = 0; i < ruleCount; i++) {
    const label: unknown = rules[i];
    if (typeof label !== "string" || label.length < 1 || label.length > MAX_RULE_LABEL_LENGTH) {
      throw new ProgramError(`a rule label must be 1 to ${MAX_RULE_LABEL_LENGTH} characters`);
    }
    labels.push(label);
  }
  return [version, ints, labels, readParams(params)];
}

/** A program's params, checked and copied. A program from before params has none. */
function readParams(raw: unknown): Param[] {
  if (raw === undefined) return [];
  const most = `params must be a list of at most ${MAX_PARAMS}`;
  if (!Array.isArray(raw)) throw new ProgramError(most);
  const count: unknown = raw.length;
  if (!isInt32(count) || count < 0 || count > MAX_PARAMS) throw new ProgramError(most);
  const params: Param[] = [];
  for (let i = 0; i < count; i++) {
    const item: unknown = raw[i];
    if (typeof item !== "object" || item === null) throw new ProgramError(`param ${i} is not one`);
    const { name, value, min, max, values } = item as Record<string, unknown>;
    if (typeof name !== "string" || !PARAM_NAME.test(name))
      throw new ProgramError(`param ${i} has no usable name`);
    if (params.some((p) => p.name === name))
      throw new ProgramError(`param "${name}" is declared twice`);
    if (!isInt32(value) || !isInt32(min) || !isInt32(max) || min > value || value > max)
      throw new ProgramError(`param "${name}" must have whole numbers min <= value <= max`);
    if (!Array.isArray(values)) throw new ProgramError(`param "${name}" has no list of values`);
    const length: unknown = values.length;
    if (!isInt32(length) || length < 0 || length > MAX_PARAM_VALUES)
      throw new ProgramError(`param "${name}" can name at most ${MAX_PARAM_VALUES} values`);
    const names: string[] = [];
    for (let k = 0; k < length; k++) {
      const each: unknown = values[k];
      if (typeof each !== "string" || !PARAM_NAME.test(each) || names.includes(each))
        throw new ProgramError(`param "${name}" has a value name that is not usable`);
      names.push(each);
    }
    if (names.length > 0 && (min !== 0 || max !== names.length - 1))
      throw new ProgramError(`param "${name}" must run from 0 to one less than its value names`);
    params.push(
      Object.freeze({
        name,
        value: value | 0,
        min: min | 0,
        max: max | 0,
        values: Object.freeze(names),
      }),
    );
  }
  return params;
}

/**
 * Runs one decision. `program` must have passed validateProgram. `memory` is
 * the actor's persistent slots: it is changed only when the decision commits
 * an action. A decision that faults leaves memory exactly as it was, so a
 * fault has no effect beyond costing the actor its turn. `params` holds the
 * values of the program's params as the actor has them; a param it has no
 * value for reads as its default. Never throws.
 */
export function runDecision(
  program: Program,
  memory: number[],
  sense: Sense,
  params: readonly number[] = [],
): Decision {
  const { code } = program;
  const slots = memory.slice(0, MEMORY_SLOTS);
  const stack: number[] = [];
  let pc = 0;
  let gas = 0;
  let rule = -1;
  const end = (fault: Fault, action: Decision["action"] = null): Decision => ({
    action,
    rule,
    fault,
    gasUsed: gas,
  });

  while (true) {
    if (pc >= code.length) return end("ran_off_end");
    if (gas >= GAS_PER_DECISION) return end("out_of_gas");
    gas++;
    const op = code[pc] as number;
    const operand = code[pc + 1] as number;
    pc += 1 + (OPERANDS[op] as number);

    // How many values the instruction takes from the stack and how many it leaves.
    let takes = 0;
    let gives = 0;
    if (op === OP.PUSH || op === OP.LOAD || op === OP.PARAM) gives = 1;
    else if (op === OP.POP || op === OP.JZ || op === OP.JNZ || op === OP.STORE) takes = 1;
    else if (op === OP.DUP) [takes, gives] = [1, 2];
    else if (op === OP.SWAP) [takes, gives] = [2, 2];
    else if (op === OP.NEG || op === OP.ABS || op === OP.NOT) [takes, gives] = [1, 1];
    else if (op >= OP.ADD && op <= OP.OR) [takes, gives] = [2, 1];
    else if (op === OP.SENSE)
      [takes, gives] = [(SYSCALLS[operand] as (typeof SYSCALLS)[number]).args, 1];
    else if (op === OP.ACT) takes = (SYSCALLS[operand] as (typeof SYSCALLS)[number]).args;
    if (stack.length < takes) return end("stack_underflow");
    if (stack.length - takes + gives > STACK_SIZE) return end("stack_overflow");

    switch (op) {
      case OP.HALT:
        return end("no_action");
      case OP.PUSH:
        stack.push(operand);
        break;
      case OP.POP:
        stack.pop();
        break;
      case OP.DUP:
        stack.push(stack[stack.length - 1] as number);
        break;
      case OP.SWAP: {
        const b = stack.pop() as number;
        const a = stack.pop() as number;
        stack.push(b, a);
        break;
      }
      case OP.NEG:
        stack.push(-(stack.pop() as number) | 0);
        break;
      case OP.ABS: {
        const a = stack.pop() as number;
        stack.push((a < 0 ? -a : a) | 0);
        break;
      }
      case OP.NOT:
        stack.push((stack.pop() as number) === 0 ? 1 : 0);
        break;
      case OP.JMP:
        pc = operand;
        break;
      case OP.JZ:
        if ((stack.pop() as number) === 0) pc = operand;
        break;
      case OP.JNZ:
        if ((stack.pop() as number) !== 0) pc = operand;
        break;
      case OP.LOAD:
        stack.push((slots[operand] ?? 0) | 0);
        break;
      case OP.STORE:
        slots[operand] = stack.pop() as number;
        break;
      case OP.RULE:
        rule = operand;
        break;
      case OP.PARAM:
        stack.push((params[operand] ?? (program.params[operand] as Param).value) | 0);
        break;
      case OP.SENSE: {
        const args = stack.splice(stack.length - takes, takes);
        stack.push(sense(operand, args) | 0);
        break;
      }
      case OP.ACT:
        for (let slot = 0; slot < MEMORY_SLOTS; slot++) memory[slot] = (slots[slot] ?? 0) | 0;
        return end("none", { id: operand, args: stack.splice(stack.length - takes, takes) });
      default: {
        // Every remaining opcode takes two values and leaves one.
        const b = stack.pop() as number;
        const a = stack.pop() as number;
        if ((op === OP.DIV || op === OP.MOD) && b === 0) return end("divide_by_zero");
        stack.push(binary(op, a, b));
      }
    }
    // Belt and braces: whatever the table above says an instruction leaves, the
    // stack is never allowed past its size.
    if (stack.length > STACK_SIZE) return end("stack_overflow");
  }
}

/** Two-operand arithmetic, wrapping to 32 bits. Division truncates toward zero. */
function binary(op: number, a: number, b: number): number {
  switch (op) {
    case OP.ADD:
      return (a + b) | 0;
    case OP.SUB:
      return (a - b) | 0;
    case OP.MUL:
      return Math.imul(a, b);
    case OP.DIV:
      return (a / b) | 0;
    case OP.MOD:
      return (a % b) | 0;
    case OP.MIN:
      return Math.min(a, b);
    case OP.MAX:
      return Math.max(a, b);
    case OP.EQ:
      return a === b ? 1 : 0;
    case OP.NE:
      return a !== b ? 1 : 0;
    case OP.LT:
      return a < b ? 1 : 0;
    case OP.LE:
      return a <= b ? 1 : 0;
    case OP.GT:
      return a > b ? 1 : 0;
    case OP.GE:
      return a >= b ? 1 : 0;
    case OP.AND:
      return a !== 0 && b !== 0 ? 1 : 0;
    default:
      return a !== 0 || b !== 0 ? 1 : 0;
  }
}
