// Everything that is text: the side panel, the ticker, the name tags. Plain DOM,
// so the pixel font stays crisp at whole-number sizes.

import { clock, type World } from "@idlin/sim";
import { ADVENTURERS, type Cell, SHEET_COLUMNS, TILE } from "./atlas.ts";
import { phaseName } from "./light.ts";
import type { Tag } from "./scene.ts";
import { placeTags } from "./tags.ts";

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

/** Writes text only when it changes, so an unchanged frame costs the page nothing. */
const setText = (node: HTMLElement, text: string): void => {
  if (node.textContent !== text) node.textContent = text;
};

function portrait(cell: Cell): HTMLElement {
  const node = el("span", `portrait sheet-${cell.sheet}`);
  const x = (cell.index % SHEET_COLUMNS) * TILE * 3;
  const y = Math.floor(cell.index / SHEET_COLUMNS) * TILE * 3;
  node.style.backgroundPosition = `-${x}px -${y}px`;
  return node;
}

export interface Hud {
  update(world: World, tags: readonly Tag[]): void;
}

/** `bounds` is the size of the world view in frame pixels; name tags stay inside it. */
export function createHud(
  panel: HTMLElement,
  ticker: HTMLElement,
  tagLayer: HTMLElement,
  bounds: { readonly width: number; readonly height: number },
): Hud {
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

  const rows = new Map<number, { item: HTMLElement; doing: HTMLElement }>();
  const tagNodes = new Map<number, { node: HTMLElement; width: number; transform: string }>();
  const tagSpots = new Map<number, number>();

  return {
    update(world, tags) {
      const { day, hour, minute } = clock(world);
      const name = phaseName(hour + minute / 60);
      setText(time, `${two(hour)}:${two(minute)}`);
      setText(phase, `Day ${day + 1} · ${name}`);
      // The mark travels left to right across the dial once a day; noon is the middle.
      sun.style.left = `${(((hour + minute / 60 + 18) % 24) / 24) * 100}%`;
      dial.dataset.phase = name.toLowerCase();
      setText(line, `Day ${day + 1} · ${name} over Idlin`);

      const present = new Set<number>();
      for (const actor of world.actors) {
        present.add(actor.id);
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
          row = { item, doing };
          rows.set(actor.id, row);
        }
        setText(
          row.doing,
          actor.moveTicksLeft > 0 || actor.path.length > 0 ? "walking" : "resting",
        );
      }

      // A tag's width never changes, so it is measured once, when the tag is made.
      for (const tag of tags) {
        if (tagNodes.has(tag.id)) continue;
        const node = el("span", "tag", tag.name);
        tagLayer.append(node);
        tagNodes.set(tag.id, { node, width: node.offsetWidth, transform: "" });
      }
      const wishes = tags.map((tag) => ({
        id: tag.id,
        x: tag.x,
        y: tag.y,
        width: tagNodes.get(tag.id)?.width ?? 0,
      }));
      for (const [id, { box, spot }] of placeTags(wishes, tagSpots, bounds)) {
        tagSpots.set(id, spot);
        const entry = tagNodes.get(id);
        const transform = `translate(${box.left}px, ${box.top}px)`;
        if (entry && entry.transform !== transform) {
          entry.node.style.transform = transform;
          entry.transform = transform;
        }
      }

      // Whoever has left the world leaves the page too.
      for (const [id, row] of rows) {
        if (present.has(id)) continue;
        row.item.remove();
        rows.delete(id);
        tagNodes.get(id)?.node.remove();
        tagNodes.delete(id);
        tagSpots.delete(id);
      }
    },
  };
}
