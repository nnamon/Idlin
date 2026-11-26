// The scene draws on a canvas, which the test run does not have. These tests
// give it a stand-in that records every drawing call, and check the order and
// shape of what was asked for. What the picture looks like is checked by eye,
// on captures.

import { readdirSync, readFileSync } from "node:fs";
import {
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
import { FRAME_HEIGHT, FRAME_WIDTH } from "./frame.ts";
import type { MapLabel } from "./ground.ts";
import { Scene } from "./scene.ts";

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
        if (key === "measureText") return { width: String(args[0]).length * 13 };
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
async function newScene(): Promise<{ scene: Scene; out: FakeCanvas; day: FakeCanvas }> {
  install();
  const scene = await Scene.create(
    { appendChild: () => {} } as unknown as HTMLElement,
    map,
    labels,
  );
  const sheets = canvases.filter((c) => c.width === FRAME_WIDTH && c.height === FRAME_HEIGHT);
  expect(sheets).toHaveLength(4);
  return { scene, out: sheets[0] as FakeCanvas, day: sheets[1] as FakeCanvas };
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
