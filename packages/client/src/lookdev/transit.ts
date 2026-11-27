// The land going by while the city walks (docs/art.md, section 3, "The city
// in transit"): pale ink and one cool wash, in layers that slide at different
// speeds, with nothing at contour weight so the city always sits in front.

import { type Draw, FORM, HAIR, INK } from "./draw.ts";
import { hash, lerp, noise1 } from "./geom.ts";
import { PICTURE } from "./plate.ts";

const LAND = 0xa9b4b0;
/** The ground line the city's feet come down on, in frame pixels. */
export const GROUND_Y = 934;

/**
 * Draws the land for a city that has walked `travel` pixels. `strength` is 1
 * in transit and falls to 0 as a landing is inked over it.
 */
export function drawTransitLand(d: Draw, travel: number, t: number, strength: number): void {
  if (strength <= 0.01) return;
  const { x0, x1 } = PICTURE;
  const base = d.strength;

  // Clouds, engraved: a scalloped top and ruled lines beneath.
  d.strength = base * strength * 0.42;
  for (let k = 0; k < 5; k++) {
    const span = 2600;
    const cx = ((((k * 560 - travel * 0.03 - t * 4) % span) + span) % span) - 300;
    const cy = 150 + hash(k, 91) * 250;
    const w = 150 + hash(k, 92) * 160;
    const top: number[] = [];
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      top.push(
        cx - w + u * 2 * w,
        cy - Math.sin(u * Math.PI) * (30 + hash(k, i) * 22) - (i % 2) * 12,
      );
    }
    d.curve(top, FORM, 900 + k);
    for (let i = 0; i < 4; i++) {
      const inset = 18 + i * 26 + hash(k, i + 20) * 20;
      d.line(
        cx - w + inset,
        cy + 8 + i * 9,
        cx + w - inset * 1.4,
        cy + 8 + i * 9,
        HAIR,
        910 + k * 7 + i,
      );
    }
  }
  // Birds, far off.
  for (let k = 0; k < 4; k++) {
    const bx = ((((k * 510 + t * 22 - travel * 0.02) % 2200) + 2200) % 2200) - 100;
    const by = 250 + hash(k, 95) * 180 + Math.sin(t * 1.3 + k) * 8;
    const flap = Math.sin(t * 7 + k * 2) * 5;
    d.curve(
      [bx - 11, by - 3 + flap, bx - 4, by - 5, bx, by, bx + 4, by - 5, bx + 11, by - 3 + flap],
      FORM,
      930 + k,
    );
  }

  // The far ridge: one wash and its top line.
  const layer = (
    speed: number,
    yBase: number,
    rise: number,
    wave: number,
    seed: number,
    wash: number,
    alpha: number,
    ink: number,
  ): ((x: number) => number) => {
    const shift = travel * speed;
    const top = (x: number): number =>
      yBase -
      rise * (0.5 + 0.5 * noise1((x + shift) / wave, seed)) -
      rise * 0.35 * noise1((x + shift) / (wave * 0.31), seed + 1);
    const pts: number[] = [];
    const line: number[] = [];
    for (let x = x0 - 40; x <= x1 + 40; x += 36) {
      pts.push(x, top(x));
      line.push(x, top(x));
    }
    pts.push(x1 + 40, 1000, x0 - 40, 1000);
    d.strength = base * strength;
    d.fill(pts, d.ground, 1);
    d.wash(pts, wash, alpha);
    d.strength = base * strength * ink;
    d.curve(line, FORM, seed);
    return top;
  };

  const far = layer(0.1, 800, 150, 620, 41, LAND, 0.28, 0.4);
  // Hatching down the shade side of each far peak.
  d.strength = base * strength * 0.4;
  for (let x = x0; x < x1; x += 90) {
    const xr = x + 40;
    const y = far(xr);
    if (far(xr + 30) > y + 6)
      d.hatch([xr, y + 2, xr + 46, far(xr + 46) + 4, xr + 30, y + 60, xr - 4, y + 40], 1, INK, 0.9);
  }
  const mid = layer(0.32, 868, 70, 380, 43, LAND, 0.34, 0.5);
  // Woods and the odd tower on the middle hills.
  d.strength = base * strength * 0.5;
  const shiftMid = travel * 0.32;
  for (let k = Math.floor((x0 + shiftMid) / 130) - 1; k < (x1 + shiftMid) / 130 + 1; k++) {
    const x = k * 130 + hash(k, 44) * 90 - shiftMid;
    const y = mid(x) + 4;
    const kind = hash(k, 45);
    if (kind < 0.5) {
      const w = 26 + hash(k, 46) * 40;
      const h = 16 + hash(k, 47) * 16;
      d.curve(
        [
          x - w,
          y,
          x - w * 0.7,
          y - h * 0.8,
          x - w * 0.2,
          y - h * 1.2,
          x + w * 0.3,
          y - h,
          x + w * 0.8,
          y - h * 0.7,
          x + w,
          y,
        ],
        FORM,
        k + 200,
      );
      d.hatch([x, y - h, x + w * 0.8, y - h * 0.7, x + w, y, x + w * 0.2, y], 2, INK, 0.9);
    } else if (kind < 0.58) {
      d.path([x - 9, y, x - 7, y - 46, x + 7, y - 46, x + 9, y], FORM, k + 300);
      d.path([x - 11, y - 46, x, y - 62, x + 11, y - 46], FORM, k + 301, true);
    }
  }

  // The ground the city walks on: a pale band, a worn track, clumps and stones.
  const shiftNear = travel;
  d.strength = base * strength;
  const band = [x0 - 20, GROUND_Y - 34, x1 + 20, GROUND_Y - 34, x1 + 20, 1000, x0 - 20, 1000];
  d.fill(band, d.ground, 1);
  d.wash(band, 0xd9dcae, 0.4);
  d.strength = base * strength * 0.6;
  const edge: number[] = [];
  for (let x = x0 - 40; x <= x1 + 40; x += 60)
    edge.push(x, GROUND_Y - 34 + noise1((x + shiftNear) / 90, 51) * 4);
  d.curve(edge, FORM, 52);
  for (let k = Math.floor((x0 + shiftNear) / 64) - 1; k < (x1 + shiftNear) / 64 + 1; k++) {
    const x = k * 64 + hash(k, 53) * 50 - shiftNear;
    const y = GROUND_Y - 24 + hash(k, 54) * 70;
    const kind = hash(k, 55);
    if (kind < 0.55) {
      // A clump of grass: a few blades from one root.
      for (let b = 0; b < 4; b++) {
        const lean = (b - 1.5) * 5 + hash(k, b) * 4;
        d.curve(
          [
            x + b * 3,
            y,
            x + b * 3 + lean * 0.5,
            y - 8,
            x + b * 3 + lean,
            y - 13 - hash(k, b + 9) * 7,
          ],
          FORM,
          k * 5 + b,
        );
      }
    } else if (kind < 0.75) {
      const r = 5 + hash(k, 56) * 8;
      d.curve(
        [x - r, y, x - r * 0.6, y - r * 0.8, x + r * 0.5, y - r * 0.9, x + r, y],
        FORM,
        k + 400,
      );
      d.line(x - r, y, x + r, y, HAIR, k + 401);
    } else if (kind < 0.82) {
      d.line(x, y, x + 1, y - 30, FORM, k + 500);
      d.path([x - 14, y - 30, x + 12, y - 28, x + 12, y - 20, x - 14, y - 21], FORM, k + 501, true);
    }
  }
  // Ruts where others have gone before.
  d.strength = base * strength * 0.35;
  for (const dy of [14, 40]) {
    const rut: number[] = [];
    for (let x = x0 - 40; x <= x1 + 40; x += 50)
      rut.push(x, GROUND_Y + dy + noise1((x + shiftNear) / 240, 57 + dy) * 5);
    d.curve(rut, HAIR, 58 + dy);
  }
  d.strength = base;
}

/** Tufts that pass in front of the feet, faster than the ground: the nearest layer. */
export function drawForeground(d: Draw, travel: number, strength: number): void {
  if (strength <= 0.01) return;
  const { x0, x1 } = PICTURE;
  const base = d.strength;
  d.strength = base * strength;
  const shift = travel * 1.7;
  for (let k = Math.floor((x0 + shift) / 210) - 1; k < (x1 + shift) / 210 + 1; k++) {
    const x = k * 210 + hash(k, 61) * 150 - shift;
    const y = PICTURE.y1 + 6;
    const blades = 6 + Math.floor(hash(k, 62) * 4);
    for (let b = 0; b < blades; b++) {
      const lean = (b - blades / 2) * 9 + hash(k, b + 3) * 8;
      const h = lerp(26, 58, hash(k, b + 30));
      d.curve(
        [x + b * 6, y, x + b * 6 + lean * 0.4, y - h * 0.6, x + b * 6 + lean, y - h],
        b % 2 ? FORM : 3,
        k * 11 + b,
      );
    }
  }
  d.strength = base;
}
