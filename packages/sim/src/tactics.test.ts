import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { regionAt } from "./atlas.ts";
import { place, placeConstants } from "./map.ts";
import { createRng, nextInt } from "./rng.ts";
import { SYSCALLS } from "./syscalls.ts";
import { BotError, type Compiled, type Constants, compileBots, compileTactics } from "./tactics.ts";
import { botSources, firstLight, shippedWorld } from "./testing.ts";
import {
  type Decision,
  MAX_CODE_LENGTH,
  MEMORY_SLOTS,
  OP,
  type Program,
  runDecision,
} from "./vm.ts";
import { clock, createWorld, spawnsNearCamp, step, TICKS_PER_DAY } from "./world.ts";

const id = (name: string): number => SYSCALLS.find((c) => c.name === name)?.id as number;
const PLACES: Constants = { camp: { x: 14, y: 9 }, bank: { x: 15, y: 9 }, far: 20 };

const compiled = (source: string, constants: Constants = PLACES): Program => {
  const result = compileTactics(source, constants);
  if (!result.ok)
    throw new Error(result.errors.map((e) => `${e.line}:${e.column} ${e.message}`).join("; "));
  return result.program;
};

const errorsOf = (source: unknown, constants: Constants = PLACES): string[] => {
  const result = compileTactics(source, constants);
  if (result.ok) throw new Error("expected errors");
  return result.errors.map((e) => `${e.line}:${e.column} ${e.message}`);
};

/** Runs one decision with fixed sensor answers; unlisted sensors answer 0. */
const decide = (
  program: Program,
  sensors: Record<string, number> = {},
  memory = new Array<number>(MEMORY_SLOTS).fill(0),
): Decision => runDecision(program, memory, (call) => sensors[SYSCALLS[call]?.name ?? ""] ?? 0);

const action = (decision: Decision): string => {
  if (!decision.action) return `fault ${decision.fault}`;
  return `${SYSCALLS[decision.action.id]?.name}(${decision.action.args.join(", ")})`;
};

