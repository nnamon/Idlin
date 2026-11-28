// Sheets for judging the drawings themselves rather than a scene: every pose
// at the three sizes, and citizens at each camera's size, down to the floor a
// landing may not go under (docs/decisions/0038-renderer-scale-and-the-siege.md),
// and the monsters by themselves.

import { beastPose, drawBrute, drawElite, drawHound, drawSwarm, inHorde } from "./beasts.ts";
import { type Draw, INK } from "./draw.ts";
import {
  BLOW_LENGTH,
  drawCitizen,
  HAT_TOP,
  hurt,
  lookOf,
  pose,
  shooting,
  standing,
  swinging,
  thrown,
  walking,
} from "./figure.ts";
import { hash } from "./geom.ts";
import { drawBorder, drawTags, PICTURE, type Tag } from "./plate.ts";
import type { Scene } from "./scenes.ts";

/** Every pose, at the far, mid and near sizes. */
export function figuresSheet(): Scene {
  return {
    duration: 8,
    draw(d: Draw, t: number): void {
      const rows = [
        { size: 46, detail: 0, y: 190, gap: 110 },
        { size: 58, detail: 1, y: 400, gap: 130 },
        { size: 96, detail: 2, y: 700, gap: 190 },
        { size: 96, detail: 2, y: 930, gap: 190 },
      ];
      const tags: Tag[] = [];
      rows.forEach((row, r) => {
        const count = Math.floor((PICTURE.x1 - PICTURE.x0 - 80) / row.gap);
        for (let i = 0; i < count; i++) {
          const id = 1 + ((i + r * 5) % 16);
          const look = lookOf(id);
          const x = PICTURE.x0 + 90 + i * row.gap;
          const k = (i + (r === 3 ? 9 : 0)) % 19;
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
          else if (k === 16) p = { ...swinging(0.15, 1), tool: "maul" };
          else if (k === 17) p = { ...swinging(0.24, 1), tool: "spear" };
          else if (k === 18) p = thrown((t * 0.7 + i * 0.1) % 1, 1);
          drawCitizen(d, look, p, x, row.y, row.size, row.detail);
          if (r < 2) tags.push({ x, y: row.y - row.size * HAT_TOP, name: look.name });
        }
      });
      drawTags(d, tags);
      drawBorder(d);
    },
  };
}

/** Rows of fifteen citizens at each camera's size, with names, down to the 44 px floor. */
export function scaleSheet(): Scene {
  // Transit with 15 and with 150 aboard, the medium landing, the large one, and the floor.
  const sizes = [96, 58, 56, 46, 44, 40];
  return {
    duration: 8,
    draw(d: Draw, t: number): void {
      let y = PICTURE.y0 + 30;
      const tags: Tag[] = [];
      for (const size of sizes) {
        y += size * 1.5 + 40;
        d.text(String(size), PICTURE.x0 + 28, y - size * 0.4, { size: 24 });
        for (let i = 0; i < 15; i++) {
          const id = i + 1;
          const look = lookOf(id);
          const x = PICTURE.x0 + 160 + i * 112 + (hash(id, size) - 0.5) * 16;
          const k = i % 5;
          const face = i % 2 ? 1 : -1;
          const p =
            k === 1
              ? walking(t * 3 + i, 1, face)
              : k === 3
                ? swinging(0.228, face)
                : k === 4
                  ? { ...walking(t * 3 + i, 1, face), haul: 0.7 }
                  : standing(id, t, face);
          drawCitizen(d, look, p, x, y, size, size >= 90 ? 2 : size >= 50 ? 1 : 0);
          if (i % 3 === 0) tags.push({ x, y: y - size * HAT_TOP, name: look.name });
        }
      }
      drawTags(d, tags);
      drawBorder(d);
    },
  };
}

/**
 * Monsters by themselves: a brute and an elite standing, walking, rearing to
 * strike and slamming, on the map's grey and in the horde's black on a black
 * ground, then every kind filled solid black at 12 px for the silhouette test
 * (docs/art.md, section 6).
 */
export function beastsSheet(): Scene {
  return {
    duration: 4,
    draw(d: Draw, t: number): void {
      const poses = [
        beastPose({ face: 1 }),
        beastPose({ face: -1, stride: (t * 0.8) % 1, speed: 1 }),
        beastPose({ face: 1, coil: 0.5 }),
        beastPose({ face: 1, coil: 1 }),
        beastPose({ face: -1, lunge: 1 }),
      ];
      const black = (x0: number, y0: number, x1: number, y1: number): void =>
        d.fill(d.box(x0, y0, x1, y1), INK, 1);
      black(PICTURE.x0, 560, PICTURE.x1, 900);
      poses.forEach((p, i) => {
        const x = PICTURE.x0 + 130 + i * 330;
        drawBrute(d, x, 300, 150, p, 11 + i);
        drawElite(d, x + 150, 300, 150, p, 31 + i);
        inHorde(() => {
          drawBrute(d, x, 820, 150, p, 11 + i);
          drawElite(d, x + 150, 820, 150, p, 31 + i);
        });
      });
      // The silhouette test: every kind solid black at 12 px tall.
      inHorde(() => {
        const y = 500;
        let x = PICTURE.x0 + 100;
        drawSwarm(d, [{ x, y, face: 1, phase: 0, stretch: 1, flash: false, seed: 1 }], 1, 16);
        x += 80;
        drawHound(d, x, y, 9, beastPose({}), 0, 3);
        x += 80;
        drawBrute(d, x, y, 12 * 1.5, beastPose({}), 5);
        x += 80;
        drawElite(d, x, y, 12 * 1.8, beastPose({}), 7);
      });
      drawBorder(d);
    },
  };
}
