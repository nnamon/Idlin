// The scene draws on a canvas, which the test run does not have. These tests
// give it a stand-in that records every drawing call, and check the order and
// shape of what was asked for. What the picture looks like is checked by eye,
// on captures.

import {
  type Actor,
  createWorld,
  levelFor,
  parseMap,
  placeConstants,
  spawnsNearCamp,
  step,
  type World,
} from "@idlin/sim";
import { beforeAll, describe, expect, it } from "vitest";
// The worlds here are the shipped world, whose camp region is the camp's map
// at (0, 0), where the view starts; the map's own size and labels are that
// map's. The view moves only once the spotlight goes to another region.
import mapJson from "../../../content/maps/camp.json";
import { rawWorld, shippedMonsters, shippedPrograms, shippedWorld } from "../../sim/src/testing.ts";
import { type Effects, glyphAt, NO_EFFECTS, nextEffects, routeAt } from "./effects.ts";
import { FRAME_HEIGHT, FRAME_WIDTH, ROW_PITCH, spreadPage } from "./frame.ts";
import type { MapLabel } from "./ground.ts";
import { identity } from "./identity.ts";
import { css } from "./light.ts";
import { eat, ROUTE_ROW, routeLine } from "./marks.ts";
import { DAY, NIGHT } from "./palette.ts";
import { actorPose } from "./pose.ts";
import { NEWS_STALE, Scene } from "./scene.ts";
import { FADE, MIN_HOLD, type Slips, slipAlpha } from "./slips.ts";
import { type Box, bodyBox, type TagWish } from "./tags.ts";
import { edgeFade, type Window, windowView } from "./view.ts";

