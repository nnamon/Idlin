// Everything on the map that does not move, drawn once per palette: the paper,
// the washes, the river, the ground marks and place names, and each thing that
// stands up (trees, rocks, tents, the lantern post) as its own small drawing so
// that walkers can pass in front of it or behind it.

import { type Terrain, type TileMap, terrainAt } from "@idlin/sim";
import { css } from "./light.ts";
import { type Pt, regionLoops, smoothLoop } from "./outline.ts";
import type { Palette, WashName } from "./palette.ts";
import { arc, type Ctx, hash, newCanvas, Pen, trace } from "./pen.ts";

/** Frame pixels per tile. */
export const TILE = 48;

export interface MapLabel {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly style: "region" | "place" | "town";
}

/** Something that stands up from the ground. Drawn in order of `base`, with the walkers. */
export interface Standing {
  readonly canvas: HTMLCanvasElement;
  /** Where its top-left corner goes, in frame pixels. */
  readonly x: number;
  readonly y: number;
  /** The line its foot stands on; things with a smaller base are drawn first. */
  readonly base: number;
}

export interface Ground {
  readonly base: HTMLCanvasElement;
  readonly standing: readonly Standing[];
  /** Where fires burn and lanterns hang, in frame pixels, for the flames and the light. */
  readonly fires: readonly Pt[];
  readonly lanterns: readonly Pt[];
  /** A spot on each water tile, for the moving ripples. */
  readonly ripples: readonly Pt[];
}

const CAMP: ReadonlySet<Terrain> = new Set(["camp", "lantern", "campfire", "bank", "tent"]);
const DEEP: ReadonlySet<Terrain> = new Set(["deep_grass", "dark_tree"]);
const WET: ReadonlySet<Terrain> = new Set(["water", "bridge"]);
const SPRITE = 132;

