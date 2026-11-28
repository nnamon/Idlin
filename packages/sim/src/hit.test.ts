import { describe, expect, it } from "vitest";
import {
  type Attacker,
  BARE_CRIT,
  blow,
  critChance,
  type DamageType,
  type Defender,
  FAMILY_HIT,
  FULL,
  hit,
  hitStages,
  life,
  MOST_CRIT,
  type Modifier,
  monsterArmour,
  monsterBlow,
  monsterLife,
  RANKS,
  rollCrit,
  weaponDamage,
} from "./hit.ts";
import { createRng, nextInt } from "./rng.ts";

const blade = (level: number): Attacker => ({ blow: blow(level), family: FAMILY_HIT.blade });
const maul = (level: number): Attacker => ({ blow: blow(level), family: FAMILY_HIT.maul });
const bare = { armour: 0 };
const added = (type: DamageType, amount: number): Modifier => ({
  kind: "added",
  type,
  amount,
});
const physical = (amount: number) => added("physical", amount);
const fire = (amount: number) => added("fire", amount);
const pct = (n: number): number => n * 100;
const increased = (n: number): Modifier => ({ kind: "increased", pct: pct(n) });
const more = (n: number, type?: DamageType): Modifier =>
  type === undefined ? { kind: "more", pct: pct(n) } : { kind: "more", pct: pct(n), type };
const only = (attacker: Attacker, defender: Defender, mods: Modifier[], crit = false) =>
  hit(attacker, defender, mods, crit).amount;

describe("the levels a hit starts from (plan.md, section 2.1)", () => {
  // Every row of plan.md's table, to the unit.
  const TABLE = [
    // level, base blow, hitpoints, blow with ordinary gear, fodder hp/hit, pack hp/hit, brute hp/hit, elite hp
    [5, 12, 95, 13, 13, 1, 39, 3, 158, 24, 528],
    [18, 40, 284, 54, 54, 3, 163, 13, 652, 83, 2_176],
    [38, 116, 708, 204, 204, 9, 612, 39, 2_449, 244, 8_166],
    [58, 232, 1_292, 501, 501, 20, 1_503, 81, 6_013, 510, 20_044],
    [78, 388, 2_036, 993, 993, 36, 2_979, 144, 11_919, 906, 39_731],
    [95, 552, 2_795, 1_600, 1_600, 54, 4_802, 218, 19_209, 1_362, 64_032],
  ] as const;
  for (const [
    L,
    base,
    hp,
    geared,
    fodder,
    fodderHit,
    pack,
    packHit,
    brute,
    bruteHit,
    elite,
  ] of TABLE) {
    it(`level ${L}`, () => {
      expect(blow(L)).toBe(base);
      expect(life(L)).toBe(hp);
      // The gear factor (100 + 2L)/100 is what the item tables are tuned to, not a rule of the hit.
      expect(Math.floor((blow(L) * (100 + 2 * L)) / 100)).toBe(geared);
      expect([monsterLife("fodder", L), monsterBlow("fodder", L)]).toEqual([fodder, fodderHit]);
      expect([monsterLife("pack", L), monsterBlow("pack", L)]).toEqual([pack, packHit]);
      expect([monsterLife("brute", L), monsterBlow("brute", L)]).toEqual([brute, bruteHit]);
      expect(monsterLife("elite", L)).toBe(elite);
    });
  }

  it("rounds a monster's hitpoints down once, after the rank, not per rank", () => {
    // 12 * 12 * 110 / 100 is 158.4; twelve fodder of 13 would be 156.
    expect(monsterLife("brute", 5)).toBe(158);
    expect(12 * monsterLife("fodder", 5)).toBe(156);
  });

  it("gives every monster a blow of 1 at least", () => {
    // Level 5: 95 * 105 / 100 = 99, and 1% of that rounds to 0.
    expect(monsterBlow("fodder", 5)).toBe(1);
    expect(monsterBlow("fodder", 1)).toBe(1);
  });

  it("gives each rank its blow's times (slice.md, section 1)", () => {
    expect(RANKS.fodder).toMatchObject({ windup: 3, recovery: 6 });
    expect(RANKS.pack).toMatchObject({ windup: 4, recovery: 8 });
    expect(RANKS.brute).toMatchObject({ windup: 6, recovery: 14 });
    expect(RANKS.elite).toMatchObject({ windup: 5, recovery: 10 });
  });

  it("gives brutes and elites armour of four times their level, and the rest none", () => {
    expect(monsterArmour("brute", 37)).toBe(148);
    expect(monsterArmour("elite", 27)).toBe(108);
    expect(monsterArmour("pack", 27)).toBe(0);
    expect(monsterArmour("fodder", 68)).toBe(0);
  });

  it("divides a weapon's own damage by 8, 6 or 4 for its family's three bases", () => {
    // blow(31) is 85, blow(66) is 289, blow(1) is 7.
    expect([weaponDamage(31, 0), weaponDamage(31, 1), weaponDamage(31, 2)]).toEqual([10, 14, 21]);
    expect(weaponDamage(66, 2)).toBe(72);
    expect(weaponDamage(1, 0)).toBe(0);
  });
});

