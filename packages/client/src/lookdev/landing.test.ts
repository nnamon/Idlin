import { describe, expect, it } from "vitest";
import { BRUTE_PARTS, eliteSail } from "./beasts.ts";
import { deckCorners, TRANSIT_TILE, TRANSIT_X, TRANSIT_Y } from "./deck.ts";
import { Draw } from "./draw.ts";
import {
  expedition150Scene,
  expeditionLanding,
  expeditionScene,
  fightDen,
  populateMid,
  revealScene,
} from "./expeditions.ts";
import { lookOf } from "./figure.ts";
import { ACT, BRUTE, citizenAt, ELITE, HOUND, monsterAt, runFray } from "./fray.ts";
import { numberBox } from "./fx.ts";
import { boundedSides, growMid, type Landing } from "./land.ts";
import type { LandingScene } from "./landing.ts";
import { itemName, usernameOf } from "./names.ts";
import { makeScene, type Probe } from "./scenes.ts";
import {
  ACCENT,
  arcStateAt,
  arcsOf,
  BREAK,
  DARK_HIT,
  LIGHT,
  LIT,
  litAt,
  poolAt,
  postsFor,
  SIEGE_LEVEL,
  siege150Scene,
  siegeScene,
  siegeShield,
  UNLIT,
} from "./siege.ts";
import {
  BACK,
  cornerBoxes,
  crosses,
  FRAME,
  headBox,
  leaderOf,
  type PlacedTag,
  TAG_CALLED,
  tagBox,
  UP,
} from "./stage.ts";
import type { Face, Surface } from "./surface.ts";
import { footAt, LEGS, rampFoot, WALK_SPEED } from "./topcity.ts";

// The sweeps over whole scenes sample sparsely in the gate and fully with IDLIN_LONG=1, which the
// capture workflow sets on every push to main. Drawing a frame or reading its tags lays the tags out
// a sixtieth of a second at a time from the scene's start, so in the gate the scenes of 150 are
// sampled over their first seconds only.
const LONG = process.env.IDLIN_LONG === "1";
const STEP = LONG ? 0.1 : 0.5;
/** How far into a scene of 150 the gate's sweeps go. */
const EARLY = 11;
/** The time limit for a sweep, sized for its full run. */
const SWEEP = LONG ? 600_000 : undefined;

// One of each scene for the whole file: a scene lays its tags out frame by frame from the start,
// and keeps what it has laid out.
const made = new Map<string, unknown>();
const once = <T>(name: string, make: () => T): T => {
  if (!made.has(name)) made.set(name, make());
  return made.get(name) as T;
};
const expedition = (): LandingScene => once("expedition", expeditionScene);
const expedition150 = (): LandingScene => once("expedition150", expedition150Scene);
const reveal = (): LandingScene => once("reveal", revealScene);
const siege = (): LandingScene => once("siege", siegeScene);
const siege150 = (): LandingScene => once("siege150", siege150Scene);
const LANDINGS: Readonly<Record<string, () => LandingScene>> = {
  expedition,
  expedition150,
  reveal,
  siege,
  siege150,
};
const named = (name: string): ReturnType<typeof makeScene> =>
  LANDINGS[name]?.() ?? once(name, () => makeScene(name));

/** A surface that draws nothing and keeps every string lettered on it. */
function recorder(): Surface & { words: Set<string> } {
  const words = new Set<string>();
  return {
    kind: "canvas",
    words,
    vertices: 0,
    begin() {},
    anchor() {},
    poly() {},
    strip() {},
    brush() {},
    text(_face: Face, _size: number, s: string) {
      words.add(s);
    },
    paper() {},
    end() {},
    finish() {},
  };
}

const LOOK_TARGET = [
  "deck",
  "deck150",
  "reveal",
  "expedition",
  "expedition-b",
  "expedition150",
  "siege",
  "siege150",
];

const meet = (a: readonly number[], b: readonly number[]): boolean =>
  (a[0] as number) < (b[2] as number) &&
  (a[2] as number) > (b[0] as number) &&
  (a[1] as number) < (b[3] as number) &&
  (a[3] as number) > (b[1] as number);

const seen = (tags: readonly PlacedTag[]): PlacedTag[] => tags.filter((tag) => tag.alpha > 0.5);
const boxOf = (tag: PlacedTag): [number, number, number, number] =>
  tagBox(tag.cx, tag.base, tag.w, tag.size);

/** No two tags meet and none lies over a head, at the moment `t`. */
function tagsClear(p: Probe, t: number): void {
  const boxes = seen(p.tags).map(boxOf);
  for (let a = 0; a < boxes.length; a++)
    for (let b = a + 1; b < boxes.length; b++)
      expect(
        meet(boxes[a] as number[], boxes[b] as number[]),
        `two tags meet at ${t.toFixed(1)} s`,
      ).toBe(false);
  const heads = p.citizens.map((c) => headBox(c.x, c.y, c.size));
  for (const box of boxes)
    for (const head of heads)
      expect(meet(box, head), `a tag on a head at ${t.toFixed(1)} s`).toBe(false);
}

