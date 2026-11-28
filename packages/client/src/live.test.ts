// The live client with the browser's WebSocket, page and frame callback
// replaced by stand-ins, so what it gives the view can be checked.
import { createCity, snapshot, step, TERRAINS, viewerMessage, type World } from "@idlin/sim";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { campMonsters, shippedPrograms } from "../../sim/src/testing.ts";
import { follow } from "./live.ts";

class FakeSocket {
  static made: FakeSocket[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(url: string) {
    // As the browser does for an address it cannot parse.
    if (url === "ws://[") throw new SyntaxError(`The URL '${url}' is invalid.`);
    FakeSocket.made.push(this);
  }
  close(): void {
    this.onclose?.();
  }
}

const programs = shippedPrograms();

beforeEach(() => {
  FakeSocket.made = [];
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("document", { body: { dataset: {} } });
  vi.stubGlobal("requestAnimationFrame", () => 0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A view that keeps the worlds it is asked to draw. */
const recorder = () => {
  const drawn: (World | null)[] = [];
  return { notice: "", drawn, draw: (world: World | null) => drawn.push(world) };
};

it("says it is waiting until a world arrives, and again when the connection drops", () => {
  const frames: ((now: number) => void)[] = [];
  vi.stubGlobal("requestAnimationFrame", (frame: (now: number) => void) => frames.push(frame));
  const view = recorder();
  vi.spyOn(console, "error").mockImplementation(() => {});
  follow(view, { programs }, "ws://server");
  expect(view.notice).toBe("waiting for the world");
  frames.shift()?.(0);
  expect(view.drawn).toEqual([null]);

  const world = createCity(1, programs);
  step(world, [{ type: "join", account: "7", name: "goofguy", role: "viewer" }]);
  const socket = FakeSocket.made[0] as FakeSocket;
  socket.onmessage?.({ data: viewerMessage(world, []) });
  expect(view.notice).toBe("");
  frames.shift()?.(0);
  expect(view.drawn.at(-1)?.actors.map((a) => a.name)).toEqual(["goofguy"]);
  expect(view.drawn.at(-1)?.cycle).toEqual(world.cycle);

  socket.close();
  expect(view.notice).toBe("waiting for the world");

  // A world this page cannot read: it says so, and keeps that note through the close.
  vi.advanceTimersByTime(2000);
  const again = FakeSocket.made[1] as FakeSocket;
  again.onmessage?.({ data: "{ not a world" });
  expect(view.notice).toBe("this page cannot read the world");
});

it("shows why when the server address cannot be opened, and still draws the frame", () => {
  const frames: ((now: number) => void)[] = [];
  vi.stubGlobal("requestAnimationFrame", (frame: (now: number) => void) => frames.push(frame));
  const view = recorder();
  follow(view, { programs }, "ws://[");
  expect(view.notice).toBe("cannot connect to ws://[: The URL 'ws://[' is invalid.");
  frames[0]?.(0);
  expect(view.drawn).toHaveLength(1);
  // Not retried: the same address would fail the same way.
  vi.advanceTimersByTime(10_000);
  expect(FakeSocket.made).toHaveLength(0);
});

it("reads a city with monsters when given their kinds, and refuses it without them", () => {
  const monsters = campMonsters();
  const content = { programs: { ...programs, ...monsters.programs }, kinds: monsters.kinds };
  const world = createCity(1, content.programs, content.kinds);
  while (world.tick < 2100) step(world);
  // On the landing's grass.
  const { atlas } = world;
  const grass = TERRAINS.indexOf("grass");
  const tile = atlas.terrain.indexOf(grass);
  const at = {
    x: atlas.left + (tile % atlas.width),
    y: atlas.top + Math.floor(tile / atlas.width),
  };
  step(world, [{ type: "spawn", name: "Wolf", program: "wolf", kind: "wolf", ...at }]);
  expect(world.actors).toHaveLength(1);
  vi.spyOn(console, "error").mockImplementation(() => {});

  const frames: ((now: number) => void)[] = [];
  vi.stubGlobal("requestAnimationFrame", (frame: (now: number) => void) => frames.push(frame));
  const view = recorder();
  follow(view, content, "ws://server");
  (FakeSocket.made[0] as FakeSocket).onmessage?.({ data: snapshot(world) });
  expect(view.notice).toBe("");
  frames[0]?.(0);
  expect(view.drawn[0]?.atlas).toBe(world.atlas);

  const blind = recorder();
  follow(blind, { programs }, "ws://server");
  (FakeSocket.made[1] as FakeSocket).onmessage?.({ data: snapshot(world) });
  expect(blind.notice).toBe("this page cannot read the world");
});
