// Draws the frame: the map, the page beside it and the line beneath it, all on
// one canvas. Everything is drawn twice, once in day ink and once in night ink.
// The two are never blended evenly, which would leave neither readable: night
// arrives as an edge that closes in on the lantern, day as one that crosses
// from the east, and at night every lamp is a window onto the day drawing.
// Everything that moves is a function of sim time, so the same time gives the
// same frame.

import {
  type Actor,
  clock,
  START_HOUR,
  TICKS_PER_GAME_HOUR,
  type TileMap,
  type World,
} from "@idlin/sim";
import { drawFigure } from "./figure.ts";
import { drawGround, type Ground, type MapLabel, TILE } from "./ground.ts";
import { css, dayAt, dayRegion, EDGE, lampAt, lampStrength, phaseName, skyCast } from "./light.ts";
import { cloakColor, DAY, NIGHT, type Palette } from "./palette.ts";
import { type Ctx, newCanvas } from "./pen.ts";
import { actorPose, type Pose } from "./pose.ts";
import { placeTags, TAG_HEIGHT } from "./tags.ts";

export const FRAME_WIDTH = 1920;
export const FRAME_HEIGHT = 1080;
const FIGURE_SCALE = 1.3;
const TAG_FONT = '25px "Fell SC"';
const FONTS = ['22px "Fell"', '22px "Fell Italic"', TAG_FONT];
/** How long a line of news stays up at least, in ticks, so the line can be read. */
const NEWS_TICKS = 40;
/** How far each kind of light reaches, in tiles. */
const LANTERN_REACH = 5.4;
const FIRE_REACH = 3;
const CARRIED_REACH = 1.75;
/** How many residents the page lists by name. */
const ROSTER_ROWS = 6;
const STANDING: Pose = {
  x: 0,
  y: 0,
  hop: 0,
  stride: 0.5,
  breath: 0,
  moving: false,
  resting: false,
};

interface Walker {
  readonly actor: Actor;
  readonly pose: Pose;
  readonly x: number;
  readonly y: number;
}

interface Side {
  readonly palette: Palette;
  readonly ground: Ground;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: Ctx;
}

const two = (n: number): string => String(n).padStart(2, "0");

export class Scene {
  /** The map's size in frame pixels; the page and the news line take the rest of the frame. */
  readonly width: number;
  readonly height: number;
  private readonly out: Ctx;
  private readonly day: Side;
  private readonly night: Side;
  private readonly lit: { canvas: HTMLCanvasElement; ctx: Ctx };
  private readonly facing = new Map<number, 1 | -1>();
  private readonly tagSpots = new Map<number, number>();
  private readonly tagWidths = new Map<string, number>();
  /** Where the dark closes in to at dusk: the first lantern, or the middle of the map. */
  private readonly hearth: readonly [number, number];
  private readonly labels: readonly MapLabel[];
  private news = "";
  private newsSince = Number.NEGATIVE_INFINITY;
  private readonly lastRule = new Map<number, number>();

  private constructor(host: HTMLElement, map: TileMap, labels: readonly MapLabel[]) {
    this.width = map.width * TILE;
    this.height = map.height * TILE;
    const { canvas, ctx } = newCanvas(FRAME_WIDTH, FRAME_HEIGHT);
    host.appendChild(canvas);
    this.out = ctx;
    const side = (palette: Palette): Side => ({
      palette,
      ground: drawGround(map, palette),
      ...newCanvas(FRAME_WIDTH, FRAME_HEIGHT),
    });
    this.day = side(DAY);
    this.night = side(NIGHT);
    this.lit = newCanvas(FRAME_WIDTH, FRAME_HEIGHT);
    this.labels = labels;
    const lantern = this.day.ground.lanterns[0];
    this.hearth = lantern ? [lantern[0], lantern[1] + 28] : [this.width / 2, this.height / 2];
  }

  static async create(
    host: HTMLElement,
    map: TileMap,
    labels: readonly MapLabel[],
  ): Promise<Scene> {
    // The lettering on the map is drawn once, so the typefaces have to be there first.
    await Promise.all(FONTS.map((font) => document.fonts.load(font)));
    return new Scene(host, map, labels);
  }

