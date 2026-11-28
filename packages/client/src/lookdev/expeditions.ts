// The scenes on a landing (the art brief on #362): the reveal and the
// expedition at 15 and at 150 on the mid city's landing, and the late ring,
// which the shield siege replaces. Each is a script for fray.ts and a camera,
// drawn by landing.ts. Positions are tiles on the map.

import { GAIT_SECONDS } from "./city.ts";
import {
  BENCH_ITEM,
  drawTransitPlan,
  itemInk,
  TRANSIT_TILE,
  TRANSIT_X,
  TRANSIT_Y,
} from "./deck.ts";
import type { Draw } from "./draw.ts";
import { type Look, lookOf } from "./figure.ts";
import {
  aliveAt,
  type Behave,
  BRUTE,
  type CitizenPlan,
  ELITE,
  type Fray,
  type Group,
  HOUND,
  MITE,
  type MonsterPlan,
  outAt,
  runFray,
  type Script,
  type Weapon,
} from "./fray.ts";
import { clamp, easeInOut, hash, lerp, rng, smooth } from "./geom.ts";
import {
  distToPaths,
  distToRiver,
  fromHull,
  growMid,
  type Landing,
  type MidLanding,
  mediumLanding,
  type Pocket,
  type PocketKind,
  unfinishedEdge,
  type View,
} from "./land.ts";
import { type LandingScene, landingScene, MID_SIZES, type Stage } from "./landing.ts";
import { itemName } from "./names.ts";
import type { Corners } from "./stage.ts";
import { UP } from "./stage.ts";
import {
  BELLY_PARKED,
  BELLY_WALK,
  type Crew,
  crowdStations,
  HULL_DEEP,
  MAST_AT,
  rampFoot,
  rampTop,
  STATION,
  STATIONS,
  type Station,
  WALK_SPEED,
} from "./topcity.ts";
import type { Reveal } from "./vale.ts";

export const crowdOf = (n: number): Look[] => Array.from({ length: n }, (_, i) => lookOf(i + 1));
export const UNIQUE = "Nine Lives";
/**
 * The cycle clock, in seconds (docs/slice.md, section 1): the legs plant at
 * 3:00 and, on untouched settings with nobody calling, the front marches at
 * 9:30. Until the march the corner counts to it, and its wedge is the time
 * gone since the landing.
 */
export const LANDED = 180;
export const MARCH = 570;

// ---------------------------------------------------------------- a roster of monsters

class Roster {
  readonly monsters: MonsterPlan[] = [];
  readonly groups: Group[] = [];
  private readonly random: () => number;
  constructor(seed: number) {
    this.random = rng(seed);
  }
  group(x: number, y: number, aggro = 4, leash = 9, wake?: number): number {
    this.groups.push({ home: [x, y], aggro, leash, wake });
    return this.groups.length - 1;
  }
  /** Fodder round (x, y); with `led`, the first is the swarm's leader and its sentinel. */
  swarm(
    n: number,
    x: number,
    y: number,
    r: number,
    g: number,
    from?: (k: number) => number | undefined,
    led = false,
  ): number[] {
    const out: number[] = [];
    for (let k = 0; k < n; k++) {
      const a = this.random() * Math.PI * 2;
      const rr = led && k === 0 ? r * 0.2 : Math.sqrt(this.random()) * r;
      out.push(this.monsters.length);
      this.monsters.push({
        kind: MITE,
        build: k % 3,
        x: x + Math.cos(a) * rr * 1.3,
        y: y + Math.sin(a) * rr * 0.8,
        behave: "boil",
        group: g,
        from: from?.(k),
        ...(led && k === 0 ? { leader: true, sentinel: true } : {}),
      });
    }
    return out;
  }
  pack(n: number, x: number, y: number, g: number, behave: Behave, spread = 1.5): number[] {
    const out: number[] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + this.random();
      const rr = k === 0 ? 0.2 : spread * (0.6 + this.random() * 0.5);
      out.push(this.monsters.length);
      // In a sleeping heap one is awake: the leader, which is also the pack's sentinel.
      this.monsters.push({
        kind: HOUND,
        build: k % 3,
        x: x + Math.cos(a) * rr,
        y: y + Math.sin(a) * rr * 0.7,
        behave: behave === "sleep" && k === 0 ? "guard" : behave,
        group: g,
        leader: k === 0,
        sentinel: k === 0,
      });
    }
    return out;
  }
  /** A brute with three pack monsters lying round it, the first of them the leader and sentinel. */
  guard(x: number, y: number, g: number, behave: Behave): { brute: number; hounds: number[] } {
    const brute = this.one(BRUTE, x, y, g, "guard");
    const hounds: number[] = [];
    for (let k = 0; k < 3; k++) {
      const a =
        ([Math.PI * 0.9, Math.PI * 0.35, -Math.PI * 0.15][k] as number) +
        (this.random() - 0.5) * 0.3;
      hounds.push(this.monsters.length);
      this.monsters.push({
        kind: HOUND,
        build: k % 3,
        x: x + Math.cos(a) * 1.5,
        y: y + 0.4 + Math.sin(a) * 0.8,
        behave: k === 0 ? "guard" : behave,
        group: g,
        leader: k === 0,
        sentinel: k === 0,
      });
    }
    return { brute, hounds };
  }
  one(kind: number, x: number, y: number, g: number, behave: Behave, from?: number): number {
    this.monsters.push({ kind, build: 0, x, y, behave, group: g, from });
    return this.monsters.length - 1;
  }
}

// ---------------------------------------------------------------- the mid landing's monsters

/** What holds a place: a swarm of ten and a leader, a brute with three pack monsters, three brutes with fodder, an elite. */
export type Hold = "swarm" | "guard" | "brutes" | "elite";
/**
 * How far each reaches across and down from where it stands, its bodies
 * included, in tiles. Groups are wider than they are deep: pack monsters lie
 * along the ground and a swarm is three tiles across.
 */
export const HOLD_BOX: Record<Hold, readonly [number, number]> = {
  swarm: [1.95, 1.2],
  guard: [2.6, 1.6],
  brutes: [3.6, 2.4],
  elite: [1.1, 0.9],
};
/** How far a group reaches across, for standing off it. */
export const HOLD_R: Record<Hold, number> = {
  swarm: HOLD_BOX.swarm[0],
  guard: HOLD_BOX.guard[0],
  brutes: HOLD_BOX.brutes[0],
  elite: HOLD_BOX.elite[0],
};
/** Where an elite stands from its den: beside the mouth. */
const ELITE_AT = [3.2, 1.1] as const;
const THING_BOX: Record<PocketKind, readonly [number, number]> = {
  den: [2.8, 1.3],
  chest: [1.7, 0.9],
  scrap: [3.7, 1.2],
  seam: [1.6, 0.9],
  nest: [2.1, 1.1],
};

