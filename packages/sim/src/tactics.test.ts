import { describe, expect, it } from "vitest";
import { placeConstants } from "./map.ts";
import { createRng, nextInt } from "./rng.ts";
import { SYSCALLS } from "./syscalls.ts";
import { BotError, type Compiled, type Constants, compileBots, compileTactics } from "./tactics.ts";
import { botSources, firstLight } from "./testing.ts";
import {
  type Decision,
  MAX_CODE_LENGTH,
  MEMORY_SLOTS,
  OP,
  type Program,
  runDecision,
} from "./vm.ts";

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
      "distance( camp ) > 5",
      "hour == 1 or hour == 2 or hour == 3 or...",
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
        "when hp < 40 -> wander",
        /^1:6 I do not know what "hp" is\. Sensors: self_x, .* set hp = 0/,
      ],
      [
        "otherwise -> chop",
        /^1:14 there is no action called "chop"\. Actions: idle, wait, walk_to, wander/,
      ],
      ["otherwise -> hour", /"hour" is a sensor: it reads, it does not act/],
      ["when wander -> idle", /I do not know what "wander" is/],
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

  it("reports several mistakes at once, each on its own line, and stops at ten", () => {
    const errors = errorsOf("when hour > -> idle\notherwise -> chop\nwhen -> idle\n");
    expect(errors.map((e) => e.split(":")[0])).toEqual(["1", "2", "3"]);
    const many = Array.from({ length: 40 }, () => "nonsense here").join("\n");
    expect(errorsOf(many)).toHaveLength(10);
  });

  it("refuses programs that are too big, with the reason", () => {
    const rule =
      "when hour == 1 and minute == 2 and distance(camp) > 3 -> walk_to(bank); wait(30); wander\n";
    expect(errorsOf(rule.repeat(70))[0]).toMatch(/at most 63 rules/);
    const wide = `otherwise -> wait(${Array.from({ length: 1500 }, (_, i) => i).join(" + ")})`;
    expect(errorsOf(wide)[0]).toMatch(/too long: it compiles to \d+ words and the limit is 4096/);
    expect(errorsOf("x".repeat(20_001))[0]).toMatch(/at most 20000 characters/);
    const deep = `otherwise -> wait(${"(1 + ".repeat(70)}1${")".repeat(70)})`;
    expect(errorsOf(deep)[0]).toMatch(/nested too deeply/);
    const slots = Array.from({ length: 16 }, (_, i) => `set s${i} = 1`).join("; ");
    expect(errorsOf(`otherwise -> ${slots}; idle`)[0]).toMatch(/remember at most 15 things/);
    expect(errorsOf(42)[0]).toMatch(/must be text/);
    expect(errorsOf(null)[0]).toMatch(/must be text/);
  });

  it("everything it accepts fits the machine's limits", () => {
    const rule =
      "when hour == 1 and minute == 2 and distance(camp) > 3 -> walk_to(bank); wait(30); wander\n";
    const big = compiled(rule.repeat(63));
    expect(big.code.length).toBeLessThanOrEqual(MAX_CODE_LENGTH);
    expect(big.rules).toHaveLength(64);
    expect(action(decide(big, { hour: 1, minute: 2, distance: 9 }))).toBe("walk_to(15, 9)");
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
    "\n",
    " ",
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

  it("never throws, whatever it is given, and what it accepts always runs cleanly", () => {
    const rng = createRng(2026);
    let accepted = 0;
    for (let i = 0; i < 10_000; i++) {
      const length = 1 + nextInt(rng, 30);
      let source = "";
      for (let k = 0; k < length; k++) source += `${WORDS[nextInt(rng, WORDS.length)]} `;
      const result = compileTactics(source, PLACES);
      if (!result.ok) {
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
      const decision = decide(result.program, {
        hour: nextInt(rng, 24),
        distance: nextInt(rng, 9),
      });
      // A compiled program can divide by zero; it can do nothing worse.
      expect(["none", "divide_by_zero"]).toContain(decision.fault);
    }
    expect(accepted).toBeGreaterThan(20);
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
      if (roll === 7) return `not ${expression(depth + 1)}`;
      return `-${expression(depth + 1)}`;
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

describe("shipped programs", () => {
  it("every program in content/bots compiles", () => {
    const sources = botSources();
    expect(Object.keys(sources)).toContain("wanderer");
    const programs = compileBots(sources, placeConstants(firstLight()));
    expect(Object.keys(programs).sort()).toEqual(Object.keys(sources).sort());
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