interface Call {
  readonly op: string;
  readonly args: readonly unknown[];
  /** For lettering and filled shapes, the fill colour in force when it was drawn. */
  readonly fill: unknown;
  /** For strokes, the alpha and the stroke colour in force. */
  readonly alpha?: unknown;
  readonly ink?: unknown;
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
          // A gradient is noted as "object", as arguments are, so two scenes' calls compare equal.
          fill:
            key === "fillText" || key === "fillRect" || key === "fill"
              ? typeof state.fillStyle === "object"
                ? "object"
                : state.fillStyle
              : undefined,
          ...(key === "stroke" ? { alpha: state.globalAlpha ?? 1, ink: state.strokeStyle } : {}),
          ...(key === "fillText" ? { alpha: state.globalAlpha ?? 1 } : {}),
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

const WORLD = shippedWorld();
const MAPS = rawWorld().maps;
const SHIPPED = shippedPrograms(WORLD);
const MONSTERS = shippedMonsters(WORLD);
/** A line of news: it starts with whom it is about, and tells what happened to them. */
const NEWS = /^(\w+) (is|was|killed|took) /;

/** The shipped world with `residents` in it, and with its monsters if `monsters`, so there are fights to tell of. */
function newWorld(residents = 6, seed = 1, monsters = false): World {
  const world = monsters
    ? createWorld(
        WORLD,
        seed,
        { ...SHIPPED, ...MONSTERS.programs },
        MONSTERS.kinds,
        MONSTERS.spawns,
      )
    : createWorld(WORLD, seed, SHIPPED);
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
  night: FakeCanvas;
}> {
  install();
  const scene = await Scene.create(
    { appendChild: () => {} } as unknown as HTMLElement,
    WORLD,
    MAPS,
  );
  const sheets = canvases.filter((c) => c.width === FRAME_WIDTH && c.height === FRAME_HEIGHT);
  expect(sheets).toHaveLength(4);
  return {
    scene,
    out: sheets[0] as FakeCanvas,
    day: sheets[1] as FakeCanvas,
    lit: sheets[3] as FakeCanvas,
    night: sheets[2] as FakeCanvas,
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
/** Ticks from the start to 19:00. */
const EVENING = 13 * 600;

/** Routes drawn in a draw's calls on a sheet: where each ends, at the walker's feet. */
function routes(calls: readonly Call[]): [number, number][] {
  const dashes = calls.flatMap((call, at) => (call.op === "setLineDash" ? [at] : []));
  const ends: [number, number][] = [];
  for (let i = 0; i + 1 < dashes.length; i += 2) {
    const end = calls
      .slice(dashes[i], dashes[i + 1])
      .findLast((call) => call.op === "lineTo") as Call;
    ends.push([end.args[0] as number, end.args[1] as number]);
  }
  return ends;
}

/** A name's slip of paper. The tab a glyph sits on beside it is rounded on one side only. */
const isSlip = (call: Call): boolean => call.op === "roundRect" && typeof call.args[4] === "number";

/** The names written on the map: each is lettered just after its slip is filled. */
const mapNames = (calls: readonly Call[]): string[] =>
  calls.flatMap((call, at) =>
    call.op === "fillText" && at >= 2 && isSlip(calls[at - 2] as Call)
      ? [String(call.args[0])]
      : [],
  );

/** Where the scene's window was at its last draw or tick: its top-left in world pixels, and in tiles. */
const seenOf = (scene: Scene) =>
  (scene as unknown as { seen: { x: number; y: number; window: Window } }).seen;

/** The clip that keeps the day sheet to the lamps' reach; a route's clip around lettering is even-odd. */
const lampClip = (call: Call): boolean => call.op === "clip" && call.args.length === 0;
/**
 * The plain clips of the sheet itself, to the lamps' reach and the map's
 * rule; not those that band a ranked figure's hood, which come straight
 * after a `save`.
 */
const sheetClips = (calls: readonly Call[]): Call[] =>
  calls.filter((call, i) => lampClip(call) && calls[i - 1]?.op !== "save");

/** Glyphs drawn on slips: each is drawn moved into place, among the lettering. */
function glyphs(calls: readonly Call[]): number {
  const lettering = calls.findIndex((call) => call.op === "fillText");
  return calls.slice(lettering).filter((call) => call.op === "translate").length;
}

describe("the scene", () => {
  let nightfall: { frame: Call[]; daySheet: Call[] };
  let midnight: { frame: Call[]; daySheet: Call[] };
  /** The same moments drawn by a scene that had drawn before and by one that had not. */
  const pairs: {
    watched: Call[];
    unwatched: Call[];
    watchedSheets: Call[];
    unwatchedSheets: Call[];
  }[] = [];

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
      // and the last one, when they are back round the fire. And the minutes
      // after 19:00, when the homebodies turn for camp and the rule in charge
      // changes: compared more often there, since a glyph is up for 10 ticks.
      const evening = tick > EVENING && tick <= EVENING + 300;
      if (tick <= 600 || tick > TO_MIDNIGHT - 600 || evening) {
        watched.scene.draw(world, world.tick + 0.4);
        if (tick % 50 === 0 || (evening && tick % 5 === 0)) {
          // The frame, and the day and night drawings it is made from, where the figures are.
          const all = (s: typeof watched) => {
            s.day.calls = [];
            s.night.calls = [];
            const frame = [...drawn(s.out, () => s.scene.draw(world, world.tick))];
            return { frame, sheets: [...s.day.calls, ...s.night.calls] };
          };
          const a = all(watched);
          const b = all(unwatched);
          pairs.push({
            watched: a.frame,
            unwatched: b.frame,
            watchedSheets: a.sheets,
            unwatchedSheets: b.sheets,
          });
        }
      }
      if (tick === TO_NIGHTFALL) nightfall = shot();
    }
    midnight = shot();
  }, 120_000);

  it("draws the same frame whether or not earlier frames were drawn", () => {
    expect(pairs).toHaveLength(24 + 60);
    for (const pair of pairs) {
      // Something is drawn. A frame over a region with fewer names than the camp makes fewer calls.
      expect(pair.watched.length).toBeGreaterThan(30);
      expect(pair.unwatched).toEqual(pair.watched);
      expect(pair.unwatchedSheets).toEqual(pair.watchedSheets);
    }
    // Glyphs, routes and beats were among what was compared. A beat slants a
    // figure just before it is turned to face its way.
    expect(pairs.filter(({ watched }) => glyphs(watched) > 0).length).toBeGreaterThan(0);
    expect(
      pairs.filter(({ watchedSheets }) => routes(watchedSheets).length > 0).length,
    ).toBeGreaterThan(0);
    const leaning = (calls: Call[]) =>
      calls.some(
        (call, at) =>
          call.op === "transform" && call.args[2] !== 0 && calls[at + 1]?.op === "scale",
      );
    expect(pairs.filter(({ watchedSheets }) => leaning(watchedSheets)).length).toBeGreaterThan(0);
    // The comparison means something only if names did have to move aside at
    // some point. Glyphs are drawn moved into place, so their strokes are near 0.
    const leaders = pairs.map(
      ({ watched }) =>
        watched.filter((call) => call.op === "lineTo" && (call.args[0] as number) > 20).length,
    );
    expect(Math.max(...leaders)).toBeGreaterThan(0);
  });

  it("puts all lettering on the map after everything else, each piece in one ink", () => {
    for (const whole of [nightfall, midnight].map(({ frame }) => frame)) {
      // While the page turns (as at nightfall) it is drawn on the frame too; the map's lettering starts at the move onto the map.
      const start = whole.findIndex((call) => call.op === "setTransform");
      expect(start).toBeGreaterThan(whole.findLastIndex((call) => call.op === "drawImage"));
      const frame = whole.slice(start);
      const turning = whole
        .slice(0, start)
        .some((c) => c.op === "fillText" && c.args[0] === "Idlin");
      expect(turning).toBe(whole === nightfall.frame);
      const texts = frame.flatMap((call, at) => (call.op === "fillText" ? [{ call, at }] : []));
      const written = texts.map(({ call }) => call.args[0]);
      for (const name of NAMES) expect(written).toContain(name);
      for (const label of labels) expect(written).toContain(label.text);
      // Nothing that fades is in force while lettering goes on.
      for (const { call } of texts) expect(String(call.fill)).toMatch(/^rgba\(.*, (1|0\.8)\)$/);
      // Each name's slip of paper reaches 21 pixels above the name's baseline.
      const slips = frame.flatMap((call, at) => (isSlip(call) ? [at] : []));
      expect(slips).toHaveLength(NAMES.length);
      for (const at of slips) {
        const name = frame.slice(at).find((call) => call.op === "fillText") as Call;
        expect((name.args[2] as number) - ((frame[at] as Call).args[1] as number)).toBe(21);
      }
    }
  });

  it("at full night draws the day sheet only where a lamp reaches", () => {
    // Three plain clips: first to the lamps' reach, then, inside that, the
    // ground to the map, and what stands on it to the map's rule. The world
    // is drawn moved by where the window is, so the rule is in world pixels.
    const clips = sheetClips(midnight.daySheet);
    expect(clips).toHaveLength(3);
    const at = (clip: Call) => midnight.daySheet[midnight.daySheet.indexOf(clip) - 1];
    const ground = at(clips[1] as Call) as Call;
    expect(ground.op).toBe("rect");
    const [x, y] = ground.args as [number, number];
    expect(ground.args).toEqual([x, y, map.width * 48, map.height * 48]);
    const rule = at(clips[2] as Call);
    expect(rule?.op === "rect" && rule.args).toEqual([
      x + 5,
      y + 5,
      map.width * 48 - 10,
      map.height * 48 - 10,
    ]);
    const before = midnight.daySheet.slice(0, midnight.daySheet.indexOf(clips[0] as Call));
    // One circle per light: the lantern, the fire and one carried by each resident.
    expect(before.filter((call) => call.op === "arc")).toHaveLength(2 + NAMES.length);
    expect(before.some((call) => call.op === "fillRect" || call.op === "drawImage")).toBe(false);
    // While the dark is still closing in, all of it is drawn: the plain clips are the map's.
    expect(sheetClips(nightfall.daySheet)).toHaveLength(2);
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
    // 06:00 has a rose cast, laid on the day drawing of the map inside the paper
    // round its rule, and more lightly on the page and that paper.
    const calls = drawn(day, () => scene.draw(world, world.tick));
    const tint = calls.findLast((c) => c.op === "fillRect");
    expect(tint?.args).toEqual([5, 5, map.width * 48 - 10, map.height * 48 - 10]);
    const pageTint = calls.slice(calls.indexOf(tint as Call)).find((c) => c.op === "fill");
    const alpha = (style: unknown): number => Number(String(style).match(/, ([\d.]+)\)$/)?.[1]);
    expect(alpha(tint?.fill)).toBeGreaterThan(0);
    expect(alpha(pageTint?.fill)).toBeCloseTo(alpha(tint?.fill) / 2);
    expect(drawn(out, () => scene.draw(world, world.tick)).some((c) => c.op === "fillRect")).toBe(
      false,
    );
    // Never narrower than the plain frame, nor shorter than the map.
    scene.resize(800, 600);
    expect([out.width, out.height]).toEqual([FRAME_WIDTH, map.height * 48]);
    // In a frame only as tall as the map, the line of news is written on the page, not below the map.
    const news = (calls: Call[]): Call | undefined =>
      // The day, or when the world has residents, what one of them is doing.
      calls.findLast((c) => c.op === "fillText" && /^(Day 1|\w+ is )/.test(String(c.args[0])));
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
    // Nothing has happened yet, so it tells of one of the six the page does not list.
    const listed = foot.filter(
      (c) =>
        c.op === "fillText" &&
        (c.args[1] as number) > map.width * 48 &&
        crowd.actors.some((a) => a.name === c.args[0]),
    );
    expect(listed).toHaveLength(6);
    const told = String(line?.args[0]).split(" is ")[0];
    expect(crowd.actors.map((a) => a.name)).toContain(told);
    expect(listed.map((c) => c.args[0])).not.toContain(told);
    // A 30-pixel line of italic needs about 40 pixels clear above its baseline.
    expect((line?.args[2] as number) - (more?.args[2] as number)).toBeGreaterThanOrEqual(40);
    expect(below?.args[1]).toBeLessThan(map.width * 48);
    expect(below?.args[2]).toBeGreaterThan(map.height * 48);
  });

