// The plain view: the city's ground as flat tiles, the citizens as dots, and a
// line along the top with the beat the cycle is in and the time to the next.
// It is a stand-in until slice piece 2b draws the deck and the landing in the
// look target's renderer (#362), and draws only what the world holds.
import {
  ADVENTURER,
  type Atlas,
  type Beat,
  type BeatSpan,
  beat,
  stepTicks,
  TERRAINS,
  type Terrain,
  TICKS_PER_SECOND,
  type World,
} from "@idlin/sim";

export const WIDTH = 1920;
export const HEIGHT = 1080;
/** The line along the top, and the margin round the ground. */
const HEAD = 72;
const MARGIN = 24;

const GROUND: Readonly<Record<Terrain, string>> = {
  grass: "#8fa66a",
  path: "#c4b48a",
  camp: "#b9a27a",
  shore: "#d2c497",
  deep_grass: "#6f8a4f",
  den: "#6b5a44",
  bridge: "#9c7a4e",
  tree: "#3f5a33",
  dark_tree: "#2c4026",
  water: "#4f7891",
  rock: "#6e6a64",
  lantern: "#b9a27a",
  campfire: "#b9a27a",
  bank: "#b9a27a",
  tent: "#b9a27a",
  deck: "#a6845a",
  hatch: "#5e4630",
  ramp: "#8a6a44",
  hull: "#4a3a2a",
};

/** How each beat is written in the line along the top. */
export const BEAT_NAMES: Readonly<Record<Beat, string>> = {
  transit: "transit",
  raid: "raiders sighted",
  legs: "legs plant",
  peace: "peace",
  scouts: "scouts",
  sighting: "the front",
  march: "the march",
  siege: "the siege",
  break: "the break",
};

/** Where the ground goes in the frame: pixels a tile, and where its top-left tile is drawn. */
export interface Layout {
  readonly tile: number;
  readonly left: number;
  readonly top: number;
}

/** The ground, as big as fits under the line along the top, centred. */
export function layoutOf(atlas: Atlas, width = WIDTH, height = HEIGHT): Layout {
  const room = { w: width - 2 * MARGIN, h: height - HEAD - MARGIN };
  const tile = Math.max(1, Math.floor(Math.min(room.w / atlas.width, room.h / atlas.height)));
  return {
    tile,
    left: Math.floor((width - tile * atlas.width) / 2),
    top: HEAD + Math.floor((room.h - tile * atlas.height) / 2),
  };
}

/** Ticks as m:ss. */
export const clock = (ticks: number): string => {
  const seconds = Math.max(0, Math.ceil(ticks / TICKS_PER_SECOND));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/**
 * The line along the top: the cycle, its beat and the time to the next one.
 * The siege has no clock: until the shield is built (slice piece 31) its end
 * is a stand-in, and nothing on screen counts to it.
 */
export function headline(world: World, span: BeatSpan | null = beat(world)): string {
  const { cycle } = world;
  if (!cycle || !span) return `tick ${world.tick}`;
  const name = BEAT_NAMES[span.beat];
  const left = span.beat === "siege" ? "" : `   ${clock(span.to - world.tick)}`;
  const { size, biome, level } = cycle.landing;
  const citizens = world.actors.filter((a) => a.kind === ADVENTURER).length;
  return `cycle ${cycle.count}   ${name}${left}   ${size} ${biome.replace("_", " ")}, level ${level}   ${citizens} citizens`;
}

/** Where `actor` is drawn, in tiles, `fraction` of a tick after the world's tick. */
function placeOf(world: World, actor: World["actors"][number], fraction: number) {
  if (actor.moveTicksLeft <= 0) return { x: actor.x, y: actor.y };
  const length = stepTicks(world, actor);
  const done = Math.min(1, (length - actor.moveTicksLeft + fraction) / length);
  return {
    x: actor.fromX + (actor.x - actor.fromX) * done,
    y: actor.fromY + (actor.y - actor.fromY) * done,
  };
}

export class PlainView {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** A line shown in place of the headline, such as "waiting for the world". */
  notice = "";

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    parent.append(this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("no 2D canvas");
    this.ctx = ctx;
  }

  /** Draws `world`, `fraction` of a tick on from its tick; with no world, the empty frame and the notice. */
  draw(world: World | null, fraction = 0): void {
    const { ctx } = this;
    ctx.fillStyle = "#14110f";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "#efe4cb";
    ctx.font = "34px Fell, serif";
    ctx.textBaseline = "middle";
    ctx.fillText(this.notice || (world ? headline(world) : ""), MARGIN, HEAD / 2);
    if (!world) return;
    const { atlas } = world;
    const { tile, left, top } = layoutOf(atlas);
    for (let y = 0; y < atlas.height; y++)
      for (let x = 0; x < atlas.width; x++) {
        const terrain = TERRAINS[atlas.terrain[y * atlas.width + x] as number] as Terrain;
        ctx.fillStyle = GROUND[terrain];
        ctx.fillRect(left + x * tile, top + y * tile, tile, tile);
      }
    const citizens = world.actors.filter((a) => a.kind === ADVENTURER);
    const named = citizens.length <= 30 && tile >= 12;
    ctx.font = `${Math.max(12, Math.min(22, tile * 0.5))}px Fell, serif`;
    ctx.textBaseline = "bottom";
    for (const actor of world.actors) {
      const at = placeOf(world, actor, fraction);
      const cx = left + (at.x - atlas.left + 0.5) * tile;
      const cy = top + (at.y - atlas.top + 0.5) * tile;
      ctx.fillStyle = actor.kind === ADVENTURER ? "#f4efe2" : "#b8322a";
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2, tile * 0.3), 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = "#1c1612";
      ctx.lineWidth = Math.max(1, tile * 0.06);
      ctx.stroke();
      if (named && actor.kind === ADVENTURER) {
        ctx.fillStyle = "#1c1612";
        ctx.fillText(actor.name, cx - ctx.measureText(actor.name).width / 2, cy - tile * 0.35);
      }
    }
  }

  /** Mean brightness, 0 to 255, of each block of 40 by 40 pixels, row by row. */
  brightness(): number[] {
    const { data } = this.ctx.getImageData(0, 0, WIDTH, HEIGHT);
    const block = 40;
    const out: number[] = [];
    for (let by = 0; by < HEIGHT; by += block)
      for (let bx = 0; bx < WIDTH; bx += block) {
        let sum = 0;
        let n = 0;
        for (let y = by; y < Math.min(HEIGHT, by + block); y += 4)
          for (let x = bx; x < Math.min(WIDTH, bx + block); x += 4) {
            const i = (y * WIDTH + x) * 4;
            sum +=
              0.299 * (data[i] as number) +
              0.587 * (data[i + 1] as number) +
              0.114 * (data[i + 2] as number);
            n++;
          }
        out.push(sum / n);
      }
    return out;
  }

  /** The frame scaled by `scale`, as RGBA bytes. */
  pixels(scale: number): { width: number; height: number; data: Uint8ClampedArray } {
    const width = Math.max(1, Math.round(WIDTH * scale));
    const height = Math.max(1, Math.round(HEIGHT * scale));
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const ctx = out.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(this.canvas, 0, 0, width, height);
    return { width, height, data: ctx.getImageData(0, 0, width, height).data };
  }
}
