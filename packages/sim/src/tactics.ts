// Tactics: the language programs are written in. A program is an ordered list
// of rules; on each decision the first rule whose condition holds chooses the
// action. This file turns source text into bytecode for the machine in vm.ts.
// It never throws: whatever it is given, it returns a program or a list of
// errors with line and column.

import { SYSCALLS, type Syscall } from "./syscalls.ts";
import {
  BYTECODE_VERSION,
  MAX_CODE_LENGTH,
  MAX_RULE_LABEL_LENGTH,
  MAX_RULES,
  MEMORY_SLOTS,
  OP,
  type Program,
  STACK_SIZE,
  validateProgram,
} from "./vm.ts";

export interface TacticsError {
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

export type Compiled =
  | { readonly ok: true; readonly name: string; readonly program: Program }
  | { readonly ok: false; readonly errors: readonly TacticsError[] };

/** A name the source may use for a fixed number, or for a place (which stands for its x and its y). */
export type Constants = Readonly<
  Record<string, number | { readonly x: number; readonly y: number }>
>;

export const MAX_SOURCE_LENGTH = 20_000;
/** The last memory slot remembers how far a rule has got through a sequence of actions. */
const SEQUENCE_SLOT = MEMORY_SLOTS - 1;
const MAX_NAMED_SLOTS = MEMORY_SLOTS - 1;
const MAX_ERRORS = 10;
const MAX_BOT_NAME_LENGTH = 32;

const KEYWORDS = new Set(["bot", "when", "otherwise", "as", "set", "and", "or", "not", "mod"]);
const SYMBOLS = [
  "->",
  "<=",
  ">=",
  "==",
  "!=",
  "<",
  ">",
  "+",
  "-",
  "*",
  "/",
  "%",
  "(",
  ")",
  ",",
  ";",
  "=",
];
/** After one of these a line break does not end the rule, so a long rule can be wrapped. */
const CONTINUES = new Set([
  "->",
  ";",
  ",",
  "and",
  "or",
  "not",
  "(",
  "+",
  "-",
  "*",
  "/",
  "mod",
  "<",
  "<=",
  ">",
  ">=",
  "==",
  "!=",
  "=",
]);

type TokenKind = "number" | "name" | "string" | "symbol" | "keyword" | "newline" | "end";
interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly line: number;
  readonly column: number;
}

/** Thrown and caught inside this file only, to abandon the rule being parsed. */
class Problem {
  readonly error: TacticsError;
  constructor(at: { line: number; column: number }, message: string) {
    this.error = { line: at.line, column: at.column, message };
  }
}

function tokenize(source: string, errors: TacticsError[]): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  let column = 1;
  let depth = 0;
  let i = 0;
  const push = (kind: TokenKind, text: string, at: number): void => {
    tokens.push({ kind, text, line, column: at });
  };
  while (i < source.length) {
    const ch = source.charAt(i);
    if (ch === "\n") {
      const last = tokens[tokens.length - 1];
      if (depth === 0 && last && last.kind !== "newline" && !CONTINUES.has(last.text))
        push("newline", "\n", column);
      i++;
      line++;
      column = 1;
    } else if (ch === " " || ch === "\t" || ch === "\r") {
      i++;
      column++;
    } else if (ch === "#") {
      while (i < source.length && source.charAt(i) !== "\n") i++;
    } else if (ch >= "0" && ch <= "9") {
      let end = i;
      while (end < source.length && source.charAt(end) >= "0" && source.charAt(end) <= "9") end++;
      push("number", source.slice(i, end), column);
      column += end - i;
      i = end;
    } else if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
      let end = i;
      while (end < source.length && /[A-Za-z0-9_]/.test(source.charAt(end))) end++;
      const text = source.slice(i, end);
      push(KEYWORDS.has(text) ? "keyword" : "name", text, column);
      column += end - i;
      i = end;
    } else if (ch === '"') {
      let end = i + 1;
      while (end < source.length && source.charAt(end) !== '"' && source.charAt(end) !== "\n")
        end++;
      if (source.charAt(end) !== '"') {
        errors.push({ line, column, message: 'this text is missing its closing "' });
        push("string", source.slice(i + 1, end), column);
        column += end - i;
        i = end;
      } else {
        push("string", source.slice(i + 1, end), column);
        column += end + 1 - i;
        i = end + 1;
      }
    } else {
      const symbol = SYMBOLS.find((s) => source.startsWith(s, i));
      if (symbol) {
        if (symbol === "(") depth++;
        if (symbol === ")" && depth > 0) depth--;
        push("symbol", symbol, column);
        column += symbol.length;
        i += symbol.length;
      } else {
        errors.push({ line, column, message: `"${ch}" is not something Tactics understands` });
        i++;
        column++;
      }
    }
  }
  if (tokens.length > 0 && tokens[tokens.length - 1]?.kind !== "newline")
    push("newline", "\n", column);
  push("end", "", column);
  return tokens;
}

