// The city in transit (docs/art.md, sections 7 and 12): the city from above
// at 66 px a tile, walking prow first to the right, with the land drawn in
// plan under it at 40% ink and one cool wash, sliding left.

import { GAIT_SECONDS } from "./city.ts";
import { type Draw, FORM, HAIR, INK, PAPER } from "./draw.ts";
import { HAT_TOP, type Look, lookOf } from "./figure.ts";
import { RARITY } from "./fx.ts";
import { hash, lerp, mix, noise1 } from "./geom.ts";
import { itemName } from "./names.ts";
import type { Scene } from "./scenes.ts";
import {
  type Corners,
  cornerBoxes,
  drawCorners,
  drawFrameRule,
  drawPlacedTags,
  FRAME,
  headBox,
  TAG_SIZE,
  TagTimeline,
  type TagWant,
  UP,
} from "./stage.ts";
import {
  BELLY_WALK,
  type Crew,
  crowdStations,
  drawTopCity,
  HULL_DEEP,
  hullRide,
  lanternAt,
  type Station,
  stayLines,
  type TopCity,
  WALK_SPEED,
} from "./topcity.ts";

const LAND = 0xa9b4b0;
/** Pixels a tile in transit, and where the ground under the hull's middle is on screen. */
export const TRANSIT_TILE = 66;
export const TRANSIT_X = 960;
/**
 * The deck's middle sits at y 385 while walking; the ground under it is below
 * by the hull's height. That puts the lantern at about y 60 and the near feet
 * at about y 955, above the log and the counts, so all eight feet and the
 * lantern are inside the rule and clear of the slips.
 */
export const TRANSIT_DECK_Y = 385;
export const TRANSIT_Y = TRANSIT_DECK_Y + (BELLY_WALK + HULL_DEEP) * UP * TRANSIT_TILE;

/** The bench result the log shows in transit. */
export const BENCH_ITEM = itemName(18, 2, 0);
/** An item's colour in lettering: its rarity's, darkened until it holds against the paper. */
export const itemInk = (rarity: number): number => mix(RARITY[rarity] as number, INK, 0.38);

/**
 * The land going by under the city, in plan: washes, a stream, a track,
 * field lines and ground marks, nothing at contour weight and nothing over
 * half a tile tall. `travel` is how far the city has walked, in tiles.
 */