describe("the name tags over the expedition, at 36 px", () => {
  const scene = expedition();
  it(
    "never meet, never lie over a head, and never move more than 4 px against their owner between frames",
    () => {
      let samples = 0;
      let checked = 0;
      for (let t = 0; t < 39.9; t += STEP) {
        const p = scene.probe(t);
        tagsClear(p, t);
        for (const tag of seen(p.tags)) expect(tag.size).toBeGreaterThanOrEqual(36);
        // A sixtieth of a second later, each tag has moved no more than 4 px against its owner.
        const next = scene.probe(t + 1 / 60);
        // (A tag faded right out in either frame is not seen, so it is not seen to move.)
        for (const tag of p.tags) {
          const later = next.tags.find((q) => q.key === tag.key);
          if (!later || tag.alpha <= 0 || later.alpha <= 0) continue;
          const moved = Math.hypot(
            later.cx - later.x - (tag.cx - tag.x),
            later.base - later.y - (tag.base - tag.y),
          );
          expect(moved).toBeLessThanOrEqual(4);
          checked++;
        }
        samples++;
      }
      expect(samples).toBeGreaterThan(39.9 / STEP - 1);
      expect(checked).toBeGreaterThan((39.9 / STEP - 1) * 12);
    },
    SWEEP,
  );

  it("names everyone out (thirteen until one comes home), and those aboard four at a time", () => {
    for (const t of [4, 14, 21, 34]) {
      const p = scene.probe(t);
      const tags = seen(p.tags);
      expect(tags.filter((tag) => tag.key < 1000).length, `out at ${t} s`).toBe(p.out);
      expect(p.out).toBeGreaterThanOrEqual(12);
      expect(tags.filter((tag) => tag.key >= 1000).length, `aboard at ${t} s`).toBeLessThanOrEqual(
        4,
      );
    }
  });
});

describe("the name tags over the expedition at 150, at 30 px", () => {
  const scene = expedition150();
  it(
    "never meet or lie over a head; at most 24 shown, of which at most six are called at 48 px",
    () => {
      let called = 0;
      for (let t = 0; t < (LONG ? 39.9 : EARLY); t += LONG ? 0.5 : 2) {
        const p = scene.probe(t);
        tagsClear(p, t);
        const tags = seen(p.tags);
        expect(tags.length, `at ${t} s`).toBeLessThanOrEqual(24);
        const big = tags.filter((tag) => tag.size === TAG_CALLED);
        expect(big.length).toBeLessThanOrEqual(6);
        for (const tag of tags) if (tag.size !== TAG_CALLED) expect(tag.size).toBe(30);
        called += big.length;
      }
      expect(called).toBeGreaterThan(0);
    },
    SWEEP,
  );

  it("has both called tags up at 10 s", () => {
    expect(seen(expedition150().probe(10).tags).filter((tag) => tag.called).length).toBe(2);
  });
});

describe("the name tags on the deck in transit, at 30 px", () => {
  const scene = named("deck");
  it("name all fifteen, and no leader crosses another", () => {
    let crossings = 0;
    for (let t = 0; t < scene.duration - 0.1; t += 0.5) {
      const p = scene.probe?.(t) as Probe;
      const tags = seen(p.tags);
      expect(tags.length, `at ${t} s`).toBe(15);
      const leaders = tags
        .map((tag) => leaderOf(tag.cx, tag.base, tag.size, tag.x, tag.y, tag.w))
        .filter((l): l is [number, number, number, number] => l !== null);
      for (let a = 0; a < leaders.length; a++)
        for (let b = a + 1; b < leaders.length; b++)
          if (
            crosses(
              ...(leaders[a] as [number, number, number, number]),
              ...(leaders[b] as [number, number, number, number]),
            )
          )
            crossings++;
    }
    expect(crossings).toBe(0);
  });
});

describe("the city in transit", () => {
  it("keeps all eight feet inside the rule and clear of the corner slips over a whole gait", () => {
    const crowd = Array.from({ length: 15 }, (_, i) => lookOf(i + 1));
    const slips = cornerBoxes(deckCorners(crowd, 15, 0));
    for (let t = 0; t < 5.6; t += 0.1)
      for (const leg of LEGS) {
        const f = footAt(leg, t / 5.6, 1, 0);
        const x = TRANSIT_X + f.x * TRANSIT_TILE;
        const y = TRANSIT_Y + f.y * BACK * TRANSIT_TILE - f.lift * UP * TRANSIT_TILE;
        // The foot plate: 29 px either side, 12 px above and below.
        const plate = [x - 29, y - 10, x + 29, y + 16];
        expect(plate[0]).toBeGreaterThan(FRAME.x0);
        expect(plate[2]).toBeLessThan(FRAME.x1);
        expect(plate[1]).toBeGreaterThan(FRAME.y0);
        expect(plate[3]).toBeLessThan(FRAME.y1);
        for (let k = 0; k < slips.length; k += 4)
          expect(
            meet(plate, slips.slice(k, k + 4)),
            `a foot under a slip at ${t.toFixed(1)} s`,
          ).toBe(false);
      }
  });
});

