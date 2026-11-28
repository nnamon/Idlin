// Carrying a world over to content that changed since it was saved: other
// programs, monster kinds or ground (a fixed map, or a landing the generator
// now makes differently). `restore` refuses such a snapshot.
// `adopt` checks it against the fingerprints it was saved with, fits its
// actors to the content passed in, and says what it changed. The world it
// returns is read by the same readState as `restore`'s, so it is one the new
// content could hold, and it runs on deterministically from there.
// docs/decisions/0021-keeping-the-world-through-content-changes.md has the reasons.

import { type Atlas, hashAtlas, pointOf, walkable } from "./atlas.ts";
import { fullNodes } from "./gather.ts";
import { isInt32 } from "./hash.ts";
import type { Point, TileMap } from "./map.ts";
import { fitOrders } from "./orders.ts";
import { cutStatus, type Status, slowed, statusTicksFor } from "./status.ts";
import { MEMORY_SLOTS, type Program } from "./vm.ts";
import { DIRECTIONS, FAMILIES, type Family, WEAPONS } from "./weapons.ts";
import {
  type Actor,
  ADVENTURER,
  blocks,
  blowTiles,
  canStep,
  checkKinds,
  checkPrograms,
  hashKinds,
  hashProgram,
  hashPrograms,
  hashStateAs,
  type Kinds,
  kindOf,
  mending,
  type Programs,
  parseSnapshot,
  plainList,
  readState,
  restore,
  SnapshotError,
  savedGround,
  stepTicks,
  type World,
  walkableFor,
} from "./world.ts";

export interface Adopted {
  readonly world: World;
  /** What differed and what was done about it, one line each, for the log. Empty if the content is the same. */
  readonly changes: readonly string[];
}