export interface Held {
  group: number;
  kind: Hold;
  x: number;
  y: number;
  /** Its biggest monster, and everyone in it. */
  main: number;
  members: number[];
}

export interface MidRoster {
  roster: Roster;
  /** Per pocket, the groups that hold it; then those on the ground between pockets. */
  holds: Held[][];
  between: Held[];
}

/** What each kind of pocket holds, by the brief's counts: 44 swarms, 20 guards, 3 brute packs, 8 elites in all. */
const POCKET_HOLDS: Record<PocketKind, Hold[]> = {
  den: ["elite", "guard", "swarm"],
  chest: ["guard", "swarm"],
  nest: ["swarm", "swarm", "swarm"],
  seam: ["guard", "swarm"],
  scrap: ["swarm", "swarm"],
};

/**
 * Monsters for the mid landing, about 600 at rest in their pockets. Every
 * group keeps two tiles of open ground between itself and the next, across
 * or down, and none stands on a wood, the river, the city's ground or under
 * a corner slip, or just behind a wood where its trees would hide it.
 */
export function populateMid(
  L: MidLanding,
  seed: number,
  o: { behave?: (p: Pocket, h: Hold) => Behave } = {},
): MidRoster {
  const R = new Roster(seed);
  const random = rng(seed + 11);
  const taken: { x: number; y: number; hx: number; hy: number }[] = L.pockets.map((p) => ({
    x: p.x,
    y: p.y + 0.2,
    hx: (THING_BOX[p.kind] as readonly [number, number])[0],
    hy: (THING_BOX[p.kind] as readonly [number, number])[1],
  }));
  const free = (x: number, y: number, hx: number, hy: number, own: number): boolean => {
    if (x < hx + 1.4 || x > L.cols - hx - 1.4 || y < hy + 2.0 || y > L.rows - hy - 1.4)
      return false;
    if (
      L.corners.some(([x0, y0, x1, y1]) => x > x0 - hx && x < x1 + hx && y > y0 - hy && y < y1 + hy)
    )
      return false;
    if (fromHull(L.city, x, y) < 4.4) return false;
    if (distToRiver(L.river, x, y) < hy + 0.7 || distToRiver(L.river, x, y) < hx * 0.5)
      return false;
    if (distToPaths(L.paths, x, y) < 0.4) return false;
    for (const m of L.masses)
      for (let k = 0; k < m.base.length; k += 2) {
        const dx = Math.abs((m.base[k] as number) - x);
        const dy = (m.base[k + 1] as number) - y;
        if (dx < hx + 0.3 && Math.abs(dy) < hy + 0.3) return false;
        if (dx < hx - 0.3 && dy > 0 && dy < hy + 1.3) return false;
      }
    return taken.every((q, k) => {
      const gap = Math.max(Math.abs(q.x - x) - q.hx - hx, Math.abs(q.y - y) - q.hy - hy);
      // Two tiles of open ground between groups; a group may stand nearer its own pocket's thing.
      return gap >= (k === own ? 0.3 : k < L.pockets.length ? 0.8 : 2);
    });
  };
  // Groups are laid first and filled after, so that the fodder of swarms there was no room for
  // can join the swarms there was: a swarm is then ten to seventeen and its leader.
  const laid: { h: Hold; x: number; y: number; behave: Behave; at: Held[] }[] = [];
  const lay = (h: Hold, x: number, y: number, behave: Behave, at: Held[]): void => {
    laid.push({ h, x, y, behave, at });
  };
  let swarmSize = 11;
  const make = (h: Hold, x: number, y: number, behave: Behave): Held => {
    // A pack hunts a citizen who comes within three tiles of where it holds; sleepers wake nearer.
    const g = R.group(x, y, h === "elite" ? 3.5 : 3, 9, behave === "sleep" ? 2.5 : undefined);
    let members: number[];
    let main: number;
    if (h === "swarm") {
      members = R.swarm(swarmSize, x, y, 1.0, g, undefined, true);
      main = members[0] as number;
    } else if (h === "guard") {
      const gd = R.guard(x, y, g, behave);
      members = [gd.brute, ...gd.hounds];
      main = gd.brute;
    } else if (h === "brutes") {
      members = [];
      for (let k = 0; k < 3; k++)
        members.push(R.one(BRUTE, x + (k - 1) * 2.2, y - 0.4 + (k % 2) * 0.8, g, "guard"));
      members.push(...R.swarm(6, x, y + 1.3, 0.8, g, undefined, true));
      main = members[0] as number;
    } else {
      main = R.one(ELITE, x, y, g, behave === "sleep" ? "sleep" : "guard");
      members = [main];
    }
    return { group: g, kind: h, x, y, main, members };
  };
  const holds: Held[][] = L.pockets.map(() => []);
  // Three scrap pockets hold a brute pack in place of one of their swarms.
  let brutePacks = 0;
  L.pockets.forEach((p, i) => {
    const list = [...POCKET_HOLDS[p.kind]];
    if (p.kind === "scrap" && brutePacks < 3 && hash(i, seed, 7) < 0.6) {
      list[0] = "brutes";
      brutePacks++;
    }
    const [tx, ty] = THING_BOX[p.kind] as readonly [number, number];
    for (const h of list) {
      const behave =
        o.behave?.(p, h) ??
        (h === "swarm" ? "boil" : p.kind === "den" || p.kind === "chest" ? "sleep" : "pace");
      const [hx, hy] = HOLD_BOX[h];
      if (h === "elite") {
        // The elite beside its den's mouth, clear of the den's letters under it.
        const x = p.x + ELITE_AT[0];
        const y = p.y + ELITE_AT[1];
        taken.push({ x, y, hx, hy });
        lay(h, x, y, behave, holds[i] as Held[]);
        continue;
      }
      // In front of what it holds first, then to either side, then behind.
      let spot: [number, number] | null = null;
      for (const ring of [0.5, 1.3, 2.2, 3.2, 4.4])
        for (const [ax, ay] of [
          [0, 1],
          [1, 0.6],
          [-1, 0.6],
          [1, 0],
          [-1, 0],
          [0.5, 1],
          [-0.5, 1],
          [1, -0.6],
          [-1, -0.6],
          [0, -1],
        ] as const) {
          if (spot) break;
          const x = p.x + ax * (tx + hx + ring);
          const y = p.y + 0.2 + ay * (ty + hy + ring * 0.7);
          if (free(x, y, hx, hy, i)) spot = [x, y];
        }
      if (!spot) continue;
      taken.push({ x: spot[0], y: spot[1], hx, hy });
      lay(h, spot[0], spot[1], behave, holds[i] as Held[]);
    }
  });
  // The rest of the 44 swarms and 20 guards on the open ground at the pockets' edges, pacing or gnawing.
  const between: Held[] = [];
  const count = (h: Hold): number => laid.filter((q) => q.h === h).length;
  const want: [Hold, number][] = [
    ["guard", 20],
    ["swarm", 44],
  ];
  for (const [h, n] of want)
    for (let tries = 0; tries < 4000 && count(h) < n; tries++) {
      const [hx, hy] = HOLD_BOX[h];
      const x = 3 + random() * (L.cols - 6);
      const y = 3 + random() * (L.rows - 6);
      if (!free(x, y, hx, hy, -1)) continue;
      taken.push({ x, y, hx, hy });
      lay(h, x, y, h === "swarm" ? "boil" : tries % 2 ? "gnaw" : "pace", between);
    }
  // Share the fodder among the swarms there was room for: 44 swarms of ten and a leader is 484,
  // and a little more keeps the plate over 550 while the first fights are on.
  const swarms = Math.max(1, count("swarm"));
  swarmSize = Math.min(18, Math.max(11, Math.round(570 / swarms)));
  for (const q of laid) q.at.push(make(q.h, q.x, q.y, q.behave));
  return { roster: R, holds, between };
}