describe("slice.md 4.1, example 1", () => {
  // goofguy, Arms 27, long blade of item level 31 with +10 physical, +12 fire
  // and +14% damage, on a level-27 pack monster with no armour or resistance.
  const mods = [physical(weaponDamage(31, 1)), physical(10), fire(12), increased(14)];
  const stages = hitStages(blade(27), bare, mods, false);

  it("matches the table row by row", () => {
    expect(stages.base).toEqual([93, 12, 0, 0]);
    expect(stages.family).toEqual([93, 12, 0, 0]);
    expect(stages.increased).toEqual([106, 13, 0, 0]);
    expect(stages.more).toEqual([106, 13, 0, 0]);
    expect(stages.crit).toEqual([106, 13, 0, 0]);
    expect(stages.target).toEqual([106, 13, 0, 0]);
  });

  it("does 119 of the pack monster's 318, so three blows", () => {
    const struck = hit(blade(27), bare, mods, false);
    expect(struck).toEqual({ parts: [106, 13, 0, 0], amount: 119, crit: false, type: "physical" });
    expect(monsterLife("pack", 27)).toBe(318);
    expect(Math.ceil(318 / struck.amount)).toBe(3);
  });

  it("puts its fire over the status line at level 27, a tenth of a fodder monster's 106", () => {
    expect(Math.floor(monsterLife("fodder", 27) / 10)).toBe(10);
    expect(stages.target[1]).toBeGreaterThanOrEqual(10);
  });
});

describe("slice.md 4.1, example 2", () => {
  // xXxKittyKatxXx, Arms 68, great maul of item level 66 with +60 physical,
  // +45 fire, +40% damage, "ignores 15% resistance" and 20% more fire damage,
  // and +30% damage on the charm, crits a level-37 brute on an ash waste.
  const mods: Modifier[] = [
    physical(weaponDamage(66, 2)),
    physical(60),
    fire(45),
    increased(40),
    { kind: "penetration", pct: pct(15) },
    more(20, "fire"),
    increased(30),
  ];
  const brute = { armour: monsterArmour("brute", 37), resist: { fire: pct(40) } };
  const stages = hitStages(maul(68), brute, mods, true);

  it("matches the table row by row", () => {
    expect(stages.base).toEqual([437, 45, 0, 0]);
    expect(stages.family).toEqual([961, 99, 0, 0]);
    expect(stages.increased).toEqual([1_633, 168, 0, 0]);
    expect(stages.more).toEqual([1_633, 201, 0, 0]);
    expect(stages.crit).toEqual([3_266, 402, 0, 0]);
    // Armour takes off 29; 40% less 15% is 25%, which takes off 100.
    expect(stages.target).toEqual([3_237, 302, 0, 0]);
  });

  it("does 3,539, and the brute's 2,317 hitpoints are gone", () => {
    const struck = hit(maul(68), brute, mods, true);
    expect(struck).toEqual({
      parts: [3_237, 302, 0, 0],
      amount: 3_539,
      crit: true,
      type: "physical",
    });
    expect(monsterLife("brute", 37)).toBe(2_317);
    expect(struck.amount).toBeGreaterThanOrEqual(2_317);
  });

  it("does not depend on where each line sits in the list", () => {
    const reversed = [...mods].reverse();
    expect(hit(maul(68), brute, reversed, true)).toEqual(hit(maul(68), brute, mods, true));
  });
});