  /** Draws the world as it is at `time` ticks (the world's tick plus a fraction of the next). */
  draw(world: World, time: number): void {
    const hour = (((time / TICKS_PER_GAME_HOUR + START_HOUR) % 24) + 24) % 24;
    const lamps = lampStrength(hour);
    const fraction = time - world.tick;
    const [hx, hy] = this.hearth;
    const reach = Math.max(
      Math.hypot(hx, hy),
      Math.hypot(FRAME_WIDTH - hx, hy),
      Math.hypot(hx, FRAME_HEIGHT - hy),
      Math.hypot(FRAME_WIDTH - hx, FRAME_HEIGHT - hy),
    );
    const region = dayRegion(hour, reach);

    const walkers: Walker[] = world.actors.map((actor) => {
      const pose = actorPose(actor, fraction, time);
      return { actor, pose, x: pose.x * TILE, y: pose.y * TILE - 4 };
    });
    walkers.sort((a, b) => a.y - b.y || a.actor.id - b.actor.id);

    // Every light there is, as a place, a reach in pixels and a strength.
    const lights: { x: number; y: number; reach: number; strength: number }[] = [];
    if (lamps > 0) {
      for (const [x, y] of this.day.ground.lanterns) {
        lights.push({ x, y: y + 28, reach: LANTERN_REACH * TILE, strength: lamps });
      }
      for (const [x, y] of this.day.ground.fires) {
        // A fire's light breathes slowly; it never jumps.
        const breath = 1 + Math.sin(time * 0.21) * 0.02 + Math.sin(time * 0.57 + 1) * 0.012;
        lights.push({ x, y, reach: FIRE_REACH * TILE * breath, strength: lamps * 0.95 });
      }
      for (const walker of walkers) {
        lights.push({
          x: walker.x,
          y: walker.y - 22,
          reach: CARRIED_REACH * TILE,
          strength: lamps * 0.85,
        });
      }
    }
    /** How much of the day drawing shows at a point, 0 to 1: the same sum the picture is built from. */
    const litAt = (x: number, y: number): number => {
      let dark = 1 - dayAt(region, Math.hypot(x - hx, y - hy));
      for (const light of lights)
        dark *= 1 - lampAt(Math.hypot(x - light.x, y - light.y), light.reach, light.strength);
      return 1 - dark;
    };

    const out = this.out;
    if (region.kind !== "all") this.drawSide(this.night, world, walkers, time);
    // In full night the day drawing only shows inside the lamps' reach, so only that much of it is drawn.
    if (region.kind !== "none" || lamps > 0) {
      this.drawSide(this.day, world, walkers, time, region.kind === "none" ? lights : null);
    }
    out.drawImage(region.kind === "all" ? this.day.canvas : this.night.canvas, 0, 0);

    if (region.kind !== "all") {
      // Build, in white, the shape of everything that is lit: what daylight is
      // left, and the reach of each lamp. Then show the day drawing through it.
      const lit = this.lit.ctx;
      lit.globalCompositeOperation = "source-over";
      lit.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
      if (region.kind === "circle" && region.radius + EDGE > 0) {
        const inner = Math.max(0, region.radius);
        const gradient = lit.createRadialGradient(hx, hy, inner, hx, hy, region.radius + EDGE);
        gradient.addColorStop(0, "rgba(255,255,255,1)");
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        lit.fillStyle = gradient;
        lit.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
      }
      for (const light of lights) {
        const gradient = lit.createRadialGradient(
          light.x,
          light.y,
          light.reach * 0.12,
          light.x,
          light.y,
          light.reach,
        );
        gradient.addColorStop(0, `rgba(255,255,255,${light.strength})`);
        gradient.addColorStop(0.55, `rgba(255,255,255,${light.strength * 0.55})`);
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        lit.fillStyle = gradient;
        lit.beginPath();
        lit.arc(light.x, light.y, light.reach, 0, 7);
        lit.fill();
      }
      lit.globalCompositeOperation = "source-in";
      lit.drawImage(this.day.canvas, 0, 0);
      out.drawImage(this.lit.canvas, 0, 0);
    }

    // Lamplight is warm: a thin amber laid where each lamp falls, by day as well
    // while the lamps are coming on or going out, so that they never switch.
    if (lights.length > 0) {
      out.globalCompositeOperation = "soft-light";
      for (const light of lights) {
        const gradient = out.createRadialGradient(
          light.x,
          light.y,
          0,
          light.x,
          light.y,
          light.reach,
        );
        gradient.addColorStop(0, `rgba(255,160,60,${0.24 * light.strength})`);
        gradient.addColorStop(1, "rgba(255,160,60,0)");
        out.fillStyle = gradient;
        out.beginPath();
        out.arc(light.x, light.y, light.reach, 0, 7);
        out.fill();
      }
      out.globalCompositeOperation = "source-over";
    }

    const cast = skyCast(hour);
    if (cast.alpha > 0) {
      out.fillStyle = css(cast.color, cast.alpha);
      out.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    }

    // Lettering goes on last, each piece wholly in day ink or wholly in night
    // ink according to the light where it sits, so it never fades into a halo.
    const inkFor = (x: number, y: number): Palette => (litAt(x, y) > 0.5 ? DAY : NIGHT);
    out.textAlign = "center";
    out.lineJoin = "round";
    for (const label of this.labels) {
      const [font, size, spacing] =
        label.style === "region"
          ? ["Fell Italic", 30, 2]
          : label.style === "town"
            ? ["Fell SC", 24, 3]
            : ["Fell Italic", 22, 0];
      const x = label.x * TILE;
      const y = label.y * TILE;
      const palette = inkFor(x, y - 8);
      out.font = `${size}px "${font}"`;
      out.letterSpacing = `${spacing}px`;
      out.lineWidth = 4;
      out.strokeStyle = css(palette.paper, 0.7);
      out.fillStyle = css(palette.ink, 0.8);
      out.strokeText(label.text, x, y);
      out.fillText(label.text, x, y);
    }
    out.letterSpacing = "0px";
    out.font = TAG_FONT;
    for (const tag of this.placeNames(walkers)) {
      // A name sits on a small slip of paper, so it reads over trees, water and other ink.
      const palette = inkFor(tag.x, tag.y - 8);
      out.fillStyle = css(palette.paper, 0.9);
      out.beginPath();
      out.roundRect(tag.x - tag.width / 2, tag.y - 19, tag.width, TAG_HEIGHT - 3, 4);
      out.fill();
      out.fillStyle = css(palette.ink);
      out.fillText(tag.name, tag.x, tag.y);
    }
  }

