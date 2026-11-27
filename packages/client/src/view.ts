// The world as the map shows it. The viewer draws one region at a time: the
// actors and marks in it, moved from world coordinates into the region's own.
import { type Actor, ADVENTURER, type Atlas, place, regionAt, type World } from "@idlin/sim";
import { type Fight, nextFight } from "./fight.ts";
import { TILE } from "./ground.ts";

/** Over how many pixels a figure walking off the map fades out (see `edgeFade`). */
export const EDGE_FADE = 32;

/** The index of the region the camp is in, which the viewer shows. */
export function campRegion(world: World): number {
  const camp = place(world.atlas, "camp");
  return regionAt(world.atlas, camp.x, camp.y);
}

/** Whether `actor` is drawn on region `index`'s map. */
function onMap(world: World, index: number, actor: Actor): boolean {
  if (regionAt(world.atlas, actor.x, actor.y) === index) return true;
  // Someone stepping out stays until the step is done, so it is seen walking off the edge.
  return actor.moveTicksLeft > 0 && regionAt(world.atlas, actor.fromX, actor.fromY) === index;
}

/**
 * `world` with only what is in region `index`, in that region's tile
 * coordinates. Someone who has just stepped in from another region keeps the
 * tile it stepped from, just off the map's edge, so it is seen walking in, and
 * someone stepping out is kept until the step is done. A path is cut where it
 * leaves the region, so a route drawn along it ends at the exit.
 */
export function regionView(world: World, index: number): World {
  const region = world.atlas.regions[index];
  if (!region) return { ...world, actors: [], marks: [] };
  const { x: dx, y: dy } = region;
  const inside = (p: { x: number; y: number }): boolean =>
    regionAt(world.atlas, p.x, p.y) === index;
  return {
    ...world,
    actors: world.actors
      .filter((actor) => onMap(world, index, actor))
      .map((actor) => {
        const out = actor.path.findIndex((p) => !inside(p));
        const path = out < 0 ? actor.path : actor.path.slice(0, out);
        return {
          ...actor,
          x: actor.x - dx,
          y: actor.y - dy,
          fromX: actor.fromX - dx,
          fromY: actor.fromY - dy,
          path: path.map((p) => ({ x: p.x - dx, y: p.y - dy })),
        };
      }),
    marks: world.marks.filter(inside).map((m) => ({ ...m, x: m.x - dx, y: m.y - dy })),
  };
}

/**
 * The fight after a tick, as region `index`'s map shows it. `all` is read off
 * the whole world, where stepping through an exit is a step like any other,
 * so someone who walks off the map is not taken for killed or downed, and a
 * resident downed in another region still counts as downed on the page.
 * `shown` is `all` with the numbers, blots, scratches and struck tiles kept to
 * the region, in its tile coordinates. What is kept by actor (rings, lunges,
 * downs) and the lines of news are left whole: only actors on the map are
 * drawn, and the page lists every resident.
 */
export function fightOn(
  previous: Fight,
  world: World,
  index: number,
): { all: Fight; shown: Fight } {
  const all = nextFight(previous, world);
  const region = world.atlas.regions[index];
  const dx = region?.x ?? 0;
  const dy = region?.y ?? 0;
  const here = <T extends { x: number; y: number }>(list: readonly T[]): T[] =>
    list
      .filter((p) => regionAt(world.atlas, p.x, p.y) === index)
      .map((p) => ({ ...p, x: p.x - dx, y: p.y - dy }));
  const shown: Fight = {
    ...all,
    floaters: here(all.floaters),
    fallen: here(all.fallen),
    gone: here(all.gone),
    scratches: here(all.scratches),
    landed: here(all.landed),
  };
  return { all, shown };
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
 * For each resident of `whole` that is not on `view` (its cut to one region,
 * see `regionView`), the name of the region it is in, by id. The page writes
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
 * How strongly a figure whose feet are at (x, y), in map pixels, is drawn on
 * a map `width` by `height` pixels: 1 while it stands anywhere on the map, up
 * to the middle of an edge tile, falling to 0 as it walks on off that edge.
 * Its feet are at the middle of a tile across and near its foot down.
 */
export function edgeFade(x: number, y: number, width: number, height: number): number {
  const across = Math.min(x, width - x) - TILE / 2;
  const down = Math.min(y - (TILE - 4), height - 4 - y);
  const share = (EDGE_FADE + Math.min(across, down)) / EDGE_FADE;
  return Math.max(0, Math.min(1, share));
}
