// Draws the frame: the map, the page beside it and the line beneath it, all on
// one canvas. Everything is drawn twice, once in day ink and once in night ink.
// The two are never blended across the whole frame, which would leave neither
// readable: at nightfall the dark closes in on the lantern as a ring, at
// daybreak the light spreads out from it the same way, and at night every lamp
// is a window onto the day drawing. Lettering goes on last, in one ink or the
// other.
// Everything that moves is a function of sim time, so the same time gives the
// same frame.

import {
  type Actor,
  ADVENTURER,
  clock,
  kindOf,
  START_HOUR,
  TICKS_PER_GAME_HOUR,
  type TileMap,
  terrainAt,
  type World,
} from "@idlin/sim";
import { drawBeast } from "./beasts.ts";
import {
  type Effects,
  glyphAt,
  leanAt,
  NO_EFFECTS,
  nextEffects,
  routeAt,
  walkAt,
} from "./effects.ts";
import {
  ARRIVE_TICKS,
  arrivalAt,
  DODGE_TICKS,
  type Fallen,
  type Fight,
  fadeAt,
  fallenAt,
  floatAt,
  HATCH_STROKES,
  hatchAt,
  LANDED_FADE,
  lyingAt,
  type News,
  NO_FIGHT,
  ringShare,
  ringStrength,
  SCRATCH_TICKS,
  shove,
  stoopAt,
} from "./fight.ts";
import { drawFigure, drawMarkGlyph, type FigureStyle, figureTop, liftOf } from "./figure.ts";
import {
  FRAME_HEIGHT,
  FRAME_WIDTH,
  PAGE_HEAD,
  ROSTER_ROWS,
  ROW_PITCH,
  spreadPage,
  TIGHT_PITCH,
} from "./frame.ts";
import { drawGround, type Ground, type MapLabel, TILE } from "./ground.ts";
import { identity } from "./identity.ts";
import {
  css,
  dayAt,
  dayInk,
  dayRegion,
  EDGE,
  LAMP_CORE,
  LAMP_KNEE,
  LAMP_KNEE_LEVEL,
  lampAt,
  lampStrength,
  pageDay,
  phaseName,
  rgb,
  skyCast,
} from "./light.ts";
import { looks, type Parts, partsFor } from "./looks.ts";
import {
  drawBlot,
  drawDust,
  drawFlecks,
  drawGlyph,
  drawHatch,
  drawLaid,
  drawRing,
  drawRoute,
  drawScratch,
  eat,
  ROUTE_ROW,
  routeLine,
  routePoint,
} from "./marks.ts";
import { type Pt, regionLoops, smoothLoop } from "./outline.ts";
import { DAY, NIGHT, PAGE_CAST, type Palette, pagePalette } from "./palette.ts";
import { type Ctx, newCanvas, trace } from "./pen.ts";
import { actorPose, easeSit, type Pose } from "./pose.ts";
import { letGo, NO_SLIPS, nextSlips, type Slips, slipAlpha } from "./slips.ts";
import { drawHp, drawLevels, hpWidth } from "./stats.ts";
import {
  type Box,
  bodyBox,
  overlaps,
  placeTags,
  TAG_HEIGHT,
  type TagWish,
  tagBox,
} from "./tags.ts";
import { edgeFade, fightOn } from "./view.ts";

const FIGURE_SCALE = 1.3;
/** How strongly a page row is drawn while its resident is off the map. */
const AWAY_ALPHA = 0.5;
const TAG_FONT = '27px "Fell SC"';
const FONTS = ['22px "Fell"', '22px "Fell Italic"', TAG_FONT];
/** How long a line of news stays up at least, in ticks, so the line can be read. */
const NEWS_TICKS = 40;
/** How far each kind of light reaches, in tiles. */
const LANTERN_REACH = 5.4;
const FIRE_REACH = 3;
const CARRIED_REACH = 1.75;
/** How much of the day drawing a carried light shows over open water, as a share of what it shows on land. */
const CARRIED_ON_WATER = 0.3;
/** A face on the page at night: pale and warm, darker than the night ink of its outline. */
const NIGHT_FACE = rgb(0xd6c3a2);
/** Beside the map, the paper outside its rule, in pixels from the map's edge, goes with the page. */
const RULE_MARGIN = 5;
/** The least room below the map that the line of news needs. */
const NEWS_STRIP = 60;
const STANDING: Pose = {
  x: 0,
  y: 0,
  hop: 0,
  stride: 0.5,
  breath: 0,
  moving: false,
  walk: 0,
  resting: false,
  sit: 0,
  lean: 0,
  stoop: 0,
  squash: 0,
};
/** How strong a route's dashes are at their strongest. */
const ROUTE_ALPHA = 0.75;
/** How big a glyph is on its slip, and how wide the paper beside the name it sits on. */
const GLYPH_SIZE = 28;
const GLYPH_ROOM = 36;
/**
 * How a floating number is lettered, and where it starts: beside the figure at
 * chest height, clear of the figure and of the name slip over its head.
 */
const FLOAT_FONT = '30px "Fell"';
const FLOAT_ABOVE = 22;
const FLOAT_ASIDE = 19;
/** How much higher each further pair of numbers on one spot starts. */
const FLOAT_ROW = 24;
/** How wide the stain a fallen monster or resident leaves is, in pixels. */
const BLOT_SIZE: Readonly<Record<string, number>> = { wolf: 50, goblin: 36, [ADVENTURER]: 30 };
/** The most lines of fight news waiting their turn; older ones give way to newer. */
const NEWS_QUEUE = 3;

const isResident = (actor: Actor): boolean => actor.kind === ADVENTURER;

/**
 * The parts each resident's figure is drawn from, by id; by its id alone if it
 * has left the world. Make one per draw: it looks the actors up once.
 */
const partsIn = (world: World): ((id: number) => Parts & { deaths: number }) => {
  const byId = new Map(world.actors.map((actor) => [actor.id, actor]));
  return (id) => {
    const actor = byId.get(id);
    return { ...partsFor(actor ?? id), deaths: actor?.deaths ?? 0 };
  };
};

/** `world` with the actors the page lists, so a resident off the map is drawn there in its own kit. */
const listing = (world: World, roster: readonly Actor[]): World => ({
  ...world,
  actors: [...roster],
});

interface Walker {
  readonly actor: Actor;
  readonly pose: Pose;
  readonly x: number;
  readonly y: number;
  /** 1 on the map, falling to 0 as it walks off an edge (see `edgeFade`). */
  readonly fade: number;
}

interface Light {
  readonly x: number;
  readonly y: number;
  /** Pixels. */
  readonly reach: number;
  readonly strength: number;
  /** A light someone carries, which shows less of the day drawing over water. */
  readonly carried?: boolean;
}

interface Side {
  readonly palette: Palette;
  readonly ground: Ground;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: Ctx;
}

const two = (n: number): string => String(n).padStart(2, "0");

/** The typeface, size and letter spacing of a place label. */
const labelFont = (label: MapLabel): readonly [string, number, number] =>
  label.style === "region"
    ? ["Fell Italic", 30, 2]
    : label.style === "town"
      ? ["Fell SC", 26, 3]
      : ["Fell Italic", 27, 0];