  /**
   * Takes note of the world after a tick: which way each actor now faces, and
   * anything worth a line of news. Call it after every `step`, drawn or not, so
   * that what a frame shows depends on the world's history and not on which
   * frames happened to be drawn.
   */
  observe(world: World): void {
    const alive = new Set<number>();
    for (const actor of world.actors) {
      alive.add(actor.id);
      if (actor.x !== actor.fromX) this.facing.set(actor.id, actor.x > actor.fromX ? 1 : -1);
      const before = this.lastRule.get(actor.id);
      this.lastRule.set(actor.id, actor.rule);
      // A line stays up long enough to be read before the next one replaces it.
      if (before === undefined || before === actor.rule || world.tick - this.newsSince < NEWS_TICKS)
        continue;
      const label = world.programs[actor.program]?.rules[actor.rule];
      if (!label || label === "otherwise") continue;
      this.news = `${actor.name}: ${label}`;
      this.newsSince = world.tick;
    }
    for (const known of [this.facing, this.tagSpots, this.lastRule]) {
      for (const id of known.keys()) if (!alive.has(id)) known.delete(id);
    }
  }

  /**
   * Forgets where names were placed in earlier frames. Names normally keep
   * their spot from frame to frame so they don't hop about; a capture calls
   * this so that a frame depends only on the world.
   */
  forgetNameSpots(): void {
    this.tagSpots.clear();
  }