describe("what a frame letters", () => {
  const usernames = new Set(Array.from({ length: 200 }, (_, i) => usernameOf(i)));
  const items = new Set<string>();
  for (let seed = 0; seed < 600; seed++)
    for (let rarity = 0; rarity < 4; rarity++)
      for (let kind = 0; kind < 4; kind++) items.add(itemName(seed, rarity, kind));
  const labels = new Set([
    "den",
    "landing",
    "march",
    "shield",
    "lift-off",
    "packs",
    "rares",
    "down",
    "Medium",
    "Large",
  ]);
  const fits = (s: string): boolean =>
    usernames.has(s) ||
    items.has(s) ||
    /^\d+$/.test(s) ||
    /^\d+:\d\d$/.test(s) ||
    /^\d+\/\d+$/.test(s) ||
    /^(−\d+\.\d|0\.0)$/.test(s) ||
    s.split(" ").every((w) => labels.has(w) || /^(\d+|\d+–\d+|×\d+|\+\d+%|[A-H])$/.test(w));

  it(
    "is only usernames, numbers, item names and the plain labels, in every scene of the look target",
    () => {
      for (const name of LOOK_TARGET) {
        const scene = named(name);
        const surface = recorder();
        const d = new Draw(surface);
        // A frame's tags are laid out from the start, so the gate letters each scene up to 14 s, and
        // a scene of 150 up to 4 s.
        const frames = LONG
          ? [0.5, 4, 14, Math.min(28, scene.duration - 0.5)]
          : name.endsWith("150")
            ? [0.5, 4]
            : [0.5, 4, 14];
        for (const t of frames) {
          if (t >= scene.duration) continue;
          surface.begin();
          d.reset();
          scene.draw(d, t);
        }
        const odd = [...surface.words].filter((s) => !fits(s));
        expect(odd, name).toEqual([]);
        expect(surface.words.size, name).toBeGreaterThan(8);
      }
    },
    SWEEP,
  );

  it("letters each den with its letter and level, A to H on the expedition's map", () => {
    const L = expeditionLanding();
    const dens = L.pockets.filter((p) => p.kind === "den");
    expect(dens.map((p) => p.letter).sort()).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
    const surface = recorder();
    expedition().draw(new Draw(surface), 4);
    for (const p of dens) expect(surface.words.has(`den ${p.letter} ${p.level}`)).toBe(true);
  });
});

describe("who is in each scene", () => {
  it(
    "adds up to 15 or 150 at every sampled second, and never more than 700 monsters",
    () => {
      for (const name of LOOK_TARGET) {
        const scene = named(name);
        const total = name.endsWith("150") ? 150 : 15;
        const end = LONG || total === 15 ? scene.duration : EARLY;
        for (let t = 0; t < end; t += LONG ? 1 : 4) {
          const p = scene.probe?.(t) as Probe;
          expect(p.out + p.aboard, `${name} at ${t} s`).toBe(total);
          expect(p.monsters, `${name} at ${t} s`).toBeLessThanOrEqual(700);
        }
      }
    },
    SWEEP,
  );

  it("has at least 550 monsters alive in the expedition at 4 s, no more than 150 of them awake", () => {
    const f = expedition().fray();
    let alive = 0;
    let awake = 0;
    for (let j = 0; j < f.script.monsters.length; j++) {
      const b = monsterAt(f, j, 4);
      if (b.act === ACT.dead || b.act === ACT.hidden) continue;
      alive++;
      if (b.wake > 1.5) awake++;
    }
    expect(alive).toBeGreaterThanOrEqual(550);
    expect(awake).toBeLessThanOrEqual(150);
  });

  it(
    "keeps about 600 on the plate at 150, between 500 and 700 at every second",
    () => {
      const scene = expedition150();
      for (let t = 0; t < (LONG ? scene.duration : EARLY); t += LONG ? 1 : 4) {
        const p = scene.probe(t);
        expect(p.monsters, `at ${t} s`).toBeGreaterThanOrEqual(500);
        expect(p.monsters, `at ${t} s`).toBeLessThanOrEqual(700);
      }
    },
    SWEEP,
  );
});

describe("how awake a monster is", () => {
  it("is never fully awake with no citizen within ten tiles and no blow on it in the last two seconds, in the expedition", () => {
    const f = expedition().fray();
    const out = (t: number): [number, number][] =>
      f.script.citizens
        .map((_, i) => citizenAt(f, i, t))
        .filter((b) => b.act !== ACT.aboard && b.act !== ACT.down)
        .map((b) => [b.x, b.y]);
    let awake = 0;
    for (let t = 2; t < 40; t += 0.5) {
      const now = out(t);
      const before = out(t - 2);
      for (let j = 0; j < f.script.monsters.length; j++) {
        const b = monsterAt(f, j, t);
        if (b.act === ACT.dead || b.act === ACT.hidden || b.wake < 1.99) continue;
        awake++;
        const near = (cs: [number, number][]): boolean =>
          cs.some(([x, y]) => Math.hypot(x - b.x, y - b.y) < 10.5);
        // A blow on it lately: a hit within a tile and a half of it in the last two seconds (a bolt from the deck, say).
        const struck = f.hits.some(
          (h) => h.t <= t && t - h.t < 2.1 && Math.hypot(h.x - b.x, h.y - b.y) < 1.5,
        );
        expect(near(now) || near(before) || struck, `monster ${j} awake alone at ${t} s`).toBe(
          true,
        );
      }
    }
    expect(awake).toBeGreaterThan(1000);
  });

  it("is at rest for most of the plate before anyone is near: the reveal at 11 s has its sentinels alert and nobody awake", () => {
    const fray = reveal().fray();
    let alert = 0;
    for (let j = 0; j < fray.script.monsters.length; j++) {
      const b = monsterAt(fray, j, 11);
      expect(b.wake).toBeLessThan(1.5);
      if (b.wake > 0.5) alert++;
    }
    expect(alert).toBeLessThan(fray.script.monsters.length / 6);
  });
});