// ---------------------------------------------------------------- shared parts of a landing scene

const _medium = (): Landing => mediumLanding();

const deckH = (settle: number): number =>
  lerp(BELLY_WALK, BELLY_PARKED, easeInOut(settle)) + HULL_DEEP;

/** Corners on a landing before the march, `t` seconds into a scene that starts `at` seconds into the cycle. */
export function landedCorners(
  L: Landing,
  at: number,
  t: number,
  f: Fray,
  crew: number,
  log: Corners["log"],
  kills0: number,
  banked: number,
): Corners {
  const kills = kills0 + f.kills.filter((k) => k.t <= t).length;
  return {
    left: MARCH - at - t,
    to: "march",
    gone: clamp((at + t - LANDED) / (MARCH - LANDED)),
    horn: 1,
    late: false,
    head: `${L.size} ${L.levels[0]}–${L.levels[1]}`,
    lines: ["packs ×2", "rares +40%"],
    log,
    counts: [outAt(f, t), crew, kills, banked],
  };
}

const logLine = (look: Look, what: string, rgb: number): NonNullable<Corners["log"]> => ({
  who: look.name,
  rgb: look.cloak,
  what,
  whatRgb: rgb,
});

const LABEL = 0x2f2621;

// ---------------------------------------------------------------- the expedition at 15

/** The roles the expedition's map is grown with: where each of its scripted places lies from the city. */
const ROLES = {
  den: 0,
  chest: 1,
  nest: 2,
  south: 3,
  seam: 4,
  sw: 5,
  walkTo: 6,
} as const;
const EXPEDITION_ROLES = [
  { angle: -2.45, kind: "den", far: 22 },
  { angle: -0.55, kind: "chest", far: 23 },
  { angle: 0.62, kind: "nest", far: 24 },
  { angle: 1.62, kind: "scrap", far: 15 },
  { angle: -1.5, kind: "seam", far: 15 },
  { angle: 2.45, kind: "scrap", far: 20 },
  { angle: 3.05, kind: "den", far: 27 },
] as const;

let expeditionMap: MidLanding | null = null;
/** The expedition's landing: the mid city's, 80 by 45, shared by `expedition`, `expedition150` and the reveal. */
export function expeditionLanding(): MidLanding {
  if (!expeditionMap) expeditionMap = growMid({ seed: 3625, rampSide: 1, roles: EXPEDITION_ROLES });
  return expeditionMap;
}

/** The den the expedition's lead fight is at: the one its map's roles put north-west of the city. */
export const fightDen = (L: MidLanding): Pocket =>
  L.pockets[L.roles[ROLES.den] as number] as Pocket;

/**
 * Where the den fight's elite stands: on the open ground north of the den's
 * mound, with the mound between it and the city. Beside the mouth, on the
 * city's side, the fight was a knot against the city's far foot.
 */
const denFightAt = (den: Pocket): [number, number] => [den.x + 0.4, den.y - 3.0];

interface ExpeditionRoster extends MidRoster {
  elite: number;
  southBrute: number;
  groups: { south: number; seam: number; sw: number; chest: number; ford: number };
}

/**
 * The expedition's monsters: the map's 600 or so, with the scripted places
 * set up for what happens there. The south's brute keeps apart until it is
 * roused, the seam's pack and the south-west's swarm wait for their moment,
 * the den keeps sending fodder out of its mouth, and the chest has fodder
 * under it for when it opens.
 */
function expeditionRoster(L: MidLanding, seed: number): ExpeditionRoster {
  const pocket = (r: number): Pocket => L.pockets[L.roles[r] as number] as Pocket;
  const mr = populateMid(L, seed, {
    behave: (p, h) =>
      h === "swarm"
        ? "boil"
        : p === pocket(ROLES.seam)
          ? "pace"
          : p.kind === "den" || p.kind === "chest"
            ? "sleep"
            : "pace",
  });
  const R = mr.roster;
  const held = (r: number): Held[] => mr.holds[L.roles[r] as number] ?? [];
  const den = fightDen(L);
  const denHolds = mr.holds[L.pockets.indexOf(den)] ?? [];
  const elite = (denHolds.find((h) => h.kind === "elite") as Held).main;
  // The den fight's elite stands on the side of the den away from the city, so the fight is
  // not a knot against the city's far foot.
  const ep = R.monsters[elite] as MonsterPlan;
  [ep.x, ep.y] = denFightAt(den);
  const g0 = ep.group;
  (R.groups[g0] as Group).home = [ep.x, ep.y];
  // The den's fodder keeps coming out of its mouth.
  R.swarm(10, den.x + 0.3, den.y + 0.6, 0.3, g0, (k) => 2.5 + k * 1.9);
  const g = (h: Held | undefined): number => h?.group ?? R.group(0, 0);
  // The south: its brute walks in when it is roused, and its pack is tough enough to last till then.
  const southGuard = held(ROLES.south).find((h) => h.kind === "guard" || h.kind === "brutes");
  const southBrute = southGuard?.main ?? -1;
  const south = R.group(southGuard?.x ?? 0, southGuard?.y ?? 0, 0.5, 18);
  if (southGuard) {
    const bp = R.monsters[southBrute] as MonsterPlan;
    bp.group = south;
    bp.hp = 5200;
    for (const j of southGuard.members)
      if (j !== southBrute) (R.monsters[j] as MonsterPlan).hp = 2600;
  }
  // The seam's pack paces off and stalks; it lunges when it is roused.
  const seamHold = held(ROLES.seam).find((h) => h.kind === "guard");
  const seam = g(seamHold);
  if (seamHold) {
    const gr = R.groups[seam] as Group;
    gr.aggro = 0.5;
    gr.leash = 12;
    gr.wake = undefined;
  }
  // The south-west's swarms turn to their worker slowly.
  const sw = g(held(ROLES.sw).find((h) => h.kind === "swarm"));
  (R.groups[sw] as Group).aggro = 0.5;
  (R.groups[sw] as Group).leash = 14;
  // The chest: four hounds come up out of the ground when it opens, and fodder after them.
  const chest = pocket(ROLES.chest);
  const chestGroup = g(held(ROLES.chest).find((h) => h.kind === "guard"));
  for (const [dx, dy] of [
    [-1.4, -0.6],
    [1.2, -0.4],
    [-1.2, 1.4],
    [1.4, 1.2],
  ] as const)
    R.monsters.push({
      kind: HOUND,
      build: Math.round(dx * 3 + 3) % 3,
      x: chest.x + dx,
      y: chest.y + dy,
      behave: "pace",
      group: chestGroup,
      from: 8.05,
    });
  for (let k = 0; k < 12; k++)
    R.monsters.push({
      kind: MITE,
      build: k % 3,
      x: chest.x - 0.4 + (k % 4) * 0.4,
      y: chest.y + 0.4 + Math.floor(k / 4) * 0.4,
      behave: "boil",
      group: chestGroup,
      from: 12.2 + k * 0.05,
      hp: 120,
    });
  return {
    ...mr,
    elite,
    southBrute,
    groups: { south, seam, sw, chest: chestGroup, ford: -1 },
  };
}

