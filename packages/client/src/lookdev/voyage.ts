// The city in transit, and the landing: the two ends of one camera move
// (docs/art.md, section 12).

import { drawHorde } from "./beasts.ts";
import {
  CITY_SPEED,
  type CityState,
  drawCity,
  drawFootfall,
  footfalls,
  GAIT_SECONDS,
  rampPoint,
} from "./city.ts";
import type { Draw } from "./draw.ts";
import {
  crewOf,
  HORDE_AT,
  HORDE_SPEED,
  LANDED,
  LANDING,
  LANDING_TILE,
  LIFT_MARGIN,
} from "./fight.ts";
import {
  CITIZEN_TILES,
  detailFor,
  drawCitizen,
  HAT_TOP,
  type Look,
  standing,
  walking,
} from "./figure.ts";
import { clamp, easeInOut, hash, lerp, smooth } from "./geom.ts";
import { clock } from "./names.ts";
import { drawBorder, drawNews, drawStatus, drawTags, PICTURE, type Tag } from "./plate.ts";
import type { Scene } from "./scenes.ts";
import { makeFight } from "./script.ts";
import { drawForeground, drawTransitLand, GROUND_Y } from "./transit.ts";
import { drawValeGround, drawValeStanding, type Reveal } from "./vale.ts";

/** Where the middle of the hull sits across the frame in the close-up, and pixels a tile there. */
const CITY_X = 912;
const CLOSE_TILE = 100;

/** Seconds of march left when the deck scene starts. */
const MARCH = 95;

/** The deck in transit: the city fills four fifths of the frame and the land slides by. */
export function deckScene(count: number): Scene {
  const { crowd } = crewOf(count);
  const name = (i: number): string => (crowd[i % crowd.length] as Look).name;
  // What happens aboard, as the news line gives it: one event every four seconds.
  const events = [
    `${name(6)} rerolled a War Axe at the bench · 2 shards spent`,
    `${name(1)} forged a Kettle Helm · 6 ore spent`,
    `${name(11)} equipped Keen Falchion`,
    `${name(2)} cooked 4 stew · +20 hitpoints each`,
    `Next landing: ${LANDING}`,
    `${name(7)} banked 3 ore in the hold`,
  ];
  const tags: Tag[] = [];
  return {
    duration: GAIT_SECONDS * 4,
    draw(d: Draw, t: number): void {
      tags.length = 0;
      const state: CityState = {
        t,
        gait: t / GAIT_SECONDS,
        walk: 1,
        settle: 0,
        ramp: 0,
        crowd,
        aboard: () => true,
        names: tags,
      };
      const travel = t * CITY_SPEED;
      drawTransitLand(d, travel, t, 1);
      for (const [i, fall] of footfalls(state).entries())
        if (!fall.far) drawFootfall(d, CITY_X + fall.x, GROUND_Y + 6, fall.age, i * 37);
      d.push();
      d.move(CITY_X, GROUND_Y);
      drawCity(d, state);
      d.pop();
      drawForeground(d, travel, 1);
      for (const tag of tags) tag.must = count <= 40;
      // With 150 aboard, who gets first pick of the room moves on every few seconds.
      if (count > 40) tags.push(...tags.splice(0, (Math.floor(t / 2.5) * 17) % tags.length));
      const shown = drawTags(d, tags);
      drawBorder(d);
      drawStatus(d, [`In transit · lands in ${clock(MARCH - t)}`, `Next: ${LANDING}`]);
      const slot = Math.floor(t / 4);
      const since = t - slot * 4;
      drawNews(
        d,
        events[slot % events.length] as string,
        smooth(0, 0.25, since) * (1 - smooth(3.7, 4, since)),
        `${count} aboard${shown < count ? ` · ${shown} names shown` : ""}`,
        "",
      );
    },
  };
}

