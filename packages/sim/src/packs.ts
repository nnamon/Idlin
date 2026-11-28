// The monsters on a landing, once they are laid (docs/slice.md, section 1):
// putting laying.ts's layout on the ground at legs-plant, the dens' clocks,
// the pack's own brain, keeping to the pocket, what the plate letters, the
// `pack_*` and `den_*` sensors, and the plate's part of a snapshot.
//
// A laid monster is an actor of one of the four rank kinds, at a level of its
// own, in a pack (`actor.pack`). It runs no Tactics program: the pack decides.
// A pack stands at its post until a citizen it will go for comes within 6
// tiles of any of it, inside its pocket; then the whole pack goes for that
// citizen, and when the citizen leaves the pocket, goes down or goes aboard,
// it breaks off and walks back. It walks only over its pocket: its district
// and the gates of that district's passages.

import { linked, terrainOf, tileAt, walkable } from "./atlas.ts";
import { attackAt } from "./brain.ts";
import { MARCH } from "./cycle.ts";
import { landingFor } from "./deck.ts";
import { gridOf, setPath } from "./grid.ts";
import { isInt32 } from "./hash.ts";
import type { Rank } from "./hit.ts";
import type { Landing } from "./landing.ts";
import {
  AROUND,
  CAP,
  DEN_GATE,
  DEN_PACKS,
  layPlate,
  MEMBERS,
  PACK_KINDS,
  PAY_CAP,
  type PackKind,
  plateGround,
  type Sharer,
  walkFrom,
} from "./laying.ts";
import { ABOARD, NEIGHBOURS, type Point } from "./map.ts";
import {
  type Actor,
  ADVENTURER,
  addMonster,
  armsOf,
  blockerAt,
  mending,
  reachOf,
  type World,
  type WorldEvent,
} from "./world.ts";

/** A laid pack, as the world holds it. Coordinates are the world's. */
export interface PackState {
  readonly id: number;
  /** An index into PACK_KINDS. */
  readonly kind: number;
  /** Its post: for a guard the thing it stands beside, for an elite its den's mouth. */
  readonly x: number;
  readonly y: number;
  /** The district it keeps to. */
  readonly pocket: number;
  readonly level: number;
  /** It pays `pay / per` times what is written. */
  readonly pay: number;
  readonly per: number;
  /** The citizen whose share it was laid from, 0 for nobody's. */
  readonly owner: number;
  /** The den it came out of, or -1. */
  readonly den: number;
  /** Its leader's actor id; its other monsters' ids follow it. */
  readonly leader: number;
  /** The citizen it is going for, 0 while it stands. */
  target: number;
  /** Citizens that have struck it, in id order: it goes for them whatever their level. */
  struck: number[];
}

/** A pack waiting in a den. */
export interface Queued {
  readonly kind: number;
  readonly level: number;
  readonly pay: number;
  readonly per: number;
  readonly owner: number;
}

/** A den, as the world holds it. */
export interface DenState {
  /** Its mouth. */
  readonly x: number;
  readonly y: number;
  readonly pocket: number;
  readonly level: number;
  /** The packs still inside, in the order they were laid into it. */
  queue: Queued[];
  /** Ticks between its turns, fixed at legs-plant; 0 when nothing was left inside. */
  readonly every: number;
  /** The tick of its next turn. */
  next: number;
  /** The tick its last pack came out, legs-plant at first. */
  last: number;
}

export interface Plate {
  packs: PackState[];
  /** One for each of the landing's dens, in its order. */
  dens: DenState[];
  /** The id the next pack takes. */
  nextPack: number;
}

/** The kind of a den's elite, as PackState holds it. */
export const ELITE = PACK_KINDS.indexOf("elite");

/** Ticks a pack's monster stands before it looks again, at its post. */
const POSTED_TICKS = 10;
/** A citizen within this many tiles of any of a pack, inside its pocket, brings the pack on. */
export const SIGHT = 6;
/** A pack leaves alone a citizen this many levels over it or more, until struck by it. */
export const LEAVE_ALONE = 10;

/** A landing with its offset from world to landing tiles, and the districts each tile counts as. */
interface OnLanding {
  readonly landing: Landing;
  readonly ox: number;
  readonly oy: number;
  readonly pockets: Pockets;
}
/** Worked out once for each plate, which stands on one landing for its whole life. */
const plateLandings = new WeakMap<Plate, OnLanding>();