  /** Works out where each name goes, so that no name covers a figure or another name. */
  private placeNames(
    walkers: readonly Walker[],
  ): { name: string; x: number; y: number; width: number }[] {
    const measure = this.out;
    measure.font = TAG_FONT;
    const wishes = walkers.map((walker) => {
      let width = this.tagWidths.get(walker.actor.name);
      if (width === undefined) {
        width = Math.ceil(measure.measureText(walker.actor.name).width) + 12;
        this.tagWidths.set(walker.actor.name, width);
      }
      // The line just above the hood.
      const top = walker.y - (walker.pose.resting ? 39 : 46) * FIGURE_SCALE - walker.pose.hop * 3;
      return { id: walker.actor.id, x: walker.x, y: top, width };
    });
    const placed = placeTags(wishes, this.tagSpots, { width: this.width, height: this.height });
    return walkers.map((walker) => {
      const spot = placed.get(walker.actor.id);
      this.tagSpots.set(walker.actor.id, spot?.spot ?? 0);
      const box = spot?.box ?? { left: walker.x, right: walker.x, top: walker.y, bottom: walker.y };
      return {
        name: walker.actor.name,
        x: (box.left + box.right) / 2,
        y: box.top + TAG_HEIGHT - 7,
        width: box.right - box.left,
      };
    });
  }

