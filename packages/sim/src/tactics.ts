// Tactics: the language programs are written in. A program is an ordered list
// of rules; on each decision the first rule whose condition holds chooses the
// action. This file turns source text into bytecode for the machine in vm.ts.
// It never throws: whatever it is given, it returns a program or a list of
// errors with line and column.

import { GOODS, goodId } from "./bag.ts";
import { isInt32 } from "./hash.ts";
import { SKILLS } from "./skills.ts";
import { SYSCALLS, type Syscall } from "./syscalls.ts";
import {
  BYTECODE_VERSION,
  countInstructions,
  GAS_PER_DECISION,
  MAX_CODE_LENGTH,
  MAX_RULE_LABEL_LENGTH,
  MAX_RULES,
  MEMORY_SLOTS,
  OP,
  PROGRAM_NAME,
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
/** How deeply brackets, `not` and minus signs may be nested in one expression. */
export const MAX_NESTING = 48;
/** How many numbers, names and operators one rule may hold. */
export const MAX_RULE_SIZE = 600;
/** How many actions one rule may do in sequence. */
export const MAX_ACTIONS_PER_RULE = 32;
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
const COMPARISONS = ["<=", ">=", "==", "!=", "<", ">"];
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

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
  /** True when the whole line had already been read, so the next line must not be skipped. */
  readonly lineDone: boolean;
  constructor(at: { line: number; column: number }, message: string, lineDone = false) {
    this.error = { line: at.line, column: at.column, message };
    this.lineDone = lineDone;
  }
}

const isWord = (token: Token, text: string): boolean =>
  (token.kind === "symbol" || token.kind === "keyword") && token.text === text;

/**
 * Text that will be shown to viewers (a bot's name, a rule's label). Only
 * Latin letters, digits and common punctuation are kept: that is what the
 * stream's typeface can draw, and it leaves no room for invisible, blank or
 * stacked characters. Spaces are collapsed and the text is cut to `limit`.
 */
function shown(text: string, limit: number): string {
  const clean = text
    .normalize("NFC")
    .replace(/[\p{Z}\p{Cc}]+/gu, " ")
    .replace(/[^\p{Script=Latin}\p{Nd} !-~\u00a1-\u00bf\u2018\u2019\u201c\u201d\u2013\u2014]/gu, "")
    .replace(/ +/g, " ")
    .trim();
  if (clean.length <= limit) return clean;
  let out = "";
  for (const character of clean) {
    if (out.length + character.length > limit - 3) break;
    out += character;
  }
  // Shorten at a word boundary where there is one.
  const space = out.lastIndexOf(" ");
  return `${(space > 10 ? out.slice(0, space) : out).trimEnd()}...`;
}

