import { readFileSync } from "node:fs";
import { USERNAME } from "@idlin/sim";
import { describe, expect, it } from "vitest";
import { Chat } from "./chat.ts";
import { accountFor, CrowdError, crowdEvents, parseCrowd } from "./crowd.ts";

const shipped = (name: string): string =>
  readFileSync(new URL(`../../../content/chat/${name}.txt`, import.meta.url), "utf8");

/** Every message a crowd sends over its first `ticks` ticks, with the tick it came at. */
const transcript = (text: string, ticks: number): string[] => {
  const crowd = parseCrowd(text);
  const lines: string[] = [];
  for (let tick = 0; tick < ticks; tick++)
    for (const event of crowdEvents(crowd, tick))
      if (event.type === "message") lines.push(`${tick} ${event.display}: ${event.text}`);
  return lines;
};

describe("the crowd files", () => {
  for (const [name, size] of [
    ["crowd-15", 15],
    ["crowd-150", 150],
  ] as const) {
    it(`${name} has ${size} chatters, each with a username of 3 to 25 letters, digits and underscores`, () => {
      const crowd = parseCrowd(shipped(name));
      expect(crowd.chatters).toHaveLength(size);
      for (const chatter of crowd.chatters) expect(chatter.login).toMatch(USERNAME);
      expect(new Set(crowd.chatters.map((c) => c.login.toLowerCase())).size).toBe(size);
      // Every one of them has said something within the first ten minutes.
      const spoke = new Set(transcript(shipped(name), 6000).map((line) => line.split(" ")[1]));
      expect(spoke.size).toBe(size);
    });
  }

  it("gives the same inputs twice from the same file, and the same at a tick whatever was asked before", () => {
    const text = shipped("crowd-150");
    const run = (): string => {
      const chat = new Chat({ crowd: parseCrowd(text) });
      const out: string[] = [];
      for (let tick = 0; tick < 9000; tick++) out.push(JSON.stringify(chat.take(tick)));
      return out.join("\n");
    };
    const first = run();
    expect(run()).toBe(first);
    expect(first.length).toBeGreaterThan(10_000);
    const crowd = parseCrowd(text);
    const at = [7000, 30, 4321, 0, 1800];
    const forwards = at.map((tick) => JSON.stringify(crowdEvents(crowd, tick)));
    const again = [...at].reverse().map((tick) => JSON.stringify(crowdEvents(crowd, tick)));
    expect(again.reverse()).toEqual(forwards);
  });

  it("a crowd of 150 at full chat stays under the 32 inputs a tick it is drained at", () => {
    const chat = new Chat({ crowd: parseCrowd(shipped("crowd-150")) });
    let most = 0;
    for (let tick = 0; tick < 9000; tick++) {
      chat.take(tick);
      most = Math.max(most, chat.queue.size);
    }
    // The raid and the 60% !home put more than a tick's worth in at once; it drains within seconds.
    expect(most).toBeLessThan(200);
    expect(chat.queue.size).toBeLessThan(32);
  });
});