/** Every body's reach on the ground, across and down, in tiles, by rank: they lie along it. */
const BODY: readonly (readonly [number, number])[] = [
  [0.5, 0.3],
  [1.0, 0.4],
  [1.3, 0.6],
  [0.9, 0.5],
];
const reach = (kind: number): number => (BODY[kind] as readonly [number, number])[0];

describe("the packs on the expedition's map", () => {
  const L = expeditionLanding();
  const mr = populateMid(L, 362);
  const groups = [...mr.holds.flat(), ...mr.between];
  it("keep two tiles of open ground between one pack at rest and the next, across or down", () => {
    let pairs = 0;
    for (let a = 0; a < groups.length; a++)
      for (let b = a + 1; b < groups.length; b++) {
        let gap = Number.POSITIVE_INFINITY;
        for (const i of (groups[a] as { members: number[] }).members)
          for (const j of (groups[b] as { members: number[] }).members) {
            const m = mr.roster.monsters[i] as { x: number; y: number; kind: number };
            const n = mr.roster.monsters[j] as { x: number; y: number; kind: number };
            const [mx, my] = BODY[m.kind] as readonly [number, number];
            const [nx, ny] = BODY[n.kind] as readonly [number, number];
            gap = Math.min(
              gap,
              Math.max(Math.abs(m.x - n.x) - mx - nx, Math.abs(m.y - n.y) - my - ny),
            );
          }
        expect(gap, `groups ${a} and ${b}`).toBeGreaterThanOrEqual(2);
        pairs++;
      }
    expect(pairs).toBeGreaterThan(1000);
  });

  it("hold the brief's ranks: brutes with pack monsters, brute packs, eight elites, about 600 in all", () => {
    const count = (k: number): number => mr.roster.monsters.filter((m) => m.kind === k).length;
    expect(count(ELITE)).toBe(8);
    expect(count(BRUTE)).toBeGreaterThanOrEqual(12);
    expect(count(HOUND)).toBeGreaterThanOrEqual(30);
    expect(mr.roster.monsters.length).toBeGreaterThanOrEqual(560);
    expect(mr.roster.monsters.length).toBeLessThanOrEqual(700);
  });

  it("leave a third of the ground with nothing on it but ground marks", () => {
    let quiet = 0;
    let total = 0;
    for (let y = 0.5; y < L.rows; y += 1)
      for (let x = 0.5; x < L.cols; x += 1) {
        total++;
        if (mr.roster.monsters.some((m) => Math.hypot(m.x - x, m.y - y) < reach(m.kind) + 0.5))
          continue;
        if (L.pockets.some((p) => Math.hypot(p.x - x, (p.y - y) * 1.5) < 3)) continue;
        if (
          L.masses.some((m) => {
            for (let k = 0; k < m.base.length; k += 2)
              if (
                Math.abs((m.base[k] as number) - x) < 1.2 &&
                (m.base[k + 1] as number) - y > -0.5 &&
                (m.base[k + 1] as number) - y < 2.5
              )
                return true;
            return false;
          })
        )
          continue;
        if (
          L.things.some(
            ([tx, ty, , size]) => Math.hypot(tx - x, ty - y) < Math.max(0.8, size * 0.5),
          )
        )
          continue;
        if (Math.abs(x - L.city.x) < 8 && Math.abs(y - L.city.y) < 4) continue;
        quiet++;
      }
    expect(quiet / total).toBeGreaterThanOrEqual(1 / 3);
  });
});

describe("the mid landing's pockets", () => {
  for (const [name, L] of [
    ["the expedition's map", expeditionLanding()],
    ["expedition-b's map", growMid({ seed: 2, rampSide: -1 })],
  ] as const)
    it(`number 26 on ${name}, each bounded on two sides or more`, () => {
      expect(L.pockets.length).toBe(26);
      for (const p of L.pockets)
        expect(boundedSides(L as Landing, p), `pocket ${p.n}`).toBeGreaterThanOrEqual(2);
    });

  it("put the expedition's four fights at least 14 tiles apart, on three sides of the city or more", () => {
    const L = expeditionLanding();
    // The den fight is at the south-west den; the chest, the nest and the south at their roles.
    const fights = [
      fightDen(L),
      ...L.roles.slice(1, 4).map((i) => L.pockets[i] as { x: number; y: number }),
    ];
    for (let a = 0; a < 4; a++)
      for (let b = a + 1; b < 4; b++) {
        const p = fights[a] as { x: number; y: number };
        const q = fights[b] as { x: number; y: number };
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(14);
      }
    const sides = new Set(
      fights.map(
        (p) =>
          ((Math.round(Math.atan2(p.y - L.city.y, p.x - L.city.x) / (Math.PI / 2)) % 4) + 4) % 4,
      ),
    );
    expect(sides.size).toBeGreaterThanOrEqual(3);
  });
});

