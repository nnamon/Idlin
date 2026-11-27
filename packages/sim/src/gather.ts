// Gathering, cooking and eating. Trees and fishing spots are the map's nodes
// (see nodes.ts): each gives a fixed number of goods, one at a time to whoever
// works it from beside it, then stands empty until it regrows. Cooking turns a
// raw fish and a log into a cooked fish, or a burnt one, at the camp fire.
// Eating a cooked fish heals.

import { type Atlas, regionAt, terrainOf, tileAt, walkable } from "./atlas.ts";
import { goodId } from "./bag.ts";
import { gridOf, tallyOf, tileOf } from "./grid.ts";
import { NEIGHBOURS, type Point } from "./map.ts";
import { NODE_KINDS, type NodeKind, nodeKind } from "./nodes.ts";
import { chance } from "./rng.ts";
import { gainXp, levelFor, SKILLS, type Skill } from "./skills.ts";
import { type Actor, ADVENTURER, kindOf, type World, type WorldEvent } from "./world.ts";

/** What a node has left: goods to give, and when one that has run out stands again. */
export interface NodeState {
  /** Goods it will still give, from its kind's yield down to 0. */
  left: number;
  /** While `left` is 0, the tick it stands again on; 0 while it stands. */
  back: number;
}

/** Ticks an actor stands after a `chop` or `fish`, whether or not it got anything. */
export const GATHER_TICKS = 12;
/** Ticks an actor stands after cooking one fish. */
export const COOK_TICKS = 18;
/** Hitpoints one cooked fish gives back. */
export const EAT_HEAL = 6;
/** Cooking experience for a fish that did not burn. A burnt one gives none. */
export const COOK_XP = 30;
/** What the node sensors answer when there is no node to go to. */
export const NO_NODE = 9999;

const LOGS = goodId("logs");
const RAW = goodId("raw_fish");
const COOKED = goodId("cooked_fish");
const BURNT = goodId("burnt_fish");

/**
 * The chance in 100 that one try at a node gives a good: 25 at the level the
 * node needs, 3 more for each level above it, up to 90.
 */
export const gatherOdds = (level: number, needs: number): number =>
  Math.min(90, 25 + 3 * (level - needs));

/** The chance in 100 that a fish burns: 30 at Cooking level 1, 2 fewer each level, none from 16. */
export const burnOdds = (level: number): number => Math.max(0, 32 - 2 * level);

/** Every node of the atlas standing with its full yield, as a new world has them. */
export const fullNodes = (atlas: Atlas): NodeState[] =>
  atlas.nodes.map((node) => ({ left: (NODE_KINDS[node.kind - 1] as NodeKind).yield, back: 0 }));

const levelIn = (actor: Actor, skill: Skill): number =>
  levelFor(actor.xp[SKILLS.indexOf(skill)] as number);

/** Brings back, with their full yield, the nodes whose time to stand again has come. */
export function regrowNodes(world: World, events: WorldEvent[]): void {
  world.nodes.forEach((state, index) => {
    if (state.left > 0 || world.tick < state.back) return;
    const node = world.atlas.nodes[index] as (typeof world.atlas.nodes)[number];
    state.left = (NODE_KINDS[node.kind - 1] as NodeKind).yield;
    state.back = 0;
    events.push({ type: "regrow", tick: world.tick, node: index, x: node.x, y: node.y });
  });
}

/** Whether node `index` stands and `actor` may work it: an adventurer in its region with the level for it. */
function workable(world: World, actor: Actor, index: number): boolean {
  const node = world.atlas.nodes[index];
  const kind = node && nodeKind(node.kind);
  if (!node || !kind || actor.kind !== ADVENTURER) return false;
  if ((world.nodes[index] as NodeState).left === 0) return false;
  if (regionAt(world.atlas, node.x, node.y) !== regionAt(world.atlas, actor.x, actor.y))
    return false;
  return levelIn(actor, kind.skill) >= kind.level;
}

const steps = (a: Point, b: Point): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * The tile to work a node of kind `kindId` from that is nearest `actor` in a
 * straight grid line: beside a node of that kind that stands, in the actor's
 * region and that its level allows, on walkable ground in the node's region
 * that nobody else stands on or is walking to. Ties go to the node listed
 * first, then to the side in NEIGHBOURS order. Null if there is none.
 */
export function nearestNode(world: World, actor: Actor, kindId: number): Point | null {
  const { atlas } = world;
  // Someone else stands on the tile or is walking to it: the grid's tally less this actor's share.
  const grid = gridOf(world);
  const { standing, ending } = tallyOf(grid);
  const here = tileOf(grid, actor.x, actor.y);
  const own = actor.path[actor.path.length - 1];
  const ownEnd = own ? tileOf(grid, own.x, own.y) : -1;
  const taken = (tile: number): boolean =>
    (standing[tile] as number) - (tile === here ? 1 : 0) > 0 ||
    (ending[tile] as number) - (tile === ownEnd ? 1 : 0) > 0;
  let best: Point | null = null;
  for (let index = 0; index < atlas.nodes.length; index++) {
    const node = atlas.nodes[index] as (typeof atlas.nodes)[number];
    if (node.kind !== kindId || !workable(world, actor, index)) continue;
    const region = regionAt(atlas, node.x, node.y);
    for (const [dx, dy] of NEIGHBOURS) {
      const side = { x: node.x + dx, y: node.y + dy };
      if (!walkable(atlas, side.x, side.y) || regionAt(atlas, side.x, side.y) !== region) continue;
      if (taken(tileAt(atlas, side.x, side.y))) continue;
      if (!best || steps(actor, side) < steps(actor, best)) best = side;
    }
  }
  return best;
}