  it("in a crowd writes at most eight names on the map; with six, all of them", async () => {
    // Thirty residents, and twelve with monsters about, start out together at
    // camp, so slips come as they are named in the news of their fights or
    // wander apart. (Thirty are more than the camp's region lets monsters come
    // to, so there is news only among the twelve.) Every frame keeps to the
    // budget, and whoever the line of news names can be found on the map once
    // their slip has had time to come: a slip held only for standing alone
    // lasts at least MIN_HOLD before it gives way, then both fade.
    let found = 0;
    for (const crowd of [newWorld(30), newWorld(12, 1, true)]) {
      const { scene, out, day } = await newScene();
      scene.observe(crowd);
      let most = 0;
      let line = "";
      let lineSince = 0;
      const offSince = new Map<string, number>();
      for (let i = 0; i < TO_NIGHTFALL + 1200; i++) {
        step(crowd);
        scene.observe(crowd);
        if (i % 10 !== 9) continue;
        day.calls = [];
        const calls = drawn(out, () => scene.draw(crowd, crowd.tick));
        const onMap = mapNames(calls);
        expect(onMap.length).toBeLessThanOrEqual(8);
        most = Math.max(most, onMap.length);
        const now = String(
          [...day.calls, ...calls].findLast(
            (c) => c.op === "fillText" && NEWS.test(String(c.args[0])),
          )?.args[0] ?? "",
        );
        if (now !== line) [line, lineSince] = [now, crowd.tick];
        // When each was last out of the view, or stepping into or out of it.
        const { window } = seenOf(scene);
        const off = (x: number, y: number): boolean =>
          x < window.x || x >= window.x + map.width || y < window.y || y >= window.y + map.height;
        for (const a of crowd.actors)
          if (off(a.x, a.y) || off(a.fromX, a.fromY)) offSince.set(a.name, crowd.tick);
        const settled = (since: number): boolean => crowd.tick - since > MIN_HOLD + 2 * FADE;
        if (line === "" || !settled(lineSince)) continue;
        // Someone named who has since walked off the map is not looked for
        // until their slip has had time to come again after they are back:
        // the news may name them long after it happened.
        const named = NEWS.exec(line)?.[1] ?? "";
        if (!settled(offSince.get(named) ?? Number.NEGATIVE_INFINITY)) continue;
        expect(onMap).toContain(named);
        found++;
      }
      expect(most).toBeGreaterThan(0);
    }
    expect(found).toBeGreaterThan(5);
    // Six residents or fewer: every one keeps a name.
    const few = newWorld(6);
    const small = await newScene();
    small.scene.observe(few);
    for (let i = 0; i < 20; i++) {
      step(few);
      small.scene.observe(few);
    }
    const names = mapNames(drawn(small.out, () => small.scene.draw(few, few.tick)));
    expect(new Set(names).size).toBe(6);
  }, 60_000);