describe("compiling", () => {
  it("compiles a small program to exactly this bytecode", () => {
    const program = compiled('bot "Tiny"\nwhen hour >= 20 -> walk_to(camp)\notherwise -> wander\n');
    expect(program.rules).toEqual(["hour >= 20", "otherwise"]);
    expect([...program.code]).toEqual([
      OP.RULE,
      0,
      OP.SENSE,
      id("hour"),
      OP.PUSH,
      20,
      OP.GE,
      OP.JZ,
      15,
      OP.PUSH,
      14,
      OP.PUSH,
      9,
      OP.ACT,
      id("walk_to"),
      OP.RULE,
      1,
      OP.ACT,
      id("wander"),
    ]);
  });

  it("reports the bot's name, and a default when none is written", () => {
    expect(
      (compileTactics('bot "Lumberjack"\notherwise -> idle') as Extract<Compiled, { ok: true }>)
        .name,
    ).toBe("Lumberjack");
    expect((compileTactics("otherwise -> idle") as Extract<Compiled, { ok: true }>).name).toBe(
      "Unnamed",
    );
  });

  it("the first rule whose condition holds chooses the action", () => {
    const program = compiled(`
      when hour < 6 -> wait(50)
      when hour < 12 -> walk_to(bank)
      when hour < 12 -> wander          # never reached while the rule above holds
      otherwise -> idle
    `);
    expect([3, 8, 15].map((hour) => action(decide(program, { hour })))).toEqual([
      "wait(50)",
      "walk_to(15, 9)",
      "idle()",
    ]);
    expect([3, 8, 15].map((hour) => decide(program, { hour }).rule)).toEqual([0, 1, 3]);
  });

  it("a rule that always holds hides every rule after it", () => {
    const program = compiled("when 1 -> wait(10)\nwhen hour == 3 -> wander\n");
    for (let hour = 0; hour < 24; hour++)
      expect(action(decide(program, { hour }))).toBe("wait(10)");
  });

  it("stands still when no rule matches and there is no otherwise", () => {
    const program = compiled("when hour == 3 -> wander\n");
    expect(program.rules).toEqual(["hour == 3", "otherwise"]);
    expect(action(decide(program, { hour: 4 }))).toBe("idle()");
    expect(decide(program, { hour: 4 }).rule).toBe(1);
  });

  it("does arithmetic and comparison with the usual precedence", () => {
    const value = (expression: string, sensors: Record<string, number> = {}): number =>
      decide(compiled(`otherwise -> wait(${expression})`), sensors).action?.args[0] as number;
    expect(value("2 + 3 * 4")).toBe(14);
    expect(value("(2 + 3) * 4")).toBe(20);
    expect(value("20 - 4 - 3")).toBe(13);
    expect(value("17 / 5")).toBe(3);
    expect(value("17 mod 5")).toBe(2);
    expect(value("-7 + 2")).toBe(-5);
    expect(value("-(3 + 4)")).toBe(-7);
    expect(value("- -5")).toBe(5);
    expect(value("3 < 4")).toBe(1);
    expect(value("3 + 1 >= 4")).toBe(1);
    expect(value("not 5")).toBe(0);
    expect(value("not 0")).toBe(1);
    expect(value("40%")).toBe(40);
    expect(value("far + 1")).toBe(21);
    expect(value("hour * 2", { hour: 9 })).toBe(18);
    expect(value("distance(camp)", { distance: 6 })).toBe(6);
    expect(value("2147483647")).toBe(2147483647);
  });

  it("and/or give 1 or 0, bind as expected, and do not evaluate what they do not need", () => {
    const truth = (expression: string): string =>
      action(decide(compiled(`when ${expression} -> wander\notherwise -> idle`), { hour: 5 }));
    expect(truth("1 and 1")).toBe("wander()");
    expect(truth("1 and 0")).toBe("idle()");
    expect(truth("0 or 7")).toBe("wander()");
    expect(truth("0 or 0")).toBe("idle()");
    expect(truth("1 or 0 and 0")).toBe("wander()");
    expect(truth("(1 or 0) and 0")).toBe("idle()");
    expect(truth("not 0 and hour == 5")).toBe("wander()");
    expect(truth("not (hour == 5 or hour == 6)")).toBe("idle()");
    // The right side would divide by zero; the left side settles it first.
    expect(truth("0 and 1 / 0")).toBe("idle()");
    expect(truth("1 or 1 / 0")).toBe("wander()");
    expect(truth("1 and 1 / 0")).toBe("fault divide_by_zero");
    const value = decide(compiled("otherwise -> wait((7 and 9) + (0 or 3) * 10)")).action?.args[0];
    expect(value).toBe(11);
  });

  it("remembers values in named slots between decisions", () => {
    const program = compiled(`
      when trips >= 2 -> wait(100)
      otherwise -> set trips = trips + 1; wander
    `);
    const memory = new Array<number>(MEMORY_SLOTS).fill(0);
    expect([1, 2, 3].map(() => action(decide(program, {}, memory)))).toEqual([
      "wander()",
      "wander()",
      "wait(100)",
    ]);
    expect(memory[0]).toBe(2);
  });

  it("does a sequence of actions one per decision, and starts again if another rule cuts in", () => {
    const program = compiled(`
      when hour == 0 -> wait(99)
      otherwise -> walk_to(bank); wait(30); wander
    `);
    const memory = new Array<number>(MEMORY_SLOTS).fill(0);
    const next = (hour: number): string => action(decide(program, { hour }, memory));
    expect([next(5), next(5), next(5), next(5), next(5)]).toEqual([
      "walk_to(15, 9)",
      "wait(30)",
      "wander()",
      "walk_to(15, 9)",
      "wait(30)",
    ]);
    // Midnight cuts in; afterwards the sequence starts from its first action.
    expect([next(0), next(5), next(5)]).toEqual(["wait(99)", "walk_to(15, 9)", "wait(30)"]);
  });

  it("lets two rules each run their own sequence", () => {
    const program = compiled(`
      when hour < 12 -> wait(11); wait(12)
      otherwise -> wait(21); wait(22); wait(23)
    `);
    const memory = new Array<number>(MEMORY_SLOTS).fill(0);
    const next = (hour: number): string => action(decide(program, { hour }, memory));
    expect([
      next(1),
      next(1),
      next(1),
      next(20),
      next(20),
      next(1),
      next(20),
      next(20),
      next(20),
      next(20),
    ]).toEqual([
      "wait(11)",
      "wait(12)",
      "wait(11)",
      "wait(21)",
      "wait(22)",
      "wait(11)",
      "wait(21)",
      "wait(22)",
      "wait(23)",
      "wait(21)",
    ]);
  });

  it("labels rules with what was written, or with the condition", () => {
    const program = compiled(`
      when hour >= 20 as "night falls" -> walk_to(camp)
      when   distance( camp )   >   5 -> wander
      when hour == 1 or hour == 2 or hour == 3 or hour == 4 or hour == 5 -> idle
      otherwise -> idle
    `);
    expect(program.rules).toEqual([
      "night falls",
      "distance(camp) > 5",
      "hour == 1 or hour == 2 or hour == 3...",
      "otherwise",
    ]);
  });

  it("lets a long rule wrap after -> ; , or an operator, and ignores comments and blank lines", () => {
    const program = compiled(`# a comment
      bot "Wrapped"   # trailing comment

      when hour >= 20 and
           distance(camp) > 0 ->
        walk_to(
          camp
        );
        wait(40)
    `);
    expect(program.rules).toEqual(["hour >= 20 and distance(camp) > 0", "otherwise"]);
    expect(action(decide(program, { hour: 22, distance: 3 }))).toBe("walk_to(14, 9)");
  });
});

