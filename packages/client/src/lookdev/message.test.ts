// A landing drawn from the world server's viewer messages: a city set down,
// citizens and wolves fighting on its grass, each tick's message read as the
// viewer reads it and handed to the feed, and frames drawn between them.
import {
  blowsOf,
  createCity,
  type Input,
  knocksOf,
  readMessage,
  step,
  TERRAINS,
  viewerMessage,
} from "@idlin/sim";
import { describe, expect, it } from "vitest";
import { campMonsters, shippedPrograms } from "../../../sim/src/testing.ts";
import { Draw } from "./draw.ts";
import { expeditionLanding } from "./expeditions.ts";
import { landingScene, MID_SIZES, type Stage } from "./landing.ts";
import { MessageFeed } from "./message.ts";
import { type Corners, type PlacedTag, TAG_STEP } from "./stage.ts";
import type { Face, Surface } from "./surface.ts";

const monsters = campMonsters();
const programs = { ...shippedPrograms(), ...monsters.programs };
const NAMES = ["goofguy", "pixelwitch", "mossy_dan", "kraken_main", "Bo7"];

/** A surface that draws nothing and keeps the words lettered on it. */
function recorder(): Surface & { words: Set<string> } {
  const words = new Set<string>();
  return {
    kind: "canvas",
    words,
    vertices: 0,
    begin() {},
    anchor() {},
    poly() {},
    strip() {},
    brush() {},
    hatch() {},
    layer: (_name: string, _key: string, paint: () => void) => paint(),
    keep: (_name: string, _key: readonly number[], draw: () => void) => draw(),
    text(_face: Face, _size: number, s: string) {
      words.add(s);
    },
    paper() {},
    end() {},
    finish() {},
  };
}

/**
 * The first city on its landing, five citizens on a row of grass and a wolf below each, then
 * `ticks` ticks run with each tick's viewer message read back as the page reads it.
 */
function fight(ticks: number) {
  const world = createCity(1, programs, monsters.kinds);
  while (world.tick < 2100) step(world);
  const { atlas } = world;
  const grass = TERRAINS.indexOf("grass");
  const open = (x: number, y: number): boolean => {
    const lx = x - atlas.left;
    const ly = y - atlas.top;
    if (lx < 0 || ly < 0 || lx >= atlas.width || ly >= atlas.height) return false;
    return atlas.terrain[ly * atlas.width + lx] === grass;
  };
  // Two rows of grass, nine tiles long, so each citizen has a wolf beside it and room either side.
  let at: [number, number] | null = null;
  for (let y = atlas.top; y < atlas.top + atlas.height && !at; y++)
    for (let x = atlas.left; x < atlas.left + atlas.width && !at; x++) {
      let ok = true;
      for (let k = 0; k < 9 && ok; k++) ok = open(x + k, y) && open(x + k, y + 1);
      if (ok) at = [x, y];
    }
  if (!at) throw new Error("no grass on the landing");
  const [x0, y0] = at;
  const spawns: Input[] = NAMES.flatMap((name, k) => [
    { type: "spawn", name, program: "deckhand", weapon: "blade", x: x0 + k * 2, y: y0 },
    { type: "spawn", name: "Wolf", program: "wolf", kind: "wolf", x: x0 + k * 2, y: y0 + 1 },
  ]);
  const feed = new MessageFeed();
  const messages: number[] = [];
  /** When each blow the server sent landed, on the viewer's clock. */
  const blows: number[] = [];
  for (let i = 0; i < ticks; i++) {
    const events = step(world, i === 0 ? spawns : []);
    const text = viewerMessage(world, blowsOf(events), knocksOf(events));
    const at = i / 10;
    for (const _ of blowsOf(events)) blows.push(at);
    feed.take(readMessage(text, null, programs, monsters.kinds), at);
    messages.push(at);
  }
  return { world, feed, messages, blows, centre: [x0 + 4.5, y0 + 1] as const };
}