type Expr =
  | { readonly type: "number"; readonly value: number; readonly at: Token }
  | {
      readonly type: "name";
      readonly name: string;
      readonly args: readonly Expr[] | null;
      readonly at: Token;
    }
  | { readonly type: "unary"; readonly op: "-" | "not"; readonly operand: Expr; readonly at: Token }
  | {
      readonly type: "binary";
      readonly op: string;
      readonly left: Expr;
      readonly right: Expr;
      readonly at: Token;
    };

type Step =
  | { readonly type: "set"; readonly name: string; readonly value: Expr; readonly at: Token }
  | {
      readonly type: "act";
      readonly name: string;
      readonly args: readonly Expr[];
      readonly at: Token;
    };

interface Rule {
  readonly condition: Expr | null;
  readonly label: string;
  readonly steps: readonly Step[];
  readonly at: Token;
}

const BINARY_OPS: Readonly<Record<string, number>> = {
  "+": OP.ADD,
  "-": OP.SUB,
  "*": OP.MUL,
  "/": OP.DIV,
  mod: OP.MOD,
  "<": OP.LT,
  "<=": OP.LE,
  ">": OP.GT,
  ">=": OP.GE,
  "==": OP.EQ,
  "!=": OP.NE,
};

const describe = (token: Token): string =>
  token.kind === "end" || token.kind === "newline" ? "the end of the line" : `"${token.text}"`;

const listOf = (kind: Syscall["kind"]): string =>
  SYSCALLS.filter((c) => c.kind === kind)
    .map((c) => c.name)
    .join(", ");

class Parser {
  private at = 0;
  private readonly tokens: readonly Token[];
  private readonly source: string;

  constructor(tokens: readonly Token[], source: string) {
    this.tokens = tokens;
    this.source = source;
  }

  peek(): Token {
    return this.tokens[this.at] as Token;
  }
  private next(): Token {
    const token = this.peek();
    if (token.kind !== "end") this.at++;
    return token;
  }
  private is(text: string): boolean {
    const token = this.peek();
    return (token.kind === "symbol" || token.kind === "keyword") && token.text === text;
  }
  private take(text: string): boolean {
    if (!this.is(text)) return false;
    this.at++;
    return true;
  }
  private expect(text: string, why: string): Token {
    if (!this.is(text))
      throw new Problem(
        this.peek(),
        `I expected "${text}" ${why}, but found ${describe(this.peek())}`,
      );
    return this.next();
  }
  skipLine(): void {
    while (this.peek().kind !== "newline" && this.peek().kind !== "end") this.at++;
    if (this.peek().kind === "newline") this.at++;
  }
  skipBlankLines(): void {
    while (this.peek().kind === "newline") this.at++;
  }
  private endOfLine(what: string): void {
    const token = this.peek();
    if (token.kind !== "newline" && token.kind !== "end") {
      throw new Problem(token, `${what} should end here, but I found ${describe(token)}`);
    }
    if (token.kind === "newline") this.at++;
  }

  header(): string | null {
    if (!this.is("bot")) return null;
    this.next();
    const name = this.peek();
    if (name.kind !== "string" || name.text.trim() === "") {
      throw new Problem(
        name,
        'after "bot" comes the bot\'s name in quotes, like: bot "Lumberjack"',
      );
    }
    this.next();
    this.endOfLine("the bot line");
    return name.text.trim().slice(0, MAX_BOT_NAME_LENGTH);
  }