describe("slice.md 4.3, armour and a monster's element", () => {
  const armour72 = { armour: 72 };

  it("takes most off small hits and little off big ones", () => {
    expect(monsterBlow("pack", 27)).toBe(23);
    expect(monsterBlow("brute", 27)).toBe(144);
    expect(only({ blow: 23, family: FULL }, armour72, [])).toBe(15);
    expect(only({ blow: 144, family: FULL }, armour72, [])).toBe(131);
  });

  it("costs a blade 16% and a maul 8% against a level-27 brute", () => {
    // A blow of 106 is Arms 27 in ordinary gear.
    const armour = { armour: monsterArmour("brute", 27) };
    const bladeHit = only({ blow: 106, family: FAMILY_HIT.blade }, armour, []);
    const maulHit = only({ blow: 106, family: FAMILY_HIT.maul }, armour, []);
    expect(bladeHit).toBe(89);
    expect(Math.floor(((106 - bladeHit) * 100) / 106)).toBe(16);
    expect(maulHit).toBe(214);
    expect(Math.floor(((233 - maulHit) * 100) / 233)).toBe(8);
  });

  // A level-27 brute's 144 on an ash waste, on goofguy with armour 72.
  const brute = { blow: monsterBlow("brute", 27), family: FULL, element: "fire" } as const;
  const rows = [
    [0, 60, 72, 132],
    [18, 60, 60, 120],
    [38, 60, 45, 105],
    [75, 60, 18, 78],
  ] as const;
  for (const [res, phys, fireLeft, total] of rows) {
    it(`gives ${total} through ${res}% fire resistance`, () => {
      const struck = hit(brute, { armour: 72, resist: { fire: pct(res) } }, [], false);
      expect(struck.parts).toEqual([phys, fireLeft, 0, 0]);
      expect(struck.amount).toBe(total);
    });
  }

  it("holds resistance at 75%", () => {
    const capped = hit(brute, { armour: 72, resist: { fire: pct(90) } }, [], false);
    expect(capped.amount).toBe(78);
  });

  it("is all fire on an All fire landing, and armour does nothing to it", () => {
    const allFire = { blow: 0, family: FULL };
    expect(only(allFire, { armour: 72 }, [fire(144)])).toBe(144);
    expect(hit(allFire, { armour: 72, resist: { fire: pct(75) } }, [fire(144)], false).amount).toBe(
      36,
    );
  });

  it("gives an odd blow's elemental half the rounded-down half", () => {
    const odd = hit({ blow: 145, family: FULL, element: "cold" }, bare, [], false);
    expect(odd.parts).toEqual([73, 0, 72, 0]);
  });
});

describe("slice.md section 6: a citizen at hour 1, 10 and 100", () => {
  it("hour 1: Arms 6, life 107, a blow of 13 with the blade it joined with", () => {
    expect(life(6)).toBe(107);
    const joined = only(blade(6), bare, [physical(weaponDamage(1, 0))]);
    expect(joined).toBe(13);
    // Yard fodder has 13 and fodder at the near end of ring 1 has 17.
    expect(monsterLife("fodder", 5)).toBe(13);
    expect(monsterLife("fodder", 7)).toBe(17);
    expect(Math.ceil(monsterLife("fodder", 5) / joined)).toBe(1);
    expect(Math.ceil(monsterLife("pack", 5) / joined)).toBe(3);
    expect(monsterBlow("brute", 7)).toBe(31);
  });

  it("hour 10: Arms 23, life 375, 85 from 55, 10 from the blade, +10 physical and +14%", () => {
    expect(life(23)).toBe(375);
    // A long blade of item level 25 is the lowest that gives 10.
    expect(weaponDamage(24, 1)).toBe(9);
    const lines = [physical(weaponDamage(25, 1)), physical(10)];
    const withLine = only(blade(23), bare, [...lines, increased(14)]);
    const without = only(blade(23), bare, lines);
    expect(withLine).toBe(85);
    expect(without).toBe(75);
    // Ring 2 is level 23: fodder 80, pack 240, a brute 963 with a hit of 115.
    expect(monsterLife("fodder", 23)).toBe(80);
    expect(monsterLife("pack", 23)).toBe(240);
    expect(monsterLife("brute", 23)).toBe(963);
    expect(Math.ceil(80 / withLine)).toBe(1);
    expect(Math.ceil(80 / without)).toBe(2);
    expect(Math.ceil(240 / withLine)).toBe(3);
    expect(monsterBlow("brute", 23)).toBe(115);
    expect(only({ blow: 115, family: FULL }, { armour: 72 }, [])).toBe(103);
  });

  it("hour 100: Arms 58, life 1,292, about 501 a blow against the far ground at level 68", () => {
    expect(life(58)).toBe(1_292);
    const geared = Math.floor((blow(58) * (100 + 2 * 58)) / 100);
    expect(geared).toBe(501);
    expect(monsterLife("fodder", 68)).toBe(719);
    expect(monsterLife("pack", 68)).toBe(2_159);
    expect(monsterLife("brute", 68)).toBe(8_637);
    expect(monsterBlow("brute", 68)).toBe(690);
    expect(Math.ceil(719 / geared)).toBe(2);
    expect(Math.ceil(2_159 / geared)).toBe(5);
    // A tenth of a level-68 fodder monster is the status line there.
    expect(Math.floor(monsterLife("fodder", 68) / 10)).toBe(71);
  });
});