export function drawGround(map: TileMap, labels: readonly MapLabel[], palette: Palette): Ground {
  const width = map.width * TILE;
  const height = map.height * TILE;
  const terrain = (x: number, y: number): Terrain | null =>
    x >= 0 && y >= 0 && x < map.width && y < map.height ? terrainAt(map, x, y) : null;
  const ink = css(palette.ink);
  const wash = (name: WashName, alpha = 1): string => css(palette.wash[name], alpha);

  const { canvas: base, ctx } = newCanvas(width, height);
  ctx.fillStyle = css(palette.paper);
  ctx.fillRect(0, 0, width, height);

  // Paper grain: a fine speckle and a scatter of fibres.
  const grain = new Pen(7);
  const speckle = ctx.createImageData(width, height);
  for (let i = 0; i < speckle.data.length; i += 4) {
    const v = Math.floor(grain.random() * 26);
    speckle.data[i] = speckle.data[i + 1] = speckle.data[i + 2] = 0;
    speckle.data[i + 3] = v;
  }
  const { canvas: speckled, ctx: sp } = newCanvas(width, height);
  sp.putImageData(speckle, 0, 0);
  ctx.drawImage(speckled, 0, 0);
  ctx.strokeStyle = css(palette.ink, 0.06);
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 900; i++) {
    const x = grain.random() * width;
    const y = grain.random() * height;
    const length = 8 + grain.random() * 30;
    const angle = grain.random() * 6.3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    ctx.stroke();
  }

  // Washes: soft pools of colour under the ink, as thin watercolour would lie.
  const pool = (cx: number, cy: number, r: number, name: WashName, alpha: number): void => {
    const gradient = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
    gradient.addColorStop(0, wash(name, alpha * palette.washStrength));
    gradient.addColorStop(1, wash(name, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 7);
    ctx.fill();
  };
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = terrainAt(map, x, y);
      const cx = x * TILE + TILE / 2;
      const cy = y * TILE + TILE / 2;
      if (DEEP.has(t))
        pool(
          cx + (hash(x, y) - 0.5) * 14,
          cy + (hash(y, x) - 0.5) * 14,
          TILE * 1.05,
          "deepWood",
          0.5,
        );
      else if (t === "tree") pool(cx, cy, TILE * 0.95, "wood", 0.5);
      else if (t === "grass" || t === "path") {
        if (hash(x, y, 3) < 0.35) pool(cx, cy, TILE * 1.2, "meadow", 0.28);
      } else if (t === "den" || t === "rock") pool(cx, cy, TILE, "den", 0.6);
      else if (CAMP.has(t)) pool(cx, cy, TILE * 1.05, "camp", 0.6);
      else if (t === "shore") pool(cx, cy, TILE * 0.8, "sand", 0.8);
    }
  }

  // The river: the water tiles' outline, rounded into banks.
  const ripples: Pt[] = [];
  const pen = new Pen(11);
  const banks = regionLoops(map.width, map.height, (x, y) => WET.has(terrainAt(map, x, y))).map(
    (loop) => smoothLoop(loop, 3).map(([x, y]) => [x * TILE, y * TILE] as const),
  );
  ctx.beginPath();
  for (const loop of banks) {
    trace(ctx, loop);
    ctx.closePath();
  }
  ctx.save();
  ctx.clip("evenodd");
  ctx.fillStyle = wash("water", 0.92);
  ctx.fillRect(0, 0, width, height);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!WET.has(terrainAt(map, x, y))) continue;
      if (hash(x, y, 9) < 0.5)
        pool(x * TILE + TILE / 2, y * TILE + TILE / 2, TILE * 0.9, "waterDeep", 0.4);
      if (terrainAt(map, x, y) === "water")
        ripples.push([x * TILE + 8 + hash(x, y, 30) * 22, y * TILE + 12 + hash(x, y, 40) * 26]);
    }
  }
  ctx.restore();
  ctx.strokeStyle = ink;
  const onEdge = ([x, y]: Pt): boolean =>
    x <= 0.5 || y <= 0.5 || x >= width - 0.5 || y >= height - 0.5;
  for (const loop of banks) {
    // Draw the bank in runs, leaving out the parts that only follow the edge of the map.
    let run: Pt[] = [];
    const flush = (): void => {
      if (run.length > 1) pen.line(ctx, run, 2.6, 1.8);
      run = [];
    };
    for (let i = 0; i <= loop.length; i++) {
      const a = loop[i % loop.length] as Pt;
      const b = loop[(i + 1) % loop.length] as Pt;
      if (onEdge(a) && onEdge(b)) flush();
      else run.push(a);
    }
    flush();
  }

  // Marks on the ground.
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = terrainAt(map, x, y);
      const px = x * TILE;
      const py = y * TILE;
      if (t === "grass" || t === "deep_grass") {
        for (let i = 0; i < (t === "deep_grass" ? 2 : 1); i++) {
          if (hash(x, y, 60 + i) >= 0.45) continue;
          const gx = px + 6 + hash(x, y, 70 + i) * 34;
          const gy = py + 10 + hash(x, y, 80 + i) * 32;
          pen.line(
            ctx,
            [
              [gx - 3, gy - 5],
              [gx, gy],
            ],
            1,
            0.6,
          );
          pen.line(
            ctx,
            [
              [gx + 1, gy - 7],
              [gx + 1, gy],
            ],
            1,
            0.6,
          );
          pen.line(
            ctx,
            [
              [gx + 5, gy - 4],
              [gx + 2, gy],
            ],
            1,
            0.6,
          );
        }
      }
      if (t === "shore") {
        ctx.fillStyle = ink;
        for (let i = 0; i < 9; i++) {
          ctx.beginPath();
          ctx.arc(
            px + 6 + hash(x, y, 90 + i) * 36,
            py + 6 + hash(x, y, 100 + i) * 36,
            0.9 + hash(x, y, 110 + i),
            0,
            7,
          );
          ctx.fill();
        }
      }
      if (t === "path") {
        for (let i = 0; i < 3; i++) {
          const sx = px + 8 + i * 14 + hash(x, y, 120 + i) * 4;
          const sy = py + TILE / 2 + (hash(x, y, 130 + i) - 0.5) * 10;
          pen.line(ctx, arc(sx, sy, 3.2 + hash(x, y, 140 + i) * 1.6, 0, 6.4, 7), 1.1, 0.7);
        }
      }
      if (t === "den") {
        for (let i = 0; i < 2; i++) {
          if (hash(x, y, 230 + i) >= 0.5) continue;
          const sx = px + 8 + hash(x, y, 240 + i) * 30;
          const sy = py + 12 + hash(x, y, 250 + i) * 28;
          pen.line(
            ctx,
            [...arc(sx, sy, 3 + hash(x, y, 260 + i) * 3, 3.3, 6.2, 5), [sx - 4, sy]],
            1.3,
            0.7,
          );
        }
      }
      if (t === "water" && hash(x, y, 20) > 0.6) {
        const fx = px + 8 + hash(x, y, 31) * 20;
        const fy = py + 30 + hash(x, y, 41) * 12;
        pen.line(
          ctx,
          [
            [fx, fy],
            [fx + 7, fy + 2.5],
            [fx + 14, fy],
          ],
          1.1,
          0.8,
        );
      }
      if (t === "bridge") {
        ctx.fillStyle = wash("timber", 0.95);
        ctx.fillRect(px - 2, py + 7, TILE + 4, TILE - 14);
        pen.line(
          ctx,
          [
            [px - 3, py + 7],
            [px + TILE + 3, py + 7],
          ],
          2.6,
          1,
        );
        pen.line(
          ctx,
          [
            [px - 3, py + TILE - 7],
            [px + TILE + 3, py + TILE - 7],
          ],
          2.6,
          1,
        );
        for (let i = 1; i < 5; i++)
          pen.line(
            ctx,
            [
              [px + i * 10, py + 9],
              [px + i * 10 + 1, py + TILE - 9],
            ],
            1.2,
            0.8,
          );
      }
    }
  }

  // Place names, lettered as on a map.
  ctx.fillStyle = css(palette.ink, 0.78);
  ctx.textAlign = "center";
  for (const label of labels) {
    const [font, size, spacing] =
      label.style === "region"
        ? ["Fell Italic", 30, 2]
        : label.style === "town"
          ? ["Fell SC", 24, 3]
          : ["Fell Italic", 22, 0];
    ctx.font = `${size}px "${font}"`;
    ctx.letterSpacing = `${spacing}px`;
    ctx.fillText(label.text, label.x * TILE, label.y * TILE);
  }
  ctx.letterSpacing = "0px";

  // Things that stand up, each on its own small sheet.
  const standing: Standing[] = [];
  const fires: Pt[] = [];
  const lanterns: Pt[] = [];
  const stand = (
    x: number,
    y: number,
    draw: (c: Ctx, p: Pen, cx: number, foot: number) => void,
  ): void => {
    const { canvas, ctx: c } = newCanvas(SPRITE, SPRITE);
    c.strokeStyle = ink;
    c.fillStyle = ink;
    // The foot of the thing sits near the bottom of the sheet, in the middle.
    const jx =
      terrain(x, y) === "tree" || terrain(x, y) === "dark_tree" ? (hash(x, y, 150) - 0.5) * 14 : 0;
    const jy =
      terrain(x, y) === "tree" || terrain(x, y) === "dark_tree" ? (hash(x, y, 160) - 0.5) * 8 : 0;
    draw(c, new Pen(1000 + x * 131 + y * 17), SPRITE / 2, SPRITE - 12);
    const foot = y * TILE + TILE - 4 + jy;
    standing.push({
      canvas,
      x: Math.round(x * TILE + TILE / 2 + jx - SPRITE / 2),
      y: Math.round(foot - (SPRITE - 12)),
      base: foot,
    });
  };

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = terrainAt(map, x, y);
      const size = 0.85 + hash(x, y, 170) * 0.35;
      if (t === "dark_tree" || (t === "tree" && hash(x, y, 180) < 0.3)) {
        stand(x, y, (c, p, cx, foot) => {
          const h = 46 * size;
          const half = 15 * size;
          c.fillStyle = wash("pine", 0.95);
          c.beginPath();
          c.moveTo(cx, foot - h);
          c.lineTo(cx + half, foot - 6);
          c.lineTo(cx - half, foot - 6);
          c.fill();
          p.line(
            c,
            [
              [cx, foot],
              [cx, foot - 8],
            ],
            2.4,
            0.6,
          );
          for (let tier = 0; tier < 3; tier++) {
            const top = foot - h + tier * h * 0.26;
            const bottom = top + h * 0.42;
            const w = half * (0.55 + tier * 0.22);
            const mid = top + (bottom - top) * 0.55;
            p.line(
              c,
              [
                [cx, top],
                [cx - w * 0.5, mid],
                [cx - w, bottom],
                [cx - w * 0.45, bottom - 4],
                [cx, bottom - 1],
                [cx + w * 0.45, bottom - 4],
                [cx + w, bottom],
                [cx + w * 0.5, mid],
                [cx, top],
              ],
              1.9,
              0.9,
            );
            for (let i = 0; i < 3; i++) {
              const hx = cx + w * (0.15 + i * 0.22);
              const hy = top + (bottom - top) * (0.5 + i * 0.12);
              p.line(
                c,
                [
                  [hx, hy],
                  [hx - 3, hy + 7],
                ],
                1,
                0.5,
              );
            }
          }
        });
      } else if (t === "tree") {
        stand(x, y, (c, p, cx, foot) => {
          const r = 15 * size;
          const cy = foot - 12 * size - r;
          c.fillStyle = wash("leaf", 0.95);
          c.beginPath();
          c.arc(cx, cy, r, 0, 7);
          c.fill();
          p.line(
            c,
            [
              [cx - 1.5, foot],
              [cx - 1, cy + r * 0.7],
            ],
            2.2,
            0.8,
          );
          p.line(
            c,
            [
              [cx + 2.5, foot],
              [cx + 1.5, cy + r * 0.7],
            ],
            2.2,
            0.8,
          );
          // The crown: a ring of small bumps.
          const bumps = 9;
          let crown: Pt[] = [];
          for (let i = 0; i <= bumps; i++) {
            const a0 = (i / bumps) * 6.283;
            const a1 = ((i + 1) / bumps) * 6.283;
            const am = (a0 + a1) / 2;
            crown = crown.concat(
              arc(
                cx + Math.cos(am) * r * 0.82,
                cy + Math.sin(am) * r * 0.82,
                r * 0.36,
                a0 - 1.2,
                a1 + 0.6,
                5,
              ),
            );
          }
          p.line(c, crown, 2, 1);
          for (let i = 0; i < 5; i++) {
            const hx = cx + r * (0.1 + i * 0.16);
            const hy = cy - r * 0.2 + i * 2.2;
            p.line(
              c,
              [
                [hx, hy],
                [hx - 5, hy + 9],
              ],
              1,
              0.6,
            );
          }
        });
      } else if (t === "rock") {
        stand(x, y, (c, p, cx, foot) => {
          // A crag: a broken outline with hatching down its face. Taller where it backs onto more rock.
          const backed = terrain(x, y - 1) === "rock" ? 1.25 : 1;
          const h = (30 + hash(x, y, 190) * 12) * backed;
          const left = cx - 25;
          const top = foot - h;
          const outline: Pt[] = [
            [left, foot],
            [left + 4, top + 12],
            [left + 13, top + 2],
            [left + 22, top + 7],
            [left + 31, top - 3],
            [left + 41, top + 6],
            [left + 48, top + 16],
            [left + 50, foot],
          ];
          c.fillStyle = wash("den", 0.95);
          c.beginPath();
          trace(c, outline);
          c.fill();
          p.line(c, outline, 2.4, 1.2);
          p.line(
            c,
            [
              [left + 22, top + 7],
              [left + 20, top + 20],
              [left + 26, foot - 6],
            ],
            1.3,
            0.9,
          );
          for (let i = 0; i < 7; i++) {
            const hx = left + 6 + i * 6.4;
            const hy = top + 14 + hash(x, y, 200 + i) * 8;
            p.line(
              c,
              [
                [hx, hy],
                [hx - 2 + hash(x, y, 210 + i) * 4, hy + 9 + hash(x, y, 220 + i) * 9],
              ],
              1.1,
              0.7,
            );
          }
        });
      } else if (t === "tent") {
        stand(x, y, (c, p, cx, foot) => {
          const s = 1 + (hash(x, y, 300) - 0.5) * 0.15;
          c.fillStyle = wash("canvas", 0.97);
          c.beginPath();
          c.moveTo(cx, foot - 40 * s);
          c.lineTo(cx + 27 * s, foot);
          c.lineTo(cx - 27 * s, foot);
          c.fill();
          p.line(
            c,
            [
              [cx - 27 * s, foot],
              [cx, foot - 40 * s],
              [cx + 27 * s, foot],
              [cx - 27 * s, foot],
            ],
            2.2,
            1,
          );
          p.line(
            c,
            [
              [cx, foot - 40 * s],
              [cx - 3 * s, foot],
            ],
            1.4,
            0.8,
          );
          c.fillStyle = ink;
          c.globalAlpha = 0.75;
          c.beginPath();
          c.moveTo(cx - 3 * s, foot);
          c.lineTo(cx + 4 * s, foot - 17 * s);
          c.lineTo(cx + 10 * s, foot);
          c.fill();
          c.globalAlpha = 1;
          p.line(
            c,
            [
              [cx - 3 * s, foot - 44 * s],
              [cx + 3 * s, foot - 36 * s],
            ],
            1.3,
            0.5,
          );
          p.line(
            c,
            [
              [cx + 3 * s, foot - 44 * s],
              [cx - 3 * s, foot - 36 * s],
            ],
            1.3,
            0.5,
          );
          p.line(
            c,
            [
              [cx - 27 * s, foot],
              [cx - 34 * s, foot + 3],
            ],
            1.2,
            0.5,
          );
          p.line(
            c,
            [
              [cx + 27 * s, foot],
              [cx + 34 * s, foot + 3],
            ],
            1.2,
            0.5,
          );
        });
      } else if (t === "lantern") {
        lanterns.push([x * TILE + TILE / 2 + 12, y * TILE + TILE - 4 - 60]);
        stand(x, y, (c, p, cx, foot) => {
          p.line(
            c,
            [
              [cx, foot],
              [cx, foot - 70],
            ],
            3,
            0.6,
          );
          p.line(
            c,
            [
              [cx - 9, foot],
              [cx + 9, foot],
            ],
            3,
            0.6,
          );
          p.line(
            c,
            [
              [cx - 5, foot - 6],
              [cx, foot - 14],
              [cx + 5, foot - 6],
            ],
            1.4,
            0.5,
          );
          p.line(
            c,
            [
              [cx, foot - 70],
              [cx + 12, foot - 75],
              [cx + 12, foot - 68],
            ],
            2,
            0.5,
          );
          c.fillStyle = wash("glass", 1);
          c.beginPath();
          c.moveTo(cx + 5, foot - 68);
          c.lineTo(cx + 19, foot - 68);
          c.lineTo(cx + 17, foot - 50);
          c.lineTo(cx + 7, foot - 50);
          c.fill();
          p.line(
            c,
            [
              [cx + 5, foot - 68],
              [cx + 19, foot - 68],
              [cx + 17, foot - 50],
              [cx + 7, foot - 50],
              [cx + 5, foot - 68],
            ],
            1.8,
            0.6,
          );
          p.line(
            c,
            [
              [cx + 8, foot - 71],
              [cx + 12, foot - 75],
              [cx + 16, foot - 71],
            ],
            1.4,
            0.4,
          );
        });
      } else if (t === "campfire") {
        fires.push([x * TILE + TILE / 2, y * TILE + TILE - 12]);
        stand(x, y, (c, p, cx, foot) => {
          for (let i = 0; i < 7; i++) {
            const a = (i / 7) * 6.283;
            p.line(
              c,
              arc(cx + Math.cos(a) * 16, foot - 5 + Math.sin(a) * 6, 3.2, 0, 6.3, 6),
              1.3,
              0.5,
            );
          }
          p.line(
            c,
            [
              [cx - 12, foot - 3],
              [cx + 11, foot - 10],
            ],
            3,
            0.8,
          );
          p.line(
            c,
            [
              [cx - 11, foot - 10],
              [cx + 12, foot - 3],
            ],
            3,
            0.8,
          );
        });
      } else if (t === "bank") {
        stand(x, y, (c, p, cx, foot) => {
          c.fillStyle = wash("timber", 0.97);
          c.fillRect(cx - 16, foot - 23, 32, 23);
          p.line(
            c,
            [
              [cx - 16, foot],
              [cx - 16, foot - 17],
              [cx - 12, foot - 24],
              [cx + 12, foot - 24],
              [cx + 16, foot - 17],
              [cx + 16, foot],
              [cx - 16, foot],
            ],
            2.1,
            0.7,
          );
          p.line(
            c,
            [
              [cx - 16, foot - 16],
              [cx + 16, foot - 16],
            ],
            1.4,
            0.5,
          );
          p.line(
            c,
            [
              [cx - 9, foot - 23],
              [cx - 9, foot],
            ],
            1.2,
            0.5,
          );
          p.line(
            c,
            [
              [cx + 9, foot - 23],
              [cx + 9, foot],
            ],
            1.2,
            0.5,
          );
          p.line(
            c,
            [
              [cx - 2.5, foot - 16],
              [cx - 2.5, foot - 9],
              [cx + 2.5, foot - 9],
              [cx + 2.5, foot - 16],
            ],
            1.3,
            0.4,
          );
        });
      }
    }
  }
  standing.sort((a, b) => a.base - b.base || a.x - b.x);
  return { base, standing, fires, lanterns, ripples };
}
