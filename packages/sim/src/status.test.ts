// The statuses of docs/slice.md section 4.2 and the defences of 4.3, as rules
// on their own: each line, each time and lockout to the tick, and the rows of
// 4.3's table worked through `hit`.

import { describe, expect, it } from "vitest";
import {
  type Attacker,
  blow,
  type Defender,
  FAMILY_HIT,
  hit,
  life,
  monsterArmour,
  monsterBlow,
  monsterLife,
  type Parts,
  type Rank,
} from "./hit.ts";
import {
  citizenLine,
  LOCKOUT_TICKS,
  noStatus,
  passTick,
  STATUS_TICKS,
  type Status,
  setBurn,
  slowed,
  staggerLine,
  statusLine,
  type Taker,
  takeHit,
} from "./status.ts";

const monster = (rank: Rank, level: number): Taker => ({
  citizen: false,
  life: monsterLife(rank, level),
  level,
  ticks: STATUS_TICKS[rank],
});
const citizen = (hp: number): Taker => ({ citizen: true, life: hp, level: 1, ticks: 40 });
const parts = (physical: number, fire: number, cold: number, lightning: number): Parts => [
  physical,
  fire,
  cold,
  lightning,
];
/** Ticks until `count` of `status` reaches 0, passing one tick at a time. */
const ticksUntilOff = (status: Status, count: keyof Status): number => {
  let ticks = 0;
  while (status[count] > 0) {
    passTick(status);
    ticks++;
  }
  return ticks;
};

describe("the line a status is set at (4.2)", () => {
  it("is a tenth of a fodder monster's life at the target's level: 10 at 27, 71 at 68", () => {
    expect(statusLine(27)).toBe(10);
    expect(statusLine(68)).toBe(71);
    expect(statusLine(27)).toBe(Math.floor(monsterLife("fodder", 27) / 10));
  });

  it("Example 1's 13 fire burns a level-27 pack monster for 13 a second; 9 does not burn it", () => {
    const status = noStatus();
    const took = takeHit(status, parts(106, 13, 0, 0), monster("pack", 27), 1);
    expect(took.burn).toBe(true);
    expect(status).toMatchObject({ burn: 40, burnDamage: 13, burnBy: 1, burnJumps: 1 });
    // Its 106 physical is over the pack monster's 31 too, so it staggers it.
    expect(status.staggerLock).toBe(LOCKOUT_TICKS);
    const cool = noStatus();
    expect(takeHit(cool, parts(0, 9, 0, 0), monster("pack", 27), 1).burn).toBe(false);
    expect(cool).toEqual(noStatus());
    // 10 is the line itself, and enough.
    expect(takeHit(noStatus(), parts(0, 10, 0, 0), monster("pack", 27), 1).burn).toBe(true);
  });

  it("sets a chill and a shock at the same line, and nothing for a part of 0 under a line of 0", () => {
    const status = noStatus();
    const took = takeHit(status, parts(0, 0, 10, 10), monster("fodder", 27), 1);
    expect(took).toEqual({ stagger: false, burn: false, chill: true, freeze: false, shock: true });
    expect(status).toMatchObject({ chill: 40, shock: 40 });
    // At level 1 the line is 0: any part over nothing sets it, and none sets nothing.
    expect(statusLine(1)).toBe(0);
    const bare = noStatus();
    expect(takeHit(bare, parts(0, 0, 0, 0), monster("fodder", 1), 1).chill).toBe(false);
    expect(takeHit(bare, parts(0, 0, 1, 0), monster("fodder", 1), 1).chill).toBe(true);
  });

  it("staggers at a tenth of the target's own life: a blade staggers a pack monster, only a maul a brute", () => {
    expect(staggerLine(318)).toBe(31);
    // At Arms 27, against level-27 monsters: a pack monster has no armour, a
    // brute 108 (4.3).
    const arms = { blow: blow(27) };
    const blade = { ...arms, family: FAMILY_HIT.blade };
    const maul = { ...arms, family: FAMILY_HIT.maul };
    const pack = { armour: monsterArmour("pack", 27) };
    const brute = { armour: monsterArmour("brute", 27) };
    const staggers = (attacker: Attacker, defender: Defender, rank: Rank): boolean =>
      takeHit(noStatus(), hit(attacker, defender, [], false).parts, monster(rank, 27), 1).stagger;
    expect(hit(blade, pack, [], false).parts[0]).toBe(69);
    expect(staggers(blade, pack, "pack")).toBe(true);
    // A blade's 69 less 16 for armour is 53, under the brute's 127.
    expect(staggerLine(monsterLife("brute", 27))).toBe(127);
    expect(hit(blade, brute, [], false).parts[0]).toBe(53);
    expect(staggers(blade, brute, "brute")).toBe(false);
    expect(hit(maul, brute, [], false).parts[0]).toBe(133);
    expect(staggers(maul, brute, "brute")).toBe(true);
  });

  it("never staggers a citizen, and sets an element's status on one at 5% of its life", () => {
    expect(citizenLine(455)).toBe(22);
    const status = noStatus();
    const took = takeHit(status, parts(455, 21, 22, 0), citizen(455), 7);
    expect(took).toEqual({ stagger: false, burn: false, chill: true, freeze: false, shock: false });
    expect(status.staggerLock).toBe(0);
  });

  it("on a citizen, a burn does a fifth of the part a second and never jumps", () => {
    const status = noStatus();
    takeHit(status, parts(60, 72, 0, 0), citizen(455), 7);
    expect(status).toMatchObject({ burn: 40, burnDamage: 14, burnBy: 7, burnJumps: 0 });
  });
});

