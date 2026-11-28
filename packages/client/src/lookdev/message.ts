// A live landing's feed: the world server's viewer messages (readMessage's
// Message, one each tick) turned into what landing.ts draws from. Citizens and
// monsters are keyed by their actor id. Between two messages an actor walking
// from one tile to the next is placed along the step, as plain.ts places it.
// What has happened (hits, blows, shots, kills) is kept for as long as any of
// it can still be seen, and then forgotten, so a stream that runs for days
// keeps no more than a few seconds of it.
//
// Not here yet: markers, burns, slams, thrusts and telegraphs, which the
// simulation does not have; the landing's map as a lookdev Landing (slice
// piece 2b); and the deck's crew, which the city drawing places.

import {
  type Actor,
  ADVENTURER,
  beat,
  DIRECTIONS,
  kindOf,
  type Message,
  stepTicks,
  TICKS_PER_SECOND,
  terrainOf,
  type World,
} from "@idlin/sim";
import type { CitizenNow, Feed, MonsterNow } from "./feed.ts";
import { firstFrom } from "./feed.ts";
import { type Look, lookOf } from "./figure.ts";
import {
  ACT,
  type Blow,
  type BodyAt,
  BRUTE,
  ELITE,
  type Fray,
  type Hit,
  HOUND,
  type Kill,
  MITE,
  type Shot,
  type Weapon,
} from "./fray.ts";
import { SPILL_GONE } from "./fx.ts";

/** A tick, in seconds. */
const TICK = 1 / TICKS_PER_SECOND;
/** How long what has happened is kept: past the life of a kill's stain. */
const KEEP = SPILL_GONE + 2;
/** How a monster's rank is drawn. */
const DRAWN_AS = { fodder: MITE, pack: HOUND, brute: BRUTE, elite: ELITE } as const;
/** The deck's ground: a citizen standing on it is aboard, not out on the landing. */
const ABOARD = new Set(["deck", "hatch", "hull"]);
/** How long a body knocked back is drawn thrown, in seconds. */
const THROWN = 0.7;

/** A citizen's look: the colours the game gives its id, and its chat username. */
export const lookFor = (actor: Actor): Look => ({ ...lookOf(actor.id), name: actor.name });

export class MessageFeed implements Feed {
  readonly scripted = false;
  readonly hits: Hit[] = [];
  readonly blows: Blow[] = [];
  readonly shots: Shot[] = [];
  readonly kills: Kill[] = [];
  readonly markers: Fray["markers"] = [];
  readonly burns: Fray["burns"] = [];
  readonly slams: Fray["slams"] = [];
  readonly thrusts: Fray["thrusts"] = [];
  readonly telegraphs: Fray["telegraphs"] = [];
  readonly chests: Feed["chests"] = [];
  private world: World | null = null;
  /** When the last message came, on the viewer's clock in seconds. */
  private arrived = 0;
  /** Each actor's act as of the last message, and since when. */
  private readonly acts = new Map<number, { act: number; since: number }>();
  private readonly thrown = new Map<number, number>();
  private readonly looks = new Map<number, Look>();
  private readonly look: (actor: Actor) => Look;
  private citizensAt = Number.NaN;
  private citizensNow: CitizenNow[] = [];
  private monstersAt = Number.NaN;
  private monstersNow: MonsterNow[] = [];

  constructor(look: (actor: Actor) => Look = lookFor) {
    this.look = look;
  }

  /** The world as the last message had it, or null before the first. */
  get latest(): World | null {
    return this.world;
  }

