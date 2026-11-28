import type { ChatInput, Program } from "@idlin/sim";
import { describe, expect, it } from "vitest";
import { shippedPrograms } from "../../sim/src/testing.ts";
import { clean, DEFAULT_VOCABULARY, MAX_LINE, MAX_WORDS, parseLine } from "./parse.ts";

const viewer = (text: string): ChatInput | null =>
  parseLine({ account: "101", role: "viewer", id: "m1", text });
const mod = (text: string): ChatInput | null =>
  parseLine({ account: "202", role: "mod", id: "m2", text });

describe("the parser", () => {
  it("reads every built-in command", () => {
    const account = "101";
    expect(viewer("!go brackwater")).toEqual({ type: "go", account, words: "brackwater" });
    expect(viewer("!go  waist   hatch ")).toEqual({ type: "go", account, words: "waist hatch" });
    expect(viewer("!go @goofguy")).toEqual({ type: "go", account, words: "@goofguy" });
    expect(viewer("!home")).toEqual({ type: "go", account, words: "home" });
    expect(viewer("!free")).toEqual({ type: "free", account });
    expect(viewer("!run Longhaul")).toEqual({ type: "run", account, preset: "longhaul" });
    expect(viewer("!me")).toEqual({ type: "me", account });
    expect(viewer("!stash")).toEqual({ type: "stash", account, slot: null });
    expect(viewer("!stash 12")).toEqual({ type: "stash", account, slot: 12 });
    expect(viewer("!wear fire")).toEqual({ type: "wear", account, words: "fire" });
    expect(viewer("!wear 3")).toEqual({ type: "wear", account, words: "3" });
    expect(viewer("!lock 4")).toEqual({ type: "lock", account, slot: 4, on: true });
    expect(viewer("!unlock 4")).toEqual({ type: "lock", account, slot: 4, on: false });
    expect(viewer("!scrap 1")).toEqual({ type: "scrap", account, slot: 1 });
    expect(viewer("!reroll weapon")).toEqual({
      type: "bench",
      account,
      tool: "reroll",
      target: "weapon",
    });
    expect(viewer("!add 7")).toEqual({ type: "bench", account, tool: "add", target: "7" });
    expect(viewer("!acid coat")).toEqual({ type: "bench", account, tool: "acid", target: "coat" });
  });

  it("reads params by name, with !set, and by a value only one param has", () => {
    const account = "101";
    expect(viewer("!margin 150")).toEqual({ type: "param", account, name: "margin", value: "150" });
    expect(viewer("!set margin 150")).toEqual({
      type: "param",
      account,
      name: "margin",
      value: "150",
    });
    expect(viewer("!stance fight")).toEqual({
      type: "param",
      account,
      name: "stance",
      value: "fight",
    });
    expect(viewer("!fight")).toEqual({ type: "param", account, name: "stance", value: "fight" });
    expect(viewer("!guard")).toEqual({ type: "param", account, name: "ramp", value: "guard" });
    // The value is checked against the program in the simulation, not here.
    expect(viewer("!margin 999")).toEqual({
      type: "param",
      account,
      name: "margin",
      value: "999",
    });
    // A number below 0, for a program whose param has a range that goes there.
    const lean = { lean: [] };
    const line = (text: string) => parseLine({ account, role: "viewer", id: "m", text }, lean);
    expect(line("!lean -2")).toEqual({ type: "param", account, name: "lean", value: "-2" });
    expect(line("!set lean -15")).toEqual({ type: "param", account, name: "lean", value: "-15" });
    for (const bad of ["!lean --2", "!lean -", "!lean -x", "!lean 2-", "!lean -1.5"])
      expect(line(bad), bad).toBeNull();
    // A value word two params share is not enough to say which.
    const shared = { a: ["x"], b: ["x"] };
    expect(parseLine({ account, role: "viewer", id: "m", text: "!x" }, shared)).toBeNull();
    expect(parseLine({ account, role: "viewer", id: "m", text: "!a x" }, shared)).toEqual({
      type: "param",
      account,
      name: "a",
      value: "x",
    });
    expect(viewer("!rare")).toEqual({ type: "param", account, name: "keep", value: "rare" });
  });

  it("knows the params the shipped program declares, with the same value names", () => {
    const deckhand = shippedPrograms().deckhand as Program;
    expect(
      Object.fromEntries(deckhand.params.map((param) => [param.name, [...param.values]])),
    ).toEqual(DEFAULT_VOCABULARY);
  });

  it("reads moderator commands from a moderator or the streamer and from nobody else", () => {
    const by = "202";
    expect(mod("!idlin mute goofguy")).toEqual({
      type: "mod",
      by,
      action: { action: "mute", name: "goofguy", minutes: 10 },
    });
    expect(mod("!idlin mute @goofguy 30")).toEqual({
      type: "mod",
      by,
      action: { action: "mute", name: "goofguy", minutes: 30 },
    });
    expect(mod("!idlin below goofguy")).toEqual({
      type: "mod",
      by,
      action: { action: "below", name: "goofguy" },
    });
    expect(mod("!idlin allow goofguy")).toEqual({
      type: "mod",
      by,
      action: { action: "allow", name: "goofguy" },
    });
    expect(mod("!idlin bubbles off")).toEqual({
      type: "mod",
      by,
      action: { action: "bubbles", on: false },
    });
    expect(mod("!idlin doors shut")).toEqual({
      type: "mod",
      by,
      action: { action: "doors", open: false },
    });
    expect(mod("!IDLIN Clear Hatch")).toEqual({
      type: "mod",
      by,
      action: { action: "clear-hatch" },
    });
    expect(
      parseLine({ account: "303", role: "streamer", id: "m", text: "!idlin doors open" }),
    ).toEqual({ type: "mod", by: "303", action: { action: "doors", open: true } });
    expect(viewer("!idlin doors shut")).toBeNull();
    for (const bad of [
      "!idlin",
      "!idlin mute",
      "!idlin mute goofguy 0",
      "!idlin mute goofguy 99999",
      "!idlin mute goofguy ten",
      "!idlin mute a",
      "!idlin below",
      "!idlin bubbles",
      "!idlin bubbles maybe",
      "!idlin doors ajar",
      "!idlin clear",
      "!idlin clear deck",
      "!idlin launch",
      "!idlin doors shut now",
    ])
      expect(mod(bad), bad).toBeNull();
  });

  it("makes nothing of a command of the wrong shape or one it does not know", () => {
    for (const bad of [
      "!",
      "!!",
      "!go",
      "!go    ",
      `!go ${"a".repeat(MAX_WORDS + 1)}`,
      "!run",
      "!run two words",
      "!run bad/name",
      "!stash 0",
      "!stash 13",
      "!stash -1",
      "!stash 1.5",
      "!stash x",
      "!stash 1 2",
      "!wear",
      "!lock",
      "!lock x",
      "!unlock 99",
      "!scrap",
      "!scrap 1 2",
      "!reroll",
      "!set",
      "!set margin",
      "!set nonsense 4",
      "!set margin 1 2",
      "!margin",
      "!margin bad!value",
      "!uptime",
      "!discord",
      "!constructor",
      "!__proto__ 1",
      "!toString",
    ])
      expect(viewer(bad), bad).toBeNull();
  });

  it("reads anything that is not a command as speech, cleaned", () => {
    expect(viewer("hello all")).toEqual({
      type: "say",
      account: "101",
      id: "m1",
      text: "hello all",
    });
    expect(viewer("  two\tspaces\n\nand\u0000nul\u007f ")).toEqual({
      type: "say",
      account: "101",
      id: "m1",
      text: "two spaces and nul",
    });
    expect(viewer(" !go home")).toEqual({ type: "go", account: "101", words: "home" });
    expect(viewer("")).toBeNull();
    expect(viewer("   \t\n ")).toBeNull();
    expect(viewer("\u0000\u0001")).toBeNull();
  });

  it("cuts a line at 500 characters, whatever is in it", () => {
    const long = `${"word ".repeat(150)}`;
    const said = viewer(long);
    expect(said?.type).toBe("say");
    expect(said && "text" in said ? said.text.length : 0).toBeLessThanOrEqual(MAX_LINE);
    expect(clean("x".repeat(MAX_LINE + 50))).toHaveLength(MAX_LINE);
    // A 500-character command carries too many words to be one.
    expect(viewer(`!go ${"b".repeat(MAX_LINE)}`)).toBeNull();
    expect(viewer(`!wear ${"c ".repeat(250)}`)).toBeNull();
    // Exactly at the line's length a command still reads.
    const go = `!go ${"d".repeat(MAX_WORDS)}`;
    expect(viewer(go + " ".repeat(MAX_LINE - go.length))).toEqual({
      type: "go",
      account: "101",
      words: "d".repeat(MAX_WORDS),
    });
  });

  it("never throws on garbage", () => {
    // A fixed run of pseudo-random lines over every code unit range, including lone surrogates.
    let seed = 7;
    const next = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) | 0;
      return (seed >>> 8) & 0xffff;
    };
    for (let n = 0; n < 2000; n++) {
      const length = next() % 600;
      let text = n % 3 === 0 ? "!" : "";
      for (let i = 0; i < length; i++)
        text += String.fromCharCode(n % 2 === 0 ? next() : 32 + (next() % 96));
      for (const role of ["viewer", "mod", "streamer"] as const) {
        const input = parseLine({ account: "1", role, id: "m", text });
        if (input && "text" in input) expect(input.text.length).toBeLessThanOrEqual(MAX_LINE);
      }
    }
  });
});