export function drawTransitPlan(
  d: Draw,
  ox: number,
  oy: number,
  T: number,
  travel: number,
  strength: number,
): void {
  if (strength <= 0.01) return;
  const base = d.strength;
  const x0 = Math.floor(travel + (FRAME.x0 - ox) / T) - 2;
  const x1 = Math.ceil(travel + (FRAME.x1 - ox) / T) + 2;
  const y0 = Math.floor((FRAME.y0 - oy) / T) - 1;
  const y1 = Math.ceil((FRAME.y1 - oy) / T) + 1;
  const sx = (wx: number): number => ox + (wx - travel) * T;
  const sy = (wy: number): number => oy + wy * T;
  // A stream and a track across the land.
  const streamY = (wx: number): number => 3.2 + 2.2 * noise1(wx / 11, 405);
  const trackY = (wx: number): number => -5.2 + 1.6 * noise1(wx / 9, 406);
  const clear = (wx: number, wy: number, r: number): boolean =>
    Math.abs(wy - streamY(wx)) > r + 0.8 && Math.abs(wy - trackY(wx)) > r + 0.6;
  // Fields and woods, one to a cell of six tiles by five: a field is a skewed plot with a hedge
  // round it and furrows across it; a wood is a scalloped edge with crowns inside, in the cool wash.
  for (let cx = Math.floor(x0 / 6) * 6; cx <= x1; cx += 6)
    for (let cy = Math.floor(y0 / 5) * 5; cy <= y1; cy += 5) {
      const k = hash(cx, cy, 401);
      const px = cx + 3 + (hash(cx, cy, 402) - 0.5) * 1.6;
      const py = cy + 2.5 + (hash(cx, cy, 403) - 0.5) * 1.2;
      const wide = 2.0 + hash(cx, cy, 404) * 0.8;
      const deep = 1.5 + hash(cx, cy, 418) * 0.6;
      if (!clear(px, py, deep)) continue;
      if (k < 0.3) continue;
      const seed = cx * 31 + cy * 7;
      if (k < 0.72) {
        // A field.
        const skew = (hash(cx, cy, 419) - 0.5) * 0.9;
        const plot = [
          px - wide + skew,
          py - deep,
          px + wide + skew,
          py - deep + 0.2,
          px + wide - skew,
          py + deep,
          px - wide - skew,
          py + deep - 0.15,
        ];
        const scr: number[] = [];
        for (let i = 0; i < plot.length; i += 2)
          scr.push(sx(plot[i] as number), sy(plot[i + 1] as number));
        d.strength = base * strength;
        d.wash(scr, k < 0.5 ? LAND : 0xc9c39f, 0.2 + k * 0.12);
        d.strength = base * strength * 0.4;
        d.path(scr, FORM, seed, true);
        // Furrows, one way or the other.
        const across = hash(cx, cy, 420) < 0.5;
        for (let u = 0.15; u < 0.9; u += 0.14) {
          if (across) {
            const ax = lerp(plot[0] as number, plot[6] as number, u);
            const ay = lerp(plot[1] as number, plot[7] as number, u);
            const bx = lerp(plot[2] as number, plot[4] as number, u);
            const by = lerp(plot[3] as number, plot[5] as number, u);
            d.line(
              sx(lerp(ax, bx, 0.06)),
              sy(lerp(ay, by, 0.06)),
              sx(lerp(ax, bx, 0.94)),
              sy(lerp(ay, by, 0.94)),
              HAIR,
              seed + Math.round(u * 40),
            );
          } else {
            const ax = lerp(plot[0] as number, plot[2] as number, u);
            const ay = lerp(plot[1] as number, plot[3] as number, u);
            const bx = lerp(plot[6] as number, plot[4] as number, u);
            const by = lerp(plot[7] as number, plot[5] as number, u);
            d.line(
              sx(lerp(ax, bx, 0.08)),
              sy(lerp(ay, by, 0.08)),
              sx(lerp(ax, bx, 0.92)),
              sy(lerp(ay, by, 0.92)),
              HAIR,
              seed + Math.round(u * 40),
            );
          }
        }
      } else {
        // A wood.
        const edge: number[] = [];
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * Math.PI * 2;
          const lobe = i % 2 ? 0.86 : 1;
          const reach = lobe * (0.85 + 0.25 * noise1(i * 0.7 + cx, cy + 3));
          edge.push(sx(px + Math.cos(a) * wide * reach), sy(py + Math.sin(a) * deep * reach));
        }
        d.strength = base * strength;
        d.wash(edge, LAND, 0.5, true);
        d.strength = base * strength * 0.4;
        d.curve(edge, FORM, seed, true);
        for (let n = 0; n < 5; n++) {
          const tx = px + (hash(seed, n, 421) - 0.5) * wide * 1.2;
          const ty = py + (hash(seed, n, 422) - 0.5) * deep * 1.1;
          const r = (0.35 + hash(seed, n, 423) * 0.2) * T;
          const crown: number[] = [];
          for (let i = 0; i < 9; i++) {
            const a = Math.PI * 0.9 + (i / 8) * Math.PI * 1.2;
            crown.push(sx(tx) + Math.cos(a) * r, sy(ty) + Math.sin(a) * r * 0.8);
          }
          d.curve(crown, HAIR, seed + n);
        }
      }
    }
  d.strength = base * strength;
  const stream: number[] = [];
  const banks: number[][] = [[], []];
  for (let wx = x0; wx <= x1; wx += 0.5) {
    const y = streamY(wx);
    const w = 0.35 + 0.12 * noise1(wx / 3, 407);
    stream.push(sx(wx), sy(y - w));
    banks[0]?.push(sx(wx), sy(y - w));
    banks[1]?.push(sx(wx), sy(y + w));
  }
  for (let wx = x1; wx >= x0; wx -= 0.5) {
    const y = streamY(wx);
    const w = 0.35 + 0.12 * noise1(wx / 3, 407);
    stream.push(sx(wx), sy(y + w));
  }
  d.wash(stream, LAND, 0.55);
  d.strength = base * strength * 0.4;
  d.curve(banks[0] as number[], FORM, 408);
  d.curve(banks[1] as number[], FORM, 409);
  const track: number[] = [];
  for (let wx = x0; wx <= x1; wx += 0.5) track.push(sx(wx), sy(trackY(wx) - 0.28));
  for (let wx = x1; wx >= x0; wx -= 0.5) track.push(sx(wx), sy(trackY(wx) + 0.28));
  d.strength = base * strength;
  d.fill(track, PAPER, 0.55);
  d.strength = base * strength * 0.4;
  for (let wx = x0; wx < x1; wx += 1.3) {
    if (hash(Math.round(wx * 10), 410) < 0.3) continue;
    d.line(
      sx(wx),
      sy(trackY(wx) - 0.3),
      sx(wx + 0.9),
      sy(trackY(wx + 0.9) - 0.3),
      FORM,
      Math.round(wx * 10),
    );
    d.line(
      sx(wx + 0.3),
      sy(trackY(wx + 0.3) + 0.3),
      sx(wx + 1.1),
      sy(trackY(wx + 1.1) + 0.3),
      FORM,
      Math.round(wx * 10) + 1,
    );
  }
  // Ground marks in clumps, with bare paper between them.
  for (let wx = x0; wx <= x1; wx++)
    for (let wy = y0; wy <= y1; wy++) {
      const k = hash(wx, wy, 413);
      const density = noise1(wx / 4 + wy * 0.37, 414);
      if (k > 0.2 + density * 0.35) continue;
      const px = sx(wx + hash(wx, wy, 415));
      const py = sy(wy + hash(wx, wy, 416));
      if (Math.abs(wy + 0.5 - streamY(wx)) < 0.7) continue;
      const kind = hash(wx, wy, 417);
      if (kind < 0.7) {
        for (let b = 0; b < 3; b++)
          d.line(
            px + b * 3,
            py,
            px + b * 3 + (b - 1) * 2,
            py - 6 - hash(wx, b, wy) * 4,
            FORM,
            wx * 31 + wy * 7 + b,
          );
      } else if (kind < 0.88) {
        d.curve(d.round(px, py, 5, 3.5, 7, wx + wy).slice(), HAIR, wx * 13 + wy);
      } else d.dot(px, py, 2.2, INK, 0.8);
    }
  d.strength = base;
}