  it("with twelve residents writes eight names, from the first frame on", async () => {
    const twelve = newWorld(12);
    const { scene, out } = await newScene();
    const onMap = (): number => mapNames(drawn(out, () => scene.draw(twelve, twelve.tick))).length;
    scene.observe(twelve);
    // The first frame of a run is drawn at the tick it starts on: no fade-in, no unnamed second.
    expect(onMap()).toBe(8);
    const counts: number[] = [];
    for (let i = 0; i < 3000; i++) {
      step(twelve);
      scene.observe(twelve);
      if (i % 10 !== 9) continue;
      const count = onMap();
      // Counted while the view is on the camp, where most of the twelve are.
      const { x, y } = seenOf(scene);
      if (x === 0 && y === 0) counts.push(count);
    }
    expect(counts.length).toBeGreaterThan(150);
    expect(Math.max(...counts)).toBe(8);
    // Slips change hands now and then and fade as they do; most of the time all eight are out.
    expect(counts.filter((n) => n === 8).length).toBeGreaterThan(counts.length * 0.8);
  }, 60_000);

  it("draws glyphs and routes only for residents with a name slip", async () => {
    // Twelve residents and eight slips: four go without. A second record of the
    // effects, kept here, says who had a glyph or a route under way.
    const twelve = newWorld(12);
    const { scene, out, day } = await newScene();
    const camp = placeConstants(map).camp as { x: number; y: number };
    let effects = NO_EFFECTS;
    scene.observe(twelve);
    effects = nextEffects(effects, twelve.actors, twelve.tick, camp);
    let routesDrawn = 0;
    let glyphsDrawn = 0;
    let routesWithout = 0;
    let glyphsWithout = 0;
    let fading = 0;
    for (let tick = 1; tick <= EVENING + 300; tick++) {
      step(twelve);
      scene.observe(twelve);
      effects = nextEffects(effects, twelve.actors, twelve.tick, camp);
      if (tick % 5 !== 0 || (tick > 900 && tick <= EVENING)) continue;
      day.calls = [];
      const frame = drawn(out, () => scene.draw(twelve, twelve.tick));
      const named = new Set(mapNames(frame));
      const time = twelve.tick;
      const slips = (scene as unknown as { slips: Slips }).slips;
      const walking = (a: Actor) => a.path.length > 0 || a.moveTicksLeft > 0;
      const withRoute = twelve.actors.filter(
        (a) => walking(a) && (routeAt(effects, a.id, time)?.line ?? 0) > 0,
      );
      const withGlyph = twelve.actors.filter((a) => glyphAt(effects, a.id, time));
      routesWithout += withRoute.filter((a) => !named.has(a.name)).length;
      glyphsWithout += withGlyph.filter((a) => !named.has(a.name)).length;
      // A route not yet being taken up starts at the feet of a walker whose name
      // is on the map, on the line routes run along. Residents walk through each
      // other, so two may stand on the one spot.
      const ends = routes(day.calls);
      for (const a of withRoute.filter(
        (a) => named.has(a.name) && routeAt(effects, a.id, time)?.eaten === 0,
      )) {
        const pose = actorPose(a, 0, time);
        const feet = ends.some(
          ([x, y]) => Math.abs(pose.x * 48 - x) < 0.01 && Math.abs(pose.y * 48 - 19.2 - y) < 0.01,
        );
        expect(feet).toBe(true);
      }
      // What is left of a route all but eaten up can be a pixel long or less, and
      // is not drawn; every other route of a named walker is. Its line is worked
      // out as the scene does, from the walker on the map along its path there.
      const seen = new Map(windowView(twelve, seenOf(scene).window).actors.map((a) => [a.id, a]));
      const longEnough = (a: Actor): boolean => {
        const route = routeAt(effects, a.id, time);
        const on = seen.get(a.id);
        if (!route || !on) return false;
        const pose = actorPose(on, 0, time);
        const ahead = on.moveTicksLeft > 0 ? [{ x: on.x, y: on.y }] : [];
        const line = eat(
          routeLine(
            [pose.x * 48, (pose.y - 1 + ROUTE_ROW) * 48],
            [...ahead, ...on.path],
            48,
            on.id,
            route.lane,
            route.goal,
          ),
          route.eaten,
        );
        const [first, end] = [line[0], line[line.length - 1]];
        return (
          line.length > 1 &&
          !!first &&
          !!end &&
          Math.hypot(first[0] - end[0], first[1] - end[1]) > 1
        );
      };
      expect(ends).toHaveLength(withRoute.filter((a) => named.has(a.name) && longEnough(a)).length);
      expect(glyphs(frame)).toBe(withGlyph.filter((a) => named.has(a.name)).length);
      routesDrawn += ends.length;
      glyphsDrawn += glyphs(frame);
      // Both fade with the slip: the alpha each is stroked at carries the slip's.
      frame.forEach((call, at) => {
        if (call.op !== "translate" || at < frame.findIndex((c) => c.op === "fillText")) return;
        const name = frame.slice(0, at).findLast((c) => c.op === "fillText")?.args[0];
        const who = twelve.actors.find((a) => a.name === name) as Actor;
        const stroke = frame.slice(at).find((c) => c.op === "stroke") as Call;
        const slip = slipAlpha(slips, who.id, time);
        expect(stroke.alpha).toBeCloseTo(slip * (glyphAt(effects, who.id, time)?.alpha ?? 0));
        if (slip < 1) fading++;
      });
      const dashed = day.calls.flatMap((call, at) =>
        call.op === "setLineDash" && day.calls[at + 1]?.op === "beginPath"
          ? [day.calls.slice(at).find((c) => c.op === "stroke") as Call]
          : [],
      );
      for (const stroke of dashed) {
        // A route is in its walker's cloak colour, at 0.75 of the slip's alpha at most.
        const owners = withRoute.filter((a) => identity(a.id).cloak === stroke.ink);
        const expected = owners.map(
          (a) => 0.75 * slipAlpha(slips, a.id, time) * (routeAt(effects, a.id, time)?.line ?? 0),
        );
        expect(expected.some((e) => Math.abs(e - (stroke.alpha as number)) < 1e-9)).toBe(true);
        if (owners.some((a) => slipAlpha(slips, a.id, time) < 1)) fading++;
      }
    }
    // Both were drawn, and both were also under way for someone with no slip and left out.
    expect([routesDrawn, glyphsDrawn].every((n) => n > 0)).toBe(true);
    expect([routesWithout, glyphsWithout].every((n) => n > 0)).toBe(true);
    // Some were drawn while their slip was fading.
    expect(fading).toBeGreaterThan(0);
  }, 60_000);