describe("how long a status lasts, to the tick (4.2)", () => {
  const RANKS: Rank[] = ["fodder", "pack", "brute", "elite"];
  const SECONDS: Record<Rank, number> = { fodder: 4, pack: 4, brute: 2, elite: 1 };

  it("4 seconds on fodder and pack monsters, 2 on a brute and 1 on an elite", () => {
    for (const rank of RANKS) {
      const ticks = SECONDS[rank] * 10;
      const status = noStatus();
      takeHit(status, parts(0, 1000, 1000, 1000), monster(rank, 30), 1);
      expect(status).toMatchObject({ burn: ticks, chill: ticks, shock: ticks });
      const chill = { ...status };
      expect(ticksUntilOff(chill, "chill")).toBe(ticks);
      const shock = { ...status };
      expect(ticksUntilOff(shock, "shock")).toBe(ticks);
      const burn = { ...status };
      expect(ticksUntilOff(burn, "burn")).toBe(ticks);
    }
  });

  it("a burn burns once a whole second has passed, as many times as it lasts seconds, and jumps at the first", () => {
    for (const rank of RANKS) {
      const status = noStatus();
      takeHit(status, parts(0, 1000, 0, 0), monster(rank, 30), 1);
      const burnt: number[] = [];
      const jumped: number[] = [];
      for (let tick = 1; tick <= 60; tick++) {
        const passed = passTick(status);
        if (passed.burnt > 0) burnt.push(tick);
        if (passed.jump) jumped.push(tick);
      }
      expect(burnt).toEqual([10, 20, 30, 40].slice(0, SECONDS[rank]));
      expect(jumped).toEqual([10]);
      // Burnt out, a burn holds nothing.
      expect(status).toEqual(noStatus());
    }
  });

  it("a jumped burn does not jump", () => {
    const status = noStatus();
    setBurn(status, 6, 1, 0, 40);
    let jumps = 0;
    for (let tick = 0; tick < 40; tick++) if (passTick(status).jump) jumps++;
    expect(jumps).toBe(0);
  });

  it("a stagger cannot come again for 2 seconds: not at 19 ticks, again at 20", () => {
    const status = noStatus();
    const brute = monster("brute", 1);
    expect(takeHit(status, parts(1000, 0, 0, 0), brute, 1).stagger).toBe(true);
    expect(status.staggerLock).toBe(LOCKOUT_TICKS);
    for (let tick = 1; tick < 20; tick++) {
      passTick(status);
      expect(takeHit(status, parts(1000, 0, 0, 0), brute, 1).stagger).toBe(false);
    }
    passTick(status);
    expect(takeHit(status, parts(1000, 0, 0, 0), brute, 1).stagger).toBe(true);
  });

  it("a second cold hit freezes a chilled target for half the status time, then not again for 2 seconds", () => {
    for (const rank of RANKS) {
      const ticks = SECONDS[rank] * 10;
      const cold = parts(0, 0, 1000, 0);
      const taker = monster(rank, 30);
      const status = noStatus();
      // The first chills only.
      expect(takeHit(status, cold, taker, 1)).toMatchObject({ chill: true, freeze: false });
      passTick(status);
      expect(takeHit(status, cold, taker, 1)).toMatchObject({ chill: true, freeze: true });
      // The chill starts its time again.
      expect(status).toMatchObject({ chill: ticks, freeze: ticks / 2 });
      // A third cold hit while frozen does not freeze it again.
      expect(takeHit(status, cold, taker, 1).freeze).toBe(false);
      let thawedAt = 0;
      for (let tick = 1; thawedAt === 0; tick++) if (passTick(status).thawed) thawedAt = tick;
      expect(thawedAt).toBe(ticks / 2);
      expect(status.freezeLock).toBe(LOCKOUT_TICKS);
      // Chilled and over the line, but locked out of a freeze for 20 ticks.
      for (let tick = 1; tick < 20; tick++) {
        passTick(status);
        expect(takeHit(status, cold, taker, 1)).toMatchObject({ chill: true, freeze: false });
      }
      passTick(status);
      expect(takeHit(status, cold, taker, 1)).toMatchObject({ chill: true, freeze: true });
    }
  });

  it("a cold hit on a target that is not chilled does not freeze it, however hard", () => {
    const status = noStatus();
    expect(takeHit(status, parts(0, 0, 1_000_000, 0), monster("fodder", 1), 1).freeze).toBe(false);
  });
});