  rule(): Rule {
    const start = this.peek();
    let condition: Expr | null = null;
    if (this.take("when")) condition = this.expression();
    else if (!this.take("otherwise")) {
      throw new Problem(
        start,
        `a rule starts with "when" or "otherwise", but this line starts with ${describe(start)}`,
      );
    }
    const conditionEnd = this.peek();
    let label: string | null = null;
    if (this.take("as")) {
      const text = this.peek();
      if (text.kind !== "string" || text.text.trim() === "")
        throw new Problem(text, 'after "as" comes a short label in quotes');
      this.next();
      label = text.text.trim();
    }
    this.expect("->", condition ? "after the condition" : 'after "otherwise"');
    const steps: Step[] = [this.step()];
    while (this.take(";")) steps.push(this.step());
    this.endOfLine("the rule");
    const last = steps[steps.length - 1] as Step;
    if (last.type !== "act")
      throw new Problem(last.at, 'a rule must end with an action, not with "set"');
    if (label === null) {
      // No label written: use the condition as it appears in the source.
      label = condition
        ? this.sourceBetween(start, conditionEnd).replace(/^when\s+/, "")
        : "otherwise";
    }
    if (label.length > MAX_RULE_LABEL_LENGTH)
      label = `${label.slice(0, MAX_RULE_LABEL_LENGTH - 3).trimEnd()}...`;
    return { condition, label, steps, at: start };
  }

  private sourceBetween(from: Token, to: Token): string {
    const lines = this.source.split("\n");
    const offset = (token: Token): number =>
      lines.slice(0, token.line - 1).reduce((sum, line) => sum + line.length + 1, 0) +
      token.column -
      1;
    return this.source.slice(offset(from), offset(to)).replace(/\s+/g, " ").trim();
  }

  private step(): Step {
    const start = this.peek();
    if (this.take("set")) {
      const name = this.peek();
      if (name.kind !== "name")
        throw new Problem(name, 'after "set" comes the name of a memory slot');
      this.next();
      this.expect("=", `after "set ${name.text}"`);
      return { type: "set", name: name.text, value: this.expression(), at: start };
    }
    if (start.kind !== "name")
      throw new Problem(
        start,
        `I expected an action here, but found ${describe(start)}. Actions: ${listOf("action")}`,
      );
    this.next();
    return { type: "act", name: start.text, args: this.take("(") ? this.args() : [], at: start };
  }

  private args(): Expr[] {
    const args: Expr[] = [];
    if (this.take(")")) return args;
    do args.push(this.expression());
    while (this.take(","));
    this.expect(")", "to close the brackets");
    return args;
  }

  private expression(): Expr {
    let left = this.conjunction();
    while (this.is("or"))
      left = { type: "binary", op: "or", at: this.next(), left, right: this.conjunction() };
    return left;
  }
  private conjunction(): Expr {
    let left = this.negation();
    while (this.is("and"))
      left = { type: "binary", op: "and", at: this.next(), left, right: this.negation() };
    return left;
  }
  private negation(): Expr {
    if (this.is("not"))
      return { type: "unary", op: "not", at: this.next(), operand: this.negation() };
    return this.comparison();
  }
  private comparison(): Expr {
    const left = this.sum();
    for (const op of ["<=", ">=", "==", "!=", "<", ">"]) {
      if (this.is(op)) return { type: "binary", op, at: this.next(), left, right: this.sum() };
    }
    if (this.is("=")) throw new Problem(this.peek(), 'to compare two values write "==", not "="');
    return left;
  }
  private sum(): Expr {
    let left = this.product();
    while (this.is("+") || this.is("-")) {
      const at = this.next();
      left = { type: "binary", op: at.text, at, left, right: this.product() };
    }
    return left;
  }
  private product(): Expr {
    let left = this.unary();
    while (this.is("*") || this.is("/") || this.is("mod")) {
      const at = this.next();
      left = { type: "binary", op: at.text, at, left, right: this.unary() };
    }
    return left;
  }
  private unary(): Expr {
    if (this.is("-")) return { type: "unary", op: "-", at: this.next(), operand: this.unary() };
    return this.primary();
  }
  private primary(): Expr {
    const token = this.peek();
    if (token.kind === "number") {
      this.next();
      const value = Number(token.text);
      if (!(value <= 0x7fffffff))
        throw new Problem(token, `${token.text} is too large; numbers go up to 2147483647`);
      // A percent sign after a number is only for reading: 40% is 40.
      this.take("%");
      return { type: "number", value, at: token };
    }
    if (token.kind === "name") {
      this.next();
      return {
        type: "name",
        name: token.text,
        args: this.take("(") ? this.args() : null,
        at: token,
      };
    }
    if (this.take("(")) {
      const inner = this.expression();
      this.expect(")", "to close the brackets");
      return inner;
    }
    throw new Problem(
      token,
      `I expected a number, a name or "(" here, but found ${describe(token)}`,
    );
  }
}