  it("shows no effect from before a rewind", async () => {
    // One scene follows a world into the evening, then is handed a different
    // world from earlier, as a server restarted from a snapshot would. From then
    // on it must draw what a scene that only ever saw the second world draws.
    const first = newWorld();
    const rewound = await newScene();
    rewound.scene.observe(first);
    // On into the evening, until a glyph has just come up on someone's slip.
    const inside = rewound.scene as unknown as { effects: Effects; slips: Slips };
    const justBegun = () =>
      [...inside.effects.glyphs].some(
        ([id, { since }]) => since === first.tick && inside.slips.held.has(id),
      );
    while (first.tick < EVENING || !justBegun()) {
      step(first);
      rewound.scene.observe(first);
    }
    expect(first.tick).toBeLessThan(EVENING + 600);
    // Back eight ticks, to a world with another seed that goes its own way: the
    // glyph would come due again there if it were kept.
    const second = newWorld(6, 2);
    while (second.tick < first.tick - 8) step(second);
    const fresh = await newScene();
    for (let tick = 0; tick < 40; tick++) {
      step(second);
      rewound.scene.observe(second);
      fresh.scene.observe(second);
      for (const time of [second.tick, second.tick + 0.5]) {
        // The frame, and the day drawing, where routes go.
        const both = (s: typeof fresh) => {
          s.day.calls = [];
          const frame = drawn(s.out, () => s.scene.draw(second, time));
          return [...frame, ...s.day.calls];
        };
        expect(both(rewound)).toEqual(both(fresh));
      }
    }
  }, 60_000);

  it("puts no slip over another, a place name, the fire or the lantern, in a crowd at camp", async () => {
    type Inside = { avoid: Box[] };
    const slipsOf = (calls: Call[]): Box[] =>
      calls.filter(isSlip).map((c) => {
        const [x, y, w, h] = c.args as [number, number, number, number];
        return { left: x, right: x + w, top: y, bottom: y + h } as Box;
      });
    const covers = (a: Box, b: Box): boolean =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    // Twelve standing together at camp on their first tick.
    const twelve = newWorld(12);
    const atCamp = await newScene();
    atCamp.scene.observe(twelve);
    const slips = slipsOf(drawn(atCamp.out, () => atCamp.scene.draw(twelve, twelve.tick)));
    expect(slips).toHaveLength(8);
    const avoid = (atCamp.scene as unknown as Inside).avoid;
    slips.forEach((slip, i) => {
      for (const other of slips.slice(i + 1)) expect(covers(slip, other)).toBe(false);
      for (const thing of avoid) expect(covers(slip, thing)).toBe(false);
    });
    // Twelve standing still in a block around the camp's name, in three shapes and
    // at every place from six tiles west of it to two east and from a row above it to
    // a row below. One block, just below the name, stands for longer than a slip is held.
    const camp = labels.find((label) => label.text === "Lantern Camp") as MapLabel;
    const shapes: ((i: number) => readonly [number, number])[] = [
      (i) => [i % 4, Math.floor(i / 4)],
      (i) => [i % 3, Math.floor(i / 3)],
      (i) => [i % 2, Math.floor(i / 2)],
    ];
    // The capture workflow tries every place; the gate every other column and the
    // rows above and below, which still takes in the block that stands for longer.
    const long = process.env.IDLIN_LONG === "1";
    let shown = 0;
    for (const [s, shape] of shapes.entries())
      for (let dx = -6; dx <= 2; dx += long ? 1 : 2)
        for (let dy = -1; dy <= 1; dy += long ? 1 : 2) {
          const group = newWorld(12);
          group.actors.forEach((actor, i) => {
            const [sx, sy] = shape(i);
            const x = Math.round(camp.x) + dx + sx;
            const y = Math.round(camp.y) + dy + sy;
            Object.assign(actor, { x, y, fromX: x, fromY: y, moveTicksLeft: 0 });
          });
          const { scene, out } = await newScene();
          const things = (scene as unknown as Inside).avoid;
          const ticks = s === 0 && dx === -2 && dy === 1 ? 2 * MIN_HOLD : 1;
          for (let t = 0; t < ticks; t++) {
            group.tick = t;
            scene.observe(group);
            const drawnSlips = slipsOf(drawn(out, () => scene.draw(group, group.tick)));
            drawnSlips.forEach((slip, i) => {
              for (const other of drawnSlips.slice(i + 1)) expect(covers(slip, other)).toBe(false);
              for (const thing of things) expect(covers(slip, thing)).toBe(false);
            });
            shown += drawnSlips.length;
          }
        }
    expect(shown).toBeGreaterThan(0);
  }, 60_000);