  /** Draws the whole frame in one palette onto that palette's sheet. */
  private drawSide(
    side: Side,
    world: World,
    walkers: readonly Walker[],
    time: number,
    only: readonly { x: number; y: number; reach: number }[] | null = null,
  ): void {
    const { ctx, ground, palette } = side;
    const ink = css(palette.ink);
    const paper = css(palette.paper);
    ctx.save();
    if (only) {
      ctx.beginPath();
      for (const spot of only) {
        ctx.moveTo(spot.x + spot.reach + 2, spot.y);
        ctx.arc(spot.x, spot.y, spot.reach + 2, 0, 7);
      }
      ctx.clip();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    ctx.drawImage(ground.base, 0, 0);

    // Water moving: short strokes that drift downstream and fade in and out.
    ctx.strokeStyle = ink;
    ctx.lineCap = "round";
    ctx.lineWidth = 1.2;
    ground.ripples.forEach(([x, y], i) => {
      const phase = (((time * 0.012 + i * 0.37) % 1) + 1) % 1;
      const alpha = Math.sin(Math.PI * phase) * 0.55;
      if (alpha <= 0.05 || i % 2 === 1) return;
      const sx = x + (i % 3) * 3;
      const sy = y + phase * 14;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(sx + 6, sy + 3, sx + 12, sy);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // Standing things and walkers together, farthest first, so each overlaps what is behind it.
    let next = 0;
    const standing = ground.standing;
    const fires = [...ground.fires].sort((a, b) => a[1] - b[1]);
    let fire = 0;
    const upTo = (base: number): void => {
      while (next < standing.length && (standing[next] as (typeof standing)[number]).base <= base) {
        const thing = standing[next++] as (typeof standing)[number];
        ctx.drawImage(thing.canvas, thing.x, thing.y);
        while (fire < fires.length && (fires[fire] as (typeof fires)[number])[1] <= thing.base) {
          this.flame(ctx, fires[fire++] as readonly [number, number], palette, time);
        }
      }
    };
    const style = (id: number, scale: number) => ({
      cloak: cloakColor(id),
      ink,
      paper,
      facing: this.facing.get(id) ?? (1 as const),
      kit: id % 3,
      scale,
    });
    for (const walker of walkers) {
      upTo(walker.y);
      drawFigure(
        ctx,
        walker.x,
        walker.y,
        walker.pose,
        style(walker.actor.id, FIGURE_SCALE),
        time + walker.actor.id * 13,
      );
    }
    upTo(Number.POSITIVE_INFINITY);

    // A ruled double border, as round a printed map.
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3;
    ctx.strokeRect(6.5, 6.5, this.width - 13, this.height - 13);
    ctx.lineWidth = 1;
    ctx.strokeRect(13.5, 13.5, this.width - 27, this.height - 27);

    this.page(ctx, world, palette, style);
    ctx.restore();
  }

  /** The page beside the map and the line beneath it. */
  private page(
    ctx: Ctx,
    world: World,
    palette: Palette,
    style: (id: number, scale: number) => Parameters<typeof drawFigure>[4],
  ): void {
    const ink = css(palette.ink);
    const left = this.width + 50;
    const right = FRAME_WIDTH - 40;
    const { day, hour, minute } = clock(world);
    const part = phaseName(hour + minute / 60);
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    ctx.textAlign = "left";

    ctx.font = '76px "Fell SC"';
    ctx.fillText("Idlin", left, 100);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, 124);
    ctx.lineTo(right, 124);
    ctx.stroke();
    ctx.font = '72px "Fell"';
    ctx.fillText(`${two(hour)}:${two(minute)}`, left, 208);
    ctx.font = '30px "Fell Italic"';
    ctx.fillText(`Day ${day + 1}, ${part}`, left + 2, 252);

    const listed = world.actors.slice(0, ROSTER_ROWS);
    listed.forEach((actor, row) => {
      const top = 294 + row * 105;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, top + 0.5);
      ctx.lineTo(right, top + 0.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
      drawFigure(ctx, left + 34, top + 92, STANDING, { ...style(actor.id, 1.5), facing: 1 }, 0);
      ctx.fillStyle = ink;
      ctx.font = '42px "Fell SC"';
      ctx.fillText(actor.name, left + 86, top + 46);
      // What the actor's program is doing, in the program's own words: the label of the rule that fired.
      const label = world.programs[actor.program]?.rules[actor.rule];
      ctx.font = '27px "Fell Italic"';
      ctx.fillText(
        actor.fault !== 0 ? "confused" : (label ?? ""),
        left + 86,
        top + 82,
        right - left - 86,
      );
    });
    const below = 294 + listed.length * 105;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(left, below + 0.5);
    ctx.lineTo(right, below + 0.5);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (world.actors.length > listed.length) {
      ctx.font = '27px "Fell Italic"';
      ctx.fillText(`and ${world.actors.length - listed.length} more`, left, below + 40);
    }

    // The line of news: the last thing a program decided, or the hour if nothing has happened yet.
    ctx.font = '36px "Fell Italic"';
    ctx.fillText(
      this.news === "" ? `Day ${day + 1}, ${part}.` : this.news,
      28,
      this.height + 49,
      this.width - 56,
    );
  }

  /** A fire's flame: three tongues that lean and stretch slowly. */
  private flame(ctx: Ctx, [x, y]: readonly [number, number], palette: Palette, time: number): void {
    const a = Math.sin(time * 0.33);
    const b = Math.sin(time * 0.47 + 2);
    const tip = y - 30 - a * 3;
    ctx.fillStyle = css(palette.wash.flame);
    ctx.strokeStyle = css(palette.ink);
    ctx.lineWidth = 1.6;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x - 9, y - 4);
    ctx.quadraticCurveTo(x - 13 - b, y - 16, x - 4 + b, y - 22);
    ctx.quadraticCurveTo(x - 3 + a * 2, y - 26, x - 1 + a * 2, tip);
    ctx.quadraticCurveTo(x + 4 + b, y - 24, x + 5, y - 20);
    ctx.quadraticCurveTo(x + 12 + a, y - 14, x + 9, y - 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = css(palette.wash.glass);
    ctx.beginPath();
    ctx.moveTo(x - 4, y - 5);
    ctx.quadraticCurveTo(x - 5 + b, y - 13, x + a, y - 18 - b * 2);
    ctx.quadraticCurveTo(x + 5, y - 12, x + 4, y - 5);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * Mean brightness (0 to 255) of the frame as just drawn, one value per
   * tile-sized block, averaged over every pixel of the block. For measuring
   * flicker: compare the results of two draws.
   */
  brightness(): number[] {
    const { data } = this.out.getImageData(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    const columns = Math.ceil(FRAME_WIDTH / TILE);
    const rows = Math.ceil(FRAME_HEIGHT / TILE);
    const sums = new Array<number>(columns * rows).fill(0);
    const counts = new Array<number>(columns * rows).fill(0);
    for (let y = 0; y < FRAME_HEIGHT; y++) {
      const row = Math.floor(y / TILE) * columns;
      for (let x = 0; x < FRAME_WIDTH; x++) {
        const i = (y * FRAME_WIDTH + x) * 4;
        const cell = row + Math.floor(x / TILE);
        sums[cell] =
          (sums[cell] as number) +
          ((data[i] as number) * 299 +
            (data[i + 1] as number) * 587 +
            (data[i + 2] as number) * 114) /
            1000;
        counts[cell] = (counts[cell] as number) + 1;
      }
    }
    return sums.map((sum, cell) => sum / (counts[cell] as number));
  }
}
