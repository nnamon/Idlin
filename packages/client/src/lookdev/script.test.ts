import { describe, expect, it } from "vitest";
import { BRUTE, census, citizenAt, FODDER, makeFight, monsterAt, RAMP } from "./script.ts";

const small = { seed: 362, citizens: 12, monsters: 110, seconds: 12, prizeAt: 6.5 } as const;

describe("the fight at the ramp, as scripted", () => {
  const fight = makeFight(small);

  it("is the same fight every time it is written from the same seed", () => {
    const again = makeFight(small);
    expect(again.hits.length).toBe(fight.hits.length);
    expect(again.hits.at(-1)).toEqual(fight.hits.at(-1));
    expect(Array.from(again.cx.slice(-12))).toEqual(Array.from(fight.cx.slice(-12)));
    expect(makeFight({ ...small, seed: 363 }).hits.at(-1)).not.toEqual(fight.hits.at(-1));
  });

  it("keeps its numbers up, and holds the line near the ramp", () => {
    for (const t of [0.5, 4, 8, 11.5])
      expect(census(fight, t).monsters).toBeGreaterThanOrEqual(100);
    for (let i = 0; i < small.citizens; i++) {
      for (const t of [0, 6, 11.9]) {
        const [x, y] = citizenAt(fight, i, t);
        expect(x).toBeGreaterThan(RAMP.x);
        expect(x).toBeLessThan(RAMP.x + 26);
        expect(Math.abs(y)).toBeLessThan(13);
      }
    }
  });

  it("records blows in order, each with the hit-stop its target earns", () => {
    expect(fight.hits.length).toBeGreaterThan(100);
    for (let i = 1; i < fight.hits.length; i++)
      expect((fight.hits[i] as { t: number }).t).toBeGreaterThanOrEqual(
        (fight.hits[i - 1] as { t: number }).t,
      );
    const stops = new Set(fight.swings.flat().map((swing) => Math.round(swing.stop * 60)));
    // No blow that missed holds; fodder holds two frames, anything bigger four.
    expect([...stops].every((frames) => [0, 2, 4].includes(frames))).toBe(true);
    expect(stops.has(2)).toBe(true);
    for (const swing of fight.swings.flat()) expect(swing.stop > 0).toBe(swing.hits > 0);
  });

  it("drops something from every kill, and exactly one unique: the one the script calls for", () => {
    const kills = fight.hits.filter((hit) => hit.kill);
    expect(fight.drops.length).toBe(kills.length);
    const uniques = fight.drops.filter((drop) => drop.rarity === 3);
    expect(uniques.length).toBe(1);
    expect((uniques[0] as { t: number }).t).toBeGreaterThanOrEqual(6.5);
    // It lies there a while before anyone takes it: the news has time to name it.
    expect(
      (uniques[0] as { pick: number; t: number }).pick - (uniques[0] as { t: number }).t,
    ).toBeGreaterThan(3);
    // Most of what drops is common.
    expect(fight.drops.filter((drop) => drop.rarity === 0).length).toBeGreaterThan(
      fight.drops.length * 0.6,
    );
  });

  it("throws what it hits along the blow, and a dead monster stays where it fell", () => {
    const hurt = fight.hits.find(
      (hit) => !hit.kill && (fight.monsters[hit.slot] as { kind: number }).kind !== BRUTE,
    );
    expect(hurt).toBeDefined();
    if (hurt) {
      const m = fight.monsters[hurt.slot] as (typeof fight.monsters)[number];
      const at = monsterAt(fight, m, hurt.t) as [number, number];
      const later = monsterAt(fight, m, Math.min(hurt.t + 0.3, m.died)) as [number, number];
      // Further along the blow than it was.
      expect((later[0] - at[0]) * hurt.dx + (later[1] - at[1]) * hurt.dy).toBeGreaterThan(0.1);
    }
    const dead = fight.monsters.find((m) => m.kind === FODDER && m.died < 6);
    expect(dead).toBeDefined();
    if (dead)
      expect(monsterAt(fight, dead, dead.died + 2)).toEqual(monsterAt(fight, dead, dead.died + 4));
  });
});

describe("the bench's load", () => {
  it("is 150 citizens, 450 monsters alive and at least a hundred shots in the air", () => {
    const bench = makeFight({ seed: 362, citizens: 150, monsters: 450, seconds: 8, volley: true });
    expect(bench.options.citizens).toBe(150);
    for (const t of [2, 4, 6]) {
      const { monsters, shots } = census(bench, t);
      expect(monsters).toBeGreaterThanOrEqual(440);
      expect(shots).toBeGreaterThanOrEqual(100);
    }
  });
});
