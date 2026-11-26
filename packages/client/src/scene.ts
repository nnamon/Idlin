// Draws the world: ground, water, things that stand on it, actors, and the
// light of the hour. Everything that moves is a function of sim time (ticks,
// with a fraction between ticks), so the same time always gives the same frame.

import {
  type Actor,
  STEP_TICKS,
  type Terrain,
  TICKS_PER_GAME_HOUR,
  type TileMap,
  terrainAt,
  type World,
} from "@idlin/sim";
import {
  Application,
  Assets,
  Container,
  Graphics,
  Rectangle,
  RenderTexture,
  Sprite,
  Texture,
  TextureSource,
} from "pixi.js";
import dungeonUrl from "../../../assets/kenney/tiny-dungeon.png";
import townUrl from "../../../assets/kenney/tiny-town.png";
import {
  ADVENTURERS,
  BANK_CHEST,
  type Cell,
  cellFor,
  DARK_TREES,
  DEN_FLOOR,
  DIRT,
  FIRE_LOG,
  GRASS,
  PATH,
  ROCK,
  SHEET_COLUMNS,
  TILE,
  TREES,
} from "./atlas.ts";
import { ambientAt, lampStrength, toHex, washAt } from "./light.ts";

/** Screen pixels per art pixel. */
export const SCALE = 3;

const INK = 0x3e2731;
const WATER = 0x4a8fd0;
const WATER_DEEP = 0x2c5a9c;
const WATER_SHALLOW = 0x6fb1e6;
const SAND = 0xedc591;
const SAND_DARK = 0xcf9f6a;
const WATER_LIGHT = 0x9fd4f2;
const WOOD = 0xb86f50;
const WOOD_DARK = 0x8a4836;
const WOOD_LIGHT = 0xe4a672;
const DEEP_WOOD_TINT = 0x7fa99c;
/** What a lamp adds to the ambient light, and the amber it lays over what it lights. */
const LAMP_LIGHT = 0xffc890;
const LAMP_GLOW = 0xff8a2a;
const GLOW_STRENGTH = 0.3;

const CAMP_GROUND: ReadonlySet<Terrain> = new Set(["camp", "lantern", "campfire", "bank"]);
const WET: ReadonlySet<Terrain> = new Set(["water", "bridge"]);

interface Lamp {
  x: number;
  y: number;
  radius: number;
  strength: number;
  /** Phase of its slow flicker; 0 for a steady lamp. */
  flicker: number;
}

interface ActorView {
  root: Container;
  sprite: Sprite;
  shadow: Graphics;
  facing: 1 | -1;
}

const LAMP_TEXTURE_SIZE = 128;

/** A soft white disc, bright in the middle and fading to nothing at the rim. */
function lampTexture(): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = LAMP_TEXTURE_SIZE;
  canvas.height = LAMP_TEXTURE_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context");
  const half = LAMP_TEXTURE_SIZE / 2;
  const gradient = context.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.62)");
  gradient.addColorStop(0.7, "rgba(255,255,255,0.2)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, LAMP_TEXTURE_SIZE, LAMP_TEXTURE_SIZE);
  return Texture.from(canvas);
}

export interface Tag {
  readonly id: number;
  readonly name: string;
  /** Frame pixels: the point above the actor's head. */
  readonly x: number;
  readonly y: number;
}

export class Scene {
  readonly width: number;
  readonly height: number;
  private readonly things = new Container();
  private readonly ripples = new Graphics();
  private readonly flames = new Graphics();
  private readonly lightFill = new Graphics();
  private readonly lightLamps = new Container();
  private readonly glow = new Container();
  private readonly wash = new Graphics();
  private readonly lampTexture: Texture;
  private readonly lightScene = new Container();
  private readonly lightTexture: RenderTexture;
  private readonly actors = new Map<number, ActorView>();
  private readonly staticLamps: Lamp[] = [];
  private readonly fires: { x: number; y: number }[] = [];
  private readonly rippleSpots: { x: number; y: number; length: number; phase: number }[] = [];