/** The mid landing, 40 seconds from 4:30 on the cycle clock: thirteen out, two aboard. */
export function expeditionScene(): LandingScene {
  const L = expeditionLanding();
  const crowd = crowdOf(15);
  const mr = expeditionRoster(L, 362);
  const R = mr.roster;
  const foot: [number, number] = [L.city.x + rampFoot(1)[0], L.city.y + rampFoot(1)[1]];
  const c = (i: number): Look => crowd[i] as Look;
  const P = (r: number): Pocket => L.pockets[L.roles[r] as number] as Pocket;
  const den = fightDen(L);
  const chest = P(ROLES.chest);
  const nest = P(ROLES.nest);
  const south = P(ROLES.south);
  const seam = P(ROLES.seam);
  const sw = P(ROLES.sw);
  const walkTo = P(ROLES.walkTo);
  const eliteAt = denFightAt(den);
  const nestSwarm = (mr.holds[L.roles[ROLES.nest] as number] ?? [])[0];
  const nestAt: [number, number] = nestSwarm ? [nestSwarm.x, nestSwarm.y] : [nest.x, nest.y + 3];
  const southHold = (mr.holds[L.roles[ROLES.south] as number] ?? []).find(
    (h) => h.kind === "guard" || h.kind === "brutes",
  );
  const southAt: [number, number] = southHold ? [southHold.x, southHold.y] : [south.x, south.y + 3];
  const chestGuard = (mr.holds[L.roles[ROLES.chest] as number] ?? []).find(
    (h) => h.kind === "guard",
  );
  const guardAt: [number, number] = chestGuard
    ? [chestGuard.x, chestGuard.y]
    : [chest.x + 4, chest.y + 3];
  const heap = (sw.heaps[0] ?? [sw.x, sw.y]) as [number, number];
  // Who comes home over the ford: from beyond it, on the far side of the river from the city.
  const ford = [...L.fords].sort(
    (a, b) =>
      Math.hypot(a[0] - L.city.x, a[1] - L.city.y) - Math.hypot(b[0] - L.city.x, b[1] - L.city.y),
  )[0] ?? [L.city.x + 16, L.city.y - 2];
  const away = Math.atan2(ford[1] - L.city.y, ford[0] - L.city.x);
  const homeFrom: [number, number] = [ford[0] + Math.cos(away) * 7, ford[1] + Math.sin(away) * 4];
  const homeVia: [number, number] = [
    lerp(ford[0], foot[0], 0.45) + Math.sin(away) * 1.5,
    lerp(ford[1], foot[1], 0.45) - Math.cos(away) * 1,
  ];
  // The pack that goes after the one coming home, within the fore gun's nine tiles when it gets there.
  const fordPack = R.group(homeVia[0] + 2.5, homeVia[1] - 3, 0.5, 14);
  R.pack(3, homeVia[0] + 2.5, homeVia[1] - 3, fordPack, "gnaw", 1.4);
  mr.groups.ford = fordPack;
  // The route the walker to the far den takes, drawn as a march.
  const walkFrom: [number, number] = [foot[0] - 7, foot[1] + 0.6];
  const route: [number, number][] = [
    [lerp(walkFrom[0], walkTo.x, 0.3), lerp(walkFrom[1], walkTo.y + 3, 0.3) + 1.2],
    [lerp(walkFrom[0], walkTo.x, 0.62), lerp(walkFrom[1], walkTo.y + 3, 0.62) + 1.6],
    [walkTo.x + 2.2, walkTo.y + 3.6],
  ];
  // Who is out, as the brief's table has them. Index in this list is the citizen's index in the script.
  const citizens: CitizenPlan[] = [
    // The den fight: two blades, a bow and a firepot, on the open ground north of the den.
    {
      look: c(0),
      weapon: "blade",
      x: eliteAt[0] + 2.2,
      y: eliteAt[1] + 0.2,
      cadence: 1.15,
      orders: [{ t: 0, fight: eliteAt, r: 4.5 }],
      pins: [9.0, 13.9],
      crit: { t: 9.0, value: 1284 },
    },
    {
      look: c(3),
      weapon: "blade",
      x: eliteAt[0] - 2.2,
      y: eliteAt[1] + 0.3,
      cadence: 1.25,
      orders: [{ t: 0, fight: eliteAt, r: 4.5 }],
    },
    {
      look: c(2),
      weapon: "bow",
      x: eliteAt[0] + 4.6,
      y: eliteAt[1] - 0.4,
      cadence: 1.1,
      stands: true,
      orders: [{ t: 0, fight: eliteAt, r: 6 }],
      pins: [13.72],
    },
    {
      look: c(4),
      weapon: "pot",
      x: eliteAt[0] - 4.4,
      y: eliteAt[1] - 0.2,
      stands: true,
      cadence: 4.6,
      orders: [{ t: 0, fight: eliteAt, r: 7.5 }],
      pins: [13.76],
    },
    // The chest: the maul works it till it opens, then fights; a sling wakes its guard.
    {
      look: c(5),
      weapon: "maul",
      x: chest.x - 0.9,
      y: chest.y + 0.9,
      cadence: 1.9,
      prefers: MITE,
      orders: [
        { t: 0, work: [chest.x - 0.9, chest.y + 0.9], kind: "chest" },
        { t: 8.3, fight: [chest.x, chest.y + 0.6], r: 4.5 },
      ],
      pins: [13.5],
    },
    {
      look: c(12),
      weapon: "sling",
      x: lerp(chest.x, guardAt[0], 0.5) - 1.5,
      y: lerp(chest.y, guardAt[1], 0.5) + 2.5,
      cadence: 1.2,
      orders: [{ t: 0, fight: guardAt, r: 6.5 }],
      pins: [13.78],
    },
    // The nest: a blade mowing and a firepot.
    {
      look: c(11),
      weapon: "blade",
      x: nestAt[0] - 2.2,
      y: nestAt[1] + 1.0,
      cadence: 2.3,
      orders: [{ t: 0, fight: nestAt, r: 6 }],
      pins: [13.86],
    },
    {
      look: c(1),
      weapon: "pot",
      x: nestAt[0] - 4.4,
      y: nestAt[1] + 2.4,
      cadence: 4.6,
      orders: [{ t: 0, fight: nestAt, r: 7.5 }],
      pins: [3.95, 13.8],
    },
    // The south: a spear.
    {
      look: c(7),
      weapon: "spear",
      x: southAt[0] - 1.6,
      y: southAt[1] - 2.4,
      cadence: 1.3,
      orders: [{ t: 0, fight: southAt, r: 6.5 }],
      pins: [13.84],
    },
    // The seam and the south-west scrap: working.
    {
      look: c(13),
      weapon: "blade",
      x: seam.x - 0.8,
      y: seam.y + 1.0,
      orders: [{ t: 0, work: [seam.x - 0.8, seam.y + 1.0], kind: "seam" }],
      haul: 0.2,
    },
    {
      look: c(9),
      weapon: "blade",
      x: heap[0] + 0.8,
      y: heap[1] + 0.6,
      orders: [{ t: 0, work: [heap[0] + 0.8, heap[1] + 0.6], kind: "scrap" }],
      haul: 0.3,
    },
    // On the paths: one walking out to a far den, one coming home over the ford, loaded, with a rare's pennant.
    {
      look: c(10),
      weapon: "blade",
      x: walkFrom[0],
      y: walkFrom[1],
      pace: 1.25,
      orders: [{ t: 0, go: route, route: true }],
    },
    {
      look: c(14),
      weapon: "blade",
      x: homeFrom[0],
      y: homeFrom[1],
      pace: 1.2,
      haul: 1,
      pennant: 2,
      orders: [{ t: 0, board: [[ford[0], ford[1]], homeVia, foot] }],
    },
  ];
  const H = deckH(1);
  const gun: [number, number] = [L.city.x + 6.85, L.city.y + 0.12];
  const script: Script = {
    seed: 3621,
    seconds: 40.5,
    // Fodder takes two blows here, so the plate keeps its 550 and more through the first seconds.
    toughness: 2.6,
    strokeHits: 4,
    citizens,
    monsters: R.monsters,
    groups: R.groups,
    telegraphs: [
      { who: mr.elite, at: 14.0, target: 1, throw: 2 },
      ...(mr.southBrute >= 0 ? [{ who: mr.southBrute, at: 27.2, target: 8, throw: 1.5 }] : []),
    ],
    deaths: [{ who: mr.elite, at: 20.0, drop: 3 }],
    downs: [{ who: 8, at: 32.0 }],
    chests: [{ at: 8.0, x: chest.x, y: chest.y, who: 4 }],
    rouse: [
      { group: mr.groups.south, at: 19.6 },
      { group: mr.groups.seam, at: 17.55 },
      { group: mr.groups.sw, at: 26.0 },
      // The pack near the ford goes after the one coming home, and the fore gun covers it.
      { group: mr.groups.ford, at: 10.4, hunts: 12 },
    ],
    turrets: [
      {
        x: gun[0],
        y: gun[1],
        z: H + 0.3,
        range: 9,
        period: 1.6,
        rgb: c(8).cloak,
        weapon: "gun",
        pins: [13.86],
      },
    ],
    ramp: foot,
  };
  let fray: Fray | null = null;
  const get = (): Fray => {
    if (!fray) fray = runFray(script);
    return fray;
  };
  const permanent: Crew[] = [
    { look: c(6), station: STATIONS[STATION.bench] as Station },
    { look: c(8), station: STATIONS[STATION.foreGun] as Station },
  ];
  const crewAt = (t: number): Crew[] => {
    const f = get();
    const out = [...permanent];
    // lil_gremlin, once aboard, goes to the hatch.
    if ((f.boarded[12] ?? Number.POSITIVE_INFINITY) <= t)
      out.push({ look: c(14), station: STATIONS[STATION.carrier] as Station });
    return out;
  };
  const rare = itemName(41, 2, 2);
  const edge = unfinishedEdge(L);
  const stage: Stage = {
    land: L,
    fray: get,
    seconds: 40,
    sizes: MID_SIZES,
    view: () => ({ T: L.T, ox: L.ox, oy: L.oy }),
    reveal: () => edge,
    city: (t) => ({
      gait: 0,
      walk: 0,
      settle: 1,
      ramp: 1,
      rampSide: 1,
      detail: 0,
      size: MID_SIZES.citizen,
      crew: crewAt(t),
      lantern: 0.2,
    }),
    black: () => null,
    corners: (t) => {
      const f = get();
      const log =
        t < 8.4
          ? logLine(c(6), BENCH_ITEM, itemInk(2))
          : t < 20.4
            ? logLine(c(5), rare, itemInk(2))
            : t < 32.1
              ? logLine(c(0), UNIQUE, itemInk(3))
              : logLine(c(7), "down", LABEL);
      return landedCorners(
        L,
        270,
        t,
        f,
        crewAt(t).length,
        log,
        214,
        31 + ((f.boarded[12] ?? 99) <= t ? 1 : 0),
      );
    },
    uniques: { [mr.elite]: UNIQUE },
    pennants: { 12: 2 },
    hauls: { 12: 1, 9: 0.2, 10: 0.3 },
    routes: [{ who: 11, from: 0, to: 40, path: route }],
    // Those shooting from the deck are named aboard; the fore gunner is.
    shooters: () => [c(8).id],
  };
  return landingScene(stage);
}