export class Scene {
  /** The map's size in frame pixels; the page and the news line take the rest of the frame. */
  readonly width: number;
  readonly height: number;
  /** The whole frame's size. 1920 by 1080 unless the window has another shape. */
  private frameWidth = FRAME_WIDTH;
  private frameHeight = FRAME_HEIGHT;
  /** Whether the page sits below the map, and how many columns its residents are listed in. */
  private pageBelow = false;
  private columns = 1;
  /** How far right of the frame's edge the map is drawn: centred over the page when that is below it. */
  private mapX = 0;
  private readonly out: Ctx;
  private readonly day: Side;
  private readonly night: Side;
  private readonly lit: { canvas: HTMLCanvasElement; ctx: Ctx };
  private readonly facing = new Map<number, 1 | -1>();
  private readonly tagSpots = new Map<number, number>();
  /** Who has a name slip on the map, and since when; see slips.ts. */
  private slips: Slips = NO_SLIPS;
  /** Where each slip fading out stays while it fades: where it was when taken away. */
  private readonly fading = new Map<number, Box>();
  /** When each resident was last named in the line of news. */
  private readonly named = new Map<number, number>();
  private readonly tagWidths = new Map<string, number>();
  /** Where the dark closes in to at dusk: the first lantern, or the middle of the map. */
  private readonly hearth: readonly [number, number];
  private readonly labels: readonly MapLabel[];
  private news = "";
  private newsSince = Number.NEGATIVE_INFINITY;
  /** The resident the line of news is about, or -1 for none. */
  private newsWho = -1;
  private readonly lastRule = new Map<number, number>();
  /** Things no name should cover: the fire, the lantern's glass, the place names. */
  private readonly avoid: Box[] = [];
  /** Which ink each name and each place label is in, settled once a tick. */
  private readonly nameDay = new Map<number, boolean>();
  private readonly labelDay: boolean[] = [];
  /** Half the width of each place label, as kept clear of names. */
  private readonly labelHalf: number[] = [];
  /** Where each place label's lettering is, which a route breaks around. */
  private readonly labelBoxes: Box[] = [];
  /** The tick of the world last observed, to notice when time goes back. */
  private lastTick = Number.NEGATIVE_INFINITY;
  /** A short line on the page beside the clock, such as "waiting for the world"; empty for none. */
  notice = "";
  /** False to draw a dash for the time and no day line, as when there is no world to tell it from yet. */
  clockShown = true;
  /** How far down into sitting each figure is, at the tick before last and at the last tick. */
  private readonly sitting = new Map<number, readonly [number, number]>();
  /** Glyphs, routes and beats under way; see effects.ts. */
  private effects: Effects = NO_EFFECTS;
  /** The camp's tile, which a walk home ends at. */
  private readonly home: { x: number; y: number };
  /** The river's outline in frame pixels, rounded as its banks are, and whether a point is on water. */
  private readonly water: Pt[][];
  private readonly wet: (x: number, y: number) => boolean;
  /**
   * Blows, hurts and the fallen (see fight.ts): `fought` as read off the
   * whole world, and `fight` as the map shows it (see `fightOn` in view.ts).
   */
  private fought: Fight = NO_FIGHT;
  private fight: Fight = NO_FIGHT;
  /** For the frame being drawn: where each listed resident off the map is (see `draw`). */
  private away: ReadonlyMap<number, string> = new Map();
  /** Lines of fight news waiting for the line, and whether the line now up is one. */
  private newsQueue: News[] = [];
  private newsFight = false;
  private newsUrgent = false;

