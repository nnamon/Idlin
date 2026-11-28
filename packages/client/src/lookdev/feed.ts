// What a landing is drawn from (landing.ts): who is where at a moment, by id,
// and what has happened, in time order. Two kinds of feed fill it: the
// scripted fights of the look target (`scriptFeed`, here) and the world
// server's viewer messages (`MessageFeed`, in message.ts). The drawing reads
// nothing else of either.

import type { Look } from "./figure.ts";
import {
  ACT,
  type Blow,
  type BodyAt,
  citizenAt,
  type Fray,
  type Hit,
  type Kill,
  type Marker,
  monsterAt,
  type Shot,
  type Weapon,
} from "./fray.ts";

/** A citizen at a moment. */
export interface CitizenNow {
  /** Who it is. Its tag is held by this, and the stage's hooks name citizens by it. */
  readonly id: number;
  readonly look: Look;
  readonly weapon: Weapon;
  readonly body: BodyAt;
  /** At work on a chest, rather than on scrap or a seam. */
  readonly chest: boolean;
}

/** A monster at a moment. */
export interface MonsterNow {
  readonly id: number;
  /** MITE, HOUND, BRUTE or ELITE. */
  readonly kind: number;
  readonly build: number;
  readonly leader: boolean;
  /** Its pack, and with it a swarm's drawing. */
  readonly group: number;
  readonly body: BodyAt;
}

export interface Feed {
  /** Everyone at `t`, out and aboard, always in the same order. */
  citizens(t: number): readonly CitizenNow[];
  citizen(id: number, t: number): CitizenNow | undefined;
  monsters(t: number): readonly MonsterNow[];
  /** Where a pack rests, in tiles. */
  home(group: number): readonly [number, number] | undefined;
  /**
   * What has happened, each list in time order: hits by `t`, blows by `contact`, shots by `t0`,
   * kills by `t`. A live feed keeps only what can still be seen; a scripted one has all of it,
   * the future too.
   */
  readonly hits: readonly Hit[];
  readonly blows: readonly Blow[];
  readonly shots: readonly Shot[];
  readonly kills: readonly Kill[];
  readonly markers: readonly Marker[];
  readonly burns: Fray["burns"];
  readonly slams: Fray["slams"];
  readonly thrusts: Fray["thrusts"];
  readonly telegraphs: Fray["telegraphs"];
  /** Chests opened, when and where. */
  readonly chests: readonly { at: number; x: number; y: number }[];
  /** Whether everything still to happen is known: the scripted scenes lay numbers out by it. */
  readonly scripted: boolean;
}

/** The first in a list in time order whose time, by `at`, is `t` or later. */
export function firstFrom<T>(list: readonly T[], t: number, at: (e: T) => number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (at(list[mid] as T) < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * A scripted fight as a feed. A citizen's id is its place in the script, so the stage's hooks
 * (pennants, hauls, routes, called tags) name citizens by it. The fight is run the first time
 * anything is asked of it.
 */
export function scriptFeed(fray: () => Fray): Feed {
  // The last moment asked for, kept: a frame asks for it several times.
  let citizensAt = Number.NaN;
  let citizensNow: CitizenNow[] = [];
  let monstersAt = Number.NaN;
  let monstersNow: MonsterNow[] = [];
  const chestAt = (i: number, t: number): boolean => {
    const plan = fray().script.citizens[i];
    if (!plan) return false;
    for (let k = plan.orders.length - 1; k >= 0; k--) {
      const o = plan.orders[k];
      if (o && o.t <= t) return "work" in o && o.kind === "chest";
    }
    return false;
  };
  const citizenOf = (f: Fray, i: number, t: number): CitizenNow => {
    const plan = f.script.citizens[i] as Fray["script"]["citizens"][number];
    const body = citizenAt(f, i, t);
    return {
      id: i,
      look: plan.look,
      weapon: plan.weapon,
      body,
      chest: body.act === ACT.work && chestAt(i, t),
    };
  };
  return {
    citizens(t) {
      if (t !== citizensAt) {
        const f = fray();
        citizensNow = f.script.citizens.map((_, i) => citizenOf(f, i, t));
        citizensAt = t;
      }
      return citizensNow;
    },
    citizen(id, t) {
      const f = fray();
      if (!Number.isInteger(id) || id < 0 || id >= f.script.citizens.length) return undefined;
      return t === citizensAt ? citizensNow[id] : citizenOf(f, id, t);
    },
    monsters(t) {
      if (t !== monstersAt) {
        const f = fray();
        monstersNow = f.script.monsters.map((plan, j) => ({
          id: j,
          kind: plan.kind,
          build: plan.build,
          leader: plan.leader === true,
          group: plan.group,
          body: monsterAt(f, j, t),
        }));
        monstersAt = t;
      }
      return monstersNow;
    },
    home: (group) => fray().script.groups[group]?.home,
    get hits() {
      return fray().hits;
    },
    get blows() {
      return fray().blows;
    },
    get shots() {
      return fray().shots;
    },
    get kills() {
      return fray().kills;
    },
    get markers() {
      return fray().markers;
    },
    get burns() {
      return fray().burns;
    },
    get slams() {
      return fray().slams;
    },
    get thrusts() {
      return fray().thrusts;
    },
    get telegraphs() {
      return fray().telegraphs;
    },
    get chests() {
      return fray().script.chests ?? [];
    },
    scripted: true,
  };
}