  private readonly app: Application;
  private readonly map: TileMap;
  private readonly sheets: Record<"town" | "dungeon", Texture>;

  private constructor(app: Application, map: TileMap, sheets: Record<"town" | "dungeon", Texture>) {
    this.app = app;
    this.map = map;
    this.sheets = sheets;
    this.width = map.width * TILE * SCALE;
    this.height = map.height * TILE * SCALE;
    const view = new Container();
    view.scale.set(SCALE);
    app.stage.addChild(view);

    const ground = new Container();
    const water = new Graphics();
    this.things.sortableChildren = true;
    this.buildGround(ground, water);

    this.lightTexture = RenderTexture.create({
      width: map.width * TILE,
      height: map.height * TILE,
    });
    this.lightScene.addChild(this.lightFill, this.lightLamps);
    const light = new Sprite(this.lightTexture);
    light.blendMode = "multiply";

    this.lampTexture = lampTexture();
    view.addChild(ground, water, this.ripples, this.things, light, this.glow, this.wash);
    this.things.addChild(this.flames);
    this.flames.zIndex = 100000;
  }

  static async create(host: HTMLElement, map: TileMap): Promise<Scene> {
    TextureSource.defaultOptions.scaleMode = "nearest";
    const app = new Application();
    await app.init({
      width: map.width * TILE * SCALE,
      height: map.height * TILE * SCALE,
      background: 0x1b1420,
      antialias: false,
      autoStart: false,
      preference: "webgl",
    });
    const [town, dungeon] = (await Promise.all([
      Assets.load(townUrl),
      Assets.load(dungeonUrl),
    ])) as [Texture, Texture];
    host.appendChild(app.canvas);
    return new Scene(app, map, { town, dungeon });
  }

  private texture(cell: Cell): Texture {
    const frame = new Rectangle(
      (cell.index % SHEET_COLUMNS) * TILE,
      Math.floor(cell.index / SHEET_COLUMNS) * TILE,
      TILE,
      TILE,
    );
    return new Texture({ source: this.sheets[cell.sheet].source, frame });
  }

  private terrain(x: number, y: number): Terrain | null {
    return x >= 0 && y >= 0 && x < this.map.width && y < this.map.height
      ? terrainAt(this.map, x, y)
      : null;
  }

