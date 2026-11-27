// The live client with the browser's WebSocket, page and frame callback
// replaced by stand-ins, so what it tells the scene can be checked.
import { ADVENTURER, createWorld, snapshot, step, type World } from "@idlin/sim";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { shippedMonsters, shippedPrograms, shippedWorld } from "../../sim/src/testing.ts";
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

const map = shippedWorld();
const programs = shippedPrograms(map);

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

it("says it is waiting and hides the clock until a world arrives, and again when the connection drops", () => {
  const scene = { notice: "", clockShown: true, observe: () => {}, draw: () => {} };
  vi.spyOn(console, "error").mockImplementation(() => {});
  follow(scene, { atlas: map, programs }, "ws://server");
  expect(scene).toMatchObject({ notice: "waiting for the world", clockShown: false });

  const world = createWorld(map, 1, programs);
  step(world);
  const socket = FakeSocket.made[0] as FakeSocket;
  socket.onmessage?.({ data: snapshot(world) });
  expect(scene).toMatchObject({ notice: "", clockShown: true });

  socket.close();
  expect(scene.notice).toBe("waiting for the world");

  // A world this page cannot read: it says so, and keeps that note through the close.
  vi.advanceTimersByTime(2000);
  const again = FakeSocket.made[1] as FakeSocket;
  again.onmessage?.({ data: "{ not a world" });
  expect(scene.notice).toBe("this page cannot read the world");
});

it("shows why when the server address cannot be opened, and still draws the map", () => {
  const frames: ((now: number) => void)[] = [];
  vi.stubGlobal("requestAnimationFrame", (frame: (now: number) => void) => frames.push(frame));
  const draw = vi.fn();
  const scene = { notice: "", clockShown: true, observe: () => {}, draw };
  follow(scene, { atlas: map, programs }, "ws://[");
  expect(scene.notice).toBe("cannot connect to ws://[: The URL 'ws://[' is invalid.");
  frames[0]?.(0);
  expect(draw).toHaveBeenCalledTimes(1);
  // Not retried: the same address would fail the same way.
  vi.advanceTimersByTime(10_000);
  expect(FakeSocket.made).toHaveLength(0);
});

it("reads a world with monsters when given the monsters, and refuses it without them", () => {
  const monsters = shippedMonsters(map);
  const content = {
    atlas: map,
    programs: { ...programs, ...monsters.programs },
    kinds: monsters.kinds,
    spawns: monsters.spawns,
  };
  const world = createWorld(map, 1, content.programs, content.kinds, content.spawns);
  while (!world.actors.some((actor) => actor.kind !== ADVENTURER) && world.tick < 10_000)
    step(world);
  vi.spyOn(console, "error").mockImplementation(() => {});

  const seen: World[] = [];
  const scene = {
    notice: "",
    clockShown: true,
    observe: (_: unknown, shownWorld: World) => seen.push(shownWorld),
    draw: () => {},
  };
  follow(scene, content, "ws://server");
  (FakeSocket.made[0] as FakeSocket).onmessage?.({ data: snapshot(world) });
  expect(scene.notice).toBe("");
  expect(seen[0]?.actors.filter((actor) => actor.kind !== ADVENTURER).length).toBeGreaterThan(0);

  const blind = { ...scene, notice: "" };
  follow(blind, { atlas: map, programs }, "ws://server");
  (FakeSocket.made[1] as FakeSocket).onmessage?.({ data: snapshot(world) });
  expect(blind.notice).toBe("this page cannot read the world");
});
