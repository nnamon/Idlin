// The scene draws on a canvas, which the test run does not have. These tests
// give it a stand-in that records every drawing call, and check the order and
// shape of what was asked for. What the picture looks like is checked by eye,
// on captures.

import { readdirSync, readFileSync } from "node:fs";
import {
  type Actor,
  compileBots,
  createWorld,
  parseMap,
  placeConstants,
  spawnsNearCamp,
  step,
  type World,
} from "@idlin/sim";
import { beforeAll, describe, expect, it } from "vitest";
import mapJson from "../../../content/maps/first-light.json";
import { FRAME_HEIGHT, FRAME_WIDTH, ROW_PITCH, spreadPage } from "./frame.ts";
import type { MapLabel } from "./ground.ts";
import { actorPose } from "./pose.ts";
import { Scene } from "./scene.ts";
import type { Box } from "./tags.ts";

interface Call {
  readonly op: string;
  readonly args: readonly unknown[];
  /** For lettering, the fill colour in force when it was drawn. */
  readonly fill: unknown;
}

interface FakeCanvas {
  width: number;
  height: number;
  calls: Call[];
  getContext(): unknown;
}

/** Every canvas made since the last `install`, in the order they were made. */
let canvases: FakeCanvas[] = [];

function fakeCanvas(): FakeCanvas {
  const state: Record<string, unknown> = {};
  const canvas: FakeCanvas = { width: 0, height: 0, calls: [], getContext: () => ctx };
  const gradient = { addColorStop: () => {} };
  const ctx = new Proxy(state, {
    get(_, key: string) {
      if (key in state) return state[key];
      return (...args: unknown[]) => {
        canvas.calls.push({
          op: key,
          args: args.map((arg) => (typeof arg === "object" ? "object" : arg)),
          fill: key === "fillText" ? state.fillStyle : undefined,
        });
        // 13 pixels a letter, and the letter spacing in force after each.
        if (key === "measureText")
          return {
            width:
              String(args[0]).length * (13 + (Number.parseFloat(String(state.letterSpacing)) || 0)),
          };
        if (key === "createRadialGradient" || key === "createLinearGradient") return gradient;
        if (key === "createImageData")
          return { data: new Uint8ClampedArray((args[0] as number) * (args[1] as number) * 4) };
        return undefined;
      };
    },
    set(_, key: string, value) {
      state[key] = value;
      return true;
    },
  });
  // A real context knows its canvas.
  state.canvas = canvas;
  canvases.push(canvas);
  return canvas;
}

function install(): void {
  canvases = [];
  (globalThis as { document?: unknown }).document = {
    createElement: fakeCanvas,
    fonts: { load: async () => [] },
  };
}

const map = parseMap(mapJson);
const labels = (mapJson as { labels?: MapLabel[] }).labels ?? [];
const NAMES = ["Ash", "Birch", "Cedar", "Dara", "Elm", "Fen"];
const PROGRAMS = ["wanderer", "homebody", "riverwalker"];

function newWorld(residents = 6): World {
  const dir = new URL("../../../content/bots/", import.meta.url);
  const sources = Object.fromEntries(
    readdirSync(dir)
      .filter((file) => file.endsWith(".tac"))
      .map((file) => [file.slice(0, -4), readFileSync(new URL(file, dir), "utf8")]),
  );
  const world = createWorld(map, 1, compileBots(sources, placeConstants(map)));
  step(
    world,
    spawnsNearCamp(
      world,
      Array.from({ length: residents }, (_, i) => ({
        name: NAMES[i] ?? `Extra${i}`,
        program: PROGRAMS[i % 3] as string,
      })),
    ),
  );
  return world;
}

/** A scene and the four frame-sized sheets it draws on: the frame itself, day, night and the lit mask. */
async function newScene(): Promise<{
  scene: Scene;
  out: FakeCanvas;
  day: FakeCanvas;
  lit: FakeCanvas;
}> {
  install();
  const scene = await Scene.create(
    { appendChild: () => {} } as unknown as HTMLElement,
    map,
    labels,
  );
  const sheets = canvases.filter((c) => c.width === FRAME_WIDTH && c.height === FRAME_HEIGHT);
  expect(sheets).toHaveLength(4);
  return {
    scene,
    out: sheets[0] as FakeCanvas,
    day: sheets[1] as FakeCanvas,
    lit: sheets[3] as FakeCanvas,
  };
}