/** The landing the world stands on, if it is set down on one with its plate laid. */
export function landingOf(world: World): OnLanding | null {
  const { cycle, plate } = world;
  if (!cycle || plate === null) return null;
  let on = plateLandings.get(plate);
  if (!on) {
    const landing = landingFor(cycle.city, cycle.landing);
    on = { landing, ox: landing.city.x, oy: landing.city.y, pockets: pocketsOf(landing) };
    plateLandings.set(plate, on);
  }
  return on;
}

/** For each tile of a landing, the districts it counts as: its own, or the two a gate joins. */
interface Pockets {
  readonly a: Int16Array;
  readonly b: Int16Array;
}
const pocketMaps = new WeakMap<Landing, Pockets>();

function pocketsOf(landing: Landing): Pockets {
  const known = pocketMaps.get(landing);
  if (known) return known;
  const N = landing.width * landing.height;
  const a = new Int16Array(N).fill(-1);
  const b = new Int16Array(N).fill(-1);
  landing.districtAt.forEach((d, i) => {
    a[i] = d;
  });
  for (const passage of landing.passages)
    for (const t of passage.tiles) {
      const i = t.y * landing.width + t.x;
      if ((a[i] as number) < 0) {
        a[i] = passage.a;
        b[i] = passage.b;
      }
    }
  const made = { a, b };
  pocketMaps.set(landing, made);
  return made;
}

/** Whether world tile (x, y) is in `pocket`: a tile of the district or of one of its gates. */
export function inPocket(world: World, pocket: number, x: number, y: number): boolean {
  const on = landingOf(world);
  if (!on) return false;
  const { landing, ox, oy } = on;
  const lx = x + ox;
  const ly = y + oy;
  if (lx < 0 || ly < 0 || lx >= landing.width || ly >= landing.height) return false;
  const { a, b } = on.pockets;
  const i = ly * landing.width + lx;
  return a[i] === pocket || b[i] === pocket;
}

/** The pack a laid monster stands in. */
export function packOf(world: World, actor: Actor): PackState | undefined {
  const { plate } = world;
  if (!plate || actor.pack === 0) return undefined;
  return findPack(plate, actor.pack);
}

