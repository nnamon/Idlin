// Sheets for judging the drawings themselves rather than a scene: every pose
// at the three sizes, and citizens at a run of scales to find the smallest at
// which one still reads (docs/decisions/0030-renderer-and-scale.md).

import type { Draw } from "./draw.ts";
import {
  BLOW_LENGTH,
  CITIZEN_TILES,
  drawCitizen,
  HAT_TOP,
  hurt,
  lookOf,
  pose,
  shooting,
  standing,
  swinging,
  walking,
} from "./figure.ts";
import { hash } from "./geom.ts";
import { drawBorder, drawNews, drawTags, PICTURE, type Tag } from "./plate.ts";
import type { Scene } from "./scenes.ts";

/** Every pose, at the far, mid and near sizes. */
export function figuresSheet(): Scene {
  return {
    duration: 8,
    draw(d: Draw, t: number): void {
      const rows = [
        { size: 37, detail: 0, y: 190, gap: 110 },
        { size: 54, detail: 1, y: 400, gap: 130 },
        { size: 104, detail: 2, y: 700, gap: 190 },
        { size: 104, detail: 2, y: 930, gap: 190 },
      ];
      const tags: Tag[] = [];
      rows.forEach((row, r) => {
        const count = Math.floor((PICTURE.x1 - PICTURE.x0 - 80) / row.gap);
        for (let i = 0; i < count; i++) {
          const id = 1 + ((i + r * 5) % 16);
          const look = lookOf(id);
          const x = PICTURE.x0 + 90 + i * row.gap;
          const k = (i + (r === 3 ? 9 : 0)) % 18;
          const blow = (t * 0.6 + i * 0.13) % (BLOW_LENGTH + 0.4);
          let p = standing(id, t, i % 3 === 0 ? -1 : 1);
          if (k === 1) p = walking(t * 3.2 + i, 1, 1);
          else if (k === 2) p = walking(t * 6 + i, 2, 1);
          else if (k === 3) p = swinging(0.15, 1);
          else if (k === 4) p = swinging(0.228, 1);
          else if (k === 5) p = swinging(0.34, 1);
          else if (k === 6) p = swinging(blow, -1);
          else if (k === 7) p = shooting(0.9, 1, false);
          else if (k === 8) p = shooting(0, 1, true);
          else if (k === 9) p = hurt(0.2, 1);
          else if (k === 10) p = pose({ down: -1 });
          else if (k === 11) p = { ...walking(t * 3 + i, 1, 1), haul: 0.4 };
          else if (k === 12) p = { ...walking(t * 3 + i, 1, -1), haul: 1 };
          else if (k === 13) p = pose({ sit: 1, arm: 0.9, arm2: 0.7 });
          else if (k === 14)
            p = pose({ arm: 2.2 + Math.sin(t * 6) * 0.6, lean: 0.2, tool: "hammer", grip: 0.2 });
          else if (k === 15) p = pose({ asleep: true, sit: 1, lean: -0.3, nod: 0.3 });
          else if (k === 16) p = pose({ arm: 1.3, tool: "pole", grip: 0.3 });
          drawCitizen(d, look, p, x, row.y, row.size, row.detail);
          if (r < 2) tags.push({ x, y: row.y - row.size * HAT_TOP, name: look.name });
        }
      });
      drawTags(d, tags);
      drawBorder(d);
      drawNews(
        d,
        "Citizens at the far, mid and near sizes, in every pose",
        1,
        "far 37 px · mid 54 px · near 104 px",
        "",
      );
    },
  };
}

/** Rows of fifteen citizens at each scale, with names, to find the smallest that reads. */
export function scaleSheet(): Scene {
  const scales = [16, 20, 24, 28, 32, 40, 48];
  return {
    duration: 8,
    draw(d: Draw, t: number): void {
      let y = PICTURE.y0 + 50;
      const tags: Tag[] = [];
      for (const tile of scales) {
        const size = tile * CITIZEN_TILES;
        y += size * 1.5 + 50;
        d.text(`${tile} px a tile`, PICTURE.x0 + 28, y - size * 0.4, { size: 24 });
        for (let i = 0; i < 15; i++) {
          const id = i + 1;
          const look = lookOf(id);
          const x = PICTURE.x0 + 290 + i * 100 + (hash(id, tile) - 0.5) * tile * 0.6;
          const k = i % 5;
          const p =
            k === 1
              ? walking(t * 3 + i, 1, 1)
              : k === 3
                ? swinging(0.228, -1)
                : k === 4
                  ? { ...walking(t * 3 + i, 1, -1), haul: 0.7 }
                  : standing(id, t, i % 2 ? 1 : -1);
          drawCitizen(d, look, p, x, y, size, tile >= 44 ? 1 : 0);
          if (i % 3 === 0) tags.push({ x, y: y - size * HAT_TOP, name: look.name });
        }
      }
      drawTags(d, tags);
      drawBorder(d);
      drawNews(d, "Fifteen citizens at each scale, 16 to 48 px a tile", 1, "", "");
    },
  };
}