/** A live landing over the feed: the lookdev's map, the camera on the fight. */
function liveStage(feed: MessageFeed, centre: readonly [number, number]): Stage {
  const L = expeditionLanding();
  const corners: Corners = {
    left: 600,
    to: "lift-off",
    gone: 0.3,
    horn: 0.8,
    late: false,
    head: "Medium 23-68",
    lines: [],
    log: null,
    counts: [5, 0, 0, 0],
  };
  return {
    land: L,
    feed,
    live: true,
    seconds: Number.POSITIVE_INFINITY,
    sizes: MID_SIZES,
    view: () => ({ T: L.T, ox: 960 - centre[0] * L.T, oy: 540 - centre[1] * L.T }),
    city: () => ({
      gait: 0,
      walk: 0,
      settle: 1,
      ramp: 1,
      rampSide: 1,
      detail: 0,
      size: MID_SIZES.citizen,
      crew: [],
      lantern: 0,
    }),
    black: () => null,
    corners: () => corners,
  };
}

describe("a landing drawn from the server's messages", () => {
  it("keys everyone by actor id, letters each by its chat username, and draws the blows", () => {
    const { world, feed, messages, centre } = fight(60);
    const citizens = world.actors.filter((a) => a.kind === "adventurer");
    expect(citizens.map((a) => a.name).sort()).toEqual([...NAMES].sort());
    const t = messages.at(-1) as number;
    expect(feed.citizens(t).map((c) => c.id)).toEqual(citizens.map((a) => a.id));
    expect(feed.citizens(t).map((c) => c.look.name)).toEqual(citizens.map((a) => a.name));
    // The wolves are the monsters, under their own ids.
    const wolves = world.actors.filter((a) => a.kind === "wolf").map((a) => a.id);
    expect(feed.monsters(t).map((m) => m.id)).toEqual(wolves);
    // Six seconds of fighting gives blows, and each hit is where its target stood.
    expect(feed.hits.length).toBeGreaterThan(10);

    const scene = landingScene(liveStage(feed, centre));
    const surface = recorder();
    let numbers = 0;
    let frames = 0;
    for (const at of messages)
      for (let k = 0; k < 6; k++) {
        const d = new Draw(surface);
        scene.draw(d, at + k / 60);
        numbers += scene.probe(at + k / 60).numbers.length;
        frames++;
      }
    expect(frames).toBe(360);
    for (const name of NAMES) expect(surface.words.has(name), name).toBe(true);
    expect(numbers).toBeGreaterThan(0);
  });

  it("lays tags out frame by frame by citizen id, each moving no more than a step a frame", () => {
    const { feed, messages, centre } = fight(40);
    const scene = landingScene(liveStage(feed, centre));
    const ids = new Set(feed.citizens(messages.at(-1) as number).map((c) => c.id));
    let last = new Map<number, PlacedTag>();
    let pairs = 0;
    for (const at of messages)
      for (let k = 0; k < 6; k++) {
        const t = at + k / 60;
        scene.draw(new Draw(recorder()), t);
        const tags = scene.probe(t).tags;
        const now = new Map(tags.map((tag) => [tag.key, tag]));
        for (const tag of tags) {
          expect(ids.has(tag.key), `tag ${tag.key}`).toBe(true);
          const was = last.get(tag.key);
          if (!was) continue;
          // Against its owner: a tag keeps its place, or slides to a new one a step at a time.
          const moved = Math.hypot(
            tag.cx - tag.x - (was.cx - was.x),
            tag.base - tag.y - (was.base - was.y),
          );
          expect(moved, `tag ${tag.key} at ${t.toFixed(3)} s`).toBeLessThanOrEqual(TAG_STEP + 1e-6);
          pairs++;
        }
        last = now;
      }
    expect(pairs).toBeGreaterThan(500);
  });

  it("forgets what is past seeing, so a long stream keeps a few seconds of it", () => {
    const { feed, messages, blows } = fight(260);
    const t = messages.at(-1) as number;
    expect(t).toBeGreaterThan(25);
    // Blows landed early on that are gone now, and every one since is still there.
    const early = blows.filter((at) => at < t - 17).length;
    expect(early).toBeGreaterThan(5);
    expect(feed.hits.length).toBe(blows.length - early);
    for (const h of feed.hits) expect(h.t).toBeGreaterThanOrEqual(t - 17);
    for (const b of feed.blows) expect(b.contact).toBeGreaterThanOrEqual(t - 17);
    for (const k of feed.kills) expect(k.t).toBeGreaterThanOrEqual(t - 17);
  });
});