  it("keeps a slip given for the room clear of other slips, their figures, place names, the fire and the lantern between ticks too", async () => {
    type Inside = {
      avoid: Box[];
      slips: Slips;
      sitting: Map<number, readonly [number, number]>;
      wish(actor: World["actors"][number], pose: ReturnType<typeof actorPose>): TagWish;
    };
    const covers = (a: Box, b: Box): boolean =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const twelve = newWorld(12);
    const { scene, out } = await newScene();
    const inside = scene as unknown as Inside;
    scene.observe(twelve);
    let checked = 0;
    for (let i = 0; i < 1200; i++) {
      step(twelve);
      scene.observe(twelve);
      const { slips } = inside;
      for (const fraction of [0, 0.25, 0.5, 0.75, 0.99]) {
        const time = twelve.tick + fraction;
        for (const sheet of canvases) sheet.calls = [];
        const calls = drawn(out, () => scene.draw(twelve, time));
        // Each slip of paper, and whose it is: the name written on it next.
        const drawnSlips = calls.flatMap((call, at) => {
          if (!isSlip(call)) return [];
          const name = calls.slice(at).find((c) => c.op === "fillText")?.args[0];
          const actor = twelve.actors.find((a) => a.name === name);
          const [x, y, w, h] = call.args as [number, number, number, number];
          return actor
            ? [{ id: actor.id, box: { left: x, right: x + w, top: y, bottom: y + h } }]
            : [];
        });
        // The figures of slip holders as drawn now, eased into sitting part of the way.
        const figures = twelve.actors
          .filter((a) => slips.held.has(a.id) || slips.leaving.has(a.id))
          .map((actor) => {
            const raw = actorPose(actor, fraction, time);
            const [before, now] = inside.sitting.get(actor.id) ?? [raw.sit, raw.sit];
            const pose = { ...raw, sit: before + (now - before) * fraction };
            // The wish is in the window's pixels, the slips as drawn in the world's.
            const { x, y } = seenOf(scene);
            const box = bodyBox(inside.wish(actor, pose));
            return {
              id: actor.id,
              box: {
                left: box.left + x,
                right: box.right + x,
                top: box.top + y,
                bottom: box.bottom + y,
              },
            };
          });
        for (const { id, box } of drawnSlips) {
          if (!slips.room.has(id) && !slips.leaving.has(id)) continue;
          checked++;
          const where = `${id} at ${time}`;
          for (const other of drawnSlips)
            if (other.id !== id)
              expect(covers(box, other.box), `${where} on ${other.id}`).toBe(false);
          for (const other of figures)
            if (other.id !== id)
              expect(covers(box, other.box), `${where} on figure ${other.id}`).toBe(false);
          for (const thing of inside.avoid) expect(covers(box, thing), where).toBe(false);
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  }, 120_000);

  it("draws a place name in the same ink whether or not a later tick was seen before a rewind", async () => {
    const den = labels.findIndex((label) => label.text === "the Den");
    const inkAt = async (ticks: readonly number[]): Promise<unknown> => {
      const world = newWorld(6);
      const { scene, out } = await newScene();
      for (const tick of ticks) {
        world.tick = tick;
        scene.observe(world);
      }
      return drawn(out, () => scene.draw(world, world.tick)).find(
        (c) => c.op === "fillText" && c.args[0] === labels[den]?.text,
      )?.fill;
    };
    const straight = await inkAt([8381]);
    expect(straight).toBeDefined();
    expect(await inkAt([9600, 8381])).toEqual(straight);
  });

  it("writes each place name once a frame, only on the frame itself, through a day and a night in a crowd", async () => {
    for (const residents of [12, 50]) {
      const world = newWorld(residents);
      install();
      const scene = await Scene.create(
        { appendChild: () => {} } as unknown as HTMLElement,
        WORLD,
        MAPS,
      );
      const sheets = canvases.filter((c) => c.width === FRAME_WIDTH && c.height === FRAME_HEIGHT);
      const [out, ...others] = sheets as [FakeCanvas, ...FakeCanvas[]];
      scene.observe(world);
      // Every 50 ticks (five game minutes) from 06:00 round to 06:00 the next day.
      for (let tick = 1; tick <= 24 * 600; tick++) {
        step(world);
        scene.observe(world);
        if (tick % 50 !== 0) continue;
        for (const sheet of sheets) sheet.calls = [];
        scene.draw(world, world.tick + 0.5);
        for (const label of labels) {
          const on = (sheet: FakeCanvas, op: string) =>
            sheet.calls.filter((c) => c.op === op && c.args[0] === label.text).length;
          expect([on(out, "fillText"), on(out, "strokeText")], `${label.text} at ${tick}`).toEqual([
            1, 1,
          ]);
          for (const sheet of others) expect(on(sheet, "fillText")).toBe(0);
        }
      }
    }
  }, 120_000);

  it("at night puts a place name in day ink only when lit along its width, not by one resident under its middle", async () => {
    const wood = labels.find((label) => label.text === "The Deep Wood") as MapLabel;
    const world = newWorld(6);
    const { scene, out } = await newScene();
    // Midnight, far from the lantern and the fire. The resident stands right
    // under the middle of the name, where the light it carries is strongest.
    world.tick = TO_MIDNIGHT;
    const actor = world.actors[0] as Actor;
    actor.x = actor.fromX = Math.floor(wood.x);
    actor.y = actor.fromY = Math.floor(wood.y);
    actor.moveTicksLeft = 0;
    actor.path.length = 0;
    const ink = (): unknown => {
      scene.observe(world);
      return drawn(out, () => scene.draw(world, world.tick)).find(
        (c) => c.op === "fillText" && c.args[0] === wood.text,
      )?.fill;
    };
    expect(ink()).toBe(css(NIGHT.ink, 0.8));
    // Five standing in a row under the whole name light all of it: then it goes to day ink.
    world.actors.slice(0, 5).forEach((each, i) => {
      each.x = each.fromX = 2 + i;
      each.y = each.fromY = Math.floor(wood.y);
      each.moveTicksLeft = 0;
      each.path.length = 0;
    });
    world.tick += 1;
    expect(ink()).toBe(css(DAY.ink, 0.8));
  });

  it("takes note of a tick once, however often it is observed", async () => {
    const once = await newScene();
    const twice = await newScene();
    const world = newWorld(30);
    type Inside = { slips: Slips; tagSpots: Map<number, number> };
    const state = (scene: Scene) => {
      const inside = scene as unknown as Inside;
      return [[...inside.slips.held], [...inside.slips.leaving], [...inside.tagSpots]];
    };
    once.scene.observe(world);
    twice.scene.observe(world);
    twice.scene.observe(world);
    for (let i = 0; i < 1500; i++) {
      step(world);
      once.scene.observe(world);
      twice.scene.observe(world);
      twice.scene.observe(world);
      expect(state(twice.scene)).toEqual(state(once.scene));
    }
  }, 60_000);

  it("names six residents on the very first frame", async () => {
    const six = newWorld(6);
    const { scene, out } = await newScene();
    scene.observe(six);
    const names = drawn(out, () => scene.draw(six, six.tick)).filter(
      (c) => c.op === "fillText" && NAMES.includes(String(c.args[0])),
    );
    expect(names.map((c) => c.args[0]).sort()).toEqual([...NAMES].sort());
  });

  it("writes each listed resident's hitpoints and its level in every skill on the page", async () => {
    const six = newWorld(6);
    const [ash, birch] = six.actors as [Actor, Actor];
    ash.hp = 7;
    // Melee 10 and Cooking 99; Birch is untouched, level 1 in everything.
    ash.xp = [1_154, 0, 0, 0, 13_034_431];
    const { scene, day } = await newScene();
    scene.observe(six);
    const texts = drawn(day, () => scene.draw(six, six.tick)).filter((c) => c.op === "fillText");
    const words = texts.map((c) => String(c.args[0]));
    expect(words.filter((w) => w === "20/20")).toHaveLength(5);
    expect(words).toContain("7/20");
    // The levels follow the name and its rule.
    const after = (name: string): string[] => {
      const at = words.lastIndexOf(name);
      return words.slice(at + 2, at + 2 + 5);
    };
    expect(after(ash.name)).toEqual(["10", "1", "1", "1", "99"]);
    expect(after(birch.name)).toEqual(["1", "1", "1", "1", "1"]);
    // The page is beside the map, to the right of it.
    const ashAt = texts.find((c) => c.args[0] === ash.name);
    expect(ashAt?.args[1] as number).toBeGreaterThan(FRAME_WIDTH - 480);
  });

  it("ties every slip moved off its figure back to it with a stroke, in a crowd too", async () => {
    const crowd = newWorld(30);
    const { scene, out } = await newScene();
    const inside = scene as unknown as { tagSpots: Map<number, number>; slips: Slips };
    scene.observe(crowd);
    let moved = 0;
    for (let i = 0; i < 1500; i++) {
      step(crowd);
      scene.observe(crowd);
      if (i % 10 !== 9) continue;
      const calls = drawn(out, () => scene.draw(crowd, crowd.tick));
      // Lettering is in world pixels, moved by where the window is.
      const left = seenOf(scene).x;
      const strokes = calls.filter(
        (c) => c.op === "lineTo" && (c.args[0] as number) > left + 20,
      ).length;
      // A figure the window has drifted off is faded out, and so is its slip.
      const drawnFigure = (actor: Actor): boolean => {
        const pose = actorPose(actor, 0, crowd.tick);
        const { x, y } = seenOf(scene);
        return edgeFade(pose.x * 48 - x, pose.y * 48 - 4 - y, map.width * 48, map.height * 48) > 0;
      };
      const aside = crowd.actors.filter(
        (actor) =>
          inside.slips.held.has(actor.id) &&
          slipAlpha(inside.slips, actor.id, crowd.tick) > 0 &&
          (inside.tagSpots.get(actor.id) ?? 0) !== 0 &&
          drawnFigure(actor),
      ).length;
      expect(strokes, `at ${crowd.tick}`).toBe(aside);
      moved += aside;
    }
    expect(moved).toBeGreaterThan(0);
  }, 60_000);

  it("starts the news and the page's lines afresh when the world goes back in time, as after a server restart", async () => {
    // Everything written: the page's lines and the news among it.
    const newsOf = (calls: Call[]): unknown =>
      calls
        .filter((c) => c.op === "fillText")
        .map((c) => c.args[0])
        .join("|");
    const fresh = await newScene();
    const restarted = await newScene();
    // The restarted scene first followed a world far ahead of the one it now sees.
    const ahead = newWorld();
    restarted.scene.observe(ahead);
    for (let i = 0; i < 2000; i++) {
      step(ahead);
      restarted.scene.observe(ahead);
    }
    const world = newWorld();
    fresh.scene.observe(world);
    restarted.scene.observe(world);
    // The news each shows, every 20 ticks, and every tick who has a slip and where it sits.
    const lines = { fresh: [] as unknown[], restarted: [] as unknown[] };
    const slipsOf = (scene: Scene) => {
      const inside = scene as unknown as { slips: Slips; tagSpots: Map<number, number> };
      return [[...inside.slips.held], [...inside.tagSpots].sort((a, b) => a[0] - b[0])];
    };
    expect(slipsOf(restarted.scene)).toEqual(slipsOf(fresh.scene));
    for (let i = 1; i <= 600; i++) {
      step(world);
      fresh.scene.observe(world);
      restarted.scene.observe(world);
      expect(slipsOf(restarted.scene)).toEqual(slipsOf(fresh.scene));
      if (i % 20 !== 0) continue;
      lines.fresh.push(newsOf(drawn(fresh.day, () => fresh.scene.draw(world, world.tick))));
      lines.restarted.push(
        newsOf(drawn(restarted.day, () => restarted.scene.draw(world, world.tick))),
      );
    }
    // The lines changed as the residents went about.
    expect(new Set(lines.fresh).size).toBeGreaterThan(1);
    expect(lines.restarted).toEqual(lines.fresh);
  }, 60_000);

  it("takes a line of news down after ten seconds with nothing after it, and tells of a resident instead", async () => {
    const { scene, day } = await newScene();
    const world = newWorld(12);
    scene.observe(world);
    const ash = world.actors.find((a) => a.name === "Ash") as World["actors"][number];
    (scene as unknown as { newsQueue: unknown[] }).newsQueue = [
      { text: "Ash killed a wolf", who: ash.id },
    ];
    const newsLine = (): string => {
      const calls = drawn(day, () => scene.draw(world, world.tick));
      return String(
        calls.findLast((c) => c.op === "fillText" && NEWS.test(String(c.args[0])))?.args[0],
      );
    };
    const seen: string[] = [];
    for (let i = 0; i <= NEWS_STALE + 1; i++) {
      step(world);
      scene.observe(world);
      seen.push(newsLine());
    }
    expect(seen[0]).toBe("Ash killed a wolf");
    expect(seen[NEWS_STALE - 1]).toBe("Ash killed a wolf");
    const after = seen.at(-1) as string;
    expect(after).not.toBe("Ash killed a wolf");
    // One of the six the page does not list.
    const told = after.split(" is ")[0];
    expect(world.actors.slice(6).map((a) => a.name)).toContain(told);
  });

  it("writes a notice on the page beside the map, not over it", async () => {
    const { scene, day } = await newScene();
    const world = newWorld();
    scene.observe(world);
    const notice = (calls: Call[]) =>
      calls.find((c) => c.op === "fillText" && c.args[0] === "waiting for the world");
    expect(notice(drawn(day, () => scene.draw(world, world.tick)))).toBeUndefined();
    scene.notice = "waiting for the world";
    const written = notice(drawn(day, () => scene.draw(world, world.tick)));
    expect(written?.args[1]).toBe(FRAME_WIDTH - 40);
    expect(written?.args[2]).toBeLessThan(map.height * 48);
  });

  it("fades the page row of a resident off the map, and writes where they are in place of what they do", async () => {
    const { scene, day, out } = await newScene();
    const world = newWorld();
    const cedar = world.actors.find((a) => a.name === "Cedar") as Actor;
    const pinewood = placeConstants(WORLD).pinewood as { x: number; y: number };
    Object.assign(cedar, { x: pinewood.x, y: pinewood.y, fromX: pinewood.x, fromY: pinewood.y });
    Object.assign(cedar, { path: [], moveTicksLeft: 0 });
    scene.observe(world);
    const page = drawn(day, () => scene.draw(world, world.tick)).filter(
      (c) => c.op === "fillText" && (c.args[1] as number) > map.width * 48,
    );
    const written = (text: string) => page.find((c) => c.args[0] === text);
    expect(written("Cedar")?.alpha).toBe(0.5);
    expect(written("in the Pinewood · resting")?.alpha).toBe(0.5);
    // The others are written in full, with what they are doing.
    for (const name of ["Ash", "Birch", "Dara", "Elm", "Fen"]) expect(written(name)?.alpha).toBe(1);
    expect(page.filter((c) => String(c.args[0]).startsWith("in the "))).toHaveLength(1);
    // Nothing of Cedar is on the map: no name slip.
    const frame = drawn(out, () => scene.draw(world, world.tick));
    expect(frame.some((c) => c.op === "fillText" && c.args[0] === "Cedar")).toBe(false);
    expect(frame.some((c) => c.op === "fillText" && c.args[0] === "Ash")).toBe(true);
  });

  it("shows a dash for the time, and no day, while the clock is hidden", async () => {
    const { scene, day } = await newScene();
    const world = newWorld();
    scene.observe(world);
    const texts = () =>
      drawn(day, () => scene.draw(world, world.tick))
        .filter((c) => c.op === "fillText")
        .map((c) => c.args[0]);
    expect(texts()).toContain("06:00");
    scene.clockShown = false;
    const hidden = texts();
    expect(hidden).toContain("\u2014");
    expect(hidden).not.toContain("06:00");
    expect(hidden.filter((t) => String(t).startsWith("Day "))).toEqual([]);
  });

  it("eases a figure into sitting and out of it: its name moves a little each tick, not 9 pixels at once", async () => {
    const { scene, out } = await newScene();
    const world = newWorld();
    scene.observe(world);
    const last = new Map<
      number,
      {
        x: number;
        y: number;
        tileX: number;
        tileY: number;
        still: boolean;
        resting: boolean;
        levels: number;
      }
    >();
    let changes = 0;
    let largest = 0;
    for (let tick = 1; tick <= 2400; tick++) {
      step(world);
      scene.observe(world);
      // Only the frame's calls are read; the other sheets' would pile up over 2,400 draws.
      for (const canvas of canvases) canvas.calls = [];
      const calls = drawn(out, () => scene.draw(world, world.tick));
      for (const actor of world.actors) {
        const name = calls.findLast((c) => c.op === "fillText" && c.args[0] === actor.name);
        // Off the map, nobody's name is written on it.
        if (!name) {
          last.delete(actor.id);
          continue;
        }
        const now = {
          x: name?.args[1] as number,
          y: name?.args[2] as number,
          tileX: actor.x,
          tileY: actor.y,
          still: actor.moveTicksLeft === 0,
          resting: actorPose(actor, 0, world.tick).resting,
          levels: actor.xp.reduce((sum, xp) => sum + levelFor(xp), 0),
        };
        const before = last.get(actor.id);
        last.set(actor.id, now);
        // Only while the figure stands on one tile and its name keeps its place beside it.
        if (!before?.still || !now.still || before.x !== now.x) continue;
        if (before.tileX !== now.tileX || before.tileY !== now.tileY) continue;
        // A level gained, chopping or fishing on the spot, can raise the hood and the name with it.
        if (before.levels !== now.levels) continue;
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
        day: { grounds: { fires: [number, number][]; standing: { sways: boolean }[] }[] };
      }
    ).day.grounds[0] as { fires: [number, number][]; standing: { sways: boolean }[] };
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
    // Every tree of the camp's map leans, and so do those of the regions round
    // it whose crowns reach over its edge.
    const [first, second] = [leans(early), leans(later)];
    expect(first.length).toBeGreaterThanOrEqual(trees);
    expect(second).toHaveLength(first.length);
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