  private constructor(host: HTMLElement, map: TileMap, labels: readonly MapLabel[]) {
    const camp = map.places.find((place) => place.name === "camp");
    this.home = camp ? { x: camp.x, y: camp.y } : { x: 0, y: 0 };
    // Open water only: a bridge's deck takes a carried light as land does. Traced
    // with the edge tiles repeated outwards, as the banks are, so a river running
    // off the map is not rounded off at the edge.
    const open = (x: number, y: number): boolean =>
      terrainAt(
        map,
        Math.min(map.width - 1, Math.max(0, x)),
        Math.min(map.height - 1, Math.max(0, y)),
      ) === "water";
    this.water = regionLoops(map.width + 2, map.height + 2, (x, y) => open(x - 1, y - 1)).map(
      (loop) => smoothLoop(loop, 3).map(([x, y]) => [(x - 1) * TILE, (y - 1) * TILE] as const),
    );
    this.wet = (x, y) =>
      x >= 0 &&
      y >= 0 &&
      x < this.width &&
      y < this.height &&
      open(Math.floor(x / TILE), Math.floor(y / TILE));
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
    for (const [x, y] of this.day.ground.fires)
      this.avoid.push({ left: x - 16, right: x + 16, top: y - 34, bottom: y + 6 });
    for (const [x, y] of this.day.ground.lanterns)
      this.avoid.push({ left: x - 10, right: x + 10, top: y - 12, bottom: y + 14 });
    for (const label of labels) {
      // At least the lettering's own width, as the context measures it, and a little either side.
      const [font, size, spacing] = labelFont(label);
      ctx.font = `${size}px "${font}"`;
      ctx.letterSpacing = `${spacing}px`;
      const measured = Math.ceil(ctx.measureText(label.text).width / 2) + 4;
      const half = Math.max(measured, label.text.length * (label.style === "town" ? 7 : 8));
      this.labelHalf.push(half);
      const box = {
        left: label.x * TILE - half,
        right: label.x * TILE + half,
        top: label.y * TILE - 24,
        bottom: label.y * TILE + 6,
      };
      this.avoid.push(box);
      this.labelBoxes.push(box);
    }
    ctx.letterSpacing = "0px";
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

  /**
   * Sets the size of the whole frame and where the page goes. The map stays
   * where it is; the page is beside it, or below it with its residents in
   * `columns` columns.
   */
  resize(width: number, height: number, below = false, columns = 1): void {
    this.pageBelow = below;
    this.columns = below ? Math.max(1, Math.min(ROSTER_ROWS, Math.floor(columns))) : 1;
    const wide = Math.max(below ? this.width : FRAME_WIDTH, Math.floor(width) || 0);
    const tall = Math.max(this.height, Math.floor(height) || 0);
    this.mapX = below ? Math.floor((wide - this.width) / 2) : 0;
    // Setting a canvas's size clears it and takes memory anew, so only when the size changes.
    if (wide === this.frameWidth && tall === this.frameHeight) return;
    this.frameWidth = wide;
    this.frameHeight = tall;
    for (const sheet of [this.out.canvas, this.day.canvas, this.night.canvas, this.lit.canvas]) {
      sheet.width = this.frameWidth;
      sheet.height = this.frameHeight;
    }
  }

  /**
   * Draws the world as it is at `time` ticks (the world's tick plus a fraction
   * of the next). The map shows `world.actors`; the page lists `roster`.
   * `away` names, by id, the region each listed resident off the map is in,
   * and the page fades those rows and writes that instead of what they do.
   */
  draw(
    world: World,
    time: number,
    roster: readonly Actor[] = world.actors,
    away: ReadonlyMap<number, string> = new Map(),
  ): void {
    this.away = away;
    const fraction = time - world.tick;
    const between = Math.min(1, Math.max(0, fraction));
    const walkers: Walker[] = world.actors.map((actor) => {
      const raw = actorPose(actor, fraction, time);
      // Between ticks the figure goes on easing down or up, so it never steps.
      const [before, now] = this.sitting.get(actor.id) ?? [raw.sit, raw.sit];
      const stoop = stoopAt(this.fight, actor.id, time);
      const push = shove(this.fight, actor.id, time);
      const pose = {
        ...raw,
        // Near death the step is shorter.
        stride: raw.stride * (1 - 0.4 * stoop),
        sit: before + (now - before) * between,
        lean: leanAt(this.effects, actor.id, time),
        walk: walkAt(this.effects, actor.id, time),
        stoop,
        squash: push.squash,
      };
      const x = pose.x * TILE + push.x;
      const y = pose.y * TILE - 4 + push.y;
      return { actor, pose, x, y, fade: edgeFade(x, y, this.width, this.height) };
    });
    walkers.sort((a, b) => a.y - b.y || a.actor.id - b.actor.id);
    const { hour, lamps, region, lights, litAt } = this.lighting(walkers, time);
    const [hx, hy] = this.hearth;
    const mx = this.mapX;
    // With the page below the map, the paper either side of the map is lit as the map is.
    const mapRight = this.pageBelow ? this.frameWidth : this.width;

    const out = this.out;
    // The names on the map this frame, and what a route breaks around: the
    // place names, and each slip with the glyph beside it.
    const fades = new Map(walkers.map((walker) => [walker.actor.id, walker.fade]));
    const tags = this.placeNames(walkers).flatMap((tag) => {
      const alpha =
        slipAlpha(this.slips, tag.id, time) *
        arrivalAt(this.fight, tag.id, time) *
        (fades.get(tag.id) ?? 1);
      if (alpha <= 0) return [];
      const glyph = glyphAt(this.effects, tag.id, time);
      const top = tag.y - 21;
      const left = tag.x - tag.width / 2 - (glyph ? GLYPH_ROOM : 0);
      const box = {
        left,
        right: tag.x + tag.width / 2,
        top: top - 4,
        bottom: top + TAG_HEIGHT + 3,
      };
      return [{ ...tag, alpha, glyph, box }];
    });
    const holes = [...this.labelBoxes, ...tags.map((tag) => tag.box)];
    if (region.kind !== "all") this.drawSide(this.night, world, roster, walkers, time, holes);
    // In full night the day drawing only shows inside the lamps' reach, so only that much of it is drawn.
    if (region.kind !== "none" || lamps > 0) {
      const only = region.kind === "none" ? lights : null;
      this.drawSide(this.day, world, roster, walkers, time, holes, only, skyCast(hour));
    }
    out.drawImage(region.kind === "all" ? this.day.canvas : this.night.canvas, 0, 0);

    if (region.kind !== "all") {
      // Build, in white, the shape of everything that is lit: what daylight is
      // left, and the reach of each lamp. Then show the day drawing through it.
      const lit = this.lit.ctx;
      lit.globalCompositeOperation = "source-over";
      lit.clearRect(0, 0, this.frameWidth, this.frameHeight);
      lit.setTransform(1, 0, 0, 1, mx, 0);
      if (region.kind === "circle" && region.radius + EDGE > 0) {
        const inner = Math.max(0, region.radius);
        const gradient = lit.createRadialGradient(hx, hy, inner, hx, hy, region.radius + EDGE);
        gradient.addColorStop(0, "rgba(255,255,255,1)");
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        lit.fillStyle = gradient;
        lit.fillRect(0 - mx, 0, this.frameWidth, this.frameHeight);
      }
      const paint = (light: Light, strength: number): void => {
        const gradient = lit.createRadialGradient(
          light.x,
          light.y,
          light.reach * LAMP_CORE,
          light.x,
          light.y,
          light.reach,
        );
        gradient.addColorStop(0, `rgba(255,255,255,${strength})`);
        gradient.addColorStop(LAMP_KNEE, `rgba(255,255,255,${strength * LAMP_KNEE_LEVEL})`);
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        lit.fillStyle = gradient;
        lit.beginPath();
        lit.arc(light.x, light.y, light.reach, 0, 7);
        lit.fill();
      };
      for (const light of lights) if (!light.carried) paint(light, light.strength);
      // A light someone carries opens only a little of the day drawing over the
      // river: the pale day water would read as fog on the night river. The
      // lamplight's amber, laid on below, tints the water instead. A carried
      // light lights only the map, inside its rule, so one taken off the map
      // lights nothing beside it.
      const carried = lights.filter((light) => light.carried);
      if (carried.length > 0) {
        for (const wet of [false, true]) {
          lit.save();
          lit.beginPath();
          if (!wet) lit.rect(...this.inRule());
          for (const loop of this.water) {
            trace(lit, loop);
            lit.closePath();
          }
          lit.clip("evenodd");
          for (const light of carried) paint(light, light.strength * (wet ? CARRIED_ON_WATER : 1));
          lit.restore();
        }
      }
      lit.setTransform(1, 0, 0, 1, 0, 0);
      lit.globalCompositeOperation = "source-in";
      lit.drawImage(this.day.canvas, 0, 0);
      out.drawImage(this.lit.canvas, 0, 0, mapRight, this.height, 0, 0, mapRight, this.height);
      // The page, the news line and the paper round the map's rule change all
      // at once, so that they are never half covered. While the page turns it
      // is drawn afresh on paper partway between day and night, in whichever
      // ink reads on it.
      const page = pageDay(hour);
      out.save();
      this.pageArea(out);
      out.clip("evenodd");
      if (page >= 1 || page <= 0) {
        out.drawImage(page >= 1 ? this.day.canvas : this.night.canvas, 0, 0);
      } else {
        const palette = pagePalette(hour);
        out.fillStyle = css(palette.paper);
        out.fillRect(0, 0, this.frameWidth, this.frameHeight);
        out.translate(mx, 0);
        this.page(out, world, roster, palette, this.pageStyle(listing(world, roster), palette));
      }
      out.restore();
    }

    // Lamplight is warm: a thin amber laid where each lamp falls, by day as well
    // while the lamps are coming on or going out, so that they never switch.
    if (lights.length > 0) {
      out.save();
      out.translate(mx, 0);
      out.beginPath();
      out.rect(...this.inRule());
      out.clip();
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
      out.restore();
    }

    // Lettering goes on last, each piece wholly in day ink or wholly in night
    // ink according to the light where it sits, so it never fades into a halo.
    // Which ink was settled at the last tick; before the first tick it is worked out here.
    const inkOf = (settled: boolean | undefined, x: number, y: number): Palette =>
      (settled ?? dayInk(litAt(x, y), undefined)) ? DAY : NIGHT;
    out.setTransform(1, 0, 0, 1, mx, 0);
    out.save();
    out.beginPath();
    out.rect(...this.inRule());
    out.clip();
    out.textAlign = "center";
    out.lineJoin = "round";
    this.labels.forEach((label, index) => {
      const [font, size, spacing] = labelFont(label);
      const x = label.x * TILE;
      const y = label.y * TILE;
      const settled = this.labelDay[index] ?? dayInk(this.labelLit(index, litAt), undefined);
      const palette = settled ? DAY : NIGHT;
      out.font = `${size}px "${font}"`;
      out.letterSpacing = `${spacing}px`;
      out.lineWidth = 5;
      out.strokeStyle = css(palette.paper, 0.7);
      out.fillStyle = css(palette.ink, 0.8);
      out.strokeText(label.text, x, y);
      out.fillText(label.text, x, y);
    });
    out.letterSpacing = "0px";
    out.font = TAG_FONT;
    for (const tag of tags) {
      const { alpha, glyph } = tag;
      out.globalAlpha = alpha;
      // A name sits on a small slip of paper, so it reads over trees, water and other ink.
      const palette = inkOf(this.nameDay.get(tag.id), tag.x, tag.y - 8);
      // A slip is light paper with dark lettering by day and by night: in the dark it
      // takes the pale of the night ink, so every name reads the same way at a glance.
      const slipPaper = palette === DAY ? DAY.paper : NIGHT.ink;
      const slipInk = palette === DAY ? DAY.ink : NIGHT.paper;
      if (tag.moved) {
        // Moved aside to make room: a short stroke ties the name back to its owner.
        out.strokeStyle = css(palette.ink, 0.7);
        out.lineWidth = 1.5;
        out.beginPath();
        out.moveTo(
          Math.max(tag.x - tag.width / 2 + 6, Math.min(tag.x + tag.width / 2 - 6, tag.headX)),
          tag.y + 4,
        );
        out.lineTo(tag.headX, tag.headY);
        out.stroke();
      }
      out.fillStyle = css(slipPaper, 0.92);
      out.beginPath();
      // The slip reaches 21 pixels above the baseline, a little clear of the capitals' tops.
      out.roundRect(tag.x - tag.width / 2, tag.y - 21, tag.width, TAG_HEIGHT - 1, 4);
      out.fill();
      out.fillStyle = css(slipInk);
      out.fillText(tag.name, tag.x, tag.y);
      // What it has just set out to do, on a tab of the same paper to the left
      // of the name. It fades with the slip, and on its own at the end of its life.
      if (glyph) {
        out.globalAlpha = alpha * glyph.alpha;
        const right = tag.x - tag.width / 2;
        const middle = tag.y - 21 + (TAG_HEIGHT - 1) / 2;
        out.fillStyle = css(slipPaper, 0.92);
        out.beginPath();
        out.roundRect(right - GLYPH_ROOM, middle - 17, GLYPH_ROOM, 34, [6, 0, 0, 6]);
        out.fill();
        drawGlyph(out, glyph.glyph, right - GLYPH_ROOM / 2 + 1, middle, GLYPH_SIZE, css(slipInk));
      }
    }
    // The hitpoints a blow took, rising from where it struck and fading.
    out.font = FLOAT_FONT;
    out.lineWidth = 5;
    out.textAlign = "left";
    for (const floater of this.fight.floaters) {
      const at = floatAt(floater, time);
      if (!at) continue;
      // A stack of numbers on one spot goes right, left, then a row higher, and so on.
      const side = floater.order % 2 === 0 ? 1 : -1;
      const row = Math.floor(floater.order / 2);
      const x = (floater.x + 0.5) * TILE + side * FLOAT_ASIDE;
      const y = (floater.y + 1) * TILE - 4 - FLOAT_ABOVE - row * FLOAT_ROW - at.rise;
      const palette = inkOf(undefined, x, y);
      out.textAlign = side > 0 ? "left" : "right";
      out.globalAlpha = at.alpha;
      out.strokeStyle = css(palette.paper, 0.85);
      out.fillStyle = css(palette.ink);
      out.strokeText(`-${floater.damage}`, x, y);
      out.fillText(`-${floater.damage}`, x, y);
    }
    out.restore();
    out.globalAlpha = 1;
    out.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** The light at `time`: the hour, the lamps, and how lit any point of the map is. */
  private lighting(
    walkers: readonly Walker[],
    time: number,
  ): {
    hour: number;
    lamps: number;
    region: ReturnType<typeof dayRegion>;
    lights: Light[];
    litAt: (x: number, y: number) => number;
  } {
    const hour = (((time / TICKS_PER_GAME_HOUR + START_HOUR) % 24) + 24) % 24;
    const lamps = lampStrength(hour);
    const [hx, hy] = this.hearth;
    // The dark closes in over the map only, from the map's own corners; the page changes separately.
    // With the page below, the paper either side of the map goes dark with it.
    const left = hx + this.mapX;
    const right = (this.pageBelow ? this.frameWidth - this.mapX : this.width) - hx;
    const reach = Math.max(
      Math.hypot(left, hy),
      Math.hypot(right, hy),
      Math.hypot(left, this.height - hy),
      Math.hypot(right, this.height - hy),
    );
    const region = dayRegion(hour, reach);
    // Every light there is, as a place, a reach in pixels and a strength.
    const lights: Light[] = [];
    if (lamps > 0) {
      for (const [x, y] of this.day.ground.lanterns) {
        lights.push({ x, y: y + 28, reach: LANTERN_REACH * TILE, strength: lamps });
      }
      for (const [x, y] of this.day.ground.fires) {
        // A fire's light breathes slowly; it never jumps.
        const breath = 1 + Math.sin(time * 0.21) * 0.02 + Math.sin(time * 0.57 + 1) * 0.012;
        lights.push({ x, y, reach: FIRE_REACH * TILE * breath, strength: lamps * 0.95 });
      }
      // Residents carry a light; monsters go in the dark. A light carried off the map fades with its bearer.
      for (const walker of walkers) {
        if (!isResident(walker.actor) || walker.fade <= 0) continue;
        lights.push({
          x: walker.x,
          y: walker.y - 22,
          reach: CARRIED_REACH * TILE,
          strength: lamps * 0.85 * arrivalAt(this.fight, walker.actor.id, time) * walker.fade,
          carried: true,
        });
      }
    }
    /** How much of the day drawing shows at a point, 0 to 1: the same sum the picture is built from. */
    const litAt = (x: number, y: number): number => {
      let dark = 1 - dayAt(region, Math.hypot(x - hx, y - hy));
      const wet = this.wet(x, y);
      for (const light of lights) {
        const strength = light.strength * (light.carried && wet ? CARRIED_ON_WATER : 1);
        dark *= 1 - lampAt(Math.hypot(x - light.x, y - light.y), light.reach, strength);
      }
      return 1 - dark;
    };
    return { hour, lamps, region, lights, litAt };
  }

  /** The frame as just drawn, scaled by `scale` (1 is full size), as RGBA. */
  pixels(scale: number): { width: number; height: number; data: Uint8ClampedArray } {
    const width = Math.round(this.frameWidth * scale);
    const height = Math.round(this.frameHeight * scale);
    const { ctx } = newCanvas(width, height);
    ctx.drawImage(this.out.canvas, 0, 0, width, height);
    return { width, height, data: ctx.getImageData(0, 0, width, height).data };
  }

  /**
   * Takes note of the world after a tick: which way each actor now faces,
   * anything worth a line of news, where each name sits and which ink each
   * piece of lettering is in. Call it after every `step`, drawn or not, so
   * that what a frame shows depends on the world's history and not on which
   * frames happened to be drawn. `world` is what the map shows; `whole` is
   * the world it was cut from, as region `region` (see view.ts), which the
   * fight is read off.
   */
  observe(world: World, whole: World = world, region = 0): void {
    // Each tick is taken note of once: seeing it again changes nothing.
    if (world.tick === this.lastTick) return;
    // A world from earlier than the last (a server restarted from a snapshot) has
    // another history: what was news in the old one says nothing about the new,
    // nor who had a slip, where it sat, how far down anyone was sitting, or which
    // ink the place names were in.
    if (world.tick < this.lastTick) {
      this.fought = NO_FIGHT;
      this.fight = NO_FIGHT;
      this.newsQueue = [];
      this.newsFight = false;
      this.newsUrgent = false;
      this.news = "";
      this.newsSince = Number.NEGATIVE_INFINITY;
      this.lastRule.clear();
      this.newsWho = -1;
      this.named.clear();
      this.slips = NO_SLIPS;
      this.tagSpots.clear();
      this.sitting.clear();
      this.facing.clear();
      this.nameDay.clear();
      this.fading.clear();
      this.labelDay.length = 0;
      this.effects = NO_EFFECTS;
    }
    this.lastTick = world.tick;
    this.effects = nextEffects(this.effects, world.actors, world.tick, this.home);
    const fight = fightOn(this.fought, whole, region);
    this.fought = fight.all;
    this.fight = fight.shown;
    // Kills, downs and close calls go before what anyone decided. Each stays up
    // long enough to be read; one waiting goes up once the last has had its time.
    // A resident downed goes ahead of the rest, and up at once unless the line
    // already tells of another one downed.
    // A close call still waiting is dropped once that resident is downed.
    const lines = [...this.newsQueue, ...this.fight.news];
    const urgent = lines.filter((line) => line.urgent);
    const downed = new Set(urgent.map((line) => line.who));
    const rest = lines.filter((line) => !line.urgent && !(line.close && downed.has(line.who)));
    rest.splice(0, Math.max(0, urgent.length + rest.length - NEWS_QUEUE));
    this.newsQueue = [...urgent, ...rest];
    const next = this.newsQueue[0];
    if (
      next &&
      (!this.newsFight ||
        world.tick - this.newsSince >= NEWS_TICKS ||
        (next.urgent === true && !this.newsUrgent))
    ) {
      this.newsQueue.shift();
      this.news = next.text;
      this.newsSince = world.tick;
      this.newsWho = next.who;
      this.newsFight = true;
      this.newsUrgent = next.urgent === true;
    }
    // A line of fight news holds off what anyone decided for twice as long.
    const hold = (): number =>
      this.newsQueue.length > 0
        ? Number.POSITIVE_INFINITY
        : this.newsFight
          ? 2 * NEWS_TICKS
          : NEWS_TICKS;
    const alive = new Set<number>();
    for (const actor of world.actors) {
      alive.add(actor.id);
      if (actor.x !== actor.fromX) this.facing.set(actor.id, actor.x > actor.fromX ? 1 : -1);
      // Winding up a blow to one side, it turns to face it.
      const mark = actor.windup > 0 ? world.marks.find((m) => m.by === actor.id) : undefined;
      if (mark && mark.x !== actor.x) this.facing.set(actor.id, mark.x > actor.x ? 1 : -1);
      const before = this.lastRule.get(actor.id);
      this.lastRule.set(actor.id, actor.rule);
      // A line stays up long enough to be read before the next one replaces it.
      // What the monsters decide is not news.
      if (
        before === undefined ||
        before === actor.rule ||
        !isResident(actor) ||
        world.tick - this.newsSince < hold()
      )
        continue;
      const label = world.programs[actor.program]?.rules[actor.rule];
      if (!label || label === "otherwise") continue;
      this.news = `${actor.name}: ${label}`;
      this.newsSince = world.tick;
      this.newsWho = actor.id;
      this.newsFight = false;
      this.newsUrgent = false;
    }
    // Each figure moves a step further into or out of sitting, once a tick.
    const standing = world.actors.map((actor) => {
      const pose = actorPose(actor, 0, world.tick);
      const was = this.sitting.get(actor.id)?.[1] ?? pose.sit;
      const sit = easeSit(was, pose.sit);
      this.sitting.set(actor.id, [was, sit]);
      return { actor, pose: { ...pose, sit } };
    });
    // Whoever the line of news is about keeps a claim to a slip while the line names them
    // and for NEWS_HOLD after, so a reader can find them on the map.
    if (alive.has(this.newsWho)) this.named.set(this.newsWho, world.tick);
    const bounds = { width: this.width, height: this.height };
    const wishes = standing.map(({ actor, pose }) => this.wish(actor, pose));
    // Until the next tick a slip goes where its figure goes, so the room it
    // takes is all it passes over: from where it is drawn at this tick to where
    // it will be at the next, and up by as much as a step lifts the figure.
    const moves = new Map(
      world.actors.map((actor) => {
        const [was, sit] = this.sitting.get(actor.id) ?? [0, 0];
        const start = this.wish(actor, { ...actorPose(actor, 0, world.tick), sit: was });
        const end = this.wish(actor, { ...actorPose(actor, 1, world.tick + 1), sit });
        return [actor.id, { start, end, lift: actor.moveTicksLeft > 0 ? 3 : 0 }];
      }),
    );
    const sweep = (id: number, boxOf: (wish: TagWish) => Box): Box => {
      const move = moves.get(id) as { start: TagWish; end: TagWish; lift: number };
      const [a, b] = [boxOf(move.start), boxOf(move.end)];
      return {
        left: Math.min(a.left, b.left),
        right: Math.max(a.right, b.right),
        top: Math.min(a.top, b.top) - move.lift,
        bottom: Math.max(a.bottom, b.bottom),
      };
    };
    // The paper of a slip reaches 2 pixels above its box.
    const paper = (box: Box): Box => ({ ...box, top: box.top - 2 });
    // A slip fading out stays where it was drawn at the tick it was taken away.
    const fadingBox = (id: number): Box =>
      this.fading.get(id) ??
      tagBox((moves.get(id) as { start: TagWish }).start, this.tagSpots.get(id) ?? 0, bounds);
    // A slip keeps its spot from the last tick; one newly given, or given back
    // while fading, finds its own.
    const kept = new Map([...this.tagSpots].filter(([id]) => this.slips.held.has(id)));
    // Where the slips `held` go when placed together, kept clear of those
    // `leaving`; and which slips, of either, cover another slip, the figure of
    // another slip holder, a place name, the fire or the lantern on their way
    // to the next tick. Figures without a slip are only kept clear of where
    // there is room: in the knot at camp almost every spot is over someone,
    // and counting them leaves two names where eight fit clear of each other.
    // Monsters are kept clear of as the fire is: a name over one hides who is
    // doing the hitting.
    const beasts = world.actors
      .filter((actor) => !isResident(actor))
      .map((actor) => sweep(actor.id, bodyBox));
    const avoid = [...this.avoid, ...beasts];
    const covered = new Map<string, { bad: Set<number>; spots: Map<number, number> }>();
    const covering = (held: readonly number[], leaving: readonly number[]) => {
      const holding = new Set(held);
      const going = new Set(leaving);
      const byId = (a: number, b: number): number => a - b;
      const key = `${[...holding].sort(byId)}/${[...going].sort(byId)}`;
      const known = covered.get(key);
      if (known) return known;
      const left = [...going].map((id) => ({ id, box: paper(fadingBox(id)) }));
      const placed = placeTags(
        // Each slip is placed clear along the whole way to the next tick, not only where it starts.
        wishes
          .filter((wish) => holding.has(wish.id))
          .map((wish) => {
            const move = moves.get(wish.id) as { start: TagWish; end: TagWish; lift: number };
            return { ...move.start, next: { x: move.end.x, y: move.end.y, lift: move.lift } };
          }),
        kept,
        bounds,
        // The paper of a slip reaches 2 pixels above its box, so what it avoids reaches 2 lower.
        [
          ...avoid.map((box) => ({ ...box, bottom: box.bottom + 2 })),
          ...left.map(({ box }) => box),
        ],
        wishes.filter((wish) => !holding.has(wish.id)).map((wish) => sweep(wish.id, bodyBox)),
      );
      const slips = [
        ...[...placed].map(([id, { spot }]) => ({
          id,
          box: paper(sweep(id, (wish) => tagBox(wish, spot, bounds))),
        })),
        ...left,
      ];
      const bodies = [...holding, ...going].map((id) => ({ id, box: sweep(id, bodyBox) }));
      const bad = new Set<number>();
      for (const { id, box } of slips) {
        if (
          avoid.some((other) => overlaps(box, other)) ||
          bodies.some((body) => body.id !== id && overlaps(box, body.box)) ||
          slips.some((other) => other.id !== id && overlaps(box, other.box))
        )
          bad.add(id);
      }
      const spots = new Map([...placed].map(([id, { spot }]) => [id, spot]));
      const result = { bad, spots };
      covered.set(key, result);
      return result;
    };
    // A slip given only because there is room must cover nothing, and must not
    // push any other slip onto something either.
    const fits = (id: number, held: readonly number[], leaving: readonly number[]): boolean => {
      const before = covering(held, leaving).bad;
      const after = covering([...held, id], leaving).bad;
      return !after.has(id) && [...after].every((other) => before.has(other));
    };
    // Only residents have names on the map; a monster is told by its drawing.
    const people = world.actors
      .filter(isResident)
      .map((actor) => ({ id: actor.id, x: actor.x, y: actor.y }));
    let slips = nextSlips(this.slips, people, this.named, world.tick, fits);
    // A slip that is news may still land on one held only for the room, or on
    // one fading out. The one held for the room starts to fade at once, and one
    // already fading goes.
    for (;;) {
      const { bad } = covering([...slips.held.keys()], [...slips.leaving.keys()]);
      const fade = [...slips.room].filter((id) => bad.has(id));
      const drop = [...slips.leaving.keys()].filter((id) => bad.has(id));
      if (fade.length === 0 && drop.length === 0) break;
      slips = letGo(slips, fade, drop, world.tick);
    }
    this.slips = slips;
    // Names are placed once a tick, here, so that where a name sits depends on
    // the world's history and not on which frames were drawn.
    const { spots } = covering([...slips.held.keys()], [...slips.leaving.keys()]);
    const fading = new Map([...slips.leaving.keys()].map((id) => [id, fadingBox(id)]));
    this.fading.clear();
    for (const [id, box] of fading) this.fading.set(id, box);
    for (const [id, spot] of spots) this.tagSpots.set(id, spot);
    const slipped = standing.filter(({ actor }) => slips.held.has(actor.id));
    // The ink of each piece of lettering is settled here too, from the light
    // where it sits. The spot does not move with a figure's step, and the ink
    // only changes once the light is clearly past the middle.
    const { litAt } = this.lighting(
      standing.map(({ actor, pose }) => {
        const [x, y] = [pose.x * TILE, pose.y * TILE - 4];
        return { actor, pose, x, y, fade: edgeFade(x, y, this.width, this.height) };
      }),
      world.tick,
    );
    for (const { actor, pose } of slipped) {
      const box = tagBox(this.wish(actor, { ...pose, hop: 0 }), this.tagSpots.get(actor.id) ?? 0, {
        width: this.width,
      });
      const lit = litAt((box.left + box.right) / 2, box.bottom - 15);
      this.nameDay.set(actor.id, dayInk(lit, this.nameDay.get(actor.id)));
    }
    this.labels.forEach((_, index) => {
      this.labelDay[index] = dayInk(this.labelLit(index, litAt), this.labelDay[index]);
    });
    for (const known of [
      this.facing,
      this.tagSpots,
      this.lastRule,
      this.nameDay,
      this.sitting,
      this.named,
    ]) {
      for (const id of known.keys()) if (!alive.has(id)) known.delete(id);
    }
  }

  /**
   * How lit a place label is: the average of nine points evenly spaced from
   * one end to the other. A label is far wider than the light a resident
   * carries, so taken at its middle alone a resident walking under it would
   * turn the whole label to day ink, its pale halo spread over the night map
   * either side of the light.
   */
  private labelLit(index: number, litAt: (x: number, y: number) => number): number {
    const label = this.labels[index] as MapLabel;
    const half = this.labelHalf[index] ?? 0;
    const x = label.x * TILE;
    const y = label.y * TILE - 8;
    let sum = 0;
    for (let at = -4; at <= 4; at++) sum += litAt(x + (at / 4) * half, y);
    return sum / 9;
  }

  /** Where a figure's name would like to sit: centred, on the line just above the hood. */
  private wish(
    actor: Actor,
    pose: Pose,
  ): { id: number; x: number; y: number; width: number; feet: number } {
    let width = this.tagWidths.get(actor.name);
    if (width === undefined) {
      this.out.font = TAG_FONT;
      width = Math.ceil(this.out.measureText(actor.name).width) + 12;
      this.tagWidths.set(actor.name, width);
    }
    const feet = pose.y * TILE - 4;
    // Over the top of the figure, which a tall hood or a tool held high raises.
    const parts = partsFor(actor);
    return {
      id: actor.id,
      x: pose.x * TILE,
      y: feet - (figureTop(parts) - 7 * pose.sit + liftOf(pose, parts.gait)) * FIGURE_SCALE,
      width,
      feet,
    };
  }

  /** Where each name is drawn this frame: in the spot chosen for it at the last tick, following its figure. */
  private placeNames(walkers: readonly Walker[]): {
    id: number;
    name: string;
    x: number;
    y: number;
    width: number;
    moved: boolean;
    headX: number;
    headY: number;
  }[] {
    return walkers.map((walker) => {
      const wish = this.wish(walker.actor, walker.pose);
      const spot = this.tagSpots.get(walker.actor.id) ?? 0;
      // A slip fading out stays where it was taken away, so it is not tied to its figure.
      const left = this.fading.get(walker.actor.id);
      const box = left ?? tagBox(wish, spot, { width: this.width });
      return {
        id: walker.actor.id,
        name: walker.actor.name,
        x: (box.left + box.right) / 2,
        y: box.top + TAG_HEIGHT - 7,
        width: box.right - box.left,
        moved: !left && spot !== 0,
        headX: wish.x,
        headY: wish.y + 6,
      };
    });
  }

  /** Draws the whole frame in one palette onto that palette's sheet. */
  private drawSide(
    side: Side,
    world: World,
    roster: readonly Actor[],
    walkers: readonly Walker[],
    time: number,
    holes: readonly Box[],
    only: readonly { x: number; y: number; reach: number }[] | null = null,
    cast: ReturnType<typeof skyCast> | null = null,
  ): void {
    const { ctx, ground, palette } = side;
    const ink = css(palette.ink);
    const paper = css(palette.paper);
    ctx.save();
    ctx.translate(this.mapX, 0);
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
    ctx.fillRect(0 - this.mapX, 0, this.frameWidth, this.frameHeight);
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

    // From here to the map's rule, nothing is drawn outside it.
    ctx.save();
    ctx.beginPath();
    ctx.rect(...this.inRule());
    ctx.clip();

    // The route of a walk just begun, on the ground under everything that
    // stands, in its walker's cloak colour: from the walker along what is left
    // of its path, through the middle of each tile and so over a bridge's
    // deck. Only for those with a slip. It breaks around the place names and
    // the slips, so it never runs through lettering.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.width, this.height);
    for (const hole of holes)
      ctx.rect(hole.left, hole.top, hole.right - hole.left, hole.bottom - hole.top);
    ctx.clip("evenodd");
    for (const walker of walkers) {
      const { actor } = walker;
      const route = routeAt(this.effects, actor.id, time);
      const strength =
        slipAlpha(this.slips, actor.id, time) * arrivalAt(this.fight, actor.id, time) * walker.fade;
      if (!route || strength <= 0) continue;
      const ahead = actor.moveTicksLeft > 0 ? [{ x: actor.x, y: actor.y }] : [];
      // Once the walk is over only the cross is left, where the walk was going.
      const line =
        route.line > 0
          ? eat(
              routeLine(
                [walker.x, walker.y + 4 - (1 - ROUTE_ROW) * TILE],
                [...ahead, ...actor.path],
                TILE,
                actor.id,
                route.lane,
                route.goal,
              ),
              route.eaten,
            )
          : [routePoint(route.goal, TILE)];
      ctx.globalAlpha = ROUTE_ALPHA * strength;
      drawRoute(ctx, line, identity(actor.id).cloak, route.line, route.cross);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    this.drawFightGround(ctx, world, walkers, palette, time);

    // Standing things and walkers together, farthest first, so each overlaps what is behind it.
    let next = 0;
    const standing = ground.standing;
    const fires = [...ground.fires].sort((a, b) => a[1] - b[1]);
    let fire = 0;
    const upTo = (base: number): void => {
      while (next < standing.length && (standing[next] as (typeof standing)[number]).base <= base) {
        const thing = standing[next++] as (typeof standing)[number];
        if (thing.sways) {
          // Trees lean a little, about their foot, as a slow breeze crosses the map from the west.
          const foot = thing.x + thing.canvas.width / 2;
          const lean =
            Math.sin(time * 0.02 - foot * 0.004) * 0.02 + Math.sin(time * 0.053 + foot) * 0.006;
          ctx.save();
          ctx.translate(foot, thing.base);
          ctx.transform(1, 0, -lean, 1, 0, 0);
          ctx.drawImage(thing.canvas, thing.x - foot, thing.y - thing.base);
          ctx.restore();
        } else ctx.drawImage(thing.canvas, thing.x, thing.y);
        while (fire < fires.length && (fires[fire] as (typeof fires)[number])[1] <= thing.base) {
          this.flame(ctx, fires[fire++] as readonly [number, number], palette, time);
        }
      }
    };
    const style = this.figureStyle(world, palette);
    const beastStyle = (kind: string) => ({
      body: css(kind === "wolf" ? palette.wash.wolf : palette.wash.goblin),
      ink,
      paper,
      scale: FIGURE_SCALE,
    });
    for (const walker of walkers) {
      upTo(walker.y);
      // Someone new comes in, and a resident carried back to camp wakes there,
      // fading in. Someone walking off an edge fades out into it.
      ctx.globalAlpha = arrivalAt(this.fight, walker.actor.id, time) * walker.fade;
      if (isResident(walker.actor)) {
        drawFigure(
          ctx,
          walker.x,
          walker.y,
          walker.pose,
          style(walker.actor.id, FIGURE_SCALE),
          time + walker.actor.id * 13,
        );
      } else {
        drawBeast(ctx, walker.actor.kind, walker.x, walker.y, walker.pose, {
          ...beastStyle(walker.actor.kind),
          facing: this.facing.get(walker.actor.id) ?? 1,
        });
      }
      ctx.globalAlpha = 1;
    }
    upTo(Number.POSITIVE_INFINITY);
    // Flecks of ink off whoever was struck, over everything that stands.
    for (const walker of walkers) {
      const recoil = this.fight.recoils.get(walker.actor.id);
      if (!recoil) continue;
      const t = (time - recoil.since) / 4;
      drawFlecks(ctx, walker.x, walker.y - 22, recoil.dx, recoil.dy, t, ink);
    }
    for (const spot of ground.fires) this.smoke(ctx, spot, palette, time);
    ctx.restore();

    // A ruled double border round the map, as round a printed map.
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3;
    ctx.strokeRect(6.5, 6.5, this.width - 13, this.height - 13);
    ctx.lineWidth = 1;
    ctx.strokeRect(13.5, 13.5, this.width - 27, this.height - 27);

    // The colour of the sky, laid on the day drawing only: the night drawing
    // keeps its own blue, so the dark closing in at dusk is not muddied with
    // amber. The page takes it more lightly than the map, under its lettering.
    if (cast && cast.alpha > 0) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = css(cast.color, cast.alpha);
      ctx.fillRect(...this.mapOnly());
      this.pageArea(ctx);
      ctx.fillStyle = css(cast.color, cast.alpha * PAGE_CAST);
      ctx.fill("evenodd");
      ctx.restore();
    }

    this.page(ctx, world, roster, palette, this.pageStyle(listing(world, roster), palette));
    ctx.restore();
  }

  /**
   * The fight's marks on the ground, under everything that stands: the stains
   * of the fallen, the scratches of missed blows, the hatching of blows about
   * to land, the rings of hitpoints and the dust of a dodge. Then whatever is
   * falling or going home, sinking or fading where it was.
   */
  private drawFightGround(
    ctx: Ctx,
    world: World,
    walkers: readonly Walker[],
    palette: Palette,
    time: number,
  ): void {
    const fight = this.fight;
    const ink = css(palette.ink);
    const paper = css(palette.paper);
    const hatch = css(palette.wash.hatch);
    const feet = (x: number, y: number): [number, number] => [(x + 0.5) * TILE, (y + 1) * TILE - 4];
    // A monster leaves a dark stain; a resident the open shape of where it lay.
    for (const fallen of fight.fallen) {
      const [cx, cy] = feet(fallen.x, fallen.y);
      if (fallen.kind === ADVENTURER) {
        const at = lyingAt(fallen, time);
        if (!at) continue;
        const cloak = identity(fallen.id).cloak;
        drawLaid(ctx, cx, cy, fallen.facing, at.scuff, cloak, ink);
        continue;
      }
      const at = fallenAt(fallen, time);
      if (!at) continue;
      drawBlot(ctx, cx, cy, BLOT_SIZE[fallen.kind] ?? 36, at.blot, ink, fallen.id);
    }
    for (const scratch of fight.scratches) {
      const [cx] = feet(scratch.x, scratch.y);
      const strength = fadeAt(scratch.since, SCRATCH_TICKS, time);
      drawScratch(ctx, cx, (scratch.y + 0.55) * TILE, scratch.dx, scratch.dy, strength, ink);
    }
    for (const mark of world.marks) {
      const strokes = hatchAt(fight, mark.by, time);
      drawHatch(ctx, mark.x * TILE, mark.y * TILE, TILE, strokes, HATCH_STROKES, hatch);
    }
    for (const landed of fight.landed) {
      const strength = fadeAt(landed.since, LANDED_FADE, time);
      if (strength <= 0) continue;
      ctx.globalAlpha = strength;
      drawHatch(ctx, landed.x * TILE, landed.y * TILE, TILE, HATCH_STROKES, HATCH_STROKES, hatch);
      ctx.globalAlpha = 1;
    }
    for (const walker of walkers) {
      const id = walker.actor.id;
      const ring = fight.rings.get(id);
      const shown = arrivalAt(fight, id, time) * walker.fade;
      if (ring) {
        ctx.globalAlpha = shown;
        drawRing(ctx, walker.x, walker.y, ringShare(ring, time), ringStrength(ring, time), ink);
        ctx.globalAlpha = 1;
      }
      const dodge = fight.dodges.get(id);
      if (dodge) {
        const [cx, cy] = feet(walker.actor.fromX, walker.actor.fromY);
        drawDust(ctx, cx, cy, (time - dodge.since) / DODGE_TICKS, ink);
      }
    }
    const still = (squash: number): Pose => ({ ...STANDING, stride: 0, squash });
    const parts = partsIn(world);
    const sink = (fallen: Fallen, alpha: number, collapse: number): void => {
      const [cx, cy] = feet(fallen.x, fallen.y);
      ctx.globalAlpha = alpha;
      if (fallen.kind === ADVENTURER) {
        // A resident topples over the way it faced, about its feet, and lies there.
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(fallen.facing * collapse * Math.PI * 0.47);
        drawFigure(
          ctx,
          0,
          0,
          still(collapse),
          {
            ...identity(fallen.id),
            ...parts(fallen.id),
            ink,
            paper,
            facing: fallen.facing,
            scale: FIGURE_SCALE,
          },
          0,
        );
        ctx.restore();
      } else {
        drawBeast(
          ctx,
          fallen.kind,
          cx,
          cy,
          still(0),
          {
            body: css(fallen.kind === "wolf" ? palette.wash.wolf : palette.wash.goblin),
            ink,
            paper,
            facing: fallen.facing,
            scale: FIGURE_SCALE,
          },
          collapse,
        );
      }
      ctx.globalAlpha = 1;
    };
    for (const fallen of fight.fallen) {
      if (fallen.kind === ADVENTURER) {
        const at = lyingAt(fallen, time);
        if (at && at.alpha > 0) sink(fallen, at.alpha, at.tip);
        continue;
      }
      const at = fallenAt(fallen, time);
      if (at && at.collapse < 1) sink(fallen, 1 - at.collapse, at.collapse);
    }
    for (const gone of fight.gone) {
      const left = 1 - (time - gone.since) / ARRIVE_TICKS;
      if (left > 0 && left <= 1) sink(gone, left, 0);
    }
  }

  /** How a figure is drawn in these inks. */
  private figureStyle(world: World, palette: Palette): (id: number, scale: number) => FigureStyle {
    const ink = css(palette.ink);
    const paper = css(palette.paper);
    const parts = partsIn(world);
    return (id, scale) => ({
      ...identity(id),
      ...parts(id),
      ink,
      paper,
      facing: this.facing.get(id) ?? 1,
      scale,
    });
  }

  /**
   * How a resident on the page is drawn. In night ink a figure's face is pale,
   * a shade below the ink of its outline and warm, as the faces in lamplight
   * on the map are, with an eye in the paper's dark. Its pack keeps the paper.
   */
  private pageStyle(world: World, palette: Palette): (id: number, scale: number) => FigureStyle {
    const style = this.figureStyle(world, palette);
    const night =
      palette.ink === NIGHT.ink ? { face: css(NIGHT_FACE), eye: css(palette.paper) } : {};
    return (id, scale) => ({ ...style(id, scale), ...night });
  }

  /**
   * The map inside its outer rule, in map pixels. Walkers, their names and
   * lights and the marks of a fight are drawn only here, so nothing that walks
   * off the map is drawn in the margin or beside the page.
   */
  private inRule(): [number, number, number, number] {
    return [RULE_MARGIN, RULE_MARGIN, this.width - 2 * RULE_MARGIN, this.height - 2 * RULE_MARGIN];
  }

  /**
   * The part of the frame that is only map, in frame pixels. Beside the map,
   * the thin margin outside its rule belongs to the page; with the page below,
   * the paper either side of the map goes with the map.
   */
  private mapOnly(): [number, number, number, number] {
    if (this.pageBelow) return [0, 0, this.frameWidth, this.height];
    return this.inRule();
  }

  /** Starts a path round everything that is not only map, to fill or clip "evenodd", in frame pixels. */
  private pageArea(ctx: Ctx): void {
    ctx.beginPath();
    ctx.rect(0, 0, this.frameWidth, this.frameHeight);
    ctx.rect(...this.mapOnly());
  }

  /** The page beside the map and the line beneath it. */
  private page(
    ctx: Ctx,
    world: World,
    roster: readonly Actor[],
    palette: Palette,
    style: (id: number, scale: number) => Parameters<typeof drawFigure>[4],
  ): void {
    const ink = css(palette.ink);
    const below = this.pageBelow;
    // The page's own corner, and the edges its lines run between.
    // Below the map, the page is as wide as the map and drawn under it (the sheet
    // is already shifted to where the map is).
    const left = below ? 40 : this.width + 50;
    const right = below ? this.width - 40 : this.frameWidth - 40;
    const residents = roster.filter(isResident);
    const listed = residents.slice(0, ROSTER_ROWS);
    const rows = Math.ceil(listed.length / this.columns);
    // In a tall window there can be paper to spare under the page: the rows open
    // out a little and the rest goes above and below what is written.
    const spread = below ? spreadPage(this.frameHeight - this.height, rows) : { open: 0, shift: 0 };
    const top0 = below ? this.height + spread.shift : 0;
    const { day, hour, minute } = clock(world);
    const part = phaseName(hour + minute / 60);
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    ctx.textAlign = "left";

    ctx.font = '76px "Fell SC"';
    ctx.fillText("Idlin", left, top0 + 100);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, top0 + 124);
    ctx.lineTo(right, top0 + 124);
    ctx.stroke();
    ctx.font = '72px "Fell"';
    ctx.fillText(this.clockShown ? `${two(hour)}:${two(minute)}` : "—", left, top0 + 208);
    if (this.clockShown) {
      ctx.font = '30px "Fell Italic"';
      ctx.fillText(`Day ${day + 1}, ${part}`, left + 2, top0 + 252);
    }
    if (this.notice !== "") {
      ctx.font = '27px "Fell Italic"';
      ctx.textAlign = "right";
      ctx.globalAlpha = 0.7;
      ctx.fillText(this.notice, right, top0 + 208);
      ctx.globalAlpha = 1;
      ctx.textAlign = "left";
    }

    // Beside the map, the line of news goes below the map if there is room
    // there. In a frame only as tall as the map it goes at the foot of the
    // page, and the rows close up to leave it room.
    const strip = !below && this.frameHeight - this.height >= NEWS_STRIP;
    const pitch = (below || strip ? ROW_PITCH : TIGHT_PITCH) + spread.open;
    // A row's three lines sit closest in a tight row, and spread apart as it gets taller.
    const air = Math.min(20, pitch - TIGHT_PITCH);
    // The rule line sits nearer the name than the levels, so its descenders keep clear of the marks.
    const nameLine = 36 + Math.round(air * 0.3);
    const ruleLine = 62 + Math.round(air * 0.7);
    const levelLine = 95 + Math.round(air * 0.95);
    const gap = 40;
    const columnWidth = (right - left + gap) / this.columns;
    listed.forEach((actor, index) => {
      const column = index % this.columns;
      const x0 = left + column * columnWidth;
      const x1 = x0 + columnWidth - gap;
      const top = top0 + PAGE_HEAD + Math.floor(index / this.columns) * pitch;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, top + 0.5);
      ctx.lineTo(x1, top + 0.5);
      ctx.stroke();
      // Someone off the map is listed faded, with where they are in place of what they do.
      const away = this.away.get(actor.id);
      ctx.globalAlpha = away === undefined ? 1 : AWAY_ALPHA;
      const feet = top + 90 + Math.round(air * 0.5);
      drawFigure(ctx, x0 + 34, feet, STANDING, { ...style(actor.id, 1.5), facing: 1 }, 0);
      ctx.fillStyle = ink;
      // Hitpoints at the end of the name's line; the name keeps clear of them.
      const max = kindOf(world, actor).hp;
      const hpRoom = hpWidth(ctx, actor.hp, max) + 16;
      drawHp(ctx, actor.hp, max, x1, top + nameLine);
      ctx.font = '42px "Fell SC"';
      const nameRoom = Math.max(40, x1 - x0 - 86 - hpRoom);
      ctx.fillText(actor.name, x0 + 86, top + nameLine, nameRoom);
      // The resident's mark after its name, where there is room for it.
      const nameEnd = Math.min(ctx.measureText(actor.name).width, nameRoom);
      if (nameEnd + 40 <= nameRoom)
        drawMarkGlyph(
          ctx,
          looks(actor.id).mark,
          x0 + 86 + nameEnd + 22,
          top + nameLine - 14,
          22,
          ink,
          2.4,
        );
      // What the actor's program is doing, in the program's own words: the label of the rule that fired.
      // One downed and resting at camp runs no program, so its last rule is not what it is doing.
      const label = world.programs[actor.program]?.rules[actor.rule];
      const downed = this.fight.downs.has(actor.id) && actor.wait > 0;
      ctx.font = '31px "Fell Italic"';
      const doing = downed ? "downed" : actor.fault !== 0 ? "confused" : (label ?? "");
      ctx.fillText(
        away === undefined ? doing : `in ${away}`,
        x0 + 86,
        top + ruleLine,
        x1 - x0 - 86,
      );
      drawLevels(ctx, actor, x0 + 86, x1, top + levelLine);
      ctx.globalAlpha = 1;
    });
    const foot = top0 + PAGE_HEAD + rows * pitch;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, foot + 0.5);
    ctx.lineTo(right, foot + 0.5);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const more =
      residents.length > listed.length ? `and ${residents.length - listed.length} more` : "";