function damaged(): never {
  throw new SnapshotError("snapshot contents are damaged");
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Longer lists than this are not read; readState refuses far shorter ones anyway. */
const MOST = 1 << 20;

/** The fields of a saved actor that adoption reads or changes. The rest are passed on as they are. */
interface Fitting {
  readonly item: Record<string, unknown>;
  readonly id: number;
  readonly name: string;
  readonly kind: string;
  readonly program: string;
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  moveTicksLeft: number;
  path: Point[];
  wait: unknown;
  blocked: unknown;
  memory: unknown;
  rule: number;
  fault: unknown;
  hp: number;
  windup: number;
  recover: number;
  readonly weapon: string;
  readonly aim: number;
  /** Read for a chill, which makes steps and blows longer, and cut to a rank that now lasts less. */
  status: Status;
  /** Whether its program changed, so its params go back to the defaults. */
  programChanged: boolean;
}

function readActor(item: unknown): Fitting {
  if (!isRecord(item)) damaged();
  const { id, name, kind, program, x, y, fromX, fromY, moveTicksLeft, path, rule, hp } = item;
  const { windup, recover, weapon, aim } = item;
  if (typeof name !== "string" || typeof kind !== "string" || typeof program !== "string")
    damaged();
  if (typeof weapon !== "string" || !isInt32(aim) || aim < 0 || aim >= DIRECTIONS.length) damaged();
  const ints = [id, x, y, fromX, fromY, moveTicksLeft, rule, hp, windup, recover];
  if (!ints.every(isInt32)) damaged();
  const steps = plainList(path, MOST);
  if (!steps) damaged();
  // readState judges the rest of a status; a chill is read here and must be a count.
  const { status } = item;
  if (!isRecord(status) || !isInt32(status.chill)) damaged();
  return {
    item,
    id: id as number,
    name,
    kind,
    program,
    x: x as number,
    y: y as number,
    fromX: fromX as number,
    fromY: fromY as number,
    moveTicksLeft: moveTicksLeft as number,
    path: steps.map((p) => {
      if (!isRecord(p) || !isInt32(p.x) || !isInt32(p.y)) damaged();
      return { x: p.x, y: p.y };
    }),
    wait: item.wait,
    blocked: item.blocked,
    memory: item.memory,
    rule: rule as number,
    fault: item.fault,
    hp: hp as number,
    windup: windup as number,
    recover: recover as number,
    weapon,
    aim,
    status: status as unknown as Status,
    programChanged: false,
  };
}

/** The snapshot's fingerprint of each program, or null if it has none it can be read as. */
function readByProgram(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const prints: Record<string, string> = Object.create(null);
  for (const [name, print] of Object.entries(value)) {
    if (typeof print !== "string") return null;
    prints[name] = print;
  }
  return prints;
}

/**
 * The tile nearest `actor` by straight-line steps (ties going to the first in
 * row order) that it may stand on and nobody in `placed` would block it on,
 * or null if there is none.
 */
function nearestGround(world: World, actor: Fitting, placed: readonly Fitting[]): Point | null {
  const { atlas } = world;
  let best: Point | null = null;
  let bestSteps = Number.POSITIVE_INFINITY;
  for (let tile = 0; tile < atlas.width * atlas.height; tile++) {
    const p = pointOf(atlas, tile);
    const steps = Math.abs(p.x - actor.x) + Math.abs(p.y - actor.y);
    if (steps >= bestSteps || !walkableFor(world, actor as unknown as Actor, p.x, p.y)) continue;
    const taken = placed.some(
      (other) =>
        other.x === p.x &&
        other.y === p.y &&
        blocks(other as unknown as Actor, actor as unknown as Actor),
    );
    if (taken) continue;
    best = p;
    bestSteps = steps;
  }
  return best;
}

/**
 * The saved arrows still in flight in the adopted world: those whose shooter
 * is kept and whose tile can still be stood on. readState judges the rest.
 */
function arrowsFor(value: unknown, kept: readonly Fitting[], world: World): unknown {
  const list = plainList(value, MOST);
  if (!list) damaged();
  const shooters = new Set(kept.filter((a) => a.kind === ADVENTURER).map((a) => a.id));
  return list.filter(
    (arrow) =>
      !isRecord(arrow) ||
      !isInt32(arrow.x) ||
      !isInt32(arrow.y) ||
      (shooters.has(arrow.by as number) && walkable(world.atlas, arrow.x, arrow.y)),
  );
}

const sameTiles = (a: readonly Point[], b: readonly Point[]): boolean =>
  a.length === b.length && a.every((p, i) => p.x === b[i]?.x && p.y === b[i]?.y);

/**
 * Rebuilds a world from a snapshot taken with other content than is passed in,
 * and says what it changed to fit. With the same content it is `restore`.
 * Otherwise the snapshot is checked against the content fingerprints it
 * carries, so damage or a forged hash is still refused with a SnapshotError, as
 * is another version than SNAPSHOT_VERSION. A city's ground is worked out from
 * its saved cycle, as `restore` does, so it differs only when the deck or the
 * landing generator has changed. Then:
 *
 * - An actor whose program or monster kind is gone is removed.
 * - An actor whose program changed has its memory cleared, its rule reset and
 *   its params set to the new program's defaults, and decides again at once
 *   unless it is mending after a down.
 * - A flag comes down if the ground it stood on is gone or the citizen it
 *   followed was removed.
 *   A snapshot without `byProgram`, from before it was stored, cannot say which
 *   changed, so every program counts as changed.
 * - Hitpoints, wind-up, recovery, the ticks left in a step and the time left
 *   of a status over what the actor's kind now allows come down to it. An attack whose marks are no
 *   longer its line is called off.
 * - An actor on a tile it can no longer stand on moves to the nearest one it
 *   can, and stops what it was doing; one in the middle of a step or a walk
 *   over ground that changed stops where it stands.
 * - If the ground changed, every node stands full: the snapshot does not
 *   record where its nodes were.
 *
 * Everything else (places, levels, bags, banks, deaths, the cycle, the tick,
 * the seeded generator) is kept. `ground` is the map of a world of one map,
 * and null for a city. Throws a ProgramError, KindError or MapError if the
 * content passed in is itself invalid.
 */
export function adopt(
  text: string,
  ground: TileMap | Atlas | null,
  programs: Programs = {},
  kinds: Kinds = {},
): Adopted {
  const table = checkPrograms(programs);
  const kindTable = checkKinds(kinds);
  const saved = parseSnapshot(text);
  const { map, programs: programsPrint, kinds: kindsPrint } = saved;
  const atlas = savedGround(saved.state, ground);
  const sameMap = map === hashAtlas(atlas);
  const samePrograms = programsPrint === hashPrograms(table);
  const sameKinds = kindsPrint === hashKinds(kindTable);
  if (sameMap && samePrograms && sameKinds)
    return { world: restore(text, ground, table, kindTable), changes: [] };

  if (
    typeof map !== "string" ||
    typeof programsPrint !== "string" ||
    typeof kindsPrint !== "string"
  )
    damaged();
  const state = saved.state;
  let hash: string;
  try {
    const prints = { map, programs: programsPrint, kinds: kindsPrint };
    hash = hashStateAs(state as World, prints);
  } catch {
    damaged();
  }
  if (hash !== saved.hash || !isRecord(state)) damaged();
  const savedActors = plainList(state.actors, MOST);
  const savedMarks = plainList(state.marks, MOST);
  if (!savedActors || !savedMarks) damaged();

  const changes: string[] = [];
  if (!sameMap) changes.push("the map has changed");
  if (!samePrograms) changes.push("the programs have changed");
  if (!sameKinds) changes.push("the monster kinds have changed");
  const byProgram = samePrograms ? null : readByProgram(saved.byProgram);
  if (!samePrograms && !byProgram)
    changes.push(
      "the snapshot does not say which programs changed, so all of them count as changed",
    );

  // Enough of a world for the rules on where actors stand, step and strike.
  const rules = { atlas, programs: table, kinds: kindTable } as unknown as World;
  const who = (a: Fitting): string => `${a.name} (#${a.id})`;
  const cleared = new Map<string, number>();
  let stopped = 0;
  const placed: Fitting[] = [];
  const stranded: Fitting[] = [];
  // Who was in the middle of an attack when the snapshot was taken.
  const wasStriking = new Set<number>();
  for (const item of savedActors) {
    const a = readActor(item);
    if (a.windup > 0) wasStriking.add(a.id);
    if (a.kind !== ADVENTURER && !Object.hasOwn(kindTable, a.kind)) {
      changes.push(`removed ${who(a)}: there is no monster kind "${a.kind}" now`);
      continue;
    }
    if (!Object.hasOwn(table, a.program)) {
      changes.push(`removed ${who(a)}: there is no program "${a.program}" now`);
      continue;
    }
    const program = table[a.program] as Program;
    const changed =
      !samePrograms && (byProgram?.[a.program] ?? "") !== hashProgram(a.program, program);
    a.programChanged = changed || a.rule >= program.rules.length;
    if (a.programChanged) {
      // A wait from the old program ends, so that a reset rule reads as mending
      // only for one who was mending already.
      if (!mending(a as unknown as Actor)) a.wait = 0;
      a.memory = new Array<number>(MEMORY_SLOTS).fill(0);
      a.rule = -1;
      a.fault = 0;
      cleared.set(a.program, (cleared.get(a.program) ?? 0) + 1);
    }
    const numbers = kindOf(rules, a as unknown as Actor);
    if (a.hp > numbers.hp) {
      changes.push(`${who(a)}: hitpoints cut from ${a.hp} to ${numbers.hp}`);
      a.hp = numbers.hp;
    }
    const lasts = statusTicksFor(a.kind === ADVENTURER, numbers.rank);
    const status = cutStatus(a.status, lasts);
    if (status !== a.status) {
      changes.push(`${who(a)}: its statuses cut to the ${lasts} ticks they last now`);
      a.status = status;
    }
    // An adventurer's blow takes longest at Arms 1; readState refuses a weapon that is none of the families.
    const longest = FAMILIES.includes(a.weapon as Family) ? WEAPONS[a.weapon as Family] : numbers;
    // A chilled one's blow takes half as long again.
    const chilled = (n: number): number => (a.status.chill > 0 ? slowed(n) : n);
    a.windup = Math.min(a.windup, chilled(longest.windup));
    a.recover = Math.min(a.recover, chilled(longest.recovery));
    // A kind that walks faster now would have this actor further into its step than one takes.
    a.moveTicksLeft = Math.min(a.moveTicksLeft, stepTicks(rules, a as unknown as Actor));

    const actor = a as unknown as Actor;
    if (!walkableFor(rules, actor, a.x, a.y)) {
      stranded.push(a);
      continue;
    }
    const stands = (p: Point): boolean => walkableFor(rules, actor, p.x, p.y);
    const steps = (p: Point, q: Point): boolean =>
      stands(p) && canStep(rules, actor, p.x, p.y, q.x, q.y);
    let stop = false;
    if (a.moveTicksLeft > 0 && !steps({ x: a.fromX, y: a.fromY }, a)) {
      a.fromX = a.x;
      a.fromY = a.y;
      a.moveTicksLeft = 0;
      stop = true;
    }
    let at: Point = a;
    const walk =
      a.path.length <= atlas.open.length &&
      a.path.every((p) => {
        const ok = steps(at, p) && stands(p);
        at = p;
        return ok;
      });
    if (!walk) {
      a.path = [];
      a.blocked = 0;
      stop = true;
    }
    if (stop) stopped++;
    placed.push(a);
  }
  for (const a of stranded) {
    const to = nearestGround(rules, a, placed);
    if (!to) {
      changes.push(`removed ${who(a)}: there is no free ground it can stand on`);
      continue;
    }
    changes.push(
      `moved ${who(a)} from (${a.x}, ${a.y}) to (${to.x}, ${to.y}): it can no longer stand where it was`,
    );
    a.x = a.fromX = to.x;
    a.y = a.fromY = to.y;
    a.moveTicksLeft = 0;
    a.path = [];
    a.blocked = 0;
    a.windup = 0;
    placed.push(a);
  }
  placed.sort((p, q) => p.id - q.id);

  const kept = placed;

  const marks = savedMarks.map((m) => {
    if (!isRecord(m) || !isInt32(m.x) || !isInt32(m.y) || !isInt32(m.by)) damaged();
    // Marks are dropped only with an attack adoption called off or an actor it removed.
    if (!wasStriking.has(m.by)) damaged();
    return { x: m.x, y: m.y, by: m.by };
  });
  for (const a of kept) {
    if (a.windup === 0) continue;
    const line = marks.filter((m) => m.by === a.id);
    // Facing where it faced, from where it stands; readState refuses a weapon that is none of the families.
    const fits =
      (a.weapon === "" || FAMILIES.includes(a.weapon as Family)) &&
      sameTiles(line, blowTiles(rules, a as unknown as Actor, a.aim));
    if (!fits) {
      a.windup = 0;
      changes.push(`${who(a)}: its attack is called off, as it no longer reaches the tiles marked`);
    }
  }
  const striking = new Set(kept.filter((a) => a.windup > 0).map((a) => a.id));

  for (const [name, count] of [...cleared].sort(([p], [q]) => (p < q ? -1 : 1)))
    changes.push(`cleared the memory and rule of ${count} actor(s) running "${name}"`);
  if (stopped > 0)
    changes.push(`${stopped} actor(s) stopped walking: the ground on their way has changed`);
  if (!sameMap && atlas.nodes.length > 0)
    changes.push(`all ${atlas.nodes.length} nodes stand full again`);

  const citizens = new Set(kept.filter((a) => a.kind === ADVENTURER).map((a) => a.id));
  let flagsDown = 0;
  const orders = kept.map((a) => {
    const fit = fitOrders(a.item, table[a.program] as Program, a.programChanged, atlas, citizens);
    if (fit.flagDown) flagsDown++;
    return fit.fields;
  });
  if (flagsDown > 0)
    changes.push(`${flagsDown} flag(s) came down: the ground or the citizen they were on is gone`);

  const fitted = {
    ...state,
    actors: kept.map((a, i) => ({
      ...a.item,
      ...orders[i],
      x: a.x,
      y: a.y,
      fromX: a.fromX,
      fromY: a.fromY,
      moveTicksLeft: a.moveTicksLeft,
      path: a.path,
      wait: a.wait,
      blocked: a.blocked,
      memory: a.memory,
      rule: a.rule,
      fault: a.fault,
      hp: a.hp,
      windup: a.windup,
      recover: a.recover,
      status: a.status,
    })),
    marks: marks.filter((m) => striking.has(m.by)),
    nodes: sameMap ? state.nodes : fullNodes(atlas),
    arrows: arrowsFor(state.arrows, kept, rules),
  };
  const world = readState(fitted, atlas, table, kindTable);
  if (!world) throw new SnapshotError("snapshot could not be fitted to the new content");
  return { world, changes };
}