class Generator {
  readonly code: number[] = [];
  private depth = 0;
  private deepest = 0;
  private readonly slots = new Map<string, number>();
  private readonly constants: Constants;

  constructor(constants: Constants, rules: readonly Rule[]) {
    this.constants = constants;
    // Every slot a rule sets exists from the start (holding 0), so a rule may read a slot that a later rule sets.
    for (const rule of rules) {
      for (const step of rule.steps) if (step.type === "set") this.slotFor(step.name, step.at);
    }
  }

  get deepestStack(): number {
    return this.deepest;
  }

  private emit(words: number[], takes: number, gives: number): void {
    this.code.push(...words);
    this.depth += gives - takes;
    this.deepest = Math.max(this.deepest, this.depth);
  }

  private slotFor(name: string, at: Token): number {
    const existing = this.slots.get(name);
    if (existing !== undefined) return existing;
    if (SYSCALLS.some((c) => c.name === name) || Object.hasOwn(this.constants, name)) {
      throw new Problem(
        at,
        `"${name}" already means something, so it cannot be used as a memory slot`,
      );
    }
    if (this.slots.size >= MAX_NAMED_SLOTS)
      throw new Problem(at, `a program can remember at most ${MAX_NAMED_SLOTS} things`);
    this.slots.set(name, this.slots.size);
    return this.slots.size - 1;
  }

  /** Pushes the values of the arguments for a call, expanding a place into its x and y. Returns how many were pushed. */
  private pushArgs(args: readonly Expr[]): number {
    let count = 0;
    for (const arg of args) {
      const place =
        arg.type === "name" && arg.args === null && Object.hasOwn(this.constants, arg.name)
          ? this.constants[arg.name]
          : null;
      if (typeof place === "object" && place !== null) {
        this.emit([OP.PUSH, place.x | 0], 0, 1);
        this.emit([OP.PUSH, place.y | 0], 0, 1);
        count += 2;
      } else {
        this.expression(arg);
        count++;
      }
    }
    return count;
  }

  private call(kind: Syscall["kind"], name: string, args: readonly Expr[], at: Token): void {
    const found = SYSCALLS.find((c) => c.name === name);
    if (!found || found.kind !== kind) {
      const other = found
        ? ` ("${name}" is ${found.kind === "sensor" ? "a sensor: it reads, it does not act" : "an action: it can only come after ->"})`
        : "";
      throw new Problem(
        at,
        `there is no ${kind} called "${name}"${other}. ${kind === "sensor" ? "Sensors" : "Actions"}: ${listOf(kind)}`,
      );
    }
    const before = this.code.length;
    const depthBefore = this.depth;
    const count = this.pushArgs(args);
    if (count !== found.args) {
      this.code.length = before;
      this.depth = depthBefore;
      throw new Problem(
        at,
        `"${name}" takes ${found.args} value${found.args === 1 ? "" : "s"}, but was given ${count}`,
      );
    }
    this.emit(
      [kind === "sensor" ? OP.SENSE : OP.ACT, found.id],
      found.args,
      kind === "sensor" ? 1 : 0,
    );
  }

