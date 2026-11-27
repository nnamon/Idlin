// The world as the map shows it. The map is a window onto the world plane, as
// big as one region, and the actors and marks drawn are those in the window,
// in world coordinates. Where the window is comes from camera.ts.
import { type Actor, ADVENTURER, type Atlas, place, regionAt, type World } from "@idlin/sim";
import { TILE } from "./ground.ts";

/** Over how many pixels a figure walking off the map fades out (see `edgeFade`). */
export const EDGE_FADE = 32;

/** The index of the region the camp is in, where the view starts. */
export function campRegion(world: { readonly atlas: Atlas }): number {
  const camp = place(world.atlas, "camp");
  return regionAt(world.atlas, camp.x, camp.y);
}

/** The map's size in tiles: the camp region's. */
export function viewSize(atlas: Atlas, camp: number): { width: number; height: number } {
  const map = atlas.regions[camp]?.map ?? atlas.regions[0]?.map;
  return { width: map?.width ?? 0, height: map?.height ?? 0 };
}

/** A window onto the world: its top-left corner in world tiles (fractions allowed while it drifts) and its size in tiles. */
export interface Window {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Whether any part of tile (x, y) is in the window. */
export function inWindow(window: Window, x: number, y: number): boolean {
  return (
    x + 1 > window.x &&
    x < window.x + window.width &&
    y + 1 > window.y &&
    y < window.y + window.height
  );
}

/**
 * `world` with only the actors and marks in `window`, in world coordinates.
 * Someone stepping out of the window is kept until the step is done, so it is
 * seen walking off the edge.
 */
export function windowView(world: World, window: Window): World {
  const seen = (actor: Actor): boolean =>
    inWindow(window, actor.x, actor.y) ||
    (actor.moveTicksLeft > 0 && inWindow(window, actor.fromX, actor.fromY));
  return {
    ...world,
    actors: world.actors.filter(seen),
    marks: world.marks.filter((m) => inWindow(window, m.x, m.y)),
  };
}

/** Monsters this many steps apart or nearer, either way, in one region, count as one group. */
export const GROUP_REACH = 6;

/**
 * Where the monster groups are: monsters in one region within GROUP_REACH of
 * another of the group, each group at the middle of its monsters, in world
 * tiles. The world keeps no group for a monster, so the overview reckons it
 * from where they stand, as they spawn close together and keep near.
 */
export function monsterGroups(world: World): { x: number; y: number }[] {
  const groups: { region: number; members: Actor[] }[] = [];
  for (const actor of world.actors) {
    if (actor.kind === ADVENTURER) continue;
    const region = regionAt(world.atlas, actor.x, actor.y);
    const near = (other: Actor): boolean =>
      Math.max(Math.abs(other.x - actor.x), Math.abs(other.y - actor.y)) <= GROUP_REACH;
    const joined = groups.filter((g) => g.region === region && g.members.some(near));
    const into = joined[0] ?? { region, members: [] };
    if (!joined[0]) groups.push(into);
    // One that stands near two groups joins them.
    for (const other of joined.slice(1)) {
      into.members.push(...other.members);
      groups.splice(groups.indexOf(other), 1);
    }
    into.members.push(actor);
  }
  return groups.map(({ members }) => ({
    x: members.reduce((sum, a) => sum + a.x, 0) / members.length,
    y: members.reduce((sum, a) => sum + a.y, 0) / members.length,
  }));
}

/**
 * Who the page lists: every resident in the world, wherever they are, so a
 * resident's row stays put while they are away. Monsters are not listed.
 */
export function rosterOf(world: World): readonly Actor[] {
  return world.actors.filter((actor) => actor.kind === ADVENTURER);
}

/**
 * What the page calls each region, in the atlas's order: the `title` its map
 * file gives, or else the map's name. `maps` are the map files, parsed, by
 * file name.
 */
export function regionNames(atlas: Atlas, maps: Readonly<Record<string, unknown>>): string[] {
  return atlas.regions.map(({ map }) => {
    const title = (maps[map.name] as { title?: unknown } | undefined)?.title;
    return typeof title === "string" && title !== "" ? title : map.name;
  });
}

/**
 * For each resident of `whole` that is not on `view` (its cut to the window,
 * see `windowView`), the name of the region it is in, by id. The page writes
 * that in place of what it is doing.
 */
export function awayFrom(
  whole: World,
  view: World,
  names: readonly string[],
): ReadonlyMap<number, string> {
  const here = new Set(view.actors.map((actor) => actor.id));
  const away = new Map<number, string>();
  for (const actor of rosterOf(whole)) {
    if (here.has(actor.id)) continue;
    const region = regionAt(whole.atlas, actor.x, actor.y);
    away.set(actor.id, names[region] ?? "");
  }
  return away;
}

/**
 * How strongly a figure whose feet are at (x, y), in map pixels from the
 * window's top-left, is drawn on a map `width` by `height` pixels: 1 while it
 * stands anywhere on the map, up to the middle of an edge tile, falling to 0
 * as it walks on off that edge, or as the view drifts away from it. Its feet
 * are at the middle of a tile across and near its foot down.
 */
export function edgeFade(x: number, y: number, width: number, height: number): number {
  const across = Math.min(x, width - x) - TILE / 2;
  const down = Math.min(y - (TILE - 4), height - 4 - y);
  const share = (EDGE_FADE + Math.min(across, down)) / EDGE_FADE;
  return Math.max(0, Math.min(1, share));
}