// ---------------------------------------------------------------- the reveal

/** The moments of the reveal, in seconds. */
const R_HALT = 3;
const R_SETTLE = [3, 5] as const;
const R_MOVE = [4, 11] as const;
const R_RAMP = [11, 13] as const;
const R_POUR = 13;

/**
 * The landing: three seconds walking in, the legs plant and the hull
 * settles, one eased pull-back from 66 to 30 px a tile with the mast's foot
 * as its anchor while the map is inked outward from the city, the ramp
 * comes down, and thirteen go down it and split for the pockets.
 */
export function revealScene(): LandingScene {
  const L = expeditionLanding();
  const crowd = crowdOf(15);
  const c = (i: number): Look => crowd[i] as Look;
  const mr = populateMid(L, 3626);
  // Packs wake only when someone reaches them, not as walkers pass.
  for (const g of mr.roster.groups) {
    g.aggro = 1.2;
    if (g.wake !== undefined) g.wake = 1.2;
  }
  const top = rampTop(1);
  const footOff = rampFoot(1);
  const rampTopAt: [number, number] = [L.city.x + top[0], L.city.y + top[1]];
  const foot: [number, number] = [L.city.x + footOff[0], L.city.y + footOff[1]];
  const H = deckH(1);
  // Thirteen go out and split at once: three under the hull between the legs to the north, the
  // rest west, south-west, south, south-east, east and north-east. Each walks to a pack in a
  // pocket on its side; the walks are timed so that only the first two reach theirs by 28 s.
  const holds = mr.holds.flatMap((list, i) =>
    list.filter((h) => h.kind !== "elite").map((h) => ({ h, p: L.pockets[i] as Pocket })),
  );
  const angleOf = (x: number, y: number): number => Math.atan2(y - L.city.y, x - L.city.x);
  const wants: { i: number; angle: number; weapon: Weapon; arrive: number }[] = [
    { i: 13, angle: -1.7, weapon: "blade", arrive: 31 },
    { i: 2, angle: -2.1, weapon: "bow", arrive: 33 },
    { i: 12, angle: -1.15, weapon: "sling", arrive: 34 },
    { i: 0, angle: -2.7, weapon: "blade", arrive: 30 },
    { i: 3, angle: 3.0, weapon: "blade", arrive: 32 },
    { i: 10, angle: 2.6, weapon: "blade", arrive: 35 },
    { i: 9, angle: 2.1, weapon: "blade", arrive: 33 },
    { i: 7, angle: 1.6, weapon: "spear", arrive: 26.6 },
    { i: 11, angle: 1.05, weapon: "blade", arrive: 31 },
    { i: 4, angle: 0.6, weapon: "pot", arrive: 34 },
    { i: 5, angle: -0.5, weapon: "maul", arrive: 32 },
    { i: 1, angle: 0.1, weapon: "blade", arrive: 26.95 },
    { i: 14, angle: -0.15, weapon: "blade", arrive: 36 },
  ];
  const used = new Set<number>();
  const citizens: CitizenPlan[] = wants.map((w, k) => {
    // A pack in its direction that nobody else is going to, about as far as it can walk by then.
    const reach = (w.arrive - R_POUR - k * 0.42 - 1.5) * 1.8;
    let best = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    holds.forEach(({ h }, q) => {
      if (used.has(q)) return;
      let gap = Math.abs(angleOf(h.x, h.y) - w.angle) % (Math.PI * 2);
      if (gap > Math.PI) gap = Math.PI * 2 - gap;
      const s = gap * 20 + Math.abs(Math.hypot(h.x - foot[0], h.y - foot[1]) - reach) * 0.6;
      if (s < bestScore) {
        bestScore = s;
        best = q;
      }
    });
    used.add(best);
    const { h } = holds[best] as { h: Held };
    const from = R_POUR + k * 0.42;
    // To the side of the pack facing the city, three tiles short of it.
    const dx = foot[0] - h.x;
    const dy = foot[1] - h.y;
    const dl = Math.hypot(dx, dy) || 1;
    const stop: [number, number] = [
      h.x + (dx / dl) * (HOLD_R[h.kind] + 1.2),
      h.y + (dy / dl) * (HOLD_R[h.kind] + 1.2),
    ];
    const north = h.y < L.city.y - 3;
    // North-bound go under the hull between the legs; the rest bend out on their way.
    const mid: [number, number] = north
      ? [L.city.x + (h.x < L.city.x ? -2.5 : 2.5) + (k % 2) * 1.2, L.city.y - 1]
      : [
          lerp(foot[0], stop[0], 0.45) + (k % 3) - 1,
          lerp(foot[1], stop[1], 0.45) + ((k + 1) % 3) - 1,
        ];
    const route: [number, number][] = [foot, mid, stop];
    const ramp = Math.hypot(foot[0] - rampTopAt[0], foot[1] - rampTopAt[1]);
    let walk = 0;
    for (let q = 1; q < route.length; q++)
      walk += Math.hypot(
        (route[q] as [number, number])[0] - (route[q - 1] as [number, number])[0],
        (route[q] as [number, number])[1] - (route[q - 1] as [number, number])[1],
      );
    const pace = clamp(walk / Math.max(1, w.arrive - from - ramp / 1.8), 1.0, 3.2);
    const there = from + ramp / 1.8 + walk / pace;
    return {
      look: c(w.i),
      weapon: w.weapon,
      x: rampTopAt[0] + 0.4 + (k % 3) * 0.3,
      y: rampTopAt[1],
      z: H,
      ramp,
      from,
      pace,
      orders: [
        { t: 0, go: route },
        { t: there + 0.1, fight: [h.x, h.y], r: HOLD_R[h.kind] + 2 },
      ],
    };
  });
  const script: Script = {
    seed: 3622,
    seconds: 30.5,
    // Nothing dies before the scene ends: the first blows are landing at 28 s and spill no ink yet.
    toughness: 40,
    citizens,
    monsters: mr.roster.monsters,
    groups: mr.roster.groups,
    ramp: foot,
  };
  let fray: Fray | null = null;
  const get = (): Fray => {
    if (!fray) fray = runFray(script);
    return fray;
  };
  // The camera: the mast's foot is its anchor, on one eased curve from the close-up to the landing.
  const k = (t: number): number => easeInOut(clamp((t - R_MOVE[0]) / (R_MOVE[1] - R_MOVE[0])));
  const settle = (t: number): number => clamp((t - R_SETTLE[0]) / (R_SETTLE[1] - R_SETTLE[0]));
  const walked = (t: number): number => (t < R_HALT ? t - (t * t) / (2 * R_HALT) : R_HALT / 2);
  const view = (t: number): View => {
    const e = k(t);
    const T = lerp(TRANSIT_TILE, L.T, e);
    const Hn = deckH(settle(t));
    const anchorX = lerp(
      TRANSIT_X + MAST_AT.x * TRANSIT_TILE,
      L.ox + (L.city.x + MAST_AT.x) * L.T,
      e,
    );
    const anchorY = lerp(
      TRANSIT_Y - (BELLY_WALK + HULL_DEEP) * UP * TRANSIT_TILE,
      L.oy + L.city.y * L.T - H * UP * L.T,
      e,
    );
    const cityX = anchorX - MAST_AT.x * T;
    const cityY = anchorY + Hn * UP * T;
    return { T, ox: cityX - L.city.x * T, oy: cityY - L.city.y * T };
  };
  const reveal = (t: number): Reveal => {
    const v = view(t);
    const finish = (lag: number): number => smooth(R_MOVE[1] - 0.8 + lag, R_MOVE[1] + 0.5 + lag, t);
    const make = (lag: number, inset: number, soft: number) => {
      // The ink sets out as the legs plant, ahead of the camera, and stays just inside the frame as it widens.
      const reach = (t - lag - R_HALT) * 7 + 1;
      const done = finish(lag);
      return (x: number, y: number): number => {
        const px = v.ox + x * v.T;
        const py = v.oy + y * v.T;
        const edge = Math.min(px - 20, 1900 - px, py - 20, 1060 - py);
        const inside = Math.max(clamp((edge - inset) / soft), done);
        const near = clamp((reach - Math.hypot(x - L.city.x, (y - L.city.y) * 1.5)) / 2.5);
        return Math.min(inside, near);
      };
    };
    // The landing ends as an unfinished drawing does, at its last two tiles.
    const ink = make(0, 30, 120);
    const flood = make(0.5, 120, 160);
    return {
      ink: (x, y) => Math.min(ink(x, y), edge.ink(x, y)),
      flood: (x, y) => Math.min(flood(x, y), edge.flood(x, y)),
    };
  };
  const edge = unfinishedEdge(L);
  const permanent: Crew[] = [
    { look: c(6), station: STATIONS[STATION.bench] as Station },
    { look: c(8), station: STATIONS[STATION.foreGun] as Station },
  ];
  const homes = [
    STATION.lookout,
    STATION.navigator,
    STATION.cook,
    STATION.smith,
    STATION.bellows,
    STATION.eater,
    STATION.stoker,
    STATION.sleeper,
    STATION.carrier,
    STATION.crane,
    STATION.helm,
    STATION.aftGun,
    STATION.bench2,
  ];
  const crewAt = (t: number): Crew[] => {
    const out = [...permanent];
    citizens.forEach((p, k) => {
      if ((p.from ?? 0) > t)
        out.push({ look: p.look, station: STATIONS[homes[k] as number] as Station });
    });
    return out;
  };
  const stage: Stage = {
    land: L,
    fray: get,
    seconds: 30,
    sizes: MID_SIZES,
    view,
    reveal,
    city: (t) => ({
      gait: walked(t) / GAIT_SECONDS,
      walk: 1 - smooth(R_HALT - 0.5, R_HALT + 0.2, t),
      settle: settle(t),
      ramp: clamp((t - R_RAMP[0]) / (R_RAMP[1] - R_RAMP[0])),
      rampSide: 1,
      detail: 1 - k(t),
      size: lerp(96, MID_SIZES.citizen, k(t)),
      crew: crewAt(t),
      lantern: 0.2,
    }),
    // A landing begins in peace: no black comes with the reveal.
    black: () => null,
    lettering: (t) =>
      Math.max(
        1 - smooth(R_MOVE[0] - 0.4, R_MOVE[0] + 0.4, t),
        smooth(R_MOVE[1] - 0.4, R_MOVE[1] + 0.4, t),
      ),
    corners: (t) => {
      const f = get();
      const landed = t >= R_HALT;
      // The legs plant at 3:00 on the cycle clock, R_HALT seconds in.
      const base = landedCorners(
        L,
        LANDED - R_HALT,
        t,
        f,
        crewAt(t).length,
        logLine(c(6), BENCH_ITEM, itemInk(2)),
        0,
        31,
      );
      return landed
        ? base
        : { ...base, left: R_HALT - t, to: "landing", gone: 1 - (R_HALT - t) / 180, horn: 1 };
    },
  };
  const scene = landingScene(stage);
  return {
    ...scene,
    draw(d: Draw, t: number): void {
      // The land of the march goes as the landing is inked over it.
      const lift = 1 - smooth(R_HALT, R_MOVE[0] + 2, t);
      if (lift > 0.01) {
        const v = view(t);
        drawTransitPlan(
          d,
          v.ox + L.city.x * v.T,
          v.oy + L.city.y * v.T,
          v.T,
          walked(t) * WALK_SPEED,
          lift,
        );
      }
      scene.draw(d, t);
    },
  };
}