  expression(expr: Expr): void {
    if (expr.type === "number") {
      this.emit([OP.PUSH, expr.value | 0], 0, 1);
    } else if (expr.type === "unary") {
      if (expr.op === "-" && expr.operand.type === "number") {
        this.emit([OP.PUSH, -expr.operand.value | 0], 0, 1);
      } else {
        this.expression(expr.operand);
        this.emit([expr.op === "-" ? OP.NEG : OP.NOT], 1, 1);
      }
    } else if (expr.type === "binary" && (expr.op === "and" || expr.op === "or")) {
      // Short-circuit: the right side runs only if the left side has not settled the answer.
      this.expression(expr.left);
      const jump = this.code.length;
      this.emit([expr.op === "and" ? OP.JZ : OP.JNZ, 0], 1, 0);
      this.expression(expr.right);
      // Turn whatever the right side left into exactly 0 or 1.
      this.emit([OP.PUSH, 0], 0, 1);
      this.emit([OP.NE], 2, 1);
      this.emit([OP.JMP, 0], 0, 0);
      const settled = this.code.length;
      this.code[jump + 1] = settled;
      // The left side decided: push the answer it implies. Both paths leave one value.
      this.depth--;
      this.emit([OP.PUSH, expr.op === "and" ? 0 : 1], 0, 1);
      this.code[settled - 1] = this.code.length;
    } else if (expr.type === "binary") {
      this.expression(expr.left);
      this.expression(expr.right);
      this.emit([BINARY_OPS[expr.op] as number], 2, 1);
    } else if (expr.args !== null) {
      this.call("sensor", expr.name, expr.args, expr.at);
    } else {
      const constant = Object.hasOwn(this.constants, expr.name)
        ? this.constants[expr.name]
        : undefined;
      const slot = this.slots.get(expr.name);
      if (typeof constant === "number") this.emit([OP.PUSH, constant | 0], 0, 1);
      else if (constant !== undefined) {
        throw new Problem(
          expr.at,
          `"${expr.name}" is a place, so it can only be given to a sensor or an action, like distance(${expr.name})`,
        );
      } else if (slot !== undefined) this.emit([OP.LOAD, slot], 0, 1);
      else if (SYSCALLS.some((c) => c.name === expr.name && c.kind === "sensor"))
        this.call("sensor", expr.name, [], expr.at);
      else {
        throw new Problem(
          expr.at,
          `I do not know what "${expr.name}" is. Sensors: ${listOf("sensor")}. To remember a value of your own, set it first: set ${expr.name} = 0`,
        );
      }
    }
  }

  private steps(steps: readonly Step[], beforeAction: number[] | null): void {
    for (const step of steps) {
      if (step.type === "set") {
        this.expression(step.value);
        this.emit([OP.STORE, this.slotFor(step.name, step.at)], 1, 0);
      } else {
        if (beforeAction) this.emit(beforeAction, 0, 0);
        this.call("action", step.name, step.args, step.at);
      }
    }
  }

  /**
   * One rule. `index` is its position; `sequences` says whether any rule in the
   * program has more than one action, in which case every rule keeps the
   * sequence slot up to date.
   */
  rule(rule: Rule, index: number, sequences: boolean): void {
    this.emit([OP.RULE, index], 0, 0);
    let skip = -1;
    if (rule.condition) {
      this.expression(rule.condition);
      skip = this.code.length;
      this.emit([OP.JZ, 0], 1, 0);
    }
    // Split the steps into stages, one per action; each stage carries the sets written before its action.
    const stages: Step[][] = [[]];
    for (const step of rule.steps) {
      (stages[stages.length - 1] as Step[]).push(step);
      if (step.type === "act") stages.push([]);
    }
    stages.pop();
    const mark = (stage: number): number => (index + 1) * 256 + stage;
    // A rule with several actions does them one per decision, in order, for as
    // long as it keeps being the rule that fires. The sequence slot holds the
    // rule and the stage to do next; any other rule firing starts afresh.
    for (let stage = stages.length - 1; stage >= 1; stage--) {
      this.emit([OP.LOAD, SEQUENCE_SLOT, OP.PUSH, mark(stage), OP.EQ], 0, 1);
      const notThisStage = this.code.length;
      this.emit([OP.JZ, 0], 1, 0);
      const next = stage + 1 < stages.length ? mark(stage + 1) : 0;
      this.steps(stages[stage] as Step[], [OP.PUSH, next, OP.STORE, SEQUENCE_SLOT]);
      this.code[notThisStage + 1] = this.code.length;
    }
    const next = stages.length > 1 ? mark(1) : 0;
    this.steps(stages[0] as Step[], sequences ? [OP.PUSH, next, OP.STORE, SEQUENCE_SLOT] : null);
    if (skip >= 0) this.code[skip + 1] = this.code.length;
  }
}

/**
 * Compiles Tactics source. `constants` are extra names the source may use:
 * numbers, and places (which stand for an x and a y wherever a call takes two
 * values). Never throws.
 */
