// The sheet the plate is drawn on: cream laid paper with blotches, fibres, a
// little foxing and edges that have aged. Made once, in fibres and blotches at
// least six pixels across, with no per-pixel speckle (docs/art.md, section 2).

import { rng } from "./geom.ts";
import { HEIGHT, WIDTH } from "./surface.ts";

export function makePaper(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context for the paper");
  const random = rng(4242);
  ctx.fillStyle = "#f1e6cd";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Uneven tone: large, faint, hard-edged patches, as size soaks into a sheet.
  for (let i = 0; i < 90; i++) {
    const dark = random() < 0.55;
    ctx.fillStyle = dark ? "rgba(196,170,120,0.035)" : "rgba(255,250,232,0.07)";
    ctx.beginPath();
    const x = random() * WIDTH;
    const y = random() * HEIGHT;
    const r = 60 + random() * 260;
    const points = 9;
    for (let k = 0; k <= points; k++) {
      const angle = (k / points) * Math.PI * 2;
      const reach = r * (0.6 + random() * 0.6);
      const px = x + Math.cos(angle) * reach * 1.5;
      const py = y + Math.sin(angle) * reach * 0.8;
      if (k === 0) ctx.moveTo(px, py);
      else
        ctx.quadraticCurveTo(
          px + (random() - 0.5) * r * 0.5,
          py + (random() - 0.5) * r * 0.5,
          px,
          py,
        );
    }
    ctx.fill();
  }

  // Laid lines: the faint ribs of the mould the sheet was made on.
  ctx.strokeStyle = "rgba(170,146,104,0.05)";
  ctx.lineWidth = 2;
  for (let x = 14; x < WIDTH; x += 27) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 3, HEIGHT);
    ctx.stroke();
  }

  // Fibres.
  ctx.lineCap = "round";
  for (let i = 0; i < 2600; i++) {
    const x = random() * WIDTH;
    const y = random() * HEIGHT;
    const length = 8 + random() * 26;
    const angle = random() * Math.PI;
    const bend = (random() - 0.5) * 10;
    const light = random() < 0.4;
    ctx.strokeStyle = light
      ? `rgba(255,251,236,${0.2 + random() * 0.25})`
      : `rgba(150,122,82,${0.05 + random() * 0.09})`;
    ctx.lineWidth = 1 + random() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + (Math.cos(angle) * length) / 2 - Math.sin(angle) * bend,
      y + (Math.sin(angle) * length) / 2 + Math.cos(angle) * bend,
      x + Math.cos(angle) * length,
      y + Math.sin(angle) * length,
    );
    ctx.stroke();
  }

  // Foxing: brown spots, mostly toward the edges.
  for (let i = 0; i < 70; i++) {
    const edge = random() < 0.75;
    const x = edge ? (random() < 0.5 ? random() * 220 : WIDTH - random() * 220) : random() * WIDTH;
    const y =
      edge && random() < 0.5
        ? random() < 0.5
          ? random() * 160
          : HEIGHT - random() * 160
        : random() * HEIGHT;
    const r = 3 + random() * 8;
    ctx.fillStyle = `rgba(150,96,50,${0.04 + random() * 0.07})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.6 + random() * 0.5), random() * 3, 0, Math.PI * 2);
    ctx.fill();
    if (random() < 0.4) {
      ctx.fillStyle = "rgba(130,80,40,0.08)";
      ctx.beginPath();
      ctx.arc(x + 1, y, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The edges have browned with handling, in a few steps, deepest at the corners.
  const steps: [number, number][] = [
    [150, 0.035],
    [90, 0.04],
    [46, 0.05],
    [18, 0.06],
  ];
  for (const [inset, alpha] of steps) {
    ctx.fillStyle = `rgba(140,100,52,${alpha})`;
    ctx.beginPath();
    ctx.rect(0, 0, WIDTH, HEIGHT);
    const wobble = (): number => (random() - 0.5) * inset * 0.5;
    ctx.moveTo(inset + wobble(), inset + wobble());
    for (let y = inset; y < HEIGHT - inset; y += 120) ctx.lineTo(inset + wobble(), y);
    ctx.lineTo(inset + wobble(), HEIGHT - inset + wobble());
    for (let x = inset; x < WIDTH - inset; x += 120) ctx.lineTo(x, HEIGHT - inset + wobble());
    ctx.lineTo(WIDTH - inset + wobble(), HEIGHT - inset + wobble());
    for (let y = HEIGHT - inset; y > inset; y -= 120) ctx.lineTo(WIDTH - inset + wobble(), y);
    ctx.lineTo(WIDTH - inset + wobble(), inset + wobble());
    for (let x = WIDTH - inset; x > inset; x -= 120) ctx.lineTo(x, inset + wobble());
    ctx.closePath();
    ctx.fill("evenodd");
  }
  return canvas;
}