  private buildGround(ground: Container, water: Graphics): void {
    const { map } = this;
    const tile = (cell: Cell, x: number, y: number, tint = 0xffffff): void => {
      const sprite = new Sprite(this.texture(cell));
      sprite.position.set(x * TILE, y * TILE);
      sprite.tint = tint;
      ground.addChild(sprite);
    };
    const stand = (cell: Cell, x: number, y: number, tint = 0xffffff): void => {
      const sprite = new Sprite(this.texture(cell));
      sprite.anchor.set(0.5, 1);
      sprite.position.set(x * TILE + TILE / 2, y * TILE + TILE);
      sprite.tint = tint;
      sprite.zIndex = sprite.y;
      this.things.addChild(sprite);
    };
    const isCamp = (x: number, y: number): boolean =>
      CAMP_GROUND.has(this.terrain(x, y) ?? "grass");
    const isWet = (x: number, y: number): boolean => WET.has(this.terrain(x, y) ?? "water");

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const terrain = terrainAt(map, x, y);
        const px = x * TILE;
        const py = y * TILE;
        if (CAMP_GROUND.has(terrain)) {
          const row = !isCamp(x, y - 1) ? 0 : !isCamp(x, y + 1) ? 2 : 1;
          const column = !isCamp(x - 1, y) ? 0 : !isCamp(x + 1, y) ? 2 : 1;
          tile((DIRT[row] as (typeof DIRT)[number])[column] as Cell, x, y);
        } else if (terrain === "path") tile(PATH, x, y);
        else if (terrain === "den") tile(cellFor(DEN_FLOOR, x, y), x, y);
        else if (terrain === "rock") tile(cellFor(ROCK, x, y), x, y);
        else if (terrain === "deep_grass" || terrain === "dark_tree")
          tile(cellFor(GRASS, x, y), x, y, DEEP_WOOD_TINT);
        else if (!WET.has(terrain)) tile(cellFor(GRASS, x, y), x, y);

        if (terrain === "shore") {
          // A worn sandy patch, rounded, reaching out to any water beside it.
          water.rect(px + 4, py + 1, 8, 14).fill(SAND);
          water.rect(px + 2, py + 2, 12, 12).fill(SAND);
          water.rect(px + 1, py + 4, 14, 8).fill(SAND);
          if (isWet(x + 1, y)) water.rect(px + 8, py + 2, 8, 12).fill(SAND);
          if (isWet(x - 1, y)) water.rect(px, py + 2, 8, 12).fill(SAND);
          if (isWet(x, y + 1)) water.rect(px + 2, py + 8, 12, 8).fill(SAND);
          if (isWet(x, y - 1)) water.rect(px + 2, py, 12, 8).fill(SAND);
          water.rect(px + 4, py + 5, 2, 1).fill(SAND_DARK);
          water.rect(px + 10, py + 9, 2, 1).fill(SAND_DARK);
          water.rect(px + 7, py + 12, 1, 1).fill(SAND_DARK);
        }
        if (WET.has(terrain)) {
          water.rect(px, py, TILE, TILE).fill(WATER);
          // Banks: a dark line where water meets land, and a paler shallow band inside it.
          const banks: [boolean, number, number, number, number, number, number, number, number][] =
            [
              [!isWet(x, y - 1), px, py + 1, TILE, 2, px, py, TILE, 1],
              [!isWet(x, y + 1), px, py + TILE - 3, TILE, 2, px, py + TILE - 1, TILE, 1],
              [!isWet(x - 1, y), px + 1, py, 2, TILE, px, py, 1, TILE],
              [!isWet(x + 1, y), px + TILE - 3, py, 2, TILE, px + TILE - 1, py, 1, TILE],
            ];
          for (const [land, sx, sy, sw, sh] of banks)
            if (land) water.rect(sx, sy, sw, sh).fill(WATER_SHALLOW);
          for (const [land, , , , , ex, ey, ew, eh] of banks)
            if (land) water.rect(ex, ey, ew, eh).fill(WATER_DEEP);
          if (terrain === "water" && cellFor([0, 1], x, y) === 0) {
            this.rippleSpots.push({
              x: px + 4 + cellFor([0, 2, 4, 6], y, x),
              y: py + 5 + cellFor([0, 2, 4, 6], x + 7, y),
              length: 3 + cellFor([0, 1, 2], x + 3, y),
              phase: cellFor([0, 1, 2, 3, 4, 5, 6, 7], x, y + 11),
            });
          }
        }
        if (terrain === "bridge") {
          water.rect(px, py + 1, TILE, TILE - 2).fill(WOOD);
          for (let k = 0; k < TILE; k += 4) water.rect(px + k, py + 1, 1, TILE - 2).fill(WOOD_DARK);
          water.rect(px, py + 2, TILE, 1).fill(WOOD_LIGHT);
          water.rect(px, py, TILE, 2).fill(INK);
          water.rect(px, py + TILE - 2, TILE, 2).fill(INK);
        }

        if (terrain === "tree") stand(cellFor(TREES, x, y), x, y);
        if (terrain === "dark_tree") stand(cellFor(DARK_TREES, x, y), x, y, DEEP_WOOD_TINT);
        if (terrain === "bank") stand(BANK_CHEST, x, y);
        if (terrain === "campfire") {
          stand(FIRE_LOG, x, y);
          this.fires.push({ x: px + TILE / 2, y: py + TILE - 5 });
          this.staticLamps.push({
            x: px + TILE / 2,
            y: py + TILE / 2,
            radius: 4.2 * TILE,
            strength: 1,
            flicker: 1,
          });
        }
        if (terrain === "lantern") {
          this.things.addChild(this.lantern(px, py));
          this.staticLamps.push({
            x: px + TILE / 2,
            y: py - 4,
            radius: 7 * TILE,
            strength: 1,
            flicker: 0,
          });
        }
      }
    }
  }

  /** The great lantern: a post two tiles tall with a lit glass at the top. */
  private lantern(px: number, py: number): Graphics {
    const g = new Graphics();
    const cx = px + TILE / 2;
    const base = py + TILE;
    g.ellipse(cx, base - 1, 6, 2).fill({ color: 0x000000, alpha: 0.25 });
    g.rect(cx - 3, base - 3, 6, 3).fill(INK);
    g.rect(cx - 2, base - 22, 4, 20).fill(INK);
    g.rect(cx - 1, base - 21, 2, 18).fill(0x8b9bb4);
    g.rect(cx - 1, base - 21, 1, 18).fill(0xc0cbdc);
    g.rect(cx - 6, base - 33, 12, 12).fill(INK);
    g.rect(cx - 4, base - 31, 8, 8).fill(0xffd166);
    g.rect(cx - 2, base - 29, 4, 5).fill(0xfff3c4);
    g.rect(cx - 7, base - 35, 14, 3).fill(INK);
    g.rect(cx - 4, base - 37, 8, 2).fill(INK);
    g.zIndex = base;
    return g;
  }

  private actorView(actor: Actor): ActorView {
    let view = this.actors.get(actor.id);
    if (!view) {
      const root = new Container();
      const shadow = new Graphics().ellipse(0, 0, 5, 2).fill({ color: 0x000000, alpha: 0.28 });
      const cell = ADVENTURERS[(actor.id - 1) % ADVENTURERS.length] as Cell;
      const sprite = new Sprite(this.texture(cell));
      sprite.anchor.set(0.5, 1);
      root.addChild(shadow, sprite);
      this.things.addChild(root);
      view = { root, sprite, shadow, facing: 1 };
      this.actors.set(actor.id, view);
    }
    return view;
  }

  /** Draws the world as it is at `time` ticks (the world's tick plus a fraction of the next). */
  draw(world: World, time: number): Tag[] {
    const fraction = time - world.tick;
    const hour = (((time / TICKS_PER_GAME_HOUR + 6) % 24) + 24) % 24;
    const lamps: Lamp[] = [...this.staticLamps];
    const tags: Tag[] = [];
    const night = lampStrength(hour);

    for (const actor of world.actors) {
      const view = this.actorView(actor);
      const moving = actor.moveTicksLeft > 0;
      const progress = moving
        ? Math.min(1, (STEP_TICKS - actor.moveTicksLeft + fraction) / STEP_TICKS)
        : 1;
      // Ease in and out of each step, with a small hop and a squash on landing.
      const eased = progress * progress * (3 - 2 * progress);
      const x = (actor.fromX + (actor.x - actor.fromX) * eased) * TILE + TILE / 2;
      const y = (actor.fromY + (actor.y - actor.fromY) * eased) * TILE + TILE;
      const hop = moving ? Math.sin(Math.PI * progress) * 2.2 : 0;
      const breath = moving ? 0 : Math.sin(time * 0.16 + actor.id * 1.7) * 0.03;
      if (actor.x !== actor.fromX) view.facing = actor.x > actor.fromX ? 1 : -1;
      view.root.position.set(x, y);
      view.root.zIndex = y;
      view.sprite.y = -hop;
      view.sprite.scale.set(
        view.facing * (1 - breath * 0.5),
        1 + breath + (moving ? Math.sin(Math.PI * progress) * 0.06 : 0),
      );
      view.shadow.scale.set(1 - hop * 0.08);
      view.shadow.y = -1;
      tags.push({ id: actor.id, name: actor.name, x: x * SCALE, y: (y - TILE - 3 - hop) * SCALE });
      if (night > 0) lamps.push({ x, y: y - 6, radius: 2.1 * TILE, strength: 0.55, flicker: 0 });
    }

    this.ripples.clear();
    for (const r of this.rippleSpots) {
      const wave = Math.sin(time * 0.045 + r.phase * 0.8);
      if (wave > 0.2)
        this.ripples
          .rect(r.x, r.y, r.length, 1)
          .fill({ color: WATER_LIGHT, alpha: (wave - 0.2) * 0.9 });
    }

    this.flames.clear();
    for (const fire of this.fires) {
      const a = Math.sin(time * 0.9) * 0.5 + 0.5;
      const b = Math.sin(time * 1.3 + 2) * 0.5 + 0.5;
      this.flames.rect(fire.x - 4, fire.y - 5 - a, 8, 6 + a).fill(0xe8590c);
      this.flames.rect(fire.x - 3, fire.y - 8 - b * 2, 6, 6 + b * 2).fill(0xf59f00);
      this.flames.rect(fire.x - 1, fire.y - 10 - a * 2, 3, 5 + a * 2).fill(0xffe066);
      this.flames.rect(fire.x - 2 + b * 3, fire.y - 13 - a * 3, 1, 1).fill(0xffe066);
    }

    this.lightFill
      .clear()
      .rect(0, 0, this.map.width * TILE, this.map.height * TILE)
      .fill(toHex(ambientAt(hour)));
    // Each lamp is drawn twice with the same soft disc: once into the light map,
    // where it lifts the ambient light, and once over the world as an amber glow.
    const shown = night > 0 ? lamps : [];
    for (const [layer, tint, gain] of [
      [this.lightLamps, LAMP_LIGHT, 1],
      [this.glow, LAMP_GLOW, GLOW_STRENGTH],
    ] as const) {
      while (layer.children.length < shown.length) {
        const disc = new Sprite(this.lampTexture);
        disc.anchor.set(0.5);
        disc.blendMode = "add";
        disc.tint = tint;
        layer.addChild(disc);
      }
      layer.children.forEach((child, i) => {
        const lamp = shown[i];
        child.visible = lamp !== undefined;
        if (!lamp) return;
        const sway = lamp.flicker
          ? 1 + Math.sin(time * 0.23) * 0.012 + Math.sin(time * 0.61 + 1) * 0.006
          : 1;
        child.position.set(lamp.x, lamp.y);
        child.scale.set((lamp.radius * 2 * sway) / LAMP_TEXTURE_SIZE);
        child.alpha = lamp.strength * night * gain;
      });
    }
    const { color, alpha } = washAt(hour);
    this.wash
      .clear()
      .rect(0, 0, this.map.width * TILE, this.map.height * TILE)
      .fill({ color: toHex(color), alpha });
    this.app.renderer.render({
      container: this.lightScene,
      target: this.lightTexture,
      clear: true,
    });
    this.app.renderer.render({ container: this.app.stage });
    return tags;
  }

  /**
   * Mean brightness (0 to 255) of the frame just drawn, in blocks of one tile.
   * For measuring flicker: compare the result of two consecutive frames.
   */
  brightness(): number[] {
    const probe = document.createElement("canvas");
    probe.width = this.map.width;
    probe.height = this.map.height;
    const context = probe.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("no 2d context");
    context.drawImage(this.app.canvas, 0, 0, probe.width, probe.height);
    const { data } = context.getImageData(0, 0, probe.width, probe.height);
    const blocks: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      blocks.push(
        ((data[i] as number) * 299 +
          (data[i + 1] as number) * 587 +
          (data[i + 2] as number) * 114) /
          1000,
      );
    }
    return blocks;
  }
}