/** The deck in transit, with `count` aboard. */
export function deckScene(count: number): Scene {
  const crowd: Look[] = Array.from({ length: count }, (_, i) => lookOf(i + 1));
  const stations: Station[] = crowdStations(count);
  const size = count > 40 ? 56 : 96;
  const crew: Crew[] = crowd.map((look, i) => ({ look, station: stations[i] as Station }));
  const corners = (t: number): Corners => deckCorners(crowd, count, t);
  const city = (t: number): TopCity => ({
    ox: TRANSIT_X,
    oy: TRANSIT_Y,
    T: TRANSIT_TILE,
    t,
    gait: t / GAIT_SECONDS,
    walk: 1,
    settle: 0,
    ramp: 0,
    rampSide: 1,
    detail: 1,
    size,
    crew,
    lantern: 0,
  });
  const tags = new TagTimeline((t) => {
    const c = city(t);
    const places = crewPlaces(c);
    const taken = cornerBoxes(corners(t));
    for (const p of places) taken.push(...headBox(p.x, p.y, p.size));
    // The lantern is never under a tag.
    const [lx, ly] = lanternAt(c);
    const ls = Math.max(5, 0.26 * c.T);
    taken.push(lx - ls * 1.3, ly - ls * 1.6, lx + ls * 1.3, ly + ls * 1.3);
    // With more than forty aboard, who is named moves on every five seconds.
    const order = places.map((_, i) => i);
    if (count > 40) {
      const turn = Math.floor((t + 2.5) / 5);
      order.sort((a, b) => ((a + turn * 47) % count) - ((b + turn * 47) % count));
    }
    const wants: TagWant[] = order.slice(0, count > 40 ? 24 : count).map((i) => {
      const p = places[i] as (typeof places)[number];
      return {
        key: p.look.id,
        x: p.x,
        y: p.y - p.size * HAT_TOP,
        name: p.look.name,
        rgb: p.look.cloak,
        size: TAG_SIZE,
      };
    });
    return { wants, taken, must: count <= 40, lines: stayLines(c) };
  });
  return {
    duration: GAIT_SECONDS * 4,
    draw(d: Draw, t: number): void {
      const c = city(t);
      drawTransitPlan(d, c.ox, c.oy, c.T, t * WALK_SPEED, 1);
      drawTopCity(d, c);
      drawCorners(d, corners(t));
      drawPlacedTags(d, tags.get(t));
      drawFrameRule(d);
    },
    probe(t: number) {
      const c = city(t);
      const places = crewPlaces(c);
      return {
        out: 0,
        aboard: count,
        monsters: 0,
        citizens: places.map((p) => ({
          key: p.look.id,
          x: p.x,
          y: p.y,
          size: p.size,
          outside: false,
        })),
        get tags() {
          return tags.get(t);
        },
      };
    },
  };
}

/** The corners in transit: 42 seconds to the landing, the landing ahead, one bench result. */
export const deckCorners = (crowd: readonly Look[], count: number, t: number): Corners => ({
  left: 42 - t,
  to: "landing",
  gone: (138 + t) / 180,
  horn: 1,
  late: false,
  head: "Medium 23–68",
  lines: ["packs ×2", "rares +40%"],
  log: {
    who: (crowd[6] as Look).name,
    rgb: (crowd[6] as Look).cloak,
    what: BENCH_ITEM,
    whatRgb: itemInk(2),
  },
  counts: [0, count, 0, 31],
});

/** Where everyone aboard stands on screen, without drawing: the same sums the drawing does. */
export function crewPlaces(c: TopCity): { look: Look; x: number; y: number; size: number }[] {
  const ride = hullRide(c.t, c.gait, c.walk, c.settle);
  const H = ride.belly + HULL_DEEP;
  return c.crew.map((m) => {
    const sp = m.station;
    let hx = sp.x;
    if (sp.act === "pace" || sp.act === "carry") {
      // Pacing moves a citizen along its range, as the station's pose does.
      const beat = c.t + hash(m.look.id, 21) * 5;
      const period = sp.act === "carry" ? 9 : 5 + hash(m.look.id, 22) * 4;
      const u = ((beat / period) % 1) * 2;
      const k = u < 1 ? u : 2 - u;
      const e = sp.act === "carry" ? k : k * k * (3 - 2 * k);
      hx = sp.x + (e - 0.5) * 2 * sp.range;
    }
    const z = H + sp.z;
    return {
      look: m.look,
      x: c.ox + hx * c.T,
      y: c.oy + sp.y * 0.8 * c.T - z * UP * c.T,
      size: c.size,
    };
  });
}
