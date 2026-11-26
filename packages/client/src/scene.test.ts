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
import type { MapLabel } from "./ground.ts";
import { FRAME_HEIGHT, FRAME_WIDTH, Scene } from "./scene.ts";

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

function newWorld(): World {
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
      NAMES.map((name, i) => ({ name, program: PROGRAMS[i % 3] as string })),
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