/** The moments of a landing, in seconds from the last strides. */
const HALT = 1.5;
const SETTLE = [1.9, 4.2] as const;
const MOVE = [2.2, 9.4] as const;
const RAMP = [4.4, 5.8] as const;
const POUR = 6.0;

/**
 * The landing: the legs plant, the camera pulls back in one move with the
 * lantern mast as its anchor, the land is inked outward from the city, and
 * the citizens pour down the ramp.
 */
export function revealScene(count: number): Scene {
  const crew = crewOf(count);
  const out = crew.out;
  // They fan out to where the fight at the ramp finds them.
  const places = makeFight({ seed: 362, citizens: out.length, monsters: 0, seconds: 0.1 });
  const spread = count > 40 ? 6.5 : 4.2;
  // Distance walked by the time the legs stop, so the last strides slow down.
  const walked = (t: number): number => (t < HALT ? t - (t * t) / (2 * HALT) : HALT / 2) + 3;
  const tags: Tag[] = [];
  const duration = 16;
  return {
    duration,
    draw(d: Draw, t: number): void {
      const k = easeInOut(clamp((t - MOVE[0]) / (MOVE[1] - MOVE[0])));
      const zoom = lerp(CLOSE_TILE, LANDING_TILE, k);
      // The anchor: a point on the mast. It travels on one curve; everything else scales round it.
      const ax = -0.3;
      const ay = -7.2;
      const sx = lerp(CITY_X + ax * CLOSE_TILE, LANDED.x + ax * LANDING_TILE, k);
      const sy = lerp(GROUND_Y + ay * CLOSE_TILE, LANDED.y + ay * LANDING_TILE, k ** 0.86);
      const ox = sx - ax * zoom;
      const oy = sy - ay * zoom;
      const walking01 = 1 - smooth(HALT - 0.5, HALT + 0.3, t);
      const settle = clamp((t - SETTLE[0]) / (SETTLE[1] - SETTLE[0]));
      const ramp = clamp((t - RAMP[0]) / (RAMP[1] - RAMP[0]));
      const leaves = (i: number): number => POUR + (i / out.length) * spread + hash(i, 5) * 0.3;
      tags.length = 0;
      const state: CityState = {
        t,
        gait: walked(t) / GAIT_SECONDS,
        walk: walking01,
        settle,
        ramp,
        crowd: crew.crowd,
        aboard: (i) => crew.aboard.has(i) || t < leaves(out.indexOf(crew.crowd[i] as Look)) - 0.5,
        names: tags,
      };
      const travel = walked(t) * CITY_SPEED;
      // The land of the march goes as the land of the landing is inked.
      const lift = 1 - smooth(HALT, MOVE[0] + 1.2, t);
      drawTransitLand(d, travel, t, lift);

      // What has been drawn yet: outward from the city at first, then just inside the frame as it widens.
      const done = smooth(MOVE[1] - 0.9, MOVE[1] + 0.5, t);
      const reveal = (
        lag: number,
        inset: number,
        soft: number,
      ): ((x: number, y: number) => number) => {
        // The ink sets out as the legs plant, ahead of the camera.
        const reach = (t - lag - HALT) * 9 + 1;
        const finish = smooth(MOVE[1] - 0.9 + lag, MOVE[1] + 0.5 + lag, t);
        return (x, y) => {
          const px = x * zoom + ox;
          const py = y * zoom + oy;
          const edge = Math.min(px - PICTURE.x0, PICTURE.x1 - px, py - PICTURE.y0, PICTURE.y1 - py);
          const inside = Math.max(clamp((edge - inset) / soft), finish);
          const near = clamp((reach - Math.hypot(x, y * 1.6)) / 2.5);
          return Math.min(inside, near);
        };
      };
      const r: Reveal = { ink: reveal(0, 46, 150), flood: reveal(0.5, 150, 190) };

      d.push();
      d.move(ox, oy);
      d.scale(zoom);
      drawValeGround(d, r);
      drawValeStanding(d, r, false);
      // Footfalls of the last strides and of the legs stepping out to park.
      for (const [i, fall] of footfalls(state).entries()) {
        if (fall.far) continue;
        d.push();
        d.scale(1 / 100);
        drawFootfall(d, fall.x, 6, fall.age, i * 37);
        d.pop();
      }
      d.push();
      d.scale(1 / 100);
      drawCity(d, state);
      d.pop();

      // Citizens pour down the ramp and spread across the meadow.
      const size = CITIZEN_TILES;
      const detail = detailFor(size * zoom);
      const order = out
        .map((_, i) => i)
        .sort((a, b) => (places.cy[a] as number) - (places.cy[b] as number));
      let outside = 0;
      for (const i of order) {
        const since = t - leaves(i);
        if (since < 0) continue;
        outside++;
        const look = out[i] as Look;
        const tx = places.cx[i] as number;
        const ty = places.cy[i] as number;
        const down = 1.1;
        let x: number;
        let y: number;
        let along: number;
        let arrived = false;
        if (since < down) {
          const [rx, ry] = rampPoint(since / down);
          x = rx / 100;
          y = ry / 100;
          along = since * 3;
        } else {
          const [fx, fy] = rampPoint(1);
          const far = Math.hypot(tx - fx / 100, ty - fy / 100);
          const u = clamp(((since - down) * 3.3) / far);
          const e = u * (2 - u);
          x = lerp(fx / 100, tx, e);
          y = lerp(fy / 100, ty, e) + Math.sin(u * Math.PI) * (hash(i, 9) - 0.5) * 1.2;
          along = down * 3 + far * e;
          arrived = u >= 1;
        }
        const p = arrived
          ? standing(look.id, t, 1)
          : walking(along * 2.6, since < down ? 1 : 1.7, 1);
        drawCitizen(d, look, p, x, y, size, detail);
        tags.push({
          x: d.sx(x, y),
          y: d.sy(x, y) - size * zoom * HAT_TOP,
          name: look.name,
          rgb: look.cloak,
          must: count <= 40,
        });
      }
      drawValeStanding(d, r, true);
      d.pop();

      drawForeground(d, travel, lift);
      // Names are never scaled with the picture: they go out as the move starts and come back as it ends.
      const before = 1 - smooth(MOVE[0] - 0.4, MOVE[0] + 0.5, t);
      const names = Math.max(before, done);
      if (names > 0.01) drawTags(d, tags, names);
      // The horde comes onto the margin as soon as the city is down.
      const reachIn = smooth(MOVE[1], duration, t) * 110;
      if (reachIn > 1) drawHorde(d, PICTURE.x1, PICTURE.y0, PICTURE.y1, reachIn, t);
      drawBorder(d);
      const lifts = HORDE_AT - LIFT_MARGIN + (duration - t);
      // The status block is not part of the picture, so it stays through the move.
      if (t < HALT)
        drawStatus(d, [
          `In transit · lands in ${clock(Math.max(0, HALT - t))}`,
          `Next: ${LANDING}`,
        ]);
      else
        drawStatus(d, [
          `Landed · lift-off in ${clock(lifts)}`,
          LANDING,
          `Horde ${Math.ceil((HORDE_AT + duration - t) * HORDE_SPEED)} tiles from the ramp`,
        ]);
      const news =
        t < MOVE[0]
          ? `Landing: ${LANDING}`
          : t < POUR
            ? "Legs planted · ramp coming down"
            : `Ramp down · ${outside} of ${out.length} out`;
      const cut =
        Math.abs(t - MOVE[0]) < 0.3
          ? Math.abs(t - MOVE[0]) / 0.3
          : Math.abs(t - POUR) < 0.3
            ? Math.abs(t - POUR) / 0.3
            : 1;
      drawNews(
        d,
        news,
        cut,
        `${out.length - outside + crew.aboard.size} aboard · ${outside} out`,
        "",
      );
    },
  };
}
