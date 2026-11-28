import { TICKS_PER_SECOND } from "@idlin/sim";
import { describe, expect, it } from "vitest";
import type { ChatEvent } from "./events.ts";
import { citizenName, FLOOD_MESSAGES, Gate, MAX_ACCOUNTS } from "./gate.ts";

const message = (
  text: string,
  extra: Partial<ChatEvent & { type: "message" }> = {},
): ChatEvent => ({
  type: "message",
  id: "m1",
  account: "1001",
  login: "goofguy",
  display: "GoofGuy",
  text,
  role: "viewer",
  emotes: [],
  ...extra,
});

describe("the gate", () => {
  it("joins an account on its first message of any kind, once, and names it by its username", () => {
    const gate = new Gate();
    expect(gate.pass(message("hello"), 0)).toEqual([
      { type: "join", account: "1001", name: "GoofGuy", role: "viewer" },
      { type: "say", account: "1001", id: "m1", text: "hello" },
    ]);
    expect(gate.pass(message("!go river", { id: "m2" }), 20)).toEqual([
      { type: "go", account: "1001", words: "river" },
    ]);
    // A command the game does not know still means the chatter was heard.
    const other = new Gate();
    expect(
      other.pass(
        message("!uptime", { account: "77", login: "joshyboy88", display: "joshyboy88" }),
        0,
      ),
    ).toEqual([
      { type: "join", account: "77", name: "joshyboy88", role: "viewer" },
      { type: "heard", account: "77" },
    ]);
  });

  it("takes the display name only when it is the login in other capitals", () => {
    expect(citizenName("xxxkittykatxxx", "xXxKittyKatxXx")).toBe("xXxKittyKatxXx");
    expect(citizenName("goofguy", "Someone Else")).toBe("goofguy");
    expect(citizenName("goofguy", "goofguy")).toBe("goofguy");
  });

  it("drops what the ignore list names, by login or account, in any capitals", () => {
    const gate = new Gate();
    expect(gate.pass(message("!commands", { login: "nightbot", display: "Nightbot" }), 0)).toEqual(
      [],
    );
    const own = new Gate({ ignore: ["GoofGuy", "555"] });
    expect(own.pass(message("hi"), 0)).toEqual([]);
    expect(own.pass(message("hi", { account: "555", login: "pixel_pete" }), 0)).toEqual([]);
    expect(own.pass(message("hi", { account: "556", login: "nightbot" }), 0)).toHaveLength(2);
  });

  it(`passes ${FLOOD_MESSAGES} messages an account sends in a second and drops the rest`, () => {
    const gate = new Gate();
    const passed: number[] = [];
    // Ten a second, one a tick, for three seconds.
    for (let tick = 0; tick < 30; tick++)
      if (gate.pass(message(`!go river`, { id: `m${tick}` }), tick).length > 0) passed.push(tick);
    expect(passed).toEqual([0, 1, 2, 3, 4, 10, 11, 12, 13, 14, 20, 21, 22, 23, 24]);
    // Another account is not held up by it.
    expect(gate.pass(message("hi", { account: "2002", login: "pixel_pete" }), 5)).toHaveLength(2);
    // Ten in one tick: five pass.
    const burst = new Gate();
    const many = Array.from({ length: 10 }, (_, i) =>
      burst.pass(message("!me", { id: `b${i}` }), 0),
    );
    expect(many.filter((inputs) => inputs.length > 0)).toHaveLength(FLOOD_MESSAGES);
  });

  it(`keeps track of at most ${MAX_ACCOUNTS} accounts, and of none quiet for a second in its flood list`, () => {
    const gate = new Gate();
    const from = (n: number, tick: number) =>
      gate.pass(message("hi", { id: `m${n}`, account: `${n}`, login: `chatter_${n}` }), tick);
    // One a tick, so each is a second past by the time the tenth after it speaks.
    for (let n = 1; n <= MAX_ACCOUNTS + 10; n++) from(n, n);
    expect(gate.tracked).toEqual({ joined: MAX_ACCOUNTS, recent: TICKS_PER_SECOND });
    // The first ten went quiet longest and were forgotten, so each joins again;
    // one still kept does not.
    expect(from(11, MAX_ACCOUNTS + 11)).toEqual([
      { type: "say", account: "11", id: "m11", text: "hi" },
    ]);
    expect(from(1, MAX_ACCOUNTS + 12)[0]).toMatchObject({ type: "join", account: "1" });
    expect(gate.tracked.joined).toBe(MAX_ACCOUNTS);
    // Speaking again kept 11 from being the next forgotten: 12 went instead.
    expect(from(12, MAX_ACCOUNTS + 13)[0]).toMatchObject({ type: "join", account: "12" });
    expect(from(11, MAX_ACCOUNTS + 14)[0]).toMatchObject({ type: "say" });
  });

  it("turns a deletion into an unsay, and a timeout or a ban into the platform's mod input", () => {
    const gate = new Gate();
    expect(gate.pass({ type: "delete", id: "m9" }, 0)).toEqual([{ type: "unsay", id: "m9" }]);
    expect(gate.pass({ type: "clear", account: "1001", seconds: 600 }, 0)).toEqual([
      { type: "mod", by: "platform", action: { action: "timeout", account: "1001", seconds: 600 } },
    ]);
    expect(gate.pass({ type: "clear", account: "1001", seconds: null }, 0)).toEqual([
      { type: "mod", by: "platform", action: { action: "ban", account: "1001" } },
    ]);
    expect(gate.pass({ type: "clear", account: "1001", seconds: 0 }, 0)).toEqual([]);
    expect(gate.pass({ type: "clear", account: "1001", seconds: 1.5 }, 0)).toEqual([]);
    expect(gate.pass({ type: "delete", id: "" }, 0)).toEqual([]);
  });

  it("makes nothing of an event of the wrong shape, and never throws", () => {
    const gate = new Gate();
    const hostile: unknown[] = [
      null,
      undefined,
      42,
      "message",
      [],
      {},
      { type: "message" },
      { type: "nonsense", id: "x" },
      { ...message("hi"), account: "" },
      { ...message("hi"), account: "a b" },
      { ...message("hi"), account: "x".repeat(41) },
      { ...message("hi"), login: "no spaces allowed" },
      { ...message("hi"), login: "ab" },
      { ...message("hi"), login: "x".repeat(26) },
      { ...message("hi"), role: "admin" },
      { ...message("hi"), text: 7 },
      { ...message("hi"), id: "" },
      { ...message("hi"), id: "x".repeat(65) },
      { ...message("hi"), display: null },
      { type: "clear", account: { toString: () => "1" }, seconds: 5 },
      Object.defineProperty({ type: "message" }, "text", {
        get() {
          throw new Error("boom");
        },
      }),
    ];
    for (const event of hostile) expect(gate.pass(event as ChatEvent, 0)).toEqual([]);
  });
});