describe("a brute", () => {
  // Every part of it at rest, its far limbs set back as the drawing sets them.
  const parts = [
    BRUTE_PARTS.body,
    BRUTE_PARTS.head,
    BRUTE_PARTS.fore,
    BRUTE_PARTS.hind,
    BRUTE_PARTS.fore.map((v, i) => (i % 2 ? v : v - 0.08)),
    BRUTE_PARTS.hind.map((v, i) => (i % 2 ? v : v + 0.06)),
  ];
  /** Where a row crosses the drawing: the x of each crossing, sorted. */
  const crossings = (y: number): number[] => {
    const xs: number[] = [];
    for (const poly of parts)
      for (let i = 0, n = poly.length / 2; i < n; i++) {
        const ax = poly[i * 2] as number;
        const ay = poly[i * 2 + 1] as number;
        const bx = poly[((i + 1) % n) * 2] as number;
        const by = poly[((i + 1) % n) * 2 + 1] as number;
        if (ay > y !== by > y) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
      }
    return xs.sort((a, b) => a - b);
  };
  it("is widest above its middle height, and no wider than it is tall", () => {
    let widest = 0;
    let at = 0;
    for (let y = -0.99; y < -0.01; y += 0.01) {
      const xs = crossings(y);
      if (xs.length < 2) continue;
      const w = (xs.at(-1) as number) - (xs[0] as number);
      if (w > widest) {
        widest = w;
        at = y;
      }
    }
    expect(at).toBeLessThan(-0.5);
    expect(widest).toBeLessThanOrEqual(1);
  });

  it("has ground under its belly, a fifth of its height, between its hind legs and its forelimbs", () => {
    for (const y of [-0.05, -0.1, -0.17]) {
      // The row is inside the drawing between pairs of crossings; between the legs it is not.
      const xs = crossings(y);
      const covered = (x: number): boolean => xs.filter((c) => c < x).length % 2 === 1;
      let gap = 0;
      for (let x = -0.1; x < 0.2; x += 0.01) if (!covered(x)) gap += 0.01;
      expect(gap, `at ${y}`).toBeGreaterThan(0.12);
    }
  });
});

describe("every fight's numbers", () => {
  it(
    "include one of 36 px or more whenever a fight has a number, in the expedition",
    () => {
      const scene = expedition();
      let fights = 0;
      for (let t = 0.5; t < 40; t += LONG ? 0.25 : 0.5) {
        const nums = scene.probe(t).numbers;
        for (const n of nums) {
          const fight = nums.filter((q) => Math.hypot(q.tx - n.tx, q.ty - n.ty) <= 4);
          expect(Math.max(...fight.map((q) => q.size)), `at ${t} s`).toBeGreaterThanOrEqual(36);
          fights++;
        }
      }
      expect(fights).toBeGreaterThan(100);
    },
    SWEEP,
  );
});

/** Each half of the frame, cut through the hull's middle across and then down, has its share. */
function halves(scene: LandingScene, t: number): void {
  const p = scene.probe(t);
  const [hx, hy] = p.hull;
  const out = p.citizens.filter((c) => c.outside);
  const monsters: [number, number][] = [];
  for (let i = 0; i < p.monsterPoints.length; i += 2)
    monsters.push([p.monsterPoints[i] as number, p.monsterPoints[i + 1] as number]);
  const pockets: [number, number][] = [];
  for (let i = 0; i < p.pocketPoints.length; i += 2)
    pockets.push([p.pocketPoints[i] as number, p.pocketPoints[i + 1] as number]);
  for (const [axis, mid] of [
    [0, hx],
    [1, hy],
  ] as const)
    for (const side of [-1, 1]) {
      const inHalf = (x: number, y: number): boolean => ((axis === 0 ? x : y) - mid) * side > 0;
      expect(out.filter((c) => inHalf(c.x, c.y)).length).toBeGreaterThanOrEqual(out.length / 5);
      expect(monsters.filter(([x, y]) => inHalf(x, y)).length).toBeGreaterThanOrEqual(
        monsters.length / 5,
      );
      expect(pockets.filter(([x, y]) => inHalf(x, y)).length).toBeGreaterThanOrEqual(2);
    }
}