export function compileTactics(source: unknown, constants: Constants = {}): Compiled {
  const errors: TacticsError[] = [];
  const fail = (): Compiled => ({ ok: false, errors: errors.slice(0, MAX_ERRORS) });
  if (typeof source !== "string") {
    errors.push({ line: 1, column: 1, message: "a program must be text" });
    return fail();
  }
  if (source.length > MAX_SOURCE_LENGTH) {
    errors.push({
      line: 1,
      column: 1,
      message: `a program can be at most ${MAX_SOURCE_LENGTH} characters long`,
    });
    return fail();
  }
  try {
    const tokens = tokenize(source, errors);
    const parser = new Parser(tokens, source);
    const rules: Rule[] = [];
    let name = "Unnamed";
    let sawOtherwise: Token | null = null;

    const attempt = (work: () => void): void => {
      try {
        work();
      } catch (problem) {
        if (!(problem instanceof Problem)) throw problem;
        errors.push(problem.error);
        parser.skipLine();
      }
    };

    parser.skipBlankLines();
    attempt(() => {
      name = parser.header() ?? name;
    });
    for (
      parser.skipBlankLines();
      parser.peek().kind !== "end" && errors.length < MAX_ERRORS;
      parser.skipBlankLines()
    ) {
      attempt(() => {
        const rule = parser.rule();
        if (sawOtherwise)
          throw new Problem(
            rule.at,
            `no rule can come after "otherwise" (line ${sawOtherwise.line}): it would never be reached`,
          );
        if (rule.condition === null) sawOtherwise = rule.at;
        rules.push(rule);
      });
    }
    if (rules.length === 0 && errors.length === 0) {
      errors.push({
        line: 1,
        column: 1,
        message: "a program needs at least one rule, like: otherwise -> idle",
      });
    }
    if (rules.length + 1 > MAX_RULES) {
      errors.push({
        line: (rules[MAX_RULES - 1] as Rule).at.line,
        column: 1,
        message: `a program can have at most ${MAX_RULES - 1} rules`,
      });
    }
    if (errors.length > 0) return fail();

    const sequences = rules.some(
      (rule) => rule.steps.filter((step) => step.type === "act").length > 1,
    );
    let generator: Generator;
    try {
      generator = new Generator(constants, rules);
    } catch (problem) {
      if (!(problem instanceof Problem)) throw problem;
      errors.push(problem.error);
      return fail();
    }
    const labels: string[] = [];
    rules.forEach((rule, index) => {
      try {
        generator.rule(rule, index, sequences);
        labels.push(rule.label);
      } catch (problem) {
        if (!(problem instanceof Problem)) throw problem;
        errors.push(problem.error);
      }
    });
    if (errors.length > 0) return fail();
    if (!sawOtherwise) {
      // Nothing matched: stand still. Without this a program could run off its end.
      labels.push("otherwise");
      generator.code.push(OP.RULE, labels.length - 1);
      if (sequences) generator.code.push(OP.PUSH, 0, OP.STORE, SEQUENCE_SLOT);
      generator.code.push(OP.ACT, (SYSCALLS.find((c) => c.name === "idle") as Syscall).id);
    }
    if (generator.deepestStack > STACK_SIZE) {
      errors.push({
        line: 1,
        column: 1,
        message: "an expression in this program is nested too deeply",
      });
      return fail();
    }
    if (generator.code.length > MAX_CODE_LENGTH) {
      errors.push({
        line: 1,
        column: 1,
        message: `this program is too long: it compiles to ${generator.code.length} words and the limit is ${MAX_CODE_LENGTH}`,
      });
      return fail();
    }
    return {
      ok: true,
      name,
      program: validateProgram({ version: BYTECODE_VERSION, code: generator.code, rules: labels }),
    };
  } catch {
    // Reaching here is a bug in the compiler, but a bad program must still never take anything down.
    errors.push({ line: 1, column: 1, message: "this program could not be compiled" });
    return fail();
  }
}

export class BotError extends Error {
  override name = "BotError";
}

/**
 * Compiles a set of content programs, keyed by file name without its
 * extension. Throws a BotError naming the file, line and column of the first
 * problem: shipped content must compile.
 */
export function compileBots(
  sources: Readonly<Record<string, string>>,
  constants: Constants = {},
): Record<string, Program> {
  const programs: Record<string, Program> = {};
  for (const file of Object.keys(sources).sort()) {
    const compiled = compileTactics(sources[file], constants);
    if (!compiled.ok) {
      const first = compiled.errors[0] as TacticsError;
      throw new BotError(
        `${file}.tac, line ${first.line}, column ${first.column}: ${first.message}`,
      );
    }
    programs[file] = compiled.program;
  }
  return programs;
}