describe("the crowd format", () => {
  const names = "names aaa_one bbb_two ccc_three ddd_four";

  it("brings chatters in at their time, spread over `over`, each with a first line", () => {
    const lines = transcript(`seed 3\n${names}\n00:10 +2 lurkers over 5s\n00:20 +2 lurkers`, 400);
    expect(lines).toHaveLength(4);
    const ticks = lines.map((line) => Number(line.split(" ")[0]));
    expect(ticks.slice(0, 2).every((t) => t >= 100 && t < 150)).toBe(true);
    expect(ticks.slice(2)).toEqual([200, 200]);
  });

  it("gives each kind its period: talkers every 20 s, and `every` sets another", () => {
    const talk = transcript(`${names}\n00:00 +1 talkers`, 1200).map((l) => Number(l.split(" ")[0]));
    // A first line at 0, then one in each 20-second period after it.
    expect(talk[0]).toBe(0);
    expect(talk.length).toBe(6);
    for (let n = 1; n < talk.length; n++) {
      expect(talk[n]).toBeGreaterThanOrEqual(n * 200);
      expect(talk[n]).toBeLessThan((n + 1) * 200);
    }
    expect(transcript(`${names}\n00:00 +1 talkers every 5s`, 1200)).toHaveLength(24);
  });

  it("has a spammer send ten lines a second for five seconds of each minute", () => {
    const lines = transcript(`${names}\n00:00 +1 spammers`, 1200);
    expect(lines).toHaveLength(100);
    expect(lines.every((line) => line.includes("!go "))).toBe(true);
  });

  it("says explicit lines at their time, and sends a share to that part of those who have arrived", () => {
    const text = [
      "seed 9",
      "names aaa_one bbb_two ccc_three ddd_four eee_five fff_six ggg_seven hhh_eight",
      "mods bbb_two",
      "streamer aaa_one",
      "00:00 +8 lurkers",
      "00:05 Zed_Visitor: hello there",
      "01:00 * 50% !home",
    ].join("\n");
    const crowd = parseCrowd(text);
    const hello = crowdEvents(crowd, 50);
    expect(hello).toEqual([
      {
        type: "message",
        id: "c50-0",
        account: accountFor("zed_visitor"),
        login: "zed_visitor",
        display: "Zed_Visitor",
        text: "hello there",
        role: "viewer",
        emotes: [],
      },
    ]);
    const home = crowdEvents(crowd, 600);
    expect(home.every((event) => event.type === "message" && event.text === "!home")).toBe(true);
    // Nine have arrived; a seeded half of them, give or take, are sent.
    expect(home.length).toBeGreaterThan(1);
    expect(home.length).toBeLessThan(9);
    const roles = crowdEvents(crowd, 0).map((event) =>
      event.type === "message" ? event.role : "",
    );
    expect(roles.slice(0, 3)).toEqual(["streamer", "mod", "viewer"]);
  });

  it("refuses a file it cannot read, naming the line", () => {
    const bad: [string, RegExp][] = [
      ["seed x", /line 1: seed/],
      ["names ok_name x", /line 1: "x" is not a username/],
      ["names aaa_one\n00:00 +2 regulars", /groups need more/],
      ["names aaa_one aaa_ONE", /aaa_one twice/],
      ["00:00 +1 dancers", /line 1: the kind must be one of/],
      ["00:00 +0 regulars", /line 1: "\+0" is not a count/],
      ["0:61 +1 regulars", /line 1: "0:61" is not a time/],
      ["names aaa_one\n00:00 +1 lurkers every 5s", /line 2: lurkers have no period/],
      [
        "names aaa_one\n00:00 +1 talkers every 0s",
        /line 2: lurkers have no period, and a period must be over 0/,
      ],
      ["names aaa_one\n00:00 +1 talkers often 5s", /line 2: "often"/],
      ["names aaa_one\n00:00 +1 talkers every soon", /line 2: "soon" is not a span/],
      ["00:00 * 0% hi", /line 1: "\* " needs a share/],
      ["00:00 * 50%", /line 1: nothing to say/],
      ["00:00 hello", /line 1: expected/],
      ["00:00 x: hi", /line 1: "x" is not a username/],
      ["00:00 aaa_one:", /line 1: expected/],
    ];
    for (const [text, message] of bad) {
      expect(() => parseCrowd(text), text).toThrow(CrowdError);
      expect(() => parseCrowd(text), text).toThrow(message);
    }
    expect(() => parseCrowd("\n".repeat(10_001))).toThrow(CrowdError);
  });

  it("gives a username the same account id every time, in any capitals", () => {
    expect(accountFor("GoofGuy")).toBe(accountFor("goofguy"));
    expect(accountFor("goofguy")).not.toBe(accountFor("goofguy2"));
    expect(accountFor("goofguy")).toMatch(/^\d+$/);
  });
});