// Each stage is checked on numbers where moving it one place, or leaving it
// out, gives another answer; the other answers are worked out in the comments.
describe("each stage, in its place", () => {
  it("added: joins the base before the family's share", () => {
    // (10 + 5) * 220% = 33. After the family: 10 * 220% + 5 = 27. Left out: 22.
    expect(only({ blow: 10, family: FAMILY_HIT.maul }, bare, [physical(5)])).toBe(33);
  });

  it("added: goes to its own type only", () => {
    const struck = hit({ blow: 10, family: FULL }, bare, [fire(4), added("lightning", 3)], false);
    expect(struck.parts).toEqual([10, 4, 0, 3]);
  });

  it("increased: comes after the family's share, and its lines are summed, not multiplied", () => {
    // 437 * 220% = 961, * 170% = 1,633. Before the family: 437 * 170% = 742, * 220% = 1,632.
    // Multiplied: 961 * 140% = 1,345, * 130% = 1,748. Left out: 961.
    const maulBlow = { blow: 437, family: FAMILY_HIT.maul };
    expect(only(maulBlow, bare, [increased(40), increased(30)])).toBe(1_633);
  });

  it("more: comes after the increased, each one on its own", () => {
    // 99 * 170% = 168, * 120% = 201. Before the increased: 99 * 120% = 118, * 170% = 200.
    // Counted with the increased: 99 * 190% = 188. Left out: 168.
    expect(only({ blow: 0, family: FULL }, bare, [fire(99), increased(70), more(20)])).toBe(201);
    // Two of 50% more: 100 * 150% = 150, * 150% = 225. Summed: 200.
    expect(only({ blow: 100, family: FULL }, bare, [more(50), more(50)])).toBe(225);
  });

  it("more: a less takes its percent off, and a typed one touches only its type", () => {
    expect(only({ blow: 100, family: FULL }, bare, [more(-30)])).toBe(70);
    const struck = hit({ blow: 100, family: FULL }, bare, [fire(100), more(20, "fire")], false);
    expect(struck.parts).toEqual([100, 120, 0, 0]);
  });

  it("crit: doubles every type after the more and before the target", () => {
    const brute = { armour: 148, resist: { fire: pct(25) } };
    const mods = [fire(168), more(20, "fire")];
    // Fire: 168 * 120% = 201, doubled 402, less 25% is 302. Crit before the
    // more: 336 * 120% = 403, less 25% is 303. After the target: 151 * 2 = 302,
    // so the physical part tells those apart.
    const struck = hit({ blow: 1_633, family: FULL }, brute, mods, true);
    // Physical: 3,266 less 29 is 3,237. Crit after the armour: 1,633 less 29 is 1,604, doubled 3,208.
    expect(struck.parts).toEqual([3_237, 302, 0, 0]);
    expect(hit({ blow: 1_633, family: FULL }, brute, mods, false).parts).toEqual([
      1_604, 151, 0, 0,
    ]);
  });

  it("armour: comes off physical last, as hit * armour / (armour + 5 * hit)", () => {
    // 23 * 72 / 187 = 8.85, so 8 comes off. Left out: 23.
    expect(only({ blow: 23, family: FULL }, { armour: 72 }, [])).toBe(15);
    // 23 * 220% = 50, less 50 * 72 / 322 = 11.18: 39. Armour before the family: 15 * 220% = 33.
    expect(only({ blow: 23, family: FAMILY_HIT.maul }, { armour: 72 }, [])).toBe(39);
  });

  it("resistance: less what the attacker ignores, held between 0 and 75%", () => {
    const pen = (n: number): Modifier => ({ kind: "penetration", pct: pct(n) });
    const at = (res: number, mods: Modifier[]) =>
      only({ blow: 0, family: FULL }, { armour: 0, resist: { fire: pct(res) } }, [
        fire(100),
        ...mods,
      ]);
    expect(at(40, [pen(15)])).toBe(75);
    expect(at(10, [pen(15)])).toBe(100);
    expect(at(90, [pen(10)])).toBe(25);
    // Two lines of penetration add up.
    expect(at(40, [pen(10), pen(10)])).toBe(80);
  });
});