// ---------------------------------------------------------------- the mid landing from the helper

export const WEAPONS: Weapon[] = [
  "blade",
  "blade",
  "bow",
  "blade",
  "sling",
  "maul",
  "spear",
  "pot",
];

/**
 * Citizens in groups at pockets: each group on the city's side of what it
 * fights, spread over an arc so no group stands as a rank or a file; at a
 * chest, scrap or a seam one of them works it.
 */
function sendGroups(
  L: MidLanding,
  mr: MidRoster,
  crowd: Look[],
  parties: { pocket: number; size: number }[],
  first: number,
  seed: number,
): CitizenPlan[] {
  const random = rng(seed);
  const out: CitizenPlan[] = [];
  let next = first;
  const foot: [number, number] = [
    L.city.x + rampFoot(L.rampSide)[0],
    L.city.y + rampFoot(L.rampSide)[1],
  ];
  for (const party of parties) {
    const p = L.pockets[party.pocket] as Pocket;
    const list = mr.holds[party.pocket] ?? [];
    const target = list.find((h) => h.kind === "elite") ?? list[0];
    const tx = target?.x ?? p.x;
    const ty = target?.y ?? p.y + 2;
    const r = target ? HOLD_R[target.kind] : 2;
    const toward = Math.atan2(foot[1] - ty, foot[0] - tx);
    for (let k = 0; k < party.size; k++) {
      const look = crowd[next++];
      if (!look) break;
      const weapon = WEAPONS[(look.id * 7 + k) % WEAPONS.length] as Weapon;
      if (k === 0 && p.kind !== "den" && p.kind !== "nest") {
        const [wx, wy] = (p.heaps[0] ?? [p.x - 0.9, p.y + 0.9]) as [number, number];
        out.push({
          look,
          weapon: "blade",
          x: wx + 0.8,
          y: wy + 0.7,
          orders: [
            {
              t: 0,
              work: [wx + 0.8, wy + 0.7],
              kind: p.kind === "chest" ? "chest" : p.kind === "seam" ? "seam" : "scrap",
            },
          ],
          haul: p.kind === "chest" ? 0 : 0.3,
        });
        continue;
      }
      const ranged = weapon === "bow" || weapon === "sling" || weapon === "pot";
      const a =
        toward +
        (k - (party.size - 1) / 2) * (1.6 / Math.max(2, party.size)) +
        (random() - 0.5) * 0.35;
      const dist = r + (ranged ? 3.4 : 0.9) + random() * 1.2 + (k % 2) * 0.7;
      out.push({
        look,
        weapon,
        x: tx + Math.cos(a) * dist * 1.1,
        y: ty + Math.sin(a) * dist * 0.75,
        orders: [{ t: 0, fight: [tx, ty], r: r + 3 }],
      });
    }
  }
  return out;
}