describe("every citizen out", () => {
  // The cover test from the look pass on #371: at every sampled half second, each citizen out has
  // its head clear of every burst, number, tag and body, and no more than a third of its figure
  // under them, or it is drawn again on top as an outline. A body (a monster drawn after it) may
  // be outlined round; a burst, a number or a tag never lies over a citizen at all. What lies over
  // whom is what the scene recorded as it drew the frame, in the order it drew it.
  for (const name of ["expedition", "siege", "siege150"])
    it(
      `can be found, whole or as an outline, at every sampled moment of ${name}`,
      () => {
        const scene = named(name) as LandingScene;
        // The gate draws once a second, and the scene of 150 over its first seconds only.
        const step = LONG ? STEP : 1;
        const end = LONG || !name.endsWith("150") ? scene.duration : EARLY;
        let checked = 0;
        let outlined = 0;
        for (let t = 0; t < end; t += step) {
          scene.draw(new Draw(recorder()), t);
          const at = `at ${t.toFixed(1)} s`;
          for (const c of scene.covers()) {
            for (const kind of ["burst", "number", "tag"] as const) {
              expect(c.over[kind].head, `a ${kind} on ${c.i}'s head ${at}`).toBe(false);
              expect(c.over[kind].share, `a ${kind} over ${c.i} ${at}`).toBeLessThanOrEqual(1 / 3);
            }
            const body = c.over.body;
            if (body.head || body.share > 1 / 3)
              expect(c.outlined, `${c.i} under a body and not outlined ${at}`).toBe(true);
            if (c.outlined) outlined++;
            checked++;
          }
          // And no number lies over another or over a tag.
          const p = scene.probe(t);
          const nums = p.numbers.map((n) => numberBox(n.x, n.y, n.value, n.size, n.size === 48));
          for (let a = 0; a < nums.length; a++) {
            for (let b = a + 1; b < nums.length; b++)
              expect(meet(nums[a] as number[], nums[b] as number[]), `two numbers meet ${at}`).toBe(
                false,
              );
            for (const tag of p.tags.filter((q) => q.alpha > 0.45))
              expect(meet(nums[a] as number[], boxOf(tag)), `a number on a tag ${at}`).toBe(false);
          }
        }
        expect(checked).toBeGreaterThan((end / step) * 5);
        expect(outlined).toBeGreaterThan(0);
      },
      SWEEP,
    );
});

describe("the halves test", () => {
  it("passes on the expedition at 14 s and on the expedition at 150 at 10 s", () => {
    halves(expedition(), 14);
    halves(expedition150(), 10);
  });
});