describe("rounding", () => {
  it("rounds every stage down", () => {
    const stages = hitStages(
      { blow: 7, family: 15_000 },
      { armour: 3 },
      [increased(15), more(15)],
      true,
    );
    // 7 * 150% = 10.5, * 115% = 11.5, * 115% = 12.65, doubled 24, less 24 * 3 / 123 = 0.58.
    expect(stages.family[0]).toBe(10);
    expect(stages.increased[0]).toBe(11);
    expect(stages.more[0]).toBe(12);
    expect(stages.crit[0]).toBe(24);
    expect(stages.target[0]).toBe(24);
  });

  it("rounds what resistance and armour take off down, so what is left rounds up", () => {
    // 402 * 25% = 100.5: 100 comes off.
    const fireHit = only({ blow: 0, family: FULL }, { armour: 0, resist: { fire: pct(25) } }, [
      fire(402),
    ]);
    expect(fireHit).toBe(302);
  });

  it("holds percentages in hundredths of a percent", () => {
    // +0.5% on 1,000 is 1,005; whole percents could not say it.
    expect(only({ blow: 1_000, family: FULL }, bare, [{ kind: "increased", pct: 50 }])).toBe(1_005);
  });

  it("does 1 when a hit with anything in it comes to nothing", () => {
    // 1 with 50% less is 0.5, which rounds to 0.
    expect(only({ blow: 1, family: FULL }, bare, [more(-50)])).toBe(1);
    expect(only({ blow: 1, family: FULL }, bare, [more(-100)])).toBe(1);
  });

  it("does nothing with a blow of nothing", () => {
    expect(hit({ blow: 0, family: FULL }, bare, [], true)).toEqual({
      parts: [0, 0, 0, 0],
      amount: 0,
      crit: true,
      type: "physical",
    });
  });

  it("names the type with the largest part, physical first on a tie", () => {
    expect(hit({ blow: 10, family: FULL }, bare, [fire(11)], false).type).toBe("fire");
    expect(hit({ blow: 10, family: FULL }, bare, [fire(10)], false).type).toBe("physical");
    expect(hit({ blow: 0, family: FULL }, bare, [fire(5), added("cold", 5)], false).type).toBe(
      "fire",
    );
  });

  it("stays a 32-bit whole number however big the lines are", () => {
    const huge = hit(
      { blow: 2_000_000_000, family: FAMILY_HIT.maul },
      bare,
      [more(10_000), increased(10_000)],
      true,
    );
    expect(huge.amount).toBe(0x7fff_ffff);
    expect(Number.isInteger(huge.amount)).toBe(true);
    // Hostile lines below nothing count as nothing.
    expect(only({ blow: 100, family: FULL }, bare, [physical(-1_000)])).toBe(0);
    expect(only({ blow: 100, family: FULL }, bare, [increased(-500)])).toBe(1);
    expect(only({ blow: 100, family: FULL }, { armour: -50 }, [])).toBe(100);
  });
});

describe("the crit roll", () => {
  it("starts at 5% and adds every crit line, up to 40%", () => {
    expect(critChance([])).toBe(BARE_CRIT);
    expect(BARE_CRIT).toBe(500);
    expect(
      critChance([
        { kind: "crit", pct: pct(12) },
        { kind: "crit", pct: pct(6) },
      ]),
    ).toBe(2_300);
    expect(critChance([{ kind: "crit", pct: pct(60) }])).toBe(MOST_CRIT);
    expect(MOST_CRIT).toBe(4_000);
    expect(critChance([{ kind: "crit", pct: -pct(20) }])).toBe(0);
  });

  it("draws one roll below 10,000 from the generator, and crits below the chance", () => {
    const rng = createRng(7);
    const copy = createRng(7);
    for (let i = 0; i < 1_000; i++) {
      const crit = rollCrit(rng, []);
      expect(crit).toBe(nextInt(copy, FULL) < BARE_CRIT);
    }
    expect(rng).toEqual(copy);
  });

  it("crits on 5,000 of 100,000 swings at 5%, give or take 275", () => {
    // sqrt(100,000 * 0.05 * 0.95) is 68.9, and 4 of those is 275.
    const rng = createRng(383);
    let crits = 0;
    for (let i = 0; i < 100_000; i++) if (rollCrit(rng, [])) crits++;
    expect(Math.abs(crits - 5_000)).toBeLessThanOrEqual(275);
  });

  it("never crits at 0%", () => {
    const rng = createRng(1);
    const none: Modifier[] = [{ kind: "crit", pct: -BARE_CRIT }];
    for (let i = 0; i < 10_000; i++) expect(rollCrit(rng, none)).toBe(false);
  });
});