  /** Takes a message that came `at` seconds into the viewer's clock, which never runs backwards. */
  take(message: Message, at: number): void {
    const before = this.world;
    const world = message.world;
    const byId = new Map(world.actors.map((a) => [a.id, a]));
    const was = new Map((before?.actors ?? []).map((a) => [a.id, a]));
    const find = (id: number): Actor | undefined => byId.get(id) ?? was.get(id);
    for (const b of message.blows) {
      const target = find(b.target);
      if (!target) continue;
      const striker = find(b.by);
      const tx = target.x + 0.5;
      const ty = target.y + 0.5;
      const sx = striker ? striker.x + 0.5 : tx;
      const sy = striker ? striker.y + 0.5 : ty;
      const far = Math.hypot(tx - sx, ty - sy);
      const [dx, dy] = far > 0 ? [(tx - sx) / far, (ty - sy) / far] : [1, 0];
      const citizen = striker?.kind === ADVENTURER;
      this.hits.push({
        t: at,
        x: tx,
        y: ty,
        dx,
        dy,
        value: b.amount,
        crit: b.crit,
        big: false,
        who: citizen && striker ? striker.id : -1,
        ax: tx,
        ay: ty,
        lift: target.kind === ADVENTURER ? 0.45 : 0.2,
      });
      if (citizen && striker)
        this.blows.push({
          who: striker.id,
          weapon: weaponOf(striker),
          start: at - TICK,
          contact: at,
          x: sx,
          y: sy,
          dx,
          dy,
          hits: 1,
          value: b.amount,
          crit: b.crit,
          big: false,
        });
    }
    for (const k of message.knocks) this.thrown.set(k.target, at + THROWN);
    // A monster there one tick and gone the next was killed: its ink spills where it stood. Lift-off
    // leaves every monster behind, and across a gap in the messages (a reconnect) there is no
    // telling who was killed, so neither spills anything.
    const lifted =
      before !== null && beat(before)?.beat === "break" && beat(world)?.beat === "transit";
    if (before && world.tick === before.tick + 1 && !lifted)
      for (const a of before.actors) {
        if (a.kind === ADVENTURER || byId.has(a.id)) continue;
        const hit = this.hits.findLast((h) => h.x === a.x + 0.5 && h.y === a.y + 0.5);
        this.kills.push({
          t: at,
          x: a.x + 0.5,
          y: a.y + 0.5,
          dx: hit?.dx ?? 1,
          dy: hit?.dy ?? 0,
          kind: drawnAs(before, a),
          seed: a.id,
        });
      }
    // Arrows in flight, each across the tile it is over toward the next, over the tick.
    for (const arrow of world.arrows) {
      const [ax, ay] = DIRECTIONS[arrow.aim] ?? [1, 0];
      const by = find(arrow.by);
      this.shots.push({
        who: arrow.by,
        rgb: by ? this.lookOf(by).cloak : 0x2f2621,
        weapon: "bow",
        t0: at,
        t1: at + TICK,
        x0: arrow.x + 0.5,
        y0: arrow.y + 0.5,
        z0: 0.6,
        x1: arrow.x + 0.5 + ax,
        y1: arrow.y + 0.5 + ay,
      });
    }
    // What each is doing, and since when, so a swing or a step starts where it should.
    for (const a of world.actors) {
      const act = actOf(a, world);
      const held = this.acts.get(a.id);
      if (!held || held.act !== act) this.acts.set(a.id, { act, since: at });
    }
    for (const id of [...this.acts.keys()]) if (!byId.has(id)) this.acts.delete(id);
    for (const [id, until] of this.thrown) if (until < at) this.thrown.delete(id);
    for (const id of [...this.looks.keys()]) if (!byId.has(id)) this.looks.delete(id);
    this.world = world;
    this.arrived = at;
    this.citizensAt = Number.NaN;
    this.monstersAt = Number.NaN;
    this.forget(at - KEEP);
  }

  private forget(before: number): void {
    const drop = <T>(list: T[], at: (e: T) => number): void => {
      const n = firstFrom(list, before, at);
      if (n > 0) list.splice(0, n);
    };
    drop(this.hits, (h) => h.t);
    drop(this.blows, (b) => b.contact);
    drop(this.shots, (s) => s.t1);
    drop(this.kills, (k) => k.t);
  }