describe("the shield in the siege", () => {
  const { sh, places } = siegeShield();
  const L = expeditionLanding();
  const step = LONG ? 0.1 : 0.5;

  it("cuts the foot into one arc a post, each changing to the next midway between them", () => {
    const arcs = arcsOf(sh);
    const n = arcs.length;
    const turn = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
    let round = 0;
    arcs.forEach((arc, k) => {
      const p = sh.posts[k] as { a: number };
      const prev = sh.posts[(k + n - 1) % n] as { a: number };
      const next = sh.posts[(k + 1) % n] as { a: number };
      // Its ends are midway to each neighbour, and the next arc starts where it ends.
      expect(p.a - arc.a0).toBeCloseTo(Math.abs(turn(p.a - prev.a)) / 2, 9);
      expect(arc.a1 - p.a).toBeCloseTo(Math.abs(turn(next.a - p.a)) / 2, 9);
      expect(turn((arcs[(k + 1) % n] as { a0: number }).a0 - arc.a1)).toBeCloseTo(0, 9);
      round += arc.a1 - arc.a0;
    });
    expect(round).toBeCloseTo(Math.PI * 2, 9);
  });

  it("draws each post's arc of the foot's band and the wall or near strip lit exactly while its lamp is", () => {
    // A surface that keeps the band's strips and the wall's and strip's fills, by colour.
    const strips: { rgb: number; xy: number[] }[] = [];
    const fills: { rgb: number; xy: number[] }[] = [];
    const surface: Surface = {
      ...recorder(),
      strip(xy, n, rgb) {
        if (rgb === ACCENT || rgb === UNLIT)
          strips.push({ rgb, xy: Array.from(xy).slice(0, n * 4) });
      },
      poly(xy, n, rgb) {
        if (rgb === LIT || rgb === UNLIT) fills.push({ rgb, xy: Array.from(xy).slice(0, n * 2) });
      },
    };
    const scene = siege();
    const inPoly = (xy: number[], x: number, y: number): boolean => {
      let hit = false;
      for (let i = 0, j = xy.length - 2; i < xy.length; j = i, i += 2) {
        const xi = xy[i] as number;
        const yi = xy[i + 1] as number;
        const xj = xy[j] as number;
        const yj = xy[j + 1] as number;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    };
    let checked = 0;
    // From the second after the lighting run, when the wall has risen all round.
    const from = Math.ceil(LIGHT + 2);
    for (let t = from; t < BREAK; t += 1) {
      strips.length = 0;
      fills.length = 0;
      scene.draw(new Draw(surface), t);
      const [ox, oy, T] = (scene.probe(t).extra as { view: [number, number, number] }).view;
      const lit = litAt(sh, t);
      const states = arcStateAt(sh, t);
      sh.posts.forEach((p, k) => {
        expect(states[k], `post ${k} at ${t} s`).toBe(lit[k] ? "lit" : "dark");
        const fx = ox + p.x * T;
        const fy = oy + p.y * T;
        // The band: the strip vertex nearest the post's foot is in the accent exactly while it is lit.
        let near = Number.POSITIVE_INFINITY;
        let rgb = -1;
        for (const s of strips)
          for (let i = 0; i < s.xy.length; i += 2) {
            const dist = Math.hypot((s.xy[i] as number) - fx, (s.xy[i + 1] as number) - fy);
            if (dist < near) {
              near = dist;
              rgb = s.rgb;
            }
          }
        expect(near, `the band by post ${k} at ${t} s`).toBeLessThan(10);
        expect(rgb === ACCENT, `the band by post ${k} at ${t} s`).toBe(lit[k]);
        // The wall or the near strip, 3 px outside the foot on the post's ray: lit or unlit with it.
        const [qx, qy] = sh.at(p.a, 3 / T);
        const fill = fills.find((q) => inPoly(q.xy, ox + qx * T, oy + qy * T));
        expect(fill, `the wall by post ${k} at ${t} s`).toBeDefined();
        expect(fill?.rgb === LIT, `the wall by post ${k} at ${t} s`).toBe(lit[k]);
        checked++;
      });
    }
    expect(checked).toBe(sh.posts.length * (BREAK - from));
  });

  it("has ten posts and two more a level, eighteen at the scene's level 4", () => {
    expect([0, 2, 4, 7, 10].map(postsFor)).toEqual([10, 14, 18, 24, 30]);
    expect(sh.posts.length).toBe(postsFor(SIEGE_LEVEL));
    expect(SIEGE_LEVEL).toBe(4);
  });

  it("stands round the planted feet and the ramp's foot, the way out midway between two posts", () => {
    const foot = rampFoot(1);
    expect(sh.outside(L.city.x + foot[0], L.city.y + foot[1])).toBeLessThan(-1);
    for (const [fx, fy] of [
      [-10, -7],
      [10, -7],
      [-10, 7],
      [10, 7],
    ] as const)
      expect(sh.outside(L.city.x + fx, L.city.y + fy)).toBeLessThan(-0.5);
    const near = [...sh.posts].sort(
      (a, b) =>
        Math.abs(Math.atan2(Math.sin(a.a - sh.rampAngle), Math.cos(a.a - sh.rampAngle))) -
        Math.abs(Math.atan2(Math.sin(b.a - sh.rampAngle), Math.cos(b.a - sh.rampAngle))),
    );
    const g0 = Math.atan2(
      Math.sin((near[0] as { a: number }).a - sh.rampAngle),
      Math.cos((near[0] as { a: number }).a - sh.rampAngle),
    );
    const g1 = Math.atan2(
      Math.sin((near[1] as { a: number }).a - sh.rampAngle),
      Math.cos((near[1] as { a: number }).a - sh.rampAngle),
    );
    expect(Math.sign(g0)).not.toBe(Math.sign(g1));
  });

  it("lights the lamps at the march, never relights one, and has every lamp out only from the break", () => {
    let last = Number.POSITIVE_INFINITY;
    for (let t = LIGHT + 1; t < BREAK; t += step) {
      const lit = litAt(sh, t).filter(Boolean).length;
      expect(lit, `at ${t} s`).toBeLessThanOrEqual(last);
      expect(lit, `at ${t} s`).toBeGreaterThan(0);
      last = lit;
    }
    expect(litAt(sh, LIGHT - 0.01).filter(Boolean).length).toBe(0);
    expect(litAt(sh, 13).filter(Boolean).length).toBe(18);
    expect(litAt(sh, 28).filter(Boolean).length).toBe(9);
    expect(litAt(sh, 40).filter(Boolean).length).toBe(2);
    expect(litAt(sh, BREAK).filter(Boolean).length).toBe(0);
  });

  it("has its dark posts in three runs at half, and the last two at the east end", () => {
    const runs = (lit: boolean[]): number =>
      lit.filter((on, k) => !on && lit[(k + lit.length - 1) % lit.length]).length;
    expect(runs(litAt(sh, 28))).toBe(3);
    const left = sh.posts.filter((p) => p.darkAt > 39.5);
    for (const p of left) expect(Math.cos(p.a)).toBeGreaterThan(0.9);
  });

  it("drains its one pool, faster for hits on a dark arc, and breaks when the pool is gone", () => {
    let last = 1;
    let fastest = 0;
    let first = 0;
    for (let t = LIGHT; t < BREAK; t += step) {
      const p = poolAt(sh, places, t);
      expect(p, `at ${t} s`).toBeLessThanOrEqual(last + 1e-9);
      expect(p, `at ${t} s`).toBeGreaterThan(0);
      const rate = last - p;
      if (t < 17 && t > 14) first = Math.max(first, rate);
      fastest = Math.max(fastest, rate);
      last = p;
    }
    expect(poolAt(sh, places, BREAK)).toBe(0);
    expect(fastest).toBeGreaterThan(first * 2);
    expect(DARK_HIT).toBeGreaterThan(1);
  });

  it("puts the lamps lit and their loss a minute in the corner, with no clock from the march to the break", () => {
    const scene = siege();
    const surface = recorder();
    const d = new Draw(surface);
    surface.begin();
    d.reset();
    scene.draw(d, 28);
    expect(surface.words.has("9/18")).toBe(true);
    expect([...surface.words].some((w) => /^−\d+\.\d$/.test(w))).toBe(true);
    expect([...surface.words].some((w) => /^\d+:\d\d$/.test(w))).toBe(false);
    const before = recorder();
    scene.draw(new Draw(before), 1);
    expect(before.words.has("march")).toBe(true);
    const after = recorder();
    scene.draw(new Draw(after), 50);
    expect(after.words.has("lift-off")).toBe(true);
    expect(after.words.has("shield")).toBe(false);
  });

  it("holds the whole foot and every citizen who is out inside the rule, at every sampled second", () => {
    const scene = siege();
    for (let t = 0.5; t < 57; t += LONG ? 0.5 : 2) {
      const p = scene.probe(t);
      for (const c of p.citizens.filter((q) => q.outside)) {
        expect(c.x, `at ${t} s`).toBeGreaterThan(FRAME.x0);
        expect(c.x, `at ${t} s`).toBeLessThan(FRAME.x1);
        expect(c.y - c.size, `at ${t} s`).toBeGreaterThan(FRAME.y0);
        expect(c.y, `at ${t} s`).toBeLessThan(FRAME.y1);
      }
    }
    // The foot at 32 px a tile, the frame centred on it.
    const T = 32;
    for (let a = -Math.PI; a < Math.PI; a += 0.05) {
      const [x, y] = sh.at(a, 0);
      expect(960 + (x - sh.cx) * T).toBeGreaterThan(FRAME.x0);
      expect(960 + (x - sh.cx) * T).toBeLessThan(FRAME.x1);
      expect(540 + (y - sh.cy) * T).toBeGreaterThan(FRAME.y0);
      expect(540 + (y - sh.cy) * T).toBeLessThan(FRAME.y1);
    }
  });

  it(
    "has 15 or 150 in the scene at every sampled second",
    () => {
      for (const [scene, n] of [
        [siege(), 15],
        [siege150(), 150],
      ] as const)
        for (let t = 0.5; t < (LONG || n === 15 ? 60 : EARLY); t += LONG ? 1 : 4) {
          const p = scene.probe(t);
          expect(p.out + p.aboard, `at ${t} s`).toBe(n);
        }
    },
    SWEEP,
  );

  it(
    "has six out at half strength, 44 out at 150, and 30 of them still out at 44 s",
    () => {
      const p = siege().probe(28);
      expect(p.out).toBe(6);
      const q = siege150().probe(28);
      expect(q.out).toBe(44);
      // Reaching 44 s at 150 lays out every frame before it, so the gate leaves it to the long run.
      if (LONG) expect(siege150().probe(44).out).toBe(30);
    },
    SWEEP,
  );
});

describe("an elite's sail", () => {
  it("is one shape at least two and a half times as long as it is tall, a quarter of the body high", () => {
    const s = eliteSail();
    let length = 0;
    for (let i = 2; i < s.base.length; i += 2)
      length += Math.hypot(
        (s.base[i] as number) - (s.base[i - 2] as number),
        (s.base[i + 1] as number) - (s.base[i - 1] as number),
      );
    const tall = Math.max(...s.tall);
    expect(tall).toBeCloseTo(0.25, 2);
    expect(length / tall).toBeGreaterThanOrEqual(2.5);
    expect(s.ribs.length / 4).toBeGreaterThanOrEqual(4);
    expect(s.ribs.length / 4).toBeLessThanOrEqual(6);
  });
});

describe("the city's legs from above", () => {
  it("do not slide a planted foot: it stays where it came down while the land goes by", () => {
    let checked = 0;
    for (const leg of LEGS) {
      for (let t = 0; t < 11; t += 0.13) {
        const dt = 0.02;
        const a = footAt(leg, t / 5.6, 1, 0);
        const b = footAt(leg, (t + dt) / 5.6, 1, 0);
        if (a.planted > 90 || b.planted > 90 || b.planted < a.planted) continue;
        // On the land, a foot's place is its place under the hull plus how far the city has walked.
        expect(b.x + (t + dt) * WALK_SPEED - (a.x + t * WALK_SPEED)).toBeCloseTo(0, 6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(300);
  });

  it("keep at least five of eight feet on the ground", () => {
    for (let t = 0; t < 11.2; t += 0.05) {
      const down = LEGS.filter((leg) => footAt(leg, t / 5.6, 1, 0).planted < 90).length;
      expect(down).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("the deck with 150 aboard", () => {
  it("covers nobody's head with the body or hat of the one in front", () => {
    const scene = named("deck150");
    for (const t of [0, 2.2, 7.5]) {
      const probe = scene.probe?.(t) as Probe;
      const people = probe.citizens;
      expect(people.length).toBe(150);
      let pairs = 0;
      for (const back of people)
        for (const front of people) {
          if (front.y <= back.y + 0.5) continue;
          // The one in front, feet to hat top, a third of its height either side; the head behind.
          const s = front.size;
          const body = [front.x - s * 0.3, front.y - s * 1.5, front.x + s * 0.3, front.y];
          expect(
            meet(body, headBox(back.x, back.y, back.size)),
            `${front.key} covers ${back.key}`,
          ).toBe(false);
          pairs++;
        }
      expect(pairs).toBeGreaterThan(5000);
    }
  });
});

describe("the same seed", () => {
  it("gives the same mid landing, and another seed another", () => {
    const a = growMid({ seed: 2, rampSide: -1 });
    const b = growMid({ seed: 2, rampSide: -1 });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    const c = growMid({ seed: 3, rampSide: -1 });
    expect(JSON.stringify(c.pockets)).not.toBe(JSON.stringify(a.pockets));
  });

  it("gives the same fight from each script", () => {
    for (const make of [expedition, siege]) {
      const one = make().fray();
      const two = runFray(one.script);
      expect(two.hits.length).toBe(one.hits.length);
      expect(two.hits.at(-1)).toEqual(one.hits.at(-1));
      expect(Array.from(two.mon.slice(-200))).toEqual(Array.from(one.mon.slice(-200)));
      expect(Array.from(two.cit.slice(-60))).toEqual(Array.from(one.cit.slice(-60)));
    }
  });
});
