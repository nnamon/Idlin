import type { ChatInput } from "@idlin/sim";
import { describe, expect, it } from "vitest";
import { Chat } from "./chat.ts";
import type { ChatEvent } from "./events.ts";
import { INPUTS_PER_TICK, InputQueue, MOST_PARAMS, MOST_WAITING } from "./queue.ts";

const go = (account: string, words: string): ChatInput => ({ type: "go", account, words });
const say = (account: string, id: string): ChatInput => ({ type: "say", account, id, text: "hi" });

describe("the input queue", () => {
  it("holds one waiting input of each kind for an account; a newer one replaces it in its place", () => {
    const queue = new InputQueue();
    queue.push(go("a", "river"));
    queue.push(go("b", "hills"));
    queue.push({ type: "free", account: "a" });
    queue.push(go("a", "north"));
    queue.push({ type: "param", account: "a", name: "margin", value: "60" });
    queue.push({ type: "param", account: "a", name: "stance", value: "fight" });
    queue.push({ type: "param", account: "a", name: "margin", value: "90" });
    expect(queue.size).toBe(4);
    expect(queue.take()).toEqual([
      go("a", "north"),
      go("b", "hills"),
      { type: "param", account: "a", name: "margin", value: "90" },
      { type: "param", account: "a", name: "stance", value: "fight" },
    ]);
    expect(queue.size).toBe(0);
  });

  it("holds 17 inputs for one account at the very most, with eight params", () => {
    const queue = new InputQueue();
    const account = "a";
    const params = Array.from({ length: MOST_PARAMS + 2 }, (_, i) => `p${i}`);
    for (let round = 0; round < 3; round++) {
      queue.push({ type: "join", account, name: "goofguy", role: "viewer" });
      queue.push(go(account, `x${round}`));
      for (const name of params) queue.push({ type: "param", account, name, value: `${round}` });
      queue.push({ type: "run", account, preset: "longhaul" });
      queue.push({ type: "me", account });
      queue.push(say(account, `m${round}`));
      queue.push({ type: "stash", account, slot: round + 1 });
      queue.push({ type: "wear", account, words: "fire" });
      queue.push({ type: "scrap", account, slot: 2 });
      queue.push({ type: "lock", account, slot: 3, on: round % 2 === 0 });
      queue.push({ type: "bench", account, tool: "acid", target: "weapon" });
      queue.push({ type: "heard", account });
    }
    // join, a flag, eight params, run, me, say, stash, wear, scrap, lock, bench.
    expect(queue.size).toBe(1 + 1 + MOST_PARAMS + 3 + 3 + 1 + 1);
    expect(queue.waiting(account).filter((input) => input.type === "param")).toHaveLength(
      MOST_PARAMS,
    );
  });

  it("queues `heard` only for an account with nothing else waiting", () => {
    const queue = new InputQueue();
    queue.push({ type: "heard", account: "a" });
    queue.push({ type: "heard", account: "a" });
    queue.push(go("b", "river"));
    queue.push({ type: "heard", account: "b" });
    expect(queue.take()).toEqual([{ type: "heard", account: "a" }, go("b", "river")]);
  });

  it(`takes ${INPUTS_PER_TICK} a tick in arrival order and leaves the rest for the next`, () => {
    const queue = new InputQueue();
    for (let i = 0; i < 100; i++) queue.push(go(`a${i}`, "river"));
    const first = queue.take();
    expect(first).toHaveLength(INPUTS_PER_TICK);
    expect(first[0]).toEqual(go("a0", "river"));
    expect(queue.take()[0]).toEqual(go(`a${INPUTS_PER_TICK}`, "river"));
    expect(queue.size).toBe(100 - 2 * INPUTS_PER_TICK);
  });

  it("takes out a waiting line that was deleted, and queues the deletion of one already taken", () => {
    const queue = new InputQueue();
    queue.push(say("a", "m1"));
    queue.push(say("b", "m2"));
    queue.push({ type: "unsay", id: "m1" });
    expect(queue.take()).toEqual([say("b", "m2")]);
    queue.push({ type: "unsay", id: "m2" });
    expect(queue.take()).toEqual([{ type: "unsay", id: "m2" }]);
  });

  it(`past ${MOST_WAITING} drops speech first, then the newest of the account with most waiting, never join or mod`, () => {
    const queue = new InputQueue();
    // 2,000 accounts with a join and a line each, and one flooding account with orders.
    for (let i = 0; i < 2000; i++) {
      queue.push({ type: "join", account: `a${i}`, name: `name${i}`, role: "viewer" });
      queue.push(say(`a${i}`, `m${i}`));
    }
    expect(queue.size).toBe(MOST_WAITING);
    expect(queue.waiting("a0")).toEqual([
      { type: "join", account: "a0", name: "name0", role: "viewer" },
    ]);
    expect(queue.waiting("a1999")).toHaveLength(2);
    // Every line is gone; only joins and orders are left past the bound.
    for (let i = 0; i < 2000; i++) queue.push(go(`a${i}`, "river"));
    expect(queue.size).toBe(MOST_WAITING);
    const left = queue.take(10_000);
    expect(left.filter((input) => input.type === "say")).toEqual([]);
    expect(left.filter((input) => input.type === "join")).toHaveLength(2000);
    expect(left.filter((input) => input.type === "go")).toHaveLength(1000);
  });

  it("drops the orders of the account with the most waiting before an account with one", () => {
    const queue = new InputQueue();
    for (let i = 0; i < MOST_WAITING - 2; i++)
      queue.push({ type: "join", account: `j${i}`, name: `n${i}`, role: "viewer" });
    queue.push(go("quiet", "river"));
    queue.push(go("loud", "hills"));
    expect(queue.size).toBe(MOST_WAITING);
    // The loud account now has two waiting and the quiet one one: the loud one's newest goes.
    queue.push({ type: "me", account: "loud" });
    expect(queue.size).toBe(MOST_WAITING);
    expect(queue.waiting("quiet")).toEqual([go("quiet", "river")]);
    expect(queue.waiting("loud")).toEqual([go("loud", "hills")]);
    // Moderation is never dropped: orders make room for it, and past them the queue grows.
    const shut = { type: "mod", by: "m", action: { action: "doors", open: false } } as const;
    for (let i = 0; i < 3; i++) queue.push(shut);
    expect(queue.size).toBe(MOST_WAITING + 1);
    const left = queue.take(10_000);
    expect(left.filter((input) => input.type === "mod")).toHaveLength(3);
    expect(left.filter((input) => input.type === "join")).toHaveLength(MOST_WAITING - 2);
    expect(left.filter((input) => input.type === "go")).toEqual([]);
  });

  it("under a flood of !go from 30 accounts for a minute, holds one go each and lets another's order in within 2 ticks", () => {
    const chat = new Chat();
    const flooders = Array.from({ length: 30 }, (_, i) => `${5000 + i}`);
    const event = (account: string, id: string, text: string): ChatEvent => ({
      type: "message",
      id,
      account,
      login: `chatter${account}`,
      display: `chatter${account}`,
      text,
      role: "viewer",
      emotes: [],
    });
    let most = 0;
    let applied: number | null = null;
    const sentAt = 300;
    for (let tick = 0; tick < 600; tick++) {
      // Five a second each: one message every two ticks.
      if (tick % 2 === 0)
        for (const account of flooders)
          chat.hear(event(account, `${account}-${tick}`, `!go river${tick}`), tick);
      if (tick === sentAt) chat.hear(event("9999", "order", "!go hills"), tick);
      for (const account of flooders)
        most = Math.max(
          most,
          chat.queue.waiting(account).filter((input) => input.type === "go").length,
        );
      const inputs = chat.take(tick);
      if (inputs.some((input) => input.type === "go" && input.account === "9999")) applied = tick;
    }
    expect(most).toBe(1);
    expect(applied).not.toBeNull();
    expect((applied as number) - sentAt).toBeLessThanOrEqual(2);
  });
});