  private lookOf(actor: Actor): Look {
    let look = this.looks.get(actor.id);
    if (!look) {
      look = this.look(actor);
      this.looks.set(actor.id, look);
    }
    return look;
  }

  /** Where an actor is at `t`, in tiles, and the body drawn there. */
  private bodyOf(world: World, a: Actor, t: number): BodyAt {
    let x = a.x;
    let y = a.y;
    if (a.moveTicksLeft > 0) {
      const length = stepTicks(world, a);
      const into = Math.min(0.99, Math.max(0, (t - this.arrived) / TICK));
      const done = Math.min(1, (length - a.moveTicksLeft + into) / length);
      x = a.fromX + (a.x - a.fromX) * done;
      y = a.fromY + (a.y - a.fromY) * done;
    }
    const thrown = this.thrown.get(a.id);
    const held = this.acts.get(a.id);
    let act = held?.act ?? actOf(a, world);
    let since = t - (held?.since ?? this.arrived);
    if (thrown !== undefined && t < thrown) {
      act = ACT.thrown;
      since = t - (thrown - THROWN);
    }
    const [fx] = DIRECTIONS[a.aim] ?? [1, 0];
    const kind = a.kind === ADVENTURER ? null : kindOf(world, a);
    return {
      x: x + 0.5,
      y: y + 0.5,
      z: 0,
      face: Math.sign(a.x - a.fromX) || Math.sign(fx) || 1,
      act,
      since: Math.max(0, since),
      ink: kind ? Math.max(0, Math.min(1, a.hp / kind.hp)) : 1,
      wake: 2,
    };
  }

  citizens(t: number): readonly CitizenNow[] {
    const world = this.world;
    if (!world) return [];
    if (t !== this.citizensAt) {
      this.citizensNow = world.actors
        .filter((a) => a.kind === ADVENTURER)
        .map((a) => ({
          id: a.id,
          look: this.lookOf(a),
          weapon: weaponOf(a),
          body: this.bodyOf(world, a, t),
          chest: false,
        }));
      this.citizensAt = t;
    }
    return this.citizensNow;
  }

  citizen(id: number, t: number): CitizenNow | undefined {
    return this.citizens(t).find((c) => c.id === id);
  }

  monsters(t: number): readonly MonsterNow[] {
    const world = this.world;
    if (!world) return [];
    if (t !== this.monstersAt) {
      this.monstersNow = world.actors
        .filter((a) => a.kind !== ADVENTURER)
        .map((a) => ({
          id: a.id,
          kind: drawnAs(world, a),
          build: a.id % 3,
          leader: false,
          // Until the simulation has packs, each monster is drawn on its own.
          group: a.id,
          body: this.bodyOf(world, a, t),
        }));
      this.monstersAt = t;
    }
    return this.monstersNow;
  }

  home(): undefined {
    return undefined;
  }
}

const weaponOf = (a: Actor): Weapon => (a.weapon === "" ? "none" : a.weapon);

const drawnAs = (world: World, a: Actor): number => DRAWN_AS[kindOf(world, a).rank ?? "fodder"];

/** What an actor is doing as of its world's tick. */
function actOf(a: Actor, world: World): number {
  const citizen = a.kind === ADVENTURER;
  if (citizen && ABOARD.has(terrainOf(world.atlas, a.x, a.y) ?? "")) return ACT.aboard;
  if (a.hp <= 0) return citizen ? ACT.down : ACT.dead;
  // A citizen's swing runs on through its recovery, so the stroke follows through; a monster
  // coils while it winds up and lunges as its blow lands.
  if (a.windup > 0) return citizen ? ACT.swing : ACT.coil;
  if (a.recover > 0) return citizen ? ACT.swing : ACT.lunge;
  if (a.moveTicksLeft > 0) return citizen ? ACT.walk : ACT.chase;
  return ACT.idle;
}
