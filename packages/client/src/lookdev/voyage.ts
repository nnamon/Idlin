// `deckside`: #371's cut-away of the deck in transit, side-on, kept only so
// it can be set beside the deck from above in one capture. It goes, with
// `drawCity` and the sliding land in transit.ts, once the look target is
// signed off.

import {
  CITY_SPEED,
  type CityState,
  drawCity,
  drawFootfall,
  footfalls,
  GAIT_SECONDS,
} from "./city.ts";
import type { Draw } from "./draw.ts";
import { type Look, lookOf } from "./figure.ts";
import { drawBorder, drawTags, type Tag } from "./plate.ts";
import type { Scene } from "./scenes.ts";
import { drawForeground, drawTransitLand, GROUND_Y } from "./transit.ts";

/** Where the middle of the hull sits across the frame in the close-up. */
const CITY_X = 912;

export function decksideScene(count: number): Scene {
  const crowd: Look[] = Array.from({ length: count }, (_, i) => lookOf(i + 1));
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
      for (const tag of tags) tag.must = true;
      drawTags(d, tags);
      drawBorder(d);
    },
  };
}