    // The line of news: the last thing a program decided, or the day if nothing
    // has happened yet and the clock is shown.
    const line = this.news !== "" ? this.news : this.clockShown ? `Day ${day + 1}, ${part}.` : "";
    if (strip) {
      ctx.font = '36px "Fell Italic"';
      ctx.fillText(line, 28, this.height + 49, this.width - 56);
    } else {
      ctx.font = '30px "Fell Italic"';
      const y = below ? foot + 62 : this.frameHeight - 26;
      ctx.fillText(line, left, y, right - left - (below && more ? 240 : 0));
    }
    if (more) {
      ctx.font = '30px "Fell Italic"';
      if (below) {
        ctx.textAlign = "right";
        ctx.fillText(more, right, foot + 62);
        ctx.textAlign = "left";
      } else ctx.fillText(more, left, foot + 40);
    }
  }

  /**
   * Smoke over a fire: a wavy line that rises from the flame, leans east and
   * fades out, as heavy as the grass ticks at its foot and thinner as it rises.
   * The waves travel up it slowly, about one every eight seconds.
   */
  private smoke(ctx: Ctx, [x, y]: readonly [number, number], palette: Palette, time: number): void {
    const at = (t: number): [number, number] => [
      x + t * t * 30 + Math.sin(t * 8 - time * 0.08) * 5 * t,
      y - 34 - t * 72,
    ];
    ctx.strokeStyle = css(palette.ink);
    ctx.lineCap = "round";
    // In short pieces, each fainter than the one below it.
    const pieces = 12;
    for (let i = 0; i < pieces; i++) {
      ctx.lineWidth = 2.6 - (1.2 * i) / pieces;
      ctx.globalAlpha = 0.85 * (1 - i / pieces);
      ctx.beginPath();
      ctx.moveTo(...at(i / pieces));
      ctx.lineTo(...at((i + 0.5) / pieces));
      ctx.lineTo(...at((i + 1) / pieces));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
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
    const { data } = this.out.getImageData(0, 0, this.frameWidth, this.frameHeight);
    const columns = Math.ceil(this.frameWidth / TILE);
    const rows = Math.ceil(this.frameHeight / TILE);
    const sums = new Array<number>(columns * rows).fill(0);
    const counts = new Array<number>(columns * rows).fill(0);
    for (let y = 0; y < this.frameHeight; y++) {
      const row = Math.floor(y / TILE) * columns;
      for (let x = 0; x < this.frameWidth; x++) {
        const i = (y * this.frameWidth + x) * 4;
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
