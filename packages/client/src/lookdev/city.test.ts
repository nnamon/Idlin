import { describe, expect, it } from "vitest";
import { CITY_SPEED, type CityState, footfalls, GAIT_SECONDS, hullPose } from "./city.ts";
import { BLOW_CONTACT, detailFor, lookOf, swinging } from "./figure.ts";
import { onTwos } from "./fx.ts";
import { itemName, usernameOf } from "./names.ts";

const walking = (t: number): CityState => ({
  t,
  gait: t / GAIT_SECONDS,
  walk: 1,
  settle: 0,
  ramp: 0,
  crowd: [],
  aboard: () => true,
});

describe("the city's gait", () => {
  it("never has fewer than five of its eight feet on the ground", () => {
    for (let t = 0; t < GAIT_SECONDS * 2; t += 0.05) {
      const down = footfalls(walking(t)).filter((foot) => foot.age < 90).length;
      expect(down).toBeGreaterThanOrEqual(5);
    }
  });

  it("does not slide a planted foot: it goes astern at exactly the city's speed", () => {
    const dt = 0.02;
    let checked = 0;
    for (let t = 0; t < GAIT_SECONDS; t += 0.31) {
      const before = footfalls(walking(t));
      const after = footfalls(walking(t + dt));
      before.forEach((foot, i) => {
        const next = after[i] as (typeof after)[number];
        if (foot.age > 90 || next.age > 90 || next.age < foot.age) return;
        expect((foot.x - next.x) / dt).toBeCloseTo(CITY_SPEED, 6);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(40);
  });

  it("takes between a second and a half and two seconds to swing a leg", () => {
    // A foot is in the air for the part of the cycle it is not planted.
    let air = 0;
    const dt = 0.01;
    for (let t = 0; t < GAIT_SECONDS; t += dt)
      if ((footfalls(walking(t))[0] as { age: number }).age > 90) air += dt;
    expect(air).toBeGreaterThan(1.5);
    expect(air).toBeLessThan(2);
  });

  it("dips the hull toward a lifted leg and sinks onto folded legs to park", () => {
    const heights = Array.from({ length: 60 }, (_, i) => hullPose(walking(i * 0.1)).height);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(1.5);
    const rolls = Array.from({ length: 60 }, (_, i) => hullPose(walking(i * 0.1)).roll);
    expect(Math.max(...rolls) - Math.min(...rolls)).toBeGreaterThan(0.006);
    const parked = hullPose({ ...walking(3), walk: 0, settle: 1 }).height;
    expect(parked).toBeLessThan(Math.min(...heights) - 80);
  });
});

describe("a citizen", () => {
  it("keeps the colours the game already gives its id, and has a username of its own", () => {
    const first = lookOf(1);
    expect(first.cloak).toBe(0xc8442f);
    const names = new Set(Array.from({ length: 250 }, (_, i) => usernameOf(i)));
    expect(names.size).toBe(250);
    // Chat usernames: 3 to 25 characters of letters, digits and underscores, never a first name.
    for (const name of names) expect(name).toMatch(/^[A-Za-z0-9_]{3,25}$/);
    const fifteen = Array.from({ length: 15 }, (_, i) => usernameOf(i));
    expect(Math.max(...fifteen.map((name) => name.length))).toBe(25);
    expect(Math.min(...fifteen.map((name) => name.length))).toBe(3);
    // Two of the first fifteen differ from another by a single character.
    expect(fifteen).toContain("goofguy");
    expect(fifteen).toContain("goofguy_");
    expect(fifteen).toContain("joshyboy88");
    expect(fifteen).toContain("joshyboy89");
    for (const npc of ["Ash", "Birch", "Cedar", "Dara", "Elm", "Fen"])
      expect(names.has(npc)).toBe(false);
    expect(first.name).toBe(usernameOf(0));
    // Items are named from a base and affixes; only a unique has a name of its own.
    expect(itemName(5, 0, 0).split(" ").length).toBeLessThanOrEqual(2);
    expect(itemName(5, 2, 0)).toMatch(/^\w+ .+ of /);
    expect(itemName(5, 3, 0)).not.toMatch(/ of |^The /);
    const pairs = new Set(
      Array.from({ length: 56 }, (_, i) => `${lookOf(i + 1).cloak}:${lookOf(i + 1).hood}`),
    );
    expect(pairs.size).toBe(56);
  });

  it("is drawn with more of itself the larger it stands", () => {
    expect(detailFor(30)).toBe(0);
    expect(detailFor(54)).toBe(1);
    expect(detailFor(96)).toBe(2);
    for (let px = 20; px < 120; px++)
      expect(detailFor(px + 1)).toBeGreaterThanOrEqual(detailFor(px));
  });

  it("coils away from the target before a blow, by more than fifteen degrees, weapon arm behind the head", () => {
    const coiled = swinging(BLOW_CONTACT - 0.071, 1);
    expect(coiled.lean).toBeLessThan(-(15 * Math.PI) / 180);
    expect(coiled.arm).toBeGreaterThan(Math.PI * 0.9);
    // At contact it is thrown forward, the arm at full reach in front.
    const contact = swinging(BLOW_CONTACT, 1);
    expect(contact.lean).toBeGreaterThan(0.3);
    expect(contact.arm).toBeGreaterThan(1);
    expect(contact.arm).toBeLessThan(2);
    // The hem arrives late: still behind the body at contact, ahead of it in the follow-through.
    expect(contact.trail).toBeGreaterThan(0);
    expect(swinging(BLOW_CONTACT + 0.2, 1).trail).toBeLessThan(0);
  });
});

describe("ink marks", () => {
  it("are held drawings: they change twelve times a second, not every frame", () => {
    const seen = new Set<number>();
    for (let frame = 0; frame < 60; frame++) seen.add(onTwos(frame / 60));
    expect(seen.size).toBe(12);
  });
});