describe("statuses do not stack (4.2)", () => {
  it("the stronger burn stands; one as strong takes over, keeping its place in the second; a weaker one changes nothing", () => {
    const status = noStatus();
    const pack = monster("pack", 27);
    takeHit(status, parts(0, 30, 0, 0), pack, 1);
    for (let i = 0; i < 15; i++) passTick(status);
    expect(status).toMatchObject({ burn: 25, burnDamage: 30, burnBy: 1, burnJumps: 0 });
    expect(takeHit(status, parts(0, 20, 0, 0), pack, 2).burn).toBe(false);
    expect(status).toMatchObject({ burn: 25, burnDamage: 30, burnBy: 1 });
    expect(takeHit(status, parts(0, 30, 0, 0), pack, 2).burn).toBe(true);
    expect(status).toMatchObject({ burn: 35, burnDamage: 30, burnBy: 2, burnJumps: 1 });
    expect(takeHit(status, parts(0, 50, 0, 0), pack, 3).burn).toBe(true);
    expect(status).toMatchObject({ burn: 35, burnDamage: 50, burnBy: 3 });
  });

  it("a burn set again every few ticks still burns once a second", () => {
    const status = noStatus();
    const pack = monster("pack", 27);
    let burns = 0;
    for (let t = 0; t < 60; t++) {
      if (t % 5 === 0) takeHit(status, parts(0, 30, 0, 0), pack, 1);
      if (passTick(status).burnt > 0) burns++;
    }
    expect(burns).toBe(6);
  });

  it("a chill or a shock set again starts its time again", () => {
    const status = noStatus();
    const fodder = monster("fodder", 1);
    takeHit(status, parts(0, 0, 5, 5), fodder, 1);
    for (let i = 0; i < 30; i++) passTick(status);
    expect(status).toMatchObject({ chill: 10, shock: 10 });
    status.freezeLock = 1; // so the second cold hit only chills
    takeHit(status, parts(0, 0, 5, 5), fodder, 1);
    expect(status).toMatchObject({ chill: 40, shock: 40, freeze: 0 });
  });
});

describe("chill", () => {
  it("makes steps and blows take half as long again, rounded down", () => {
    expect([2, 3, 4, 5, 6, 14].map(slowed)).toEqual([3, 4, 6, 7, 9, 21]);
  });
});

describe("the table in 4.3: a level-27 brute's 144 on an ash waste, on goofguy (armour 72, 455 life)", () => {
  const brute = { blow: monsterBlow("brute", 27), family: 10_000, element: "fire" as const };
  const rows = [
    { resist: 0, takes: [60, 72], total: 132, burns: true },
    { resist: 1_800, takes: [60, 60], total: 120, burns: true },
    { resist: 3_800, takes: [60, 45], total: 105, burns: true },
    { resist: 7_500, takes: [60, 18], total: 78, burns: false },
  ];

  it("starts from a blow of 144, half of it fire", () => {
    expect(life(27)).toBe(455);
    expect(brute.blow).toBe(144);
    expect(hit(brute, { armour: 0 }, [], false).parts).toEqual([72, 72, 0, 0]);
  });

  for (const row of rows) {
    it(`at ${row.resist / 100}% fire resistance takes ${row.takes.join(" + ")} = ${row.total}, and ${row.burns ? "burns" : "does not burn"}`, () => {
      const struck = hit(brute, { armour: 72, resist: { fire: row.resist } }, [], false);
      expect(struck.parts).toEqual([row.takes[0], row.takes[1], 0, 0]);
      expect(struck.amount).toBe(row.total);
      expect(takeHit(noStatus(), struck.parts, citizen(455), 9).burn).toBe(row.burns);
    });
  }

  it("resistance stops at 75%: 90% takes what 75% does", () => {
    const capped = hit(brute, { armour: 72, resist: { fire: 9_000 } }, [], false);
    expect(capped.parts).toEqual([60, 18, 0, 0]);
  });

  it("armour 72 makes a level-27 pack monster's 23 into 15 and a brute's 144 into 131", () => {
    const physical = (n: number): number =>
      hit({ blow: n, family: 10_000 }, { armour: 72 }, [], false).amount;
    expect(monsterBlow("pack", 27)).toBe(23);
    expect(physical(23)).toBe(15);
    expect(physical(144)).toBe(131);
  });
});