/** A character as it can be named in an error: itself if it can be shown, its code point if not. */
function named(character: string): string {
  const visible = shown(character, 8);
  if (visible !== "") return `"${visible}"`;
  return `the character U+${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
}

function tokenize(text: string, errors: TacticsError[]): Token[] {
  // Every kind of line ending is one line break, and every kind of space is a space.
  const source = text.replace(/\r\n?|[\u0085\u2028\u2029\f\v]/g, "\n").replace(/[^\S\n]/g, " ");
  const tokens: Token[] = [];
  let line = 1;
  let column = 1;
  let depth = 0;
  let i = 0;
  const push = (kind: TokenKind, value: string, at: number): void => {
    tokens.push({ kind, text: value, line, column: at });
  };
  while (i < source.length) {
    const ch = source.charAt(i);
    if (ch === "\n") {
      // A line that starts a new rule always ends the one before it, whatever
      // that one was in the middle of: an unclosed bracket or a dangling
      // operator must not swallow the rest of the program.
      const startsRule = /^ *(when|otherwise|bot)\b/.test(source.slice(i + 1, i + 40));
      if (startsRule) depth = 0;
      const last = tokens[tokens.length - 1];
      const wraps =
        !startsRule &&
        last !== undefined &&
        (last.kind === "symbol" || last.kind === "keyword") &&
        CONTINUES.has(last.text);
      if (depth === 0 && last && last.kind !== "newline" && !wraps) push("newline", "\n", column);
      i++;
      line++;
      column = 1;
    } else if (ch === " " || ch === "\t") {
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
      const word = source.slice(i, end);
      push(KEYWORDS.has(word) ? "keyword" : "name", word, column);
      column += end - i;
      i = end;
    } else if (ch === '"') {
      let end = i + 1;
      while (end < source.length && source.charAt(end) !== '"' && source.charAt(end) !== "\n")
        end++;
      const closed = source.charAt(end) === '"';
      if (!closed) errors.push({ line, column, message: 'this text is missing its closing "' });
      push("string", source.slice(i + 1, end), column);
      const next = closed ? end + 1 : end;
      column += next - i;
      i = next;
    } else {
      const symbol = SYMBOLS.find((s) => source.startsWith(s, i));
      if (symbol) {
        if (symbol === "(") depth++;
        if (symbol === ")" && depth > 0) depth--;
        push("symbol", symbol, column);
        column += symbol.length;
        i += symbol.length;
      } else {
        const character = String.fromCodePoint(source.codePointAt(i) ?? 0);
        errors.push({
          line,
          column,
          message: `${named(character)} is not something Tactics understands`,
        });
        i += character.length;
        column += character.length;
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
  token.kind === "end" || token.kind === "newline"
    ? "the end of the line"
    : `"${shown(token.text, 24)}"`;

const listOf = (kind: Syscall["kind"]): string =>
  SYSCALLS.filter((c) => c.kind === kind)
    .map((c) => c.name)
    .join(", ");

class Parser {
  private at = 0;
  private nesting = 0;
  private size = 0;
  private readonly tokens: readonly Token[];

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
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
    return isWord(this.peek(), text);
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

  /** Counts one more piece of the current rule; a rule that is too big is refused where it becomes so. */
  private grow(at: Token): void {
    if (++this.size > MAX_RULE_SIZE) {
      throw new Problem(
        at,
        `this rule is too long; a rule can hold at most ${MAX_RULE_SIZE} numbers, names and operators`,
      );
    }
  }
  /** Runs `inner` one level deeper; refuses nesting the compiler could not follow. */
  private nested<T>(at: Token, inner: () => T): T {
    if (++this.nesting > MAX_NESTING) {
      throw new Problem(
        at,
        `this is nested too deeply; brackets, "not" and minus signs can go ${MAX_NESTING} deep`,
      );
    }
    try {
      return inner();
    } finally {
      this.nesting--;
    }
  }

  header(): string | null {
    if (!this.is("bot")) return null;
    this.next();
    const name = this.peek();
    const text = name.kind === "string" ? shown(name.text, MAX_BOT_NAME_LENGTH) : "";
    if (text === "")
      throw new Problem(
        name,
        'after "bot" comes the bot\'s name in quotes, like: bot "Lumberjack"',
      );
    this.next();
    this.endOfLine("the bot line");
    return text;
  }

  rule(): Rule {
    this.nesting = 0;
    this.size = 0;
    const start = this.peek();
    const first = this.at;
    let condition: Expr | null = null;
    if (this.take("when")) condition = this.expression();
    else if (!this.take("otherwise")) {
      throw new Problem(
        start,
        `a rule starts with "when" or "otherwise", but this line starts with ${describe(start)}`,
      );
    }
    const conditionEnd = this.at;
    let label = "";
    if (this.take("as")) {
      const text = this.peek();
      label = text.kind === "string" ? shown(text.text, MAX_RULE_LABEL_LENGTH) : "";
      if (label === "") throw new Problem(text, 'after "as" comes a short label in quotes');
      this.next();
    }
    this.expect("->", condition ? "after the condition" : 'after "otherwise"');
    const steps: Step[] = [this.step()];
    while (this.take(";")) steps.push(this.step());
    this.endOfLine("the rule");
    // From here on the whole line has been read, so an error must not skip the next one.
    const last = steps[steps.length - 1] as Step;
    if (last.type !== "act")
      throw new Problem(last.at, 'a rule must end with an action, not with "set"', true);
    const actions = steps.filter((step) => step.type === "act");
    if (actions.length > MAX_ACTIONS_PER_RULE) {
      const extra = actions[MAX_ACTIONS_PER_RULE] as Step;
      throw new Problem(
        extra.at,
        `a rule can do at most ${MAX_ACTIONS_PER_RULE} actions in sequence`,
        true,
      );
    }
    // No label written: show the condition as it was written.
    if (label === "") {
      label = condition
        ? shown(this.written(first + 1, conditionEnd), MAX_RULE_LABEL_LENGTH)
        : "otherwise";
    }
    return { condition, label, steps, at: start };
  }

  /** The tokens from `from` up to `to` as tidy text: comments gone, one space between words. */
  private written(from: number, to: number): string {
    let text = "";
    for (let i = from; i < to; i++) {
      const token = this.tokens[i] as Token;
      const before = i > from ? (this.tokens[i - 1] as Token) : null;
      const word = token.kind === "string" ? `"${token.text}"` : token.text;
      const tight =
        before === null ||
        isWord(before, "(") ||
        isWord(token, ")") ||
        isWord(token, ",") ||
        (isWord(token, "(") && before.kind === "name");
      text += tight ? word : ` ${word}`;
    }
    return text;
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
    if (start.kind !== "name") {
      throw new Problem(
        start,
        `I expected an action here, but found ${describe(start)}. Actions: ${listOf("action")}`,
      );
    }
    this.next();
    this.grow(start);
    const args = this.is("(") ? this.nested(this.next(), () => this.args()) : [];
    return { type: "act", name: start.text, args, at: start };
  }

  private args(): Expr[] {
    const args: Expr[] = [];
    if (this.take(")")) return args;
    do args.push(this.expression());
    while (this.take(","));
    this.expect(")", "to close the brackets");
    return args;
  }

  private binary(op: Token, left: Expr, right: Expr): Expr {
    this.grow(op);
    return { type: "binary", op: op.text, at: op, left, right };
  }

  private expression(): Expr {
    let left = this.conjunction();
    while (this.is("or")) {
      const op = this.next();
      left = this.binary(op, left, this.conjunction());
    }
    return left;
  }
  private conjunction(): Expr {
    let left = this.negation();
    while (this.is("and")) {
      const op = this.next();
      left = this.binary(op, left, this.negation());
    }
    return left;
  }
  private negation(): Expr {
    if (!this.is("not")) return this.comparison();
    const at = this.next();
    this.grow(at);
    return this.nested(at, () => ({ type: "unary", op: "not", at, operand: this.negation() }));
  }
  private comparison(): Expr {
    const left = this.sum();
    const op = this.peek();
    if (isWord(op, "=")) throw new Problem(op, 'to compare two values write "==", not "="');
    if (!COMPARISONS.some((symbol) => isWord(op, symbol))) return left;
    this.next();
    const result = this.binary(op, left, this.sum());
    if (COMPARISONS.some((symbol) => this.is(symbol))) {
      throw new Problem(
        this.peek(),
        'comparisons cannot be chained; join two of them with "and", like: a < b and b < c',
      );
    }
    return result;
  }
  private sum(): Expr {
    let left = this.product();
    while (this.is("+") || this.is("-")) {
      const op = this.next();
      left = this.binary(op, left, this.product());
    }
    return left;
  }
  private product(): Expr {
    let left = this.unary();
    while (this.is("*") || this.is("/") || this.is("mod")) {
      const op = this.next();
      left = this.binary(op, left, this.unary());
    }
    if (this.is("%"))
      throw new Problem(this.peek(), 'for a remainder write "mod", not "%", like: hour mod 2');
    return left;
  }
  private unary(): Expr {
    if (!this.is("-")) return this.primary();
    const at = this.next();
    this.grow(at);
    return this.nested(at, () => ({ type: "unary", op: "-", at, operand: this.unary() }));
  }
  private primary(): Expr {
    const token = this.peek();
    if (token.kind === "number") {
      this.next();
      this.grow(token);
      const value = Number(token.text);
      if (!(value <= 0x7fffffff)) {
        throw new Problem(
          token,
          `${shown(token.text, 24)} is too large; numbers go up to 2147483647`,
        );
      }
      // A percent sign after a number is only for reading: 40% is 40.
      if (this.take("%")) {
        const after = this.peek();
        if (after.kind === "number" || after.kind === "name" || isWord(after, "(")) {
          throw new Problem(
            after,
            `"%" after a number only marks a percentage; for a remainder write "mod", like: ${token.text} mod ${shown(after.text, 12)}`,
          );
        }
      }
      return { type: "number", value, at: token };
    }
    if (token.kind === "name") {
      this.next();
      this.grow(token);
      const args = this.is("(") ? this.nested(this.next(), () => this.args()) : null;
      return { type: "name", name: token.text, args, at: token };
    }
    if (this.is("(")) {
      const at = this.next();
      return this.nested(at, () => {
        const inner = this.expression();
        this.expect(")", "to close the brackets");
        return inner;
      });
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

  /** Problems with slot names are added to `errors`; generation can still go on to find more. */
  constructor(constants: Constants, rules: readonly Rule[], errors: TacticsError[]) {
    this.constants = constants;
    // Every slot a rule sets exists from the start (holding 0), so a rule may read a slot that a later rule sets.
    for (const rule of rules) {
      for (const step of rule.steps) {
        if (step.type !== "set") continue;
        try {
          this.slotFor(step.name, step.at);
        } catch (problem) {
          if (!(problem instanceof Problem)) throw problem;
          errors.push(problem.error);
        }
      }
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

  private constant(name: string): number | { readonly x: number; readonly y: number } | undefined {
    return Object.hasOwn(this.constants, name) ? this.constants[name] : undefined;
  }

  private slotFor(name: string, at: Token): number {
    const existing = this.slots.get(name);
    if (existing !== undefined) return existing;
    if (SYSCALLS.some((c) => c.name === name) || this.constant(name) !== undefined) {
      throw new Problem(
        at,
        `"${name}" already means something, so it cannot be used as a memory slot`,
      );
    }
    if (this.slots.size >= MAX_NAMED_SLOTS) {
      throw new Problem(at, `a program can remember at most ${MAX_NAMED_SLOTS} things`);
    }
    this.slots.set(name, this.slots.size);
    return this.slots.size - 1;
  }

  /** Pushes the arguments of a call, a place counting as its x and its y. Returns how many values and how many places. */
  private pushArgs(args: readonly Expr[]): { count: number; places: number } {
    let count = 0;
    let places = 0;
    for (const arg of args) {
      const place = arg.type === "name" && arg.args === null ? this.constant(arg.name) : undefined;
      if (typeof place === "object") {
        this.emit([OP.PUSH, place.x | 0], 0, 1);
        this.emit([OP.PUSH, place.y | 0], 0, 1);
        count += 2;
        places++;
      } else {
        this.expression(arg);
        count++;
      }
    }
    return { count, places };
  }

  private call(kind: Syscall["kind"], name: string, args: readonly Expr[], at: Token): void {
    const found = SYSCALLS.find((c) => c.name === name);
    if (!found || found.kind !== kind) {
      const what =
        found?.kind === "sensor"
          ? "a sensor: it reads, it does not act"
          : "an action: it can only come after ->";
      const other = found ? ` ("${name}" is ${what})` : "";
      const list = `${kind === "sensor" ? "Sensors" : "Actions"}: ${listOf(kind)}`;
      throw new Problem(at, `there is no ${kind} called "${name}"${other}. ${list}`);
    }
    const before = this.code.length;
    const depthBefore = this.depth;
    const { count, places } = this.pushArgs(args);
    if (count !== found.args) {
      this.code.length = before;
      this.depth = depthBefore;
      const why = places > 0 ? " (a place counts as two: its x and its y)" : "";
      const wants = `${found.args} value${found.args === 1 ? "" : "s"}`;
      throw new Problem(at, `"${name}" takes ${wants}, but was given ${count}${why}`);
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
      const constant = this.constant(expr.name);
      const slot = this.slots.get(expr.name);
      const call = SYSCALLS.find((c) => c.name === expr.name);
      if (typeof constant === "number") this.emit([OP.PUSH, constant | 0], 0, 1);
      else if (constant !== undefined) {
        const how = `it can only be given to a sensor or an action, like distance(${expr.name})`;
        throw new Problem(expr.at, `"${expr.name}" is a place, so ${how}`);
      } else if (slot !== undefined) this.emit([OP.LOAD, slot], 0, 1);
      else if (call?.kind === "sensor") this.call("sensor", expr.name, [], expr.at);
      else if (call) {
        throw new Problem(
          expr.at,
          `"${expr.name}" is an action: it can only come after ->, not in a condition or a value`,
        );
      } else {
        const hint = `To remember a value of your own, set it first: set ${expr.name} = 0`;
        throw new Problem(
          expr.at,
          `I do not know what "${expr.name}" is. Sensors: ${listOf("sensor")}. ${hint}`,
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
    this.depth = 0;
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
    // A rule with several actions does them one per decision, in order, for as
    // long as it keeps being the rule that fires. The sequence slot holds the
    // rule and the stage to do next; any other rule firing starts afresh. A rule
    // has at most MAX_ACTIONS_PER_RULE stages, so two rules' marks never meet.
    const mark = (stage: number): number => (index + 1) * 256 + stage;
    for (let stage = stages.length - 1; stage >= 1; stage--) {
      this.emit([OP.LOAD, SEQUENCE_SLOT], 0, 1);
      this.emit([OP.PUSH, mark(stage)], 0, 1);
      this.emit([OP.EQ], 2, 1);
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
 * Names every program knows: each skill stands for its position in SKILLS,
 * for `level` and `xp`, and each good for its id, for the bag and bank calls.
 */
const BUILT_IN: Constants = Object.freeze(
  Object.fromEntries([
    ...SKILLS.map((skill, index) => [skill, index] as const),
    ...GOODS.map((good) => [good, goodId(good)] as const),
  ]),
);

/** Says what is wrong with the constants a caller passed, or returns null if they are usable. */
function constantsProblem(constants: Constants): string | null {
  for (const name of Object.keys(constants)) {
    const value = constants[name];
    if (!IDENTIFIER.test(name) || KEYWORDS.has(name)) {
      return `"${shown(name, 24)}" cannot be used as a name in a program`;
    }
    if (SYSCALLS.some((c) => c.name === name)) {
      return `"${name}" is already a sensor or an action, so nothing else can have that name`;
    }
    if (Object.hasOwn(BUILT_IN, name)) {
      return `"${name}" is already a skill or a good, so nothing else can have that name`;
    }
    const numbers = typeof value === "number" ? [value] : [value?.x, value?.y];
    if (!numbers.every(isInt32))
      return `"${name}" must be a whole number, or a place with whole-number x and y`;
  }
  return null;
}

/**
 * Compiles Tactics source. `constants` are extra names the source may use:
 * numbers, and places (which stand for an x and a y wherever a call takes two
 * values). Never throws.
 */
export function compileTactics(source: unknown, constants: Constants = {}): Compiled {
  const errors: TacticsError[] = [];
  const fail = (): Compiled => {
    errors.sort((a, b) => a.line - b.line || a.column - b.column);
    // The same mistake can be met twice on the way through; it is reported once.
    const seen = new Set<string>();
    const unique = errors.filter((e) => {
      const key = `${e.line}:${e.column}:${e.message}`;
      return !seen.has(key) && seen.add(key) !== undefined;
    });
    return { ok: false, errors: unique.slice(0, MAX_ERRORS) };
  };
  const refuse = (
    message: string,
    at: { line: number; column: number } = { line: 1, column: 1 },
  ): Compiled => {
    errors.push({ line: at.line, column: at.column, message });
    return fail();
  };
  if (typeof source !== "string") return refuse("a program must be text");
  if (source.length > MAX_SOURCE_LENGTH) {
    return refuse(`a program can be at most ${MAX_SOURCE_LENGTH} characters long`);
  }
  try {
    const unusable = constantsProblem(constants);
    if (unusable !== null) return refuse(unusable);

    const tokens = tokenize(source, errors);
    const parser = new Parser(tokens);
    const rules: Rule[] = [];
    let name = "Unnamed";
    let sawOtherwise: Token | null = null;

    // Mistakes found while reading rules. Counted apart from the tokenizer's, so
    // that a line full of stray characters cannot stop the other lines being read.
    let mistakes = 0;
    const attempt = (work: () => void): void => {
      try {
        work();
      } catch (problem) {
        if (!(problem instanceof Problem)) throw problem;
        mistakes++;
        errors.push(problem.error);
        if (!problem.lineDone) parser.skipLine();
      }
    };

    parser.skipBlankLines();
    attempt(() => {
      name = parser.header() ?? name;
    });
    for (
      parser.skipBlankLines();
      parser.peek().kind !== "end" && rules.length + mistakes < MAX_RULES * 4;
      parser.skipBlankLines()
    ) {
      attempt(() => {
        const rule = parser.rule();
        if (sawOtherwise) {
          const where = `(line ${sawOtherwise.line})`;
          throw new Problem(
            rule.at,
            `no rule can come after "otherwise" ${where}: it would never be reached`,
            true,
          );
        }
        if (rule.condition === null) sawOtherwise = rule.at;
        rules.push(rule);
      });
    }
    if (rules.length === 0 && errors.length === 0) {
      return refuse("a program needs at least one rule, like: otherwise -> idle");
    }
    if (rules.length + 1 > MAX_RULES) {
      return refuse(
        `a program can have at most ${MAX_RULES - 1} rules`,
        (rules[MAX_RULES - 1] as Rule).at,
      );
    }

    // Rules that parsed are still checked when others did not, so one run reports every mistake it can.
    const sequences = rules.some(
      (rule) => rule.steps.filter((step) => step.type === "act").length > 1,
    );
    const generator = new Generator({ ...BUILT_IN, ...constants }, rules, errors);
    const labels: string[] = [];
    // The first rule at which each limit is passed, so the error can point at it.
    let tooLong: Rule | null = null;
    let tooDeep: Rule | null = null;
    let tooManySteps: Rule | null = null;
    let steps = 0;
    rules.forEach((rule, index) => {
      const before = generator.code.length;
      try {
        generator.rule(rule, index, sequences);
        labels.push(rule.label);
      } catch (problem) {
        if (!(problem instanceof Problem)) throw problem;
        errors.push(problem.error);
      }
      steps += countInstructions(generator.code.slice(before));
      if (tooLong === null && generator.code.length > MAX_CODE_LENGTH) tooLong = rule;
      if (tooDeep === null && generator.deepestStack > STACK_SIZE) tooDeep = rule;
      if (tooManySteps === null && steps > GAS_PER_DECISION) tooManySteps = rule;
    });
    if (errors.length > 0) return fail();
    if (!sawOtherwise) {
      // Nothing matched: stand still. Without this a program could run off its end.
      labels.push("otherwise");
      generator.code.push(OP.RULE, labels.length - 1);
      if (sequences) generator.code.push(OP.PUSH, 0, OP.STORE, SEQUENCE_SLOT);
      generator.code.push(OP.ACT, (SYSCALLS.find((c) => c.name === "idle") as Syscall).id);
    }
    const lastRule = rules[rules.length - 1] as Rule;
    if (generator.code.length > MAX_CODE_LENGTH) {
      const size = `it compiles to ${generator.code.length} words and the limit is ${MAX_CODE_LENGTH}`;
      return refuse(`this program is too long: ${size}`, (tooLong ?? lastRule).at);
    }
    if (generator.deepestStack > STACK_SIZE) {
      return refuse(
        "an expression in this rule needs more room than the machine has",
        (tooDeep ?? lastRule).at,
      );
    }
    // Every jump the compiler writes goes forward, so a decision runs each
    // instruction at most once. A program with no more instructions than the
    // budget can therefore never run out of it.
    const instructions = countInstructions(generator.code);
    if (instructions > GAS_PER_DECISION) {
      const size = `it has ${instructions} steps and a decision may take ${GAS_PER_DECISION}`;
      return refuse(
        `this program is too long to finish a decision: ${size}`,
        (tooManySteps ?? lastRule).at,
      );
    }
    const program = validateProgram({
      version: BYTECODE_VERSION,
      code: generator.code,
      rules: labels,
    });
    return { ok: true, name, program };
  } catch {
    // Reaching here is a bug in the compiler, but a bad program must still never take anything down.
    return refuse("this program could not be compiled");
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
  // A constant no program could use is the map's mistake, not any one program's.
  const unusable = constantsProblem(constants);
  if (unusable !== null)
    throw new BotError(`the names given to programs are not usable: ${unusable}`);
  const programs: Record<string, Program> = {};
  for (const file of Object.keys(sources).sort()) {
    if (!PROGRAM_NAME.test(file)) {
      const rule =
        "a program file's name must be a lower-case letter followed by letters, digits or underscores";
      throw new BotError(`${shown(file, 40)}.tac: ${rule}`);
    }
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
