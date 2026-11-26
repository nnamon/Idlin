// Everything that is text: the side panel, the ticker, the name tags. Plain DOM,
// so the pixel font stays crisp at whole-number sizes.

import { clock, type World } from "@idlin/sim";
import { ADVENTURERS, type Cell, SHEET_COLUMNS, TILE } from "./atlas.ts";
import { phaseName } from "./light.ts";
import type { Tag } from "./scene.ts";

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = "",
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
};

const two = (n: number): string => String(n).padStart(2, "0");

function portrait(cell: Cell): HTMLElement {
  const node = el("span", `portrait sheet-${cell.sheet}`);
  const x = (cell.index % SHEET_COLUMNS) * TILE * 3;
  const y = Math.floor(cell.index / SHEET_COLUMNS) * TILE * 3;
  node.style.backgroundPosition = `-${x}px -${y}px`;
  return node;
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
const overlaps = (a: Box, b: Box): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const WORLD_WIDTH = 1440;
const TAG_HEIGHT = 28;
/** Where a tag may sit, as the height of its bottom edge above the head: just above, below the feet, higher up. */
const TAG_RISES = [0, 94, -32, -64];

export interface Hud {
  update(world: World, tags: readonly Tag[]): void;
}

export function createHud(panel: HTMLElement, ticker: HTMLElement, tagLayer: HTMLElement): Hud {
  const title = el("h1", "title", "IDLIN");
  const time = el("div", "clock");
  const phase = el("div", "phase");
  const dial = el("div", "dial");
  const sun = el("span", "dial-mark");
  dial.append(sun);
  const heading = el("h2", "heading", "Adventurers");
  const roster = el("ul", "roster");
  panel.append(title, dial, time, phase, heading, roster);
  const line = el("span", "ticker-line");
  ticker.append(line);

  const rows = new Map<number, { doing: HTMLElement }>();
  const tagNodes = new Map<number, HTMLElement>();

  return {
    update(world, tags) {
      const { day, hour, minute } = clock(world);
      const name = phaseName(hour + minute / 60);
      time.textContent = `${two(hour)}:${two(minute)}`;
      phase.textContent = `Day ${day + 1} · ${name}`;
      // The mark travels left to right across the dial once a day; noon is the middle.
      sun.style.left = `${(((hour + minute / 60 + 18) % 24) / 24) * 100}%`;
      dial.dataset.phase = name.toLowerCase();
      line.textContent = `Day ${day + 1} · ${name} over Idlin`;

      for (const actor of world.actors) {
        let row = rows.get(actor.id);
        if (!row) {
          const item = el("li", "roster-row");
          const doing = el("span", "roster-doing");
          item.append(
            portrait(ADVENTURERS[(actor.id - 1) % ADVENTURERS.length] as Cell),
            el("span", "roster-name", actor.name),
            doing,
          );
          roster.append(item);
          row = { doing };
          rows.set(actor.id, row);
        }
        row.doing.textContent =
          actor.moveTicksLeft > 0 || actor.path.length > 0 ? "walking" : "resting";
      }

      // Name tags never cover a character or each other: each takes the first free
      // spot among a few around its own character.
      const bodies = tags.map((tag) => ({
        left: tag.x - 24,
        right: tag.x + 24,
        top: tag.y + 6,
        bottom: tag.y + 60,
      }));
      const placed: Box[] = [];
      tags.forEach((tag, index) => {
        let node = tagNodes.get(tag.id);
        if (!node) {
          node = el("span", "tag", tag.name);
          tagLayer.append(node);
          tagNodes.set(tag.id, node);
        }
        const width = node.offsetWidth;
        const left = Math.max(2, Math.min(WORLD_WIDTH - width - 2, Math.round(tag.x - width / 2)));
        const spot = (rise: number): Box => {
          const bottom = Math.round(tag.y) + rise;
          return { left, right: left + width, top: bottom - TAG_HEIGHT, bottom };
        };
        const free = (box: Box): boolean =>
          box.top >= 0 &&
          !placed.some((other) => overlaps(box, other)) &&
          !bodies.some((body, k) => k !== index && overlaps(box, body));
        const box = TAG_RISES.map(spot).find(free) ?? spot(0);
        placed.push(box);
        node.style.transform = `translate(${box.left}px, ${box.top}px)`;
      });
    },
  };
}