describe("errors", () => {
  it("says what is wrong, where, in words a newcomer can act on", () => {
    const cases: [string, RegExp][] = [
      ["when hour > 5 wander", /^1:15 I expected "->" after the condition, but found "wander"/],
      ["otherwise wander", /^1:11 I expected "->" after "otherwise"/],
      ["hour > 5 -> wander", /^1:1 a rule starts with "when" or "otherwise"/],
      [
        "when mana < 40 -> wander",
        /^1:6 I do not know what "mana" is\. Sensors: self_x, .* set mana = 0/,
      ],
      [
        "otherwise -> dance",
        /^1:14 there is no action called "dance"\. Actions: idle, wait, walk_to, wander/,
      ],
      ["otherwise -> hour", /"hour" is a sensor: it reads, it does not act/],
      ["when wander -> idle", /^1:6 "wander" is an action: it can only come after ->/],
      ["otherwise -> wait(camp)", /was given 2 \(a place counts as two: its x and its y\)/],
      ["when hour % 2 == 0 -> idle", /^1:11 for a remainder write "mod", not "%"/],
      [
        "otherwise -> wait(10 % 3)",
        /"%" after a number only marks a percentage; for a remainder write "mod", like: 10 mod 3/,
      ],
      [
        "when 1 < 2 < 3 -> idle",
        /^1:12 comparisons cannot be chained; join two of them with "and"/,
      ],
      ['when hour > 1 as "\u200B" -> idle', /after "as" comes a short label in quotes/],
      ['bot "\u202E"\notherwise -> idle', /after "bot" comes the bot's name in quotes/],
      ["when idle() -> idle", /there is no sensor called "idle" \("idle" is an action/],
      ["otherwise -> walk_to(3)", /^1:14 "walk_to" takes 2 values, but was given 1/],
      ["otherwise -> wait(camp)", /"wait" takes 1 value, but was given 2/],
      [
        "otherwise -> wait(camp + 1)",
        /"camp" is a place, so it can only be given to a sensor or an action/,
      ],
      ["when hour = 5 -> idle", /^1:11 to compare two values write "==", not "="/],
      ["otherwise -> set x = 1", /a rule must end with an action, not with "set"/],
      ["otherwise -> set hour = 1; idle", /"hour" already means something/],
      ["otherwise -> set camp = 1; idle", /"camp" already means something/],
      [
        "otherwise -> idle\nwhen hour == 1 -> idle",
        /^2:1 no rule can come after "otherwise" \(line 1\)/,
      ],
      ["otherwise -> wait(99999999999)", /99999999999 is too large/],
      ["otherwise -> wait(2 +)", /I expected a number, a name or "\(" here, but found "\)"/],
      ["otherwise -> wait((2)", /I expected "\)" to close the brackets/],
      ["otherwise -> idle idle", /the rule should end here, but I found "idle"/],
      ["otherwise -> idle @", /"@" is not something Tactics understands/],
      ["bot Lumberjack\notherwise -> idle", /after "bot" comes the bot's name in quotes/],
      ['bot "Unclosed\notherwise -> idle', /missing its closing "/],
      ["when hour > 1 as night -> idle", /after "as" comes a short label in quotes/],
      ["", /a program needs at least one rule/],
      ["# only a comment\n\n", /a program needs at least one rule/],
    ];
    for (const [source, message] of cases) {
      const errors = errorsOf(source);
      expect(
        errors.some((e) => message.test(e)),
        `${JSON.stringify(source)} gave ${JSON.stringify(errors)}`,
      ).toBe(true);
    }
  });

  it("one mistake never hides the next line's", () => {
    const lines = (source: string): string[] =>
      errorsOf(source).map((e) => e.split(" ")[0] as string);
    // An error found after the whole line was read must not swallow the next line.
    expect(lines("when 1 -> set x = 1\nwhen bogus -> idle\nwhen 1 -> nope")).toEqual([
      "1:11",
      "2:6",
      "3:11",
    ]);
    expect(lines("otherwise -> idle\nwhen 1 -> idle\nwhen bogus -> idle")).toEqual(["2:1", "3:1"]);
    // A bad slot name is one error among the others.
    expect(lines("when 1 -> set hour = 1; idle\nwhen zork -> idle")).toEqual(["1:11", "2:6"]);
    // An unclosed bracket ends at the next rule.
    expect(lines("when distance(camp > 3 -> idle\nwhen foo -> idle\nwhen 1 -> idle")).toEqual([
      "1:24",
      "2:6",
    ]);
    // Nor does a line that stops in the middle of something: after "(", ",", "->", ";" or an operator.
    for (const broken of [
      "when distance(",
      "when hour > 3 and",
      "when hour > 3 ->",
      "otherwise -> walk_to(camp,",
      "when 1 -> idle;",
      "when 1 -",
    ]) {
      const found = lines(`${broken}\nwhen zork -> idle\nwhen 1 -> nope`);
      expect(found, broken).toContain("2:6");
      expect(found, broken).toContain("3:11");
      expect(found[0], broken).toMatch(/^1:/);
    }
    // A line of stray characters does not stop the other lines being read.
    expect(lines(`when zork -> idle\notherwise -> idle ${"@".repeat(12)}`)[0]).toBe("1:6");
    // Size errors point at the rule that went over, not at the last rule.
    const deep = `when ${"1 < 1 + 1 * (".repeat(30)}1${")".repeat(30)} -> idle\n${"when 1 -> idle\n".repeat(5)}`;
    expect(errorsOf(deep)[0]).toMatch(/^1:1 an expression in this rule needs more room/);
    const long = `${`when ${Array.from({ length: 290 }, () => "hour").join(" + ")} > 0 -> idle\n`.repeat(4)}${"when hour -> idle\n".repeat(10)}`;
    expect(errorsOf(long)[0]).toMatch(/^4:1 this program is too long to finish a decision/);
    // Text in quotes is never a reason to join two lines.
    expect(
      compiled('bot "or"\nwhen hour > 1 as "and" -> idle\notherwise as "->" -> wander').rules,
    ).toEqual(["and", "->"]);
  });

  it("treats every kind of line ending as a line break", () => {
    for (const ending of ["\n", "\r\n", "\r", "\u2028", "\u2029", "\u0085", "\f", "\v"]) {
      const program = compiled(`when hour > 1 -> idle${ending}otherwise -> wander${ending}`);
      expect(program.rules).toEqual(["hour > 1", "otherwise"]);
    }
    expect(errorsOf("otherwise -> idle\r\rwhen zork -> idle")[0]).toMatch(/^3:1 /);
    // A no-break space is a space; a character that cannot be shown is named by its code point.
    expect(compiled("when\u00a0hour\u00a0>\u00a01 -> idle").rules[0]).toBe("hour > 1");
    expect(errorsOf("otherwise -> idle \u0007")[0]).toMatch(
      /^1:19 the character U\+0007 is not something Tactics understands/,
    );
  });

  it("reports several mistakes at once, each on its own line, and stops at ten", () => {
    // Line 1 and line 3 cannot be parsed; line 2 parses but names an action that does not exist.
    const errors = errorsOf("when hour > -> idle\nwhen hour == 2 -> dance\nwhen -> idle\n");
    expect(errors.map((e) => e.split(":")[0])).toEqual(["1", "2", "3"]);
    expect(errors[1]).toMatch(/no action called "dance"/);
    const many = Array.from({ length: 40 }, () => "nonsense here").join("\n");
    expect(errorsOf(many)).toHaveLength(10);
  });

  it("refuses programs that are too big, with the reason and the place", () => {
    const rule =
      "when hour == 1 and minute == 2 and distance(camp) > 3 -> walk_to(bank); wait(30); wander\n";
    expect(errorsOf(rule.repeat(70))[0]).toMatch(/^64:1 a program can have at most 63 rules/);
    expect(errorsOf("x".repeat(20_001))[0]).toMatch(/at most 20000 characters/);
    const slots = Array.from({ length: 16 }, (_, i) => `set s${i} = 1`).join("; ");
    expect(errorsOf(`otherwise -> ${slots}; idle`)[0]).toMatch(/remember at most 15 things/);
    expect(errorsOf(42)[0]).toMatch(/must be text/);
    expect(errorsOf(null)[0]).toMatch(/must be text/);

    // One rule too long to follow.
    const wide = `otherwise -> wait(${Array.from({ length: 700 }, () => 1).join(" + ")})`;
    expect(errorsOf(wide)[0]).toMatch(/^1:\d+ this rule is too long; a rule can hold at most 600/);

    // Many rules that are fine one by one. With k sensor reads a rule compiles to 3k + 8 words and 2k + 4 steps.
    const sum = (k: number): string =>
      `when ${Array.from({ length: k }, () => "hour").join(" + ")} > 0 -> idle\n`;
    expect(errorsOf(sum(20).repeat(63))[0]).toMatch(
      /^6[0-3]:1 this program is too long: it compiles to 42\d\d words and the limit is 4096/,
    );
    expect(errorsOf(sum(14).repeat(63))[0]).toMatch(
      /^63:1 this program is too long to finish a decision: it has 20\d\d steps and a decision may take 2000/,
    );
    expect(compileTactics(sum(13).repeat(63)).ok).toBe(true);
  });

  it("deep nesting and long chains are refused where they go too far, never with the generic message", () => {
    const brackets = (n: number): string => `when ${"(".repeat(n)}1${")".repeat(n)} -> idle`;
    expect(compileTactics(brackets(48)).ok).toBe(true);
    expect(errorsOf(brackets(49))).toEqual([
      '1:54 this is nested too deeply; brackets, "not" and minus signs can go 48 deep',
    ]);
    for (const source of [
      brackets(1000),
      brackets(9000),
      `when ${"- ".repeat(9000)}1 -> idle`,
      `when ${"not ".repeat(4000)}1 -> idle`,
      `otherwise -> wait(${"(1 + ".repeat(70)}1${")".repeat(70)})`,
      `otherwise -> wait(${"1 + ".repeat(4000)}1)`,
      `otherwise -> wait(${"distance(".repeat(500)}1, 1${")".repeat(500)})`,
    ]) {
      const errors = errorsOf(source);
      expect(errors.length).toBeGreaterThan(0);
      for (const error of errors) {
        expect(error).not.toMatch(/could not be compiled/);
        expect(error).toMatch(/nested too deeply|this rule is too long|at most 20000 characters/);
      }
    }
  });

  it("the largest programs it accepts finish their decision", () => {
    // The largest programs the compiler accepts, run with every sensor answering so that all rules are tried.
    const sum = (k: number): string =>
      `when ${Array.from({ length: k }, () => "hour").join(" + ")} > 9999 -> idle\n`;
    for (const source of [sum(13).repeat(63), sum(190).repeat(3), sum(40).repeat(20)]) {
      const result = compileTactics(source);
      if (!result.ok) {
        expect(result.errors[0]?.message).toMatch(/too long/);
        continue;
      }
      const decision = decide(result.program, { hour: 0 });
      expect(decision.fault).toBe("none");
      expect(decision.gasUsed).toBeLessThanOrEqual(2000);
    }
    // And the long chains from the review are refused, not compiled into something that cannot finish.
    expect(errorsOf(`when ${"not ".repeat(2100)}1 -> idle`)[0]).toMatch(/nested too deeply/);
    expect(errorsOf(`when hour${"+hour".repeat(1300)} > 0 -> idle`)[0]).toMatch(
      /this rule is too long/,
    );
  });

  it("a rule may do up to 32 actions in sequence, and its marks never meet another rule's", () => {
    const waits = (n: number): string =>
      Array.from({ length: n }, (_, i) => `wait(${100 + i})`).join("; ");
    const tooMany = errorsOf(`otherwise -> ${waits(33)}`);
    expect(tooMany[0]).toMatch(/a rule can do at most 32 actions in sequence/);
    const program = compiled(
      `when hour < 12 -> ${waits(32)}\nwhen 1 -> wait(1); wait(2); wait(3)\n`,
    );
    const memory = new Array<number>(MEMORY_SLOTS).fill(0);
    const next = (hour: number): string => action(decide(program, { hour }, memory));
    const first: string[] = [];
    for (let i = 0; i < 34; i++) first.push(next(1));
    expect(first.slice(0, 3)).toEqual(["wait(100)", "wait(101)", "wait(102)"]);
    expect(first.slice(31)).toEqual(["wait(131)", "wait(100)", "wait(101)"]);
    // The other rule takes over part-way through and starts at its own first action.
    expect([next(20), next(20), next(20), next(20)]).toEqual([
      "wait(1)",
      "wait(2)",
      "wait(3)",
      "wait(1)",
    ]);
  });

  it("everything it accepts fits the machine's limits", () => {
    const rule = "when hour == 1 and minute == 2 -> walk_to(bank); wait(30)\n";
    const big = compiled(rule.repeat(63));
    expect(big.code.length).toBeLessThanOrEqual(MAX_CODE_LENGTH);
    expect(big.rules).toHaveLength(64);
    expect(action(decide(big, { hour: 1, minute: 2 }))).toBe("walk_to(15, 9)");
  });
});

describe("names and labels", () => {
  it("keeps comments out of labels and tidies the spacing", () => {
    const program = compiled(
      "when hour > 1 and # late\n  hour <   5 -> idle\nwhen distance( camp )>3 or -hour < - 2 -> idle",
    );
    expect(program.rules).toEqual([
      "hour > 1 and hour < 5",
      "distance(camp) > 3 or - hour < - 2",
      "otherwise",
    ]);
  });

  it("keeps only Latin letters, digits and common punctuation in what viewers will read", () => {
    const result = compileTactics(
      'bot "\u202ESly\u200B\tFox\u0007 🦊"\nwhen 1 as "\u202Eévil\u200B  twin — no. 2!" -> idle',
    );
    expect(result).toMatchObject({ ok: true, name: "Sly Fox" });
    expect(result.ok && result.program.rules[0]).toBe("évil twin — no. 2!");
    // Blank-looking letters, bare accents, stacked accents, emoji and other scripts leave nothing behind.
    for (const blank of [
      "\u3164",
      "\u2800\u2800",
      "\uFE0F\uFE0F",
      "\u0301\u0301",
      "🇫🇷🇫🇷",
      "می‌خواهم",
      "\u200B",
    ]) {
      expect(errorsOf(`bot "${blank}"\notherwise -> idle`)[0], blank).toMatch(
        /after "bot" comes the bot's name/,
      );
      expect(errorsOf(`when 1 as "${blank}" -> idle`)[0], blank).toMatch(
        /after "as" comes a short label/,
      );
    }
    expect(compiled(`when 1 as "a${"\u0301".repeat(31)}b" -> idle`).rules[0]).toBe("áb");
    const long = compiled(`when 1 as "${"é".repeat(60)}" -> idle`).rules[0] as string;
    expect(long).toBe(`${"é".repeat(37)}...`);
  });

  it("refuses constants a program could not use, with the reason", () => {
    const refused: [Constants, RegExp][] = [
      [{ hour: { x: 1, y: 2 } }, /"hour" is already a sensor or an action/],
      [{ wander: 3 }, /"wander" is already a sensor or an action/],
      [{ when: 3 }, /"when" cannot be used as a name/],
      [{ "old mill": { x: 1, y: 2 } }, /"old mill" cannot be used as a name/],
      [{ far: 1.5 }, /"far" must be a whole number/],
      [{ camp: { x: 1, y: Number.NaN } }, /"camp" must be a whole number, or a place/],
      [{ camp: null as never }, /"camp" must be a whole number, or a place/],
    ];
    for (const [constants, message] of refused)
      expect(errorsOf("otherwise -> idle", constants)[0]).toMatch(message);
  });
});

describe("hostile source", () => {
  const WORDS = [
    "when",
    "otherwise",
    "as",
    "set",
    "and",
    "or",
    "not",
    "mod",
    "bot",
    "->",
    ";",
    ",",
    "(",
    ")",
    "=",
    "==",
    "!=",
    "<",
    "<=",
    ">",
    ">=",
    "+",
    "-",
    "*",
    "/",
    "%",
    "\n",
    "hour",
    "minute",
    "distance",
    "walkable",
    "self_x",
    "idle",
    "wait",
    "walk_to",
    "wander",
    "camp",
    "bank",
    "far",
    "x",
    "trips",
    "0",
    "1",
    "40",
    "99999999999",
    '"a label"',
    '"',
    "#",
    "@",
    "é",
    "\t",
  ];
  const SEED_PROGRAM = [
    'bot "Seed" \n',
    'when hour >= 20 and distance ( camp ) > 0 as "home" -> walk_to ( camp ) ; wait ( 40 ) \n',
    "when trips < 3 or not walkable ( 3 , far ) -> set trips = trips + 1 ; wander \n",
    "when ( hour mod 2 ) == 0 -> wait ( 10 * 2 - 1 ) \n",
    "otherwise -> idle",
  ]
    .join("")
    .split(" ");

  it("never throws, whatever it is given, and what it accepts always runs cleanly", () => {
    const rng = createRng(2026);
    let accepted = 0;
    let refused = 0;
    for (let i = 0; i < 10_000; i++) {
      // Half are a valid program with a few words dropped, replaced or inserted; half are word soup.
      let words: string[];
      if (i % 2 === 0) {
        words = [...SEED_PROGRAM];
        for (let edits = nextInt(rng, 4); edits > 0; edits--) {
          const at = nextInt(rng, words.length);
          const kind = nextInt(rng, 3);
          if (kind === 0) words.splice(at, 1);
          else if (kind === 1) words[at] = WORDS[nextInt(rng, WORDS.length)] as string;
          else words.splice(at, 0, WORDS[nextInt(rng, WORDS.length)] as string);
        }
      } else {
        words = Array.from(
          { length: 1 + nextInt(rng, 30) },
          () => WORDS[nextInt(rng, WORDS.length)] as string,
        );
      }
      const result = compileTactics(words.join(" "), PLACES);
      if (!result.ok) {
        refused++;
        expect(result.errors.length).toBeGreaterThan(0);
        for (const error of result.errors) {
          expect(error.line).toBeGreaterThanOrEqual(1);
          expect(error.column).toBeGreaterThanOrEqual(1);
          expect(error.message.length).toBeGreaterThan(5);
          expect(error.message).not.toMatch(/could not be compiled/);
        }
        continue;
      }
      accepted++;
      const memory = new Array<number>(MEMORY_SLOTS).fill(0);
      for (let turn = 0; turn < 3; turn++) {
        const decision = decide(
          result.program,
          { hour: nextInt(rng, 24), distance: nextInt(rng, 9) },
          memory,
        );
        // A compiled program can divide by zero; it can do nothing worse.
        expect(["none", "divide_by_zero"]).toContain(decision.fault);
      }
    }
    expect(accepted).toBeGreaterThan(500);
    expect(refused).toBeGreaterThan(3000);
  });

  it("random valid programs: compiled code never underflows, overflows or runs off the end", () => {
    const rng = createRng(77);
    const pick = <T>(list: readonly T[]): T => list[nextInt(rng, list.length)] as T;
    const expression = (depth: number): string => {
      const roll = nextInt(rng, depth > 3 ? 4 : 9);
      if (roll === 0) return String(nextInt(rng, 50));
      if (roll === 1) return pick(["hour", "minute", "self_x", "self_y", "far", "trips", "mood"]);
      if (roll === 2) return `distance(${pick(["camp", "bank", "3, 4"])})`;
      if (roll === 3) return `walkable(${expression(depth + 1)}, 2)`;
      if (roll === 4)
        return `(${expression(depth + 1)} ${pick(["+", "-", "*", "/", "mod"])} ${expression(depth + 1)})`;
      if (roll === 5)
        return `(${expression(depth + 1)} ${pick(["<", "<=", ">", ">=", "==", "!="])} ${expression(depth + 1)})`;
      if (roll === 6)
        return `(${expression(depth + 1)} ${pick(["and", "or"])} ${expression(depth + 1)})`;
      if (roll === 7) return `(not ${expression(depth + 1)})`;
      return `-(${expression(depth + 1)})`;
    };
    const act = (): string =>
      pick([
        "idle",
        "wander",
        `wait(${expression(2)})`,
        "walk_to(camp)",
        `walk_to(${expression(2)}, 5)`,
      ]);
    const body = (): string => {
      const parts: string[] = [];
      for (let n = 1 + nextInt(rng, 3); n > 0; n--) {
        if (nextInt(rng, 3) === 0) parts.push(`set ${pick(["trips", "mood"])} = ${expression(2)}`);
        parts.push(act());
      }
      return parts.join("; ");
    };
    const faults = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      let source = "";
      for (let n = nextInt(rng, 5); n > 0; n--) source += `when ${expression(0)} -> ${body()}\n`;
      source += `otherwise -> set trips = 0; set mood = 0; ${body()}\n`;
      const program = compiled(source);
      const memory = new Array<number>(MEMORY_SLOTS).fill(0);
      for (let turn = 0; turn < 4; turn++) {
        const decision = runDecision(program, memory, () => nextInt(rng, 40) - 5);
        faults.add(decision.fault);
      }
    }
    expect([...faults].sort()).toEqual(["divide_by_zero", "none"]);
  });
});

describe("params", () => {
  const SOURCE = [
    'bot "Steady"',
    "param margin = 120 from 0 to 240",
    "param stance = gather of gather, fight, careful",
    "param tries = 3",
    "param lean = -2 from -5 to 5",
    'when stance == fight as "fight" -> wait(margin + lean)',
    "when stance == careful -> wait(tries)",
    "otherwise -> idle",
  ].join("\n");

  it("declares params with ranges and named values, and reads the actor's values at run time", () => {
    const program = compiled(SOURCE);
    expect(program.params).toEqual([
      { name: "margin", value: 120, min: 0, max: 240, values: [] },
      { name: "stance", value: 0, min: 0, max: 2, values: ["gather", "fight", "careful"] },
      { name: "tries", value: 3, min: 0, max: 2147483647, values: [] },
      { name: "lean", value: -2, min: -5, max: 5, values: [] },
    ]);
    const memory = new Array<number>(MEMORY_SLOTS).fill(0);
    const run = (values: number[]) => runDecision(program, memory, () => 0, values);
    // The defaults, with no values given: gather, so it idles.
    expect(run([]).action?.id).toBe(id("idle"));
    expect(run([150, 1, 3, 4]).action).toEqual({ id: id("wait"), args: [154] });
    expect(run([150, 2, 9, 4]).action).toEqual({ id: id("wait"), args: [9] });
    // A change of value needs no compile: the same program, another number.
    expect(run([0, 1, 3, -5]).action).toEqual({ id: id("wait"), args: [-5] });
  });

  it("refuses a ninth param, a default out of its range, and names already taken", () => {
    const nine = Array.from({ length: 9 }, (_, i) => `param p${i} = ${i}`).join("\n");
    expect(errorsOf(`${nine}\notherwise -> idle`)).toEqual([
      "9:1 a program can declare at most 8 params",
    ]);
    const refused = (lines: string): string[] => errorsOf(`${lines}\notherwise -> idle`);
    expect(refused("param margin = 300 from 0 to 240")).toEqual([
      "1:16 the default 300 is outside 0 to 240",
    ]);
    expect(refused("param margin = 120 from 240 to 0")).toEqual([
      '1:20 "from 240 to 0" is empty: the first must not be larger',
    ]);
    expect(refused("param stance = run of gather, fight")).toEqual([
      '1:16 "run" is not one of the values listed after "of"',
    ]);
    expect(refused("param stance = fight of fight, fight")).toEqual([
      '1:32 "fight" is named twice',
    ]);
    expect(refused("param hp = 3")).toEqual([
      '1:1 the param "hp" cannot be used: it is already a sensor or an action',
    ]);
    expect(refused("param camp = 3")).toEqual([
      '1:1 the param "camp" cannot be used: it is already a place, a skill, a good or a kind of node',
    ]);
    expect(refused("param a = x of x, y\nparam b = y of y, z")).toEqual([
      '2:16 the value "y" cannot be used: it is already a value of "a"',
    ]);
    expect(refused("param a = 1\nparam a = 2")).toEqual([
      '2:1 the param "a" cannot be used: it is already a param',
    ]);
    expect(refused("param flag = 1")).toEqual([
      '1:1 the param "flag" cannot be used: it is already the flag\'s place',
    ]);
    expect(refused("param Margin = 1")[0]).toMatch(/its name in lower case/);
    expect(refused("param margin = 99999999999")[0]).toMatch(/too large/);
    expect(refused("param margin 120")[0]).toMatch(/expected "="/);
    expect(refused("param margin = 1 from 0 240")[0]).toMatch(/expected "to"/);
  });

  it("keeps params above the rules and out of the program's own memory", () => {
    expect(errorsOf("when hp > 0 -> idle\nparam margin = 1\notherwise -> idle")).toEqual([
      "2:1 params are declared above the rules, after the bot line",
    ]);
    expect(errorsOf("param margin = 1\notherwise -> set margin = 2; idle")).toEqual([
      '2:14 "margin" is a param: its chatter sets it, so the program can read it but not set it',
    ]);
    // A value's name is a constant like a place's number.
    expect(
      errorsOf("param stance = gather of gather, fight\notherwise -> set fight = 2; idle"),
    ).toEqual(['2:14 "fight" already means something, so it cannot be used as a memory slot']);
  });

  it("reads the flag as a place wherever a place goes, and refuses it as a number", () => {
    const program = compiled("when distance(flag) > 6 -> walk_to(flag)\notherwise -> idle");
    expect(decide(program, { distance: 7, flag_x: 3, flag_y: 4 }).action).toEqual({
      id: id("walk_to"),
      args: [3, 4],
    });
    expect(errorsOf("when flag > 0 -> idle")[0]).toMatch(/"flag" is a place/);
    expect(errorsOf("otherwise -> set flag = 1; idle")[0]).toMatch(/already means something/);
    expect(compileTactics("otherwise -> idle", { flag: 3 })).toMatchObject({ ok: false });
  });
});

describe("the language reference", () => {
  it("lists exactly the system calls the machine has", () => {
    const doc = readFileSync(new URL("../../../docs/tactics.md", import.meta.url), "utf8");
    const start = "<!-- generated: system calls -->";
    const written = doc.slice(
      doc.indexOf(start) + start.length,
      doc.indexOf("<!-- end generated -->"),
    );
    // Compared cell by cell, so the formatter may align the columns as it likes.
    const rows = written
      .trim()
      .split("\n")
      .map((line) =>
        line
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim()),
      )
      .filter((cells) => !cells.every((cell) => /^-+$/.test(cell)));
    // If this fails, update the table in docs/tactics.md to match packages/sim/src/syscalls.ts.
    expect(rows).toEqual([
      ["Name", "Kind", "Takes", "What it does"],
      ...SYSCALLS.map((c) => [`\`${c.name}\``, c.kind, String(c.args), c.about]),
    ]);
  });

  it("its example program compiles", () => {
    const doc = readFileSync(new URL("../../../docs/tactics.md", import.meta.url), "utf8");
    const example = doc.slice(
      doc.indexOf("```\nbot") + 4,
      doc.indexOf("```", doc.indexOf("```\nbot") + 4),
    );
    const result = compileTactics(example, placeConstants(firstLight()));
    expect(result.ok ? result.program.rules : result).toEqual([
      "heading home",
      "hour >= 20",
      "otherwise",
    ]);
  });
});

describe("shipped programs", () => {
  it("every program in content/bots compiles", () => {
    const sources = botSources();
    expect(Object.keys(sources).sort()).toEqual([
      "deckhand",
      "homebody",
      "riverwalker",
      "wanderer",
    ]);
    const programs = compileBots(sources, placeConstants(shippedWorld()));
    expect(Object.keys(programs).sort()).toEqual(Object.keys(sources).sort());
  });

  it("the shipped programs behave as their labels say, over a full day", () => {
    const map = shippedWorld();
    const world = createWorld(map, 9, compileBots(botSources(), placeConstants(map)));
    step(
      world,
      spawnsNearCamp(world, [
        { name: "Wren", program: "wanderer" },
        { name: "Hob", program: "homebody" },
        { name: "Rill", program: "riverwalker" },
      ]),
    );
    const camp = place(map, "camp");
    const river = place(map, "river");
    const far = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
      Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    const [wren, hob, rill] = world.actors;
    if (!wren || !hob || !rill) throw new Error("no actors");
    let hobFarthest = 0;
    let rillReachedRiver = false;
    const wrenTiles = new Set<string>();
    const wrenRegions = new Set<number>();
    const labels = new Set<string>();
    for (let tick = 0; tick < TICKS_PER_DAY; tick++) {
      step(world);
      for (const actor of world.actors) {
        expect(actor.fault).toBe(0);
        labels.add(`${actor.program}: ${world.programs[actor.program]?.rules[actor.rule]}`);
      }
      const { hour } = clock(world);
      wrenTiles.add(`${wren.x},${wren.y}`);
      wrenRegions.add(regionAt(map, wren.x, wren.y));
      if (hour >= 8 && hour < 18) hobFarthest = Math.max(hobFarthest, far(hob, camp));
      if (far(rill, river) === 0) rillReachedRiver = true;
      // Deep in the night both of them are settled near the lantern.
      if (hour === 2) {
        expect(far(hob, camp)).toBeLessThanOrEqual(3);
        expect(far(rill, camp)).toBeLessThanOrEqual(3);
        // The wanderer strolls about the camp's region, which the viewer shows.
        expect(regionAt(map, wren.x, wren.y)).toBe(regionAt(map, camp.x, camp.y));
      }
    }
    expect(rillReachedRiver).toBe(true);
    expect(wrenTiles.size).toBeGreaterThan(200);
    // The wanderer's bags come from the camp's trees and the lower river's, and
    // once it can cut old trees, the pinewood's, which it cannot on its first
    // day. The hills have no trees.
    const region = (name: string): number => map.regions.findIndex((r) => r.map.name === name);
    expect([...wrenRegions].sort()).toEqual([region("camp"), region("lower-river")].sort());
    // The homebody goes to the trees near camp and never gets across the map.
    expect(hobFarthest).toBeGreaterThan(6);
    expect(hobFarthest).toBeLessThan(30);
    // Every gathering rule is used at least once in the day.
    const used = [...labels];
    for (const label of [
      "homebody: chop",
      "homebody: bank the logs",
      "riverwalker: fish",
      "riverwalker: chop",
      "riverwalker: cook",
      "riverwalker: bank",
      "wanderer: chop",
      "wanderer: bank the logs",
      "wanderer: off to the lower river",
    ])
      expect(used).toContain(label);
  });

  it("a map whose place names no program could use is blamed, not the programs", () => {
    expect(() => compileBots({ fine: "otherwise -> idle" }, { hour: { x: 1, y: 2 } })).toThrow(
      /^the names given to programs are not usable: "hour" is already a sensor or an action/,
    );
  });

  it("a content file whose name could not be a program name is refused by name", () => {
    expect(() => compileBots({ "Night Owl": "otherwise -> idle" })).toThrow(BotError);
    expect(() => compileBots({ "Night Owl": "otherwise -> idle" })).toThrow(
      /^Night Owl\.tac: a program file's name must be/,
    );
  });

  it("a broken content program is refused with its file, line and column", () => {
    expect(() =>
      compileBots({ good: "otherwise -> idle", broken: "otherwise -> idle\nwhen hour > -> idle" }),
    ).toThrow(BotError);
    expect(() => compileBots({ broken: "otherwise -> idle\nwhen hour > -> idle" })).toThrow(
      /^broken\.tac, line 2, column \d+: /,
    );
  });
});