/** Pockets with something to fight, spread round the city: every `n`th of them by angle. */
function spread(L: MidLanding, mr: MidRoster, n: number): number[] {
  const byAngle = L.pockets
    .map((p, i) => ({ i, a: Math.atan2(p.y - L.city.y, p.x - L.city.x) }))
    .filter((q) => (mr.holds[q.i] ?? []).length > 0)
    .sort((a, b) => a.a - b.a);
  const out: number[] = [];
  for (let k = 0; k < n && k < byAngle.length; k++)
    out.push((byAngle[Math.floor((k * byAngle.length) / n)] as { i: number }).i);
  return out;
}

/**
 * An expedition on a mid landing from the helper. With 150, it is the
 * expedition's own map: twenty aboard and 130 out in groups of two to eight
 * at twenty pockets on every side; the dens send out fodder as it is killed,
 * so the plate keeps about 600 monsters.
 */
function midExpedition(o: {
  seed: number;
  rampSide: 1 | -1;
  count: number;
  aboard: number;
  offRamp: number;
}): LandingScene {
  const large = o.count > 40;
  const L = large ? expeditionLanding() : growMid({ seed: o.seed, rampSide: o.rampSide });
  const mr = populateMid(L, o.seed * 3 + 1);
  const R = mr.roster;
  const crowd = crowdOf(o.count);
  if (large) {
    // The dens keep the plate full: fodder comes out of each mouth through the scene.
    L.pockets.forEach((p, i) => {
      if (p.kind !== "den") return;
      const g = (mr.holds[i] ?? [])[0]?.group ?? R.group(p.x, p.y + 1, 6, 12);
      R.swarm(45, p.x + 0.3, p.y + 0.8, 0.4, g, (k) => 1 + k * 0.85 + (i % 3) * 0.3);
    });
  }
  const sizes = large ? [8, 7, 6, 8, 5, 7, 6, 8, 7, 6, 5, 8, 7, 6, 7, 5, 6, 7, 6, 5] : [3, 3, 2, 2];
  const pockets = spread(L, mr, sizes.length);
  const parties = pockets.map((pocket, k) => ({ pocket, size: sizes[k] as number }));
  const citizens = sendGroups(L, mr, crowd, parties, o.aboard + o.offRamp, o.seed + 9);
  // The rest walk the paths, going out or coming home.
  const foot: [number, number] = [
    L.city.x + rampFoot(L.rampSide)[0],
    L.city.y + rampFoot(L.rampSide)[1],
  ];
  const random = rng(o.seed + 17);
  for (let k = o.aboard + o.offRamp + citizens.length; k < o.count; k++) {
    const p = L.pockets[(k * 7) % L.pockets.length] as Pocket;
    const u = 0.3 + random() * 0.4;
    const going = random() < 0.6;
    citizens.push({
      look: crowd[k] as Look,
      weapon: "blade",
      x: lerp(foot[0], p.x, u),
      y: lerp(foot[1], p.y + 3, u),
      haul: going ? 0 : 0.8,
      orders: [{ t: 0, go: going ? [[p.x, p.y + 3.5]] : [foot], route: going }],
    });
  }
  // Some still coming off a far-side ramp, which means walking under the hull to the near side.
  const top = rampTop(L.rampSide);
  const footOff = rampFoot(L.rampSide);
  const rampTopAt: [number, number] = [L.city.x + top[0], L.city.y + top[1]];
  const H = deckH(1);
  for (let k = 0; k < o.offRamp; k++) {
    const across = L.pockets
      .filter((p) => (p.y - L.city.y) * L.rampSide < -3)
      .sort((a, b) => Math.abs(a.x - L.city.x) - Math.abs(b.x - L.city.x));
    const target = (across[k % Math.max(1, across.length)] ?? L.pockets[0]) as Pocket;
    citizens.push({
      look: crowd[o.aboard + k] as Look,
      weapon: WEAPONS[k % WEAPONS.length] as Weapon,
      x: rampTopAt[0] + 0.3 + k * 0.35,
      y: rampTopAt[1],
      z: H,
      ramp: Math.hypot(footOff[0] - top[0], footOff[1] - top[1]),
      from: 9.6 + k * 0.8,
      orders: [{ t: 0, go: [foot, [L.city.x + (k ? 3 : -3), L.city.y], [target.x, target.y + 3]] }],
    });
  }
  const script: Script = {
    seed: o.seed * 11 + 3,
    seconds: 40.5,
    tempo: large ? 2.2 : 1.2,
    toughness: large ? 16 : 2.2,
    strokeHits: large ? 3 : 4,
    citizens,
    monsters: R.monsters,
    groups: R.groups,
    ramp: foot,
  };
  let fray: Fray | null = null;
  const get = (): Fray => {
    if (!fray) fray = runFray(script);
    return fray;
  };
  const stations = crowdStations(o.aboard + o.offRamp);
  const crewAt = (t: number): Crew[] => {
    const out: Crew[] = [];
    for (let k = 0; k < o.aboard; k++)
      out.push({ look: crowd[k] as Look, station: stations[k] as Station });
    citizens.forEach((p, k) => {
      if ((p.from ?? 0) > t)
        out.push({
          look: p.look,
          station: stations[o.aboard + (k - (citizens.length - o.offRamp))] as Station,
        });
    });
    return out;
  };
  const edge = unfinishedEdge(L);
  // Two chatters ask for their citizens: their tags are called for six seconds each.
  const calls = large
    ? [
        { who: 3, at: 6 },
        { who: 61, at: 7.5 },
        { who: 27, at: 21 },
        { who: 104, at: 22.5 },
      ]
    : [];
  const stage: Stage = {
    land: L,
    fray: get,
    seconds: 40,
    sizes: MID_SIZES,
    view: () => ({ T: L.T, ox: L.ox, oy: L.oy }),
    reveal: () => edge,
    city: (t) => ({
      gait: 0,
      walk: 0,
      settle: 1,
      ramp: 1,
      rampSide: o.rampSide,
      detail: 0,
      size: MID_SIZES.citizen,
      crew: crewAt(t),
      lantern: 0.2,
    }),
    black: () => null,
    corners: (t) =>
      landedCorners(
        L,
        270,
        t,
        get(),
        crewAt(t).length,
        logLine(crowd[o.aboard] as Look, itemName(23, 2, 1), itemInk(2)),
        large ? 1840 : 214,
        large ? 214 : 31,
      ),
    called: (t) => calls.filter((q) => t >= q.at && t < q.at + 6).map((q) => q.who),
  };
  return landingScene(stage);
}

export const expeditionBScene = (): LandingScene =>
  midExpedition({ seed: 2, rampSide: -1, count: 15, aboard: 2, offRamp: 2 });
export const expedition150Scene = (): LandingScene =>
  midExpedition({ seed: 150, rampSide: 1, count: 150, aboard: 20, offRamp: 0 });

/** How many monsters are alive in a scene at `t`, by its own count. */
export const monstersAlive = (f: Fray, t: number): number => aliveAt(f, t);