function findPack(plate: Plate, id: number): PackState | undefined {
  // Packs are kept in id order, so a binary search finds one.
  const { packs } = plate;
  let lo = 0;
  let hi = packs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = packs[mid] as PackState;
    if (p.id === id) return p;
    if (p.id < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

/** Whether a citizen's blow on laid monster `target` counts: it does nothing from outside the pocket. */
export function blowCounts(world: World, attacker: Actor, target: Actor): boolean {
  if (target.pack === 0 || attacker.kind !== ADVENTURER) return true;
  const pack = packOf(world, target);
  return !pack || inPocket(world, pack.pocket, attacker.x, attacker.y);
}

/** A citizen struck a laid monster from inside its pocket: the pack goes for it now, whatever its level. */
export function struckBy(world: World, target: Actor, attacker: Actor): void {
  const pack = packOf(world, target);
  if (!pack || attacker.kind !== ADVENTURER) return;
  if (!pack.struck.includes(attacker.id)) {
    pack.struck.push(attacker.id);
    pack.struck.sort((p, q) => p - q);
  }
  if (pack.target === 0) pack.target = attacker.id;
}

/** Whether a laid monster may stand on (x, y): only in its pocket. */
export function mayStand(world: World, actor: Actor, x: number, y: number): boolean {
  if (actor.pack === 0) return true;
  const pack = packOf(world, actor);
  return pack !== undefined && inPocket(world, pack.pocket, x, y);
}

const at = (landing: Landing, i: number, ox: number, oy: number): Point => ({
  x: (i % landing.width) - ox,
  y: Math.floor(i / landing.width) - oy,
});

/** The Arms of a citizen, as a share takes it. */
const sharerOf = (actor: Actor): Sharer => ({
  arms: armsOf(actor),
  carry: actor.carry,
  place: actor.place,
});

/**
 * Lays the landing's monsters, the tick the legs plant. The ground is the
 * landing's already. Every citizen awake gives a share, and keeps its carry
 * and place for the next landing.
 */
export function layLanding(world: World, events: WorldEvent[]): void {
  const { cycle } = world;
  if (!cycle) return;
  const landing = landingFor(cycle.city, cycle.landing);
  const ox = landing.city.x;
  const oy = landing.city.y;
  const citizens = world.actors.filter((a) => a.kind === ADVENTURER);
  const layout = layPlate(landing, citizens.map(sharerOf));
  citizens.forEach((c, i) => {
    const share = layout.shares[i];
    if (!share) return;
    c.carry = share.carry;
    c.place = share.place;
  });
  const tick = world.tick;
  const pocketOf = (i: number): number => landing.districtAt[i] as number;
  const ownerId = (owner: number): number => (owner < 0 ? 0 : (citizens[owner] as Actor).id);
  const plate: Plate = {
    packs: [],
    dens: landing.dens.map((d, n) => {
      const queue = (layout.inside[n] ?? []).map((p) => ({
        kind: PACK_KINDS.indexOf(p.kind),
        level: p.level,
        pay: p.pay,
        per: p.per,
        owner: ownerId(p.owner),
      }));
      const every = queue.length === 0 ? 0 : Math.floor(DEN_SPAN / queue.length);
      return {
        x: d.x - ox,
        y: d.y - oy,
        pocket: d.district,
        level: d.level,
        queue,
        every,
        next: tick + every,
        last: tick,
      };
    }),
    nextPack: 1,
  };
  world.plate = plate;
  const occupied = occupancy(world);
  for (const p of layout.standing) {
    const post = at(landing, p.tile, ox, oy);
    const kind = PACK_KINDS.indexOf(p.kind);
    spawnPack(world, occupied, {
      kind,
      post,
      from: post,
      pocket: pocketOf(p.tile),
      level: p.level,
      pay: p.pay,
      per: p.per,
      owner: ownerId(p.owner),
      den: p.den,
    });
  }
  events.push({ type: "laid", tick, monsters: monstersOnPlate(world), room: layout.room });
}

/** From legs-plant to the sighting: a den's last turn is due by then. */
export const DEN_SPAN = 3_000;

/** Who stands on each tile, for putting new monsters down: citizens and monsters other than fodder, and fodder. */
interface Occupied {
  readonly solid: Set<number>;
  readonly fodder: Map<number, number>;
}

const key = (x: number, y: number): number => (y + 0x8000) * 0x10000 + (x + 0x8000);

function occupancy(world: World): Occupied {
  const solid = new Set<number>();
  const fodder = new Map<number, number>();
  for (const a of world.actors) {
    const k = key(a.x, a.y);
    if (a.pack > 0 && a.kind === "fodder") fodder.set(k, (fodder.get(k) ?? 0) + 1);
    else solid.add(k);
  }
  return { solid, fodder };
}

/** Whether a monster of `rank` may be put on (x, y) now. */
const roomFor = (occupied: Occupied, rank: Rank, x: number, y: number): boolean => {
  const k = key(x, y);
  if (occupied.solid.has(k)) return false;
  const fodder = occupied.fodder.get(k) ?? 0;
  return rank === "fodder" ? fodder < FODDER_PER_TILE : fodder === 0;
};

/** Up to three fodder share a tile (plan.md, section 2.2). */
export const FODDER_PER_TILE = 3;

/** The tile a pack's monster `slot` (0 its leader) stands on round its post. */
function slotOf(kind: PackKind, post: Point, slot: number): Point {
  // A guard stands round the thing it guards; anything else has its leader on the post.
  const ring = kind === "guard" ? slot : slot - 1;
  if (ring < 0) return post;
  const [dx, dy] = AROUND[ring % AROUND.length] as readonly [number, number];
  return { x: post.x + dx, y: post.y + dy };
}

interface NewPack {
  readonly kind: number;
  readonly post: Point;
  /** Where its monsters are put: the post, or a den's mouth. */
  readonly from: Point;
  readonly pocket: number;
  readonly level: number;
  readonly pay: number;
  readonly per: number;
  readonly owner: number;
  readonly den: number;
}

/**
 * Puts a pack's monsters down: each on its own tile round the post when they
 * are laid there, or, out of a den, on the free tiles of the pocket nearest
 * its mouth, and gives the pack its id.
 */
function spawnPack(world: World, occupied: Occupied, made: NewPack): void {
  const plate = world.plate as Plate;
  const kind = PACK_KINDS[made.kind] as PackKind;
  const ranks = MEMBERS[kind];
  const id = plate.nextPack++;
  const leader = world.nextActorId;
  const spots =
    made.from === made.post ? null : nearFree(world, occupied, made.pocket, made.from, ranks);
  ranks.forEach((rank, slot) => {
    let spot = spots ? spots[slot] : slotOf(kind, made.post, slot);
    if (
      !spot ||
      !walkable(world.atlas, spot.x, spot.y) ||
      !inPocket(world, made.pocket, spot.x, spot.y) ||
      !roomFor(occupied, rank, spot.x, spot.y)
    )
      spot =
        (nearFree(world, occupied, made.pocket, made.post, [rank])[0] as Point | undefined) ??
        made.post;
    const k = key(spot.x, spot.y);
    if (rank === "fodder") occupied.fodder.set(k, (occupied.fodder.get(k) ?? 0) + 1);
    else occupied.solid.add(k);
    addMonster(world, rank, made.level, id, spot.x, spot.y);
  });
  plate.packs.push({
    id,
    kind: made.kind,
    x: made.post.x,
    y: made.post.y,
    pocket: made.pocket,
    level: made.level,
    pay: made.pay,
    per: made.per,
    owner: made.owner,
    den: made.den,
    leader,
    target: 0,
    struck: [],
  });
}

/** The tiles of `pocket` nearest `from` by the walk that have room for each rank in turn. */
function nearFree(
  world: World,
  occupied: Occupied,
  pocket: number,
  from: Point,
  ranks: readonly Rank[],
): Point[] {
  const { atlas } = world;
  const found: Point[] = [];
  const taken = new Map<number, number>();
  const seen = new Set<number>([key(from.x, from.y)]);
  const queue: Point[] = [from];
  let r = 0;
  for (let head = 0; head < queue.length && r < ranks.length; head++) {
    const here = queue[head] as Point;
    const k = key(here.x, here.y);
    // Fill each tile as far as it takes, before the next.
    for (;;) {
      const rank = ranks[r] as Rank | undefined;
      if (!rank) break;
      const extra = taken.get(k) ?? 0;
      const fodder = (occupied.fodder.get(k) ?? 0) + extra;
      const solid = occupied.solid.has(k) || (extra > 0 && ranks[r - 1] !== "fodder");
      const fits =
        walkable(atlas, here.x, here.y) &&
        !solid &&
        (rank === "fodder" ? fodder < FODDER_PER_TILE : fodder === 0 && extra === 0);
      if (!fits) break;
      found.push(here);
      taken.set(k, extra + 1);
      r++;
      if (rank !== "fodder") break;
    }
    for (const [dx, dy] of NEIGHBOURS) {
      const x = here.x + dx;
      const y = here.y + dy;
      const n = key(x, y);
      if (seen.has(n) || !linked(atlas, here.x, here.y, x, y) || !inPocket(world, pocket, x, y))
        continue;
      seen.add(n);
      queue.push({ x, y });
    }
  }
  return found;
}

/** Monsters on the plate now: every monster in the world. */
export const monstersOnPlate = (world: World): number =>
  world.actors.reduce((n, a) => n + (a.kind === ADVENTURER ? 0 : 1), 0);

/**
 * The plate's part of a tick, before blows land: packs with no monster left
 * are gone and free their posts, dens with a turn let a pack out, and every
 * standing pack looks for someone to go for.
 */
export function runPlate(world: World, events: WorldEvent[]): void {
  const { plate, cycle } = world;
  if (!plate || !cycle) return;
  const members = membersOf(world);
  plate.packs = plate.packs.filter((p) => (members.get(p.id)?.length ?? 0) > 0);
  if (world.tick < cycle.start + MARCH) runDens(world, events);
  lookOut(world, membersOf(world));
}

/** Each pack's monsters, in id order. */
function membersOf(world: World): Map<number, Actor[]> {
  const members = new Map<number, Actor[]>();
  for (const a of world.actors) {
    if (a.pack === 0) continue;
    const list = members.get(a.pack);
    if (list) list.push(a);
    else members.set(a.pack, [a]);
  }
  return members;
}

/** The posts of a landing in world tiles, by pocket. */
function postsByPocket(world: World): Map<number, Point[]> {
  const { landing, ox, oy } = landingOf(world) as NonNullable<ReturnType<typeof landingOf>>;
  const byPocket = new Map<number, Point[]>();
  for (const t of plateGround(landing).posts) {
    const d = landing.districtAt[t] as number;
    const list = byPocket.get(d) ?? [];
    list.push(at(landing, t, ox, oy));
    byPocket.set(d, list);
  }
  return byPocket;
}

/** The posts of `pocket` that no pack holds. */
function freePosts(world: World, posts: Map<number, Point[]>, pocket: number): Point[] {
  const plate = world.plate as Plate;
  const held = new Set<number>();
  for (const p of plate.packs) if (p.pocket === pocket) held.add(key(p.x, p.y));
  return (posts.get(pocket) ?? []).filter((p) => !held.has(key(p.x, p.y)));
}

/**
 * The dens with a turn on this tick, the one whose last pack came out
 * longest ago first, then the lower den number. Each lets its next pack out
 * if the plate holds fewer than its room and 50 and its pocket has a free
 * post, counted again after each; otherwise the turn passes.
 */
function runDens(world: World, events: WorldEvent[]): void {
  const plate = world.plate as Plate;
  const due = plate.dens
    .map((den, n) => ({ den, n }))
    .filter(({ den }) => den.queue.length > 0 && den.every > 0 && den.next <= world.tick);
  if (due.length === 0) return;
  due.sort((p, q) => p.den.last - q.den.last || p.n - q.n);
  const on = landingOf(world) as NonNullable<ReturnType<typeof landingOf>>;
  const gate = roomOfWorld(world) + DEN_GATE;
  const posts = postsByPocket(world);
  for (const { den, n } of due) {
    den.next += den.every;
    const monsters = monstersOnPlate(world);
    const turn = { type: "den", tick: world.tick, den: n, monsters } as const;
    if (monsters >= gate) {
      events.push({ ...turn, out: false, why: "cap" });
      continue;
    }
    const free = freePosts(world, posts, den.pocket);
    if (free.length === 0) {
      events.push({ ...turn, out: false, why: "post" });
      continue;
    }
    const post = farthestFromCitizens(world, on, free);
    const next = den.queue.shift() as Queued;
    den.last = world.tick;
    spawnPack(world, occupancy(world), {
      kind: next.kind,
      post,
      from: { x: den.x, y: den.y },
      pocket: den.pocket,
      level: next.level,
      pay: next.pay,
      per: next.per,
      owner: next.owner,
      den: n,
    });
    events.push({ ...turn, out: true, why: "" });
  }
}

/** The room of the landing the world stands on. */
export function roomOfWorld(world: World): number {
  const on = landingOf(world);
  return on ? Math.floor((on.landing.width * on.landing.height * 30) / 180) : 0;
}

/** The cap: the plate holds its room and this many at most. */
export const capOf = (world: World): number => roomOfWorld(world) + CAP;

/**
 * Of `posts`, the one whose walk to the nearest citizen out on the plate is
 * longest; while nobody is out, the walk to the ramp. Then the lower tile.
 */
function farthestFromCitizens(
  world: World,
  on: NonNullable<ReturnType<typeof landingOf>>,
  posts: readonly Point[],
): Point {
  const { landing, ox, oy } = on;
  const ground = plateGround(landing);
  const W = landing.width;
  const starts: number[] = [];
  for (const a of world.actors) {
    if (a.kind !== ADVENTURER || mending(a)) continue;
    const terrain = terrainOf(world.atlas, a.x, a.y);
    if (terrain === undefined || ABOARD.has(terrain)) continue;
    const i = (a.y + oy) * W + (a.x + ox);
    if (ground.open[i]) starts.push(i);
  }
  const walk = starts.length === 0 ? ground.walk : walkFrom(W, landing.height, ground.open, starts);
  let best = posts[0] as Point;
  let bestKey = -2;
  for (const p of posts) {
    const i = (p.y + oy) * W + (p.x + ox);
    const steps = walk[i] as number;
    const bestI = (best.y + oy) * W + (best.x + ox);
    if (steps > bestKey || (steps === bestKey && i < bestI)) {
      best = p;
      bestKey = steps;
    }
  }
  return best;
}

/** Whether a pack goes for `citizen`: one under 10 levels over it, or one that struck it. */
const goesFor = (pack: PackState, citizen: Actor): boolean =>
  armsOf(citizen) < pack.level + LEAVE_ALONE || pack.struck.includes(citizen.id);

/**
 * Every pack going for a citizen keeps on while the citizen is in its
 * pocket, standing and on the ground; otherwise it breaks off. Every pack
 * standing goes for the nearest citizen in its pocket within SIGHT tiles of
 * any of its monsters that it goes for, then the lower id.
 */
function lookOut(world: World, members: Map<number, Actor[]>): void {
  const plate = world.plate as Plate;
  const byId = new Map<number, Actor>();
  const out: Actor[] = [];
  for (const a of world.actors) {
    if (a.kind !== ADVENTURER) continue;
    byId.set(a.id, a);
    if (a.hp > 0 && !mending(a)) out.push(a);
  }
  const inIt = (pack: PackState, c: Actor): boolean => inPocket(world, pack.pocket, c.x, c.y);
  for (const pack of plate.packs) {
    if (pack.target !== 0) {
      const c = byId.get(pack.target);
      if (c && c.hp > 0 && !mending(c) && inIt(pack, c) && goesFor(pack, c)) continue;
      pack.target = 0;
    }
    const mine = members.get(pack.id) ?? [];
    let best: Actor | undefined;
    let bestSteps = SIGHT + 1;
    for (const c of out) {
      if (!goesFor(pack, c) || !inIt(pack, c)) continue;
      for (const m of mine) {
        const steps = Math.max(Math.abs(m.x - c.x), Math.abs(m.y - c.y));
        if (steps < bestSteps || (steps === bestSteps && best && c.id < best.id)) {
          best = c;
          bestSteps = steps;
        }
      }
    }
    if (best) pack.target = best.id;
  }
}

/**
 * A laid monster's decision, when it has nothing left to do: strike the
 * citizen its pack goes for if it is in reach, else close on it over the
 * pocket; with nobody to go for, back to its place round the post.
 */
export function packThink(world: World, actor: Actor, events: WorldEvent[]): void {
  if (actor.wait > 0) {
    actor.wait--;
    return;
  }
  const pack = packOf(world, actor);
  if (!pack) {
    actor.wait = POSTED_TICKS;
    return;
  }
  const grid = gridOf(world);
  const target = pack.target === 0 ? undefined : grid.byId.get(pack.target);
  if (target) {
    const dx = target.x - actor.x;
    const dy = target.y - actor.y;
    const reach = reachOf(world, actor);
    if ((dx === 0 || dy === 0) && Math.abs(dx) + Math.abs(dy) <= reach && (dx !== 0 || dy !== 0)) {
      if (attackAt(world, actor, target.x, target.y, events)) return;
    }
    const way = pocketWay(world, actor, pack, (x, y) => {
      const ex = target.x - x;
      const ey = target.y - y;
      return (ex === 0 || ey === 0) && Math.abs(ex) + Math.abs(ey) === 1;
    });
    if (way.length > 0) setPath(world, actor, way.slice(0, 1));
    else actor.wait = 2;
    return;
  }
  const kind = PACK_KINDS[pack.kind] as PackKind;
  let spot = slotOf(kind, { x: pack.x, y: pack.y }, actor.id - pack.leader);
  if (!walkable(world.atlas, spot.x, spot.y) || !inPocket(world, pack.pocket, spot.x, spot.y))
    spot = { x: pack.x, y: pack.y };
  if (actor.x === spot.x && actor.y === spot.y) {
    actor.wait = POSTED_TICKS;
    return;
  }
  const way = pocketWay(world, actor, pack, (x, y) => x === spot.x && y === spot.y, spot);
  if (way.length > 0) setPath(world, actor, way);
  else actor.wait = POSTED_TICKS;
}

/**
 * The shortest walk from `actor` over its pack's pocket to a tile `goal`
 * accepts, round anyone in its way; `through` may be stepped onto even if
 * someone stands there, as the end of a walk back to its place. [] if there
 * is none.
 */
function pocketWay(
  world: World,
  actor: Actor,
  pack: PackState,
  goal: (x: number, y: number) => boolean,
  through?: Point,
): Point[] {
  const { atlas } = world;
  const start = tileAt(atlas, actor.x, actor.y);
  const from = new Map<number, number>([[start, -1]]);
  const queue: Point[] = [{ x: actor.x, y: actor.y }];
  for (let head = 0; head < queue.length; head++) {
    const here = queue[head] as Point;
    if (head > 0 && goal(here.x, here.y)) {
      const path: Point[] = [];
      for (let t = tileAt(atlas, here.x, here.y); t !== start; t = from.get(t) as number) {
        path.push({
          x: (t % atlas.width) + atlas.left,
          y: Math.floor(t / atlas.width) + atlas.top,
        });
      }
      return path.reverse();
    }
    for (const [dx, dy] of NEIGHBOURS) {
      const x = here.x + dx;
      const y = here.y + dy;
      if (!linked(atlas, here.x, here.y, x, y)) continue;
      const t = tileAt(atlas, x, y);
      if (from.has(t) || !inPocket(world, pack.pocket, x, y)) continue;
      const end = through !== undefined && through.x === x && through.y === y;
      if (!end && blockerAt(world, x, y, actor)) continue;
      from.set(t, tileAt(atlas, here.x, here.y));
      queue.push({ x, y });
    }
  }
  return [];
}

/** What `pack_distance` and `den_distance` read when there is none. */
export const NO_PACK = 9999;

/** The range of levels `pack_distance(n)` looks for: from Arms plus n to Arms plus `over`. */
function levelRange(world: World, actor: Actor, n: number): [number, number] {
  const arms = armsOf(actor);
  const program = world.programs[actor.program];
  const index = program ? program.params.findIndex((p) => p.name === "over") : -1;
  const over = index < 0 ? 0 : (actor.params[index] as number);
  const from = Math.max(-9, Math.min(30, n));
  return [arms + from, arms + over];
}

/**
 * The nearest laid monster in a straight grid line whose level `pack_distance(n)`
 * takes, with the lower id first if several are as near, or undefined.
 */
export function packNear(world: World, actor: Actor, n: number): Actor | undefined {
  if (!world.plate) return undefined;
  const [low, high] = levelRange(world, actor, n);
  let best: Actor | undefined;
  let bestSteps = 0;
  for (const a of gridOf(world).actors) {
    if (a.pack === 0 || a.hp <= 0 || a.level < low || a.level > high) continue;
    const steps = Math.abs(a.x - actor.x) + Math.abs(a.y - actor.y);
    if (!best || steps < bestSteps) {
      best = a;
      bestSteps = steps;
    }
  }
  return best;
}

/** The mouth of the nearest den with packs still inside whose level `den_distance(n)` takes, then the lower den. */
export function denNear(world: World, actor: Actor, n: number): Point | undefined {
  if (!world.plate) return undefined;
  const [low, high] = levelRange(world, actor, n);
  let best: Point | undefined;
  let bestSteps = 0;
  for (const den of world.plate.dens) {
    if (den.queue.length === 0 || den.level < low || den.level > high) continue;
    const steps = Math.abs(den.x - actor.x) + Math.abs(den.y - actor.y);
    if (!best || steps < bestSteps) {
      best = den;
      bestSteps = steps;
    }
  }
  return best;
}

/** One thing the plate letters on the ground: its text and the landing tile it stands at. */
export interface Letter extends Point {
  readonly text: string;
}

/**
 * What the plate letters (docs/slice.md, section 1): each den's mouth as
 * `den B 28`, and each pocket's level once, at its gate on the city's side:
 * the middle of its passage to the district one passage nearer the city.
 * Landing tiles.
 */
export function plateLetters(landing: Landing): Letter[] {
  const letters: Letter[] = landing.dens.map((d) => ({
    x: d.x,
    y: d.y,
    text: `den ${d.letter} ${d.level}`,
  }));
  const { districts, passages } = landing;
  for (const d of districts) {
    if (d.id === 0) continue;
    let gate: Point | undefined;
    for (const p of d.passages) {
      const passage = passages[p];
      if (!passage) continue;
      const other = passage.a === d.id ? passage.b : passage.a;
      if ((districts[other] as { steps: number }).steps === d.steps - 1) {
        gate = passage;
        break;
      }
    }
    if (gate) letters.push({ x: gate.x, y: gate.y, text: `${d.level}` });
  }
  return letters;
}

/** The plate as numbers, for the world's hash. */
export const plateInts = (plate: Plate): number[] => [
  plate.nextPack,
  plate.packs.length,
  ...plate.packs.flatMap((p) => [
    p.id,
    p.kind,
    p.x,
    p.y,
    p.pocket,
    p.level,
    p.pay,
    p.per,
    p.owner,
    p.den,
    p.leader,
    p.target,
    p.struck.length,
    ...p.struck,
  ]),
  plate.dens.length,
  ...plate.dens.flatMap((d) => [
    d.x,
    d.y,
    d.pocket,
    d.level,
    d.every,
    ...halvesOf(d.next),
    ...halvesOf(d.last),
    d.queue.length,
    ...d.queue.flatMap((q) => [q.kind, q.level, q.pay, q.per, q.owner]),
  ]),
];

const halvesOf = (n: number): number[] => [
  n % 0x1_0000_0000,
  (n - (n % 0x1_0000_0000)) / 0x1_0000_0000,
];

const tickLike = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/** A pay a pack could have: positive, and no more than PAY_CAP times. */
const payFits = (pay: unknown, per: unknown): boolean =>
  isInt32(pay) && isInt32(per) && pay >= 1 && per >= 1 && pay <= PAY_CAP * per;

/**
 * A saved plate read back for a world on the landing `landing`, or null if it
 * is not one a world could hold. `nextActorId` bounds the ids it names.
 */
export function readPlate(raw: unknown, landing: Landing, nextActorId: number): Plate | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { packs, dens, nextPack } = raw as Record<string, unknown>;
  if (!isInt32(nextPack) || nextPack < 1) return null;
  if (!Array.isArray(packs) || !Array.isArray(dens) || dens.length !== landing.dens.length)
    return null;
  const ox = landing.city.x;
  const oy = landing.city.y;
  const level = (n: unknown): n is number => isInt32(n) && n >= 1 && n <= 99;
  const id = (n: unknown): n is number => isInt32(n) && n >= 0 && n < nextActorId;
  const plate: Plate = { packs: [], dens: [], nextPack };
  let lastId = 0;
  for (const item of packs as unknown[]) {
    if (typeof item !== "object" || item === null) return null;
    const p = item as Record<string, unknown>;
    if (!isInt32(p.id) || p.id <= lastId || p.id >= nextPack) return null;
    lastId = p.id;
    if (!isInt32(p.kind) || p.kind < 0 || p.kind >= PACK_KINDS.length) return null;
    if (!isInt32(p.x) || !isInt32(p.y) || !isInt32(p.pocket) || !level(p.level)) return null;
    const lx = p.x + ox;
    const ly = p.y + oy;
    if (lx < 0 || ly < 0 || lx >= landing.width || ly >= landing.height) return null;
    if (p.pocket < 1 || p.pocket >= landing.districts.length) return null;
    if (!payFits(p.pay, p.per) || !id(p.owner) || !id(p.leader) || !id(p.target)) return null;
    if (!isInt32(p.den) || p.den < -1 || p.den >= landing.dens.length) return null;
    if (!Array.isArray(p.struck) || p.struck.length > nextActorId) return null;
    const struck = p.struck as unknown[];
    if (!struck.every((s, i) => id(s) && (i === 0 || (struck[i - 1] as number) < s))) return null;
    plate.packs.push({
      id: p.id,
      kind: p.kind,
      x: p.x,
      y: p.y,
      pocket: p.pocket,
      level: p.level,
      pay: p.pay as number,
      per: p.per as number,
      owner: p.owner as number,
      den: p.den,
      leader: p.leader as number,
      target: p.target as number,
      struck: [...(struck as number[])],
    });
  }
  for (let n = 0; n < dens.length; n++) {
    const item: unknown = dens[n];
    const mouth = landing.dens[n];
    if (typeof item !== "object" || item === null || !mouth) return null;
    const d = item as Record<string, unknown>;
    if (d.x !== mouth.x - ox || d.y !== mouth.y - oy || d.pocket !== mouth.district) return null;
    if (d.level !== mouth.level) return null;
    if (!isInt32(d.every) || d.every < 0 || d.every > DEN_SPAN) return null;
    if (!tickLike(d.next) || !tickLike(d.last)) return null;
    if (!Array.isArray(d.queue) || d.queue.length > DEN_PACKS) return null;
    const queue: Queued[] = [];
    for (const q of d.queue as unknown[]) {
      if (typeof q !== "object" || q === null) return null;
      const { kind, level: l, pay, per, owner } = q as Record<string, unknown>;
      if (!isInt32(kind) || kind < 0 || kind > 2 || !level(l) || !payFits(pay, per) || !id(owner))
        return null;
      queue.push({
        kind,
        level: l,
        pay: pay as number,
        per: per as number,
        owner: owner as number,
      });
    }
    plate.dens.push({
      x: d.x as number,
      y: d.y as number,
      pocket: mouth.district,
      level: mouth.level,
      queue,
      every: d.every,
      next: d.next,
      last: d.last,
    });
  }
  return plate;
}