/** The calls one draw makes on a sheet. */
function drawn(sheet: FakeCanvas, draw: () => void): Call[] {
  sheet.calls = [];
  draw();
  return sheet.calls;
}

// Ticks from the 06:00 start to a little into nightfall, and on to midnight.
const TO_NIGHTFALL = Math.round((20.1 - 6) * 600);
const TO_MIDNIGHT = 18 * 600;

describe("the scene", () => {
  let nightfall: { frame: Call[]; daySheet: Call[] };
  let midnight: { frame: Call[]; daySheet: Call[] };
  /** The same moments drawn by a scene that had drawn before and by one that had not. */
  const pairs: { watched: Call[]; unwatched: Call[] }[] = [];

  beforeAll(async () => {
    // Two scenes follow the same world. One draws often, at whole ticks and
    // between them; the other only takes note of each tick.
    const world = newWorld();
    const watched = await newScene();
    const unwatched = await newScene();
    watched.scene.observe(world);
    unwatched.scene.observe(world);
    const shot = () => {
      const daySheet = drawn(watched.day, () => {
        watched.out.calls = [];
        watched.scene.draw(world, world.tick);
      });
      // Copies: later draws go on adding to the sheets' own lists.
      return { frame: [...watched.out.calls], daySheet: [...daySheet] };
    };
    for (let tick = 1; tick <= TO_MIDNIGHT; tick++) {
      step(world);
      watched.scene.observe(world);
      unwatched.scene.observe(world);
      // The first minute, when all six leave camp in a knot and names have to make room,
      // and the last one, when they are back round the fire.
      if (tick <= 600 || tick > TO_MIDNIGHT - 600) {
        watched.scene.draw(world, world.tick + 0.4);
        if (tick % 50 === 0) {
          pairs.push({
            watched: [...drawn(watched.out, () => watched.scene.draw(world, world.tick))],
            unwatched: [...drawn(unwatched.out, () => unwatched.scene.draw(world, world.tick))],
          });
        }
      }
      if (tick === TO_NIGHTFALL) nightfall = shot();
    }
    midnight = shot();
  }, 120_000);

  it("draws the same frame whether or not earlier frames were drawn", () => {
    expect(pairs).toHaveLength(24);
    for (const pair of pairs) {
      expect(pair.watched.length).toBeGreaterThan(50);
      expect(pair.unwatched).toEqual(pair.watched);
    }
    // The comparison means something only if names did have to move aside at some point.
    const leaders = pairs.map(
      ({ watched }) => watched.filter((call) => call.op === "lineTo").length,
    );
    expect(Math.max(...leaders)).toBeGreaterThan(0);
  });

  it("puts all lettering on the map after everything else, each piece in one ink", () => {
    for (const { frame } of [nightfall, midnight]) {
      const texts = frame.flatMap((call, at) => (call.op === "fillText" ? [{ call, at }] : []));
      const written = texts.map(({ call }) => call.args[0]);
      for (const name of NAMES) expect(written).toContain(name);
      for (const label of labels) expect(written).toContain(label.text);
      const lastPicture = frame.findLastIndex((call) => call.op === "drawImage");
      for (const { at } of texts) expect(at).toBeGreaterThan(lastPicture);
      // Nothing that fades is in force while lettering goes on.
      for (const { call } of texts) expect(String(call.fill)).toMatch(/^rgba\(.*, (1|0\.8)\)$/);
      // Each name's slip of paper reaches 21 pixels above the name's baseline.
      const slips = frame.flatMap((call, at) => (call.op === "roundRect" ? [at] : []));
      expect(slips).toHaveLength(NAMES.length);
      for (const at of slips) {
        const name = frame.slice(at).find((call) => call.op === "fillText") as Call;
        expect((name.args[2] as number) - ((frame[at] as Call).args[1] as number)).toBe(21);
      }
    }
  });

  it("at full night draws the day sheet only where a lamp reaches", () => {
    const clips = midnight.daySheet.filter((call) => call.op === "clip");
    expect(clips).toHaveLength(1);
    const before = midnight.daySheet.slice(0, midnight.daySheet.indexOf(clips[0] as Call));
    // One circle per light: the lantern, the fire and one carried by each resident.
    expect(before.filter((call) => call.op === "arc")).toHaveLength(2 + NAMES.length);
    expect(before.some((call) => call.op === "fillRect" || call.op === "drawImage")).toBe(false);
    // While the dark is still closing in, all of it is drawn.
    expect(nightfall.daySheet.some((call) => call.op === "clip")).toBe(false);
    expect(nightfall.daySheet.length).toBeGreaterThan(50);
  });

  it("fills a wider frame: the sheets grow and the page's rules run to the new edge", async () => {
    const { scene, out, day } = await newScene();
    const world = newWorld();
    scene.observe(world);
    const reach = (calls: Call[]): number =>
      Math.max(...calls.filter((c) => c.op === "lineTo").map((c) => c.args[0] as number));
    const plain = reach(drawn(day, () => scene.draw(world, world.tick)));
    expect(plain).toBe(FRAME_WIDTH - 40);
    scene.resize(2200, FRAME_HEIGHT);
    expect([out.width, out.height, day.width]).toEqual([2200, FRAME_HEIGHT, 2200]);
    expect(reach(drawn(day, () => scene.draw(world, world.tick)))).toBe(2200 - 40);
    // Everything that paints or copies the whole frame follows its new size.
    const paper = (calls: Call[]): Call | undefined => calls.find((c) => c.op === "fillRect");
    expect(paper(drawn(day, () => scene.draw(world, world.tick)))?.args).toEqual([
      0,
      0,
      2200,
      FRAME_HEIGHT,
    ]);
    // 06:00 has a rose cast over the whole frame.
    const tint = drawn(out, () => scene.draw(world, world.tick)).findLast(
      (c) => c.op === "fillRect",
    );
    expect(tint?.args).toEqual([0, 0, 2200, FRAME_HEIGHT]);
    // Never narrower than the plain frame, nor shorter than the map.
    scene.resize(800, 600);
    expect([out.width, out.height]).toEqual([FRAME_WIDTH, map.height * 48]);
    // In a frame only as tall as the map, the line of news is written on the page, not below the map.
    const news = (calls: Call[]): Call | undefined =>
      calls.findLast((c) => c.op === "fillText" && String(c.args[0]).startsWith("Day 1"));
    scene.resize(2200, map.height * 48);
    const onPage = news(drawn(day, () => scene.draw(world, world.tick)));
    expect(onPage?.args[1]).toBeGreaterThan(map.width * 48);
    expect(onPage?.args[2]).toBeLessThan(map.height * 48);
    // With the page below the map, everything on it is drawn under the map, in columns.
    scene.resize(map.width * 48, 2000, true, 3);
    const under = drawn(day, () => scene.draw(world, world.tick));
    const names = under.filter((c) => c.op === "fillText" && NAMES.includes(String(c.args[0])));
    expect(names).toHaveLength(6);
    for (const name of names) expect(name.args[2]).toBeGreaterThan(map.height * 48);
    expect(new Set(names.map((c) => c.args[1])).size).toBe(3);
    // Every column is inside the frame, with room for a name.
    for (const name of names) expect(name.args[1]).toBeLessThan(map.width * 48 - 300);
    expect(new Set(names.map((c) => c.args[2])).size).toBe(2);
    expect(news(under)?.args[2]).toBeGreaterThan(map.height * 48);
    scene.resize(FRAME_WIDTH, FRAME_HEIGHT);
    const below = news(drawn(day, () => scene.draw(world, world.tick)));
    // In a map-high frame with more residents than the page lists, the rows close up so
    // that "and N more" and the line of news, written one under the other, do not touch.
    const crowd = newWorld(12);
    const crowded = await newScene();
    crowded.scene.observe(crowd);
    crowded.scene.resize(2200, map.height * 48);
    const foot = drawn(crowded.day, () => crowded.scene.draw(crowd, crowd.tick));
    const more = foot.find((c) => c.op === "fillText" && c.args[0] === "and 6 more");
    const line = news(foot);
    // A 30-pixel line of italic needs about 40 pixels clear above its baseline.
    expect((line?.args[2] as number) - (more?.args[2] as number)).toBeGreaterThanOrEqual(40);
    expect(below?.args[1]).toBeLessThan(map.width * 48);
    expect(below?.args[2]).toBeGreaterThan(map.height * 48);
  });

  it("eases a figure into sitting and out of it: its name moves a little each tick, not 9 pixels at once", async () => {
    const { scene, out } = await newScene();
    const world = newWorld();
    scene.observe(world);
    const last = new Map<
      number,
      { x: number; y: number; tileX: number; tileY: number; still: boolean; resting: boolean }
    >();
    let changes = 0;
    let largest = 0;
    for (let tick = 1; tick <= 2400; tick++) {
      step(world);
      scene.observe(world);
      const calls = drawn(out, () => scene.draw(world, world.tick));
      for (const actor of world.actors) {
        const name = calls.findLast((c) => c.op === "fillText" && c.args[0] === actor.name);
        const now = {
          x: name?.args[1] as number,
          y: name?.args[2] as number,
          tileX: actor.x,
          tileY: actor.y,
          still: actor.moveTicksLeft === 0,
          resting: actorPose(actor, 0, world.tick).resting,
        };
        const before = last.get(actor.id);
        last.set(actor.id, now);
        // Only while the figure stands on one tile and its name keeps its place beside it.
        if (!before?.still || !now.still || before.x !== now.x) continue;
        if (before.tileX !== now.tileX || before.tileY !== now.tileY) continue;
        // A name that moves to another spot above or below jumps 30 pixels or more; that is not sitting.
        const moved = Math.abs(now.y - before.y);
        if (moved >= 25) continue;
        largest = Math.max(largest, moved);
        if (before.resting !== now.resting) changes++;
      }
    }
    // Figures did sit down or get up while being watched, and no name moved more than
    // a quarter of the 9-pixel drop in one tick (2.3 pixels, rounded to a whole pixel).
    expect(changes).toBeGreaterThan(2);
    expect(largest).toBeGreaterThan(0);
    expect(largest).toBeLessThanOrEqual(3);
  }, 120_000);

  it("with the page below the map in a wider frame, centres the map and the page under it", async () => {
    const { scene, out, day } = await newScene();
    const world = newWorld();
    scene.observe(world);
    const mapWidth = map.width * 48;
    scene.resize(mapWidth + 200, 2000, true, 3);
    const sheet = drawn(day, () => scene.draw(world, world.tick));
    // The day sheet is shifted 100 pixels across before anything of the map is drawn,
    // and its paper still covers the whole frame.
    expect(sheet.find((c) => c.op === "translate")?.args).toEqual([100, 0]);
    expect(sheet.find((c) => c.op === "fillRect")?.args).toEqual([-100, 0, mapWidth + 200, 2000]);
    // The page's rule runs between the map's edges, not the frame's.
    const rule = sheet.filter((c) => c.op === "lineTo").map((c) => c.args[0] as number);
    expect(Math.max(...rule)).toBe(mapWidth - 40);
    // Names and labels on the map are lettered with the same shift, then it is undone.
    const frame = drawn(out, () => scene.draw(world, world.tick));
    const shifts = frame.filter((c) => c.op === "setTransform").map((c) => c.args[4]);
    expect(shifts).toEqual([100, 0]);
    // Beside the map nothing is shifted.
    scene.resize(FRAME_WIDTH, FRAME_HEIGHT);
    const plain = drawn(day, () => scene.draw(world, world.tick));
    expect(plain.find((c) => c.op === "translate")?.args).toEqual([0, 0]);
  });

  it("eases the figure itself into sitting, and between ticks draws it part of the way", async () => {
    const { scene, day } = await newScene();
    const world = newWorld();
    scene.observe(world);
    // How far down a still figure is drawn, from the drop drawFigure applies after
    // moving to the figure's feet: 7 pixels times the depth, less the breath.
    const sitOf = (calls: Call[], actor: Actor, fraction: number): number | undefined => {
      const pose = actorPose(actor, fraction, world.tick + fraction);
      const feet = (c: Call) =>
        c.op === "translate" && c.args[0] === pose.x * 48 && c.args[1] === pose.y * 48 - 4;
      const at = calls.findIndex(feet);
      // Skip a figure that shares its spot with another: its calls can't be told apart.
      if (at < 0 || calls.findLastIndex(feet) !== at) return undefined;
      const drop = calls.slice(at + 1).find((c) => c.op === "translate" && c.args[0] === 0);
      if (!drop) return undefined;
      return ((drop.args[1] as number) + pose.breath * 0.8) / 7;
    };
    let partway = 0;
    for (let tick = 1; tick <= 2400; tick++) {
      step(world);
      scene.observe(world);
      const half = drawn(day, () => scene.draw(world, world.tick + 0.5));
      for (const actor of world.actors) {
        if (actor.moveTicksLeft !== 0) continue;
        const middle = sitOf(half, actor, 0.5);
        if (middle === undefined || middle < 0.01 || middle > 0.99) continue;
        const start = sitOf(
          drawn(day, () => scene.draw(world, world.tick)),
          actor,
          0,
        );
        const end = sitOf(
          drawn(day, () => scene.draw(world, world.tick + 1)),
          actor,
          1,
        );
        if (start === undefined || end === undefined) continue;
        // A quarter of the way further in a tick, and half of that at the half tick.
        expect(Math.abs(end - start)).toBeCloseTo(0.25);
        expect(middle).toBeCloseTo((start + end) / 2);
        partway++;
      }
    }
    expect(partway).toBeGreaterThan(2);
  }, 120_000);

  it("eases sitting once a tick, however often the tick is observed", async () => {
    const once = await newScene();
    const twice = await newScene();
    const world = newWorld();
    const sitting = (scene: Scene) => [
      ...(scene as unknown as { sitting: Map<number, readonly [number, number]> }).sitting,
    ];
    once.scene.observe(world);
    twice.scene.observe(world);
    twice.scene.observe(world);
    let partway = 0;
    for (let tick = 1; tick <= 2400; tick++) {
      step(world);
      once.scene.observe(world);
      twice.scene.observe(world);
      twice.scene.observe(world);
      expect(sitting(twice.scene)).toEqual(sitting(once.scene));
      partway += sitting(once.scene).filter(([, [, sit]]) => sit > 0 && sit < 1).length;
    }
    expect(partway).toBeGreaterThan(2);
  }, 120_000);

  it("with the page below the map, darkens the paper either side of the map with the map", async () => {
    const { scene, out, lit } = await newScene();
    const world = newWorld();
    scene.observe(world);
    const mapWidth = map.width * 48;
    const mapHeight = map.height * 48;
    const outerRadius = (width: number): number => {
      scene.resize(width, 2000, true, 3);
      world.tick = TO_NIGHTFALL;
      const calls = drawn(lit, () => scene.draw(world, world.tick));
      return calls.find((c) => c.op === "createRadialGradient")?.args[5] as number;
    };
    // The dark closes in from the far corners of the paper beside the map, so it starts farther out.
    const narrow = outerRadius(mapWidth);
    expect(outerRadius(mapWidth + 400)).toBeGreaterThan(narrow);
    const copies = (): Call[] =>
      drawn(out, () => scene.draw(world, world.tick)).filter(
        (c) => c.op === "drawImage" && c.args.length === 9,
      );
    // At nightfall and at midnight the lit drawing is copied across the whole width of the
    // frame beside the map, and no day paper is laid either side of the map.
    for (const tick of [TO_NIGHTFALL, TO_MIDNIGHT]) {
      world.tick = tick;
      const made = copies();
      expect(made[0]?.args.slice(1, 5)).toEqual([0, 0, mapWidth + 400, mapHeight]);
      for (const copy of made) expect(copy.args[1]).toBe(0);
    }
  });

  it("draws smoke rising from the fire and leans the trees, both moving with time", async () => {
    const { scene, day } = await newScene();
    const world = newWorld();
    scene.observe(world);
    const ground = (
      scene as unknown as {
        day: { ground: { fires: [number, number][]; standing: { sways: boolean }[] } };
      }
    ).day.ground;
    expect(ground.fires.length).toBeGreaterThan(0);
    const trees = ground.standing.filter((thing) => thing.sways).length;
    expect(trees).toBeGreaterThan(0);
    const at = (tick: number) => {
      world.tick = tick;
      return drawn(day, () => scene.draw(world, world.tick));
    };
    const smoke = (calls: Call[], [x, y]: [number, number]): number[][] => {
      const start = calls.findIndex(
        (c) => c.op === "moveTo" && c.args[0] === x && c.args[1] === y - 34,
      );
      expect(start).toBeGreaterThanOrEqual(0);
      return calls
        .slice(start)
        .filter((c) => c.op === "moveTo" || c.op === "lineTo")
        .slice(0, 36)
        .map((c) => c.args as number[]);
    };
    const leans = (calls: Call[]): number[] =>
      calls.flatMap((c, i) => {
        if (c.op !== "transform") return [];
        // The tree is drawn from its foot, so it leans about the foot.
        const tree = calls[i + 1] as Call;
        expect(tree.op).toBe("drawImage");
        expect(tree.args[1]).toBeLessThan(0);
        expect(tree.args[2]).toBeLessThan(0);
        return [-(c.args[2] as number)];
      });
    const early = at(100);
    const later = at(160);
    for (const fire of ground.fires) {
      const [a, b] = [smoke(early, fire), smoke(later, fire)];
      // Twelve pieces, rising 106 pixels above the fire's foot; the waves move along it, the height doesn't.
      expect(a).toHaveLength(36);
      expect(a.at(-1)?.[1]).toBeCloseTo(fire[1] - 106);
      expect(b.map((p) => p[1])).toEqual(a.map((p) => p[1]));
      expect(b.map((p) => p[0])).not.toEqual(a.map((p) => p[0]));
    }
    const [first, second] = [leans(early), leans(later)];
    expect(first).toHaveLength(trees);
    expect(second).toHaveLength(trees);
    for (const lean of [...first, ...second]) expect(Math.abs(lean)).toBeLessThanOrEqual(0.026);
    expect(Math.max(...first.map(Math.abs))).toBeGreaterThan(0.01);
    const moved = first.filter((lean, i) => Math.abs(lean - (second[i] as number)) > 0.001);
    expect(moved.length).toBeGreaterThan(trees / 2);
  });

  it("spreads the page below the map over the spare paper under it", async () => {
    const { scene, day } = await newScene();
    const world = newWorld();
    scene.observe(world);
    const mapHeight = map.height * 48;
    scene.resize(map.width * 48, 2000, true, 3);
    const calls = drawn(day, () => scene.draw(world, world.tick));
    // Six residents in three columns are two rows.
    const { open, shift } = spreadPage(2000 - mapHeight, 2);
    expect(open).toBeGreaterThan(0);
    expect(shift).toBeGreaterThan(0);
    const title = calls.find((c) => c.op === "fillText" && c.args[0] === "Idlin");
    expect(title?.args[2]).toBe(mapHeight + shift + 100);
    const rows = [
      ...new Set(
        calls
          .filter((c) => c.op === "fillText" && NAMES.includes(String(c.args[0])))
          .map((c) => c.args[2] as number),
      ),
    ].sort((a, b) => a - b);
    expect(rows).toHaveLength(2);
    expect((rows[1] as number) - (rows[0] as number)).toBe(ROW_PITCH + open);
  });

  it("keeps names off the whole width of a town's name, as the context measures it", async () => {
    const { scene } = await newScene();
    const avoid = (scene as unknown as { avoid: Box[] }).avoid;
    const towns = labels.filter((label) => label.style === "town");
    expect(towns.length).toBeGreaterThan(0);
    for (const town of towns) {
      const box = avoid.find(
        (b) => (b.left + b.right) / 2 === town.x * 48 && b.bottom === town.y * 48 + 6,
      );
      // The stand-in measures 13 pixels a letter plus the label's 3 pixels of spacing.
      expect((box?.right as number) - (box?.left as number)).toBeGreaterThanOrEqual(
        town.text.length * 16,
      );
    }
  });

  it("carries the river's banks past the edge of the map instead of rounding them off", async () => {
    await newScene();
    const ground = canvases.find((c) => c.width === map.width * 48 && c.height === map.height * 48);
    const ys = (ground as FakeCanvas).calls
      .filter((call) => call.op === "lineTo" || call.op === "moveTo")
      .map((call) => call.args[1] as number);
    // The river leaves the map at the top and at the bottom; its outline is traced a tile beyond both.
    expect(Math.min(...ys)).toBeLessThan(-40);
    expect(Math.max(...ys)).toBeGreaterThan(map.height * 48 + 40);
  });
});