/** The first node, in the atlas's order, beside `actor` that it may work with `skill`; -1 if none. */
function nodeBeside(world: World, actor: Actor, skill: Skill): number {
  return world.atlas.nodes.findIndex(
    (node, index) =>
      steps(node, actor) === 1 &&
      nodeKind(node.kind)?.skill === skill &&
      workable(world, actor, index),
  );
}

/**
 * One try at the node beside `actor` that `skill` works (`chop` or `fish`).
 * With odds from `gatherOdds`, a good goes into the bag's first empty slot and
 * the experience is gained, and the node has one fewer; at none left, it runs
 * out. Returns whether there was a try: false with no such node beside it or a
 * full bag, and then nothing changes and nothing is rolled.
 */
export function work(world: World, actor: Actor, skill: Skill, events: WorldEvent[]): boolean {
  const index = nodeBeside(world, actor, skill);
  const slot = actor.bag.indexOf(0);
  if (index < 0 || slot < 0) return false;
  const node = world.atlas.nodes[index] as (typeof world.atlas.nodes)[number];
  const kind = nodeKind(node.kind) as NodeKind;
  if (!chance(world.rng, gatherOdds(levelIn(actor, skill), kind.level), 100)) return true;
  const state = world.nodes[index] as NodeState;
  actor.bag[slot] = goodId(kind.good);
  state.left--;
  events.push({ type: "gather", tick: world.tick, actor: actor.id, node: index, good: kind.good });
  const level = gainXp(actor.xp, skill, kind.xp);
  if (level > 0) events.push({ type: "level", tick: world.tick, actor: actor.id, skill, level });
  if (state.left === 0) {
    state.back = world.tick + kind.regrow;
    events.push({ type: "deplete", tick: world.tick, node: index, x: node.x, y: node.y });
  }
  return true;
}

/** How far from a campfire tile, in steps, an actor can cook at it. */
export const FIRE_REACH = 2;

/**
 * Whether `actor` stands within FIRE_REACH steps of a campfire tile in its own
 * region. Two steps, not one, so that a cook sent to a fire whose tiles beside
 * it are taken still ends up where it can cook.
 */
export function atFire(world: World, actor: Actor): boolean {
  const region = regionAt(world.atlas, actor.x, actor.y);
  for (let dy = -FIRE_REACH; dy <= FIRE_REACH; dy++) {
    for (let dx = -FIRE_REACH; dx <= FIRE_REACH; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > FIRE_REACH) continue;
      const x = actor.x + dx;
      const y = actor.y + dy;
      if (terrainOf(world.atlas, x, y) === "campfire" && regionAt(world.atlas, x, y) === region)
        return true;
    }
  }
  return false;
}

/**
 * At the fire, cooks the bag's first raw fish with its first log: the log is
 * burnt up and the fish's slot holds a cooked fish, or a burnt one with odds
 * from `burnOdds`. Only a fish that did not burn gives experience. Returns
 * whether anything was cooked: false away from the fire or without both.
 */
export function cook(world: World, actor: Actor, events: WorldEvent[]): boolean {
  const fish = actor.bag.indexOf(RAW);
  const log = actor.bag.indexOf(LOGS);
  if (fish < 0 || log < 0 || !atFire(world, actor)) return false;
  const burnt = chance(world.rng, burnOdds(levelIn(actor, "cooking")), 100);
  actor.bag[log] = 0;
  actor.bag[fish] = burnt ? BURNT : COOKED;
  const good = burnt ? "burnt_fish" : "cooked_fish";
  events.push({ type: "cook", tick: world.tick, actor: actor.id, good });
  const level = burnt ? 0 : gainXp(actor.xp, "cooking", COOK_XP);
  if (level > 0)
    events.push({ type: "level", tick: world.tick, actor: actor.id, skill: "cooking", level });
  return true;
}

/**
 * Eats the bag's first cooked fish, giving back up to EAT_HEAL hitpoints.
 * Returns whether it did: false with none in the bag, or at full hitpoints,
 * when the fish is kept.
 */
export function eat(world: World, actor: Actor, events: WorldEvent[]): boolean {
  const slot = actor.bag.indexOf(COOKED);
  const most = kindOf(world, actor).hp;
  if (slot < 0 || actor.hp >= most) return false;
  actor.bag[slot] = 0;
  actor.hp = Math.min(most, actor.hp + EAT_HEAL);
  events.push({ type: "eat", tick: world.tick, actor: actor.id, hp: actor.hp });
  return true;
}
