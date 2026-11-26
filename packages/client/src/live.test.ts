// The live client with the browser's WebSocket, page and frame callback
// replaced by stand-ins, so what it tells the scene can be checked.
import { readdirSync, readFileSync } from "node:fs";
import { compileBots, createWorld, parseMap, placeConstants, snapshot, step } from "@idlin/sim";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import mapJson from "../../../content/maps/first-light.json";
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

const map = parseMap(mapJson);
const dir = new URL("../../../content/bots/", import.meta.url);
const programs = compileBots(
  Object.fromEntries(
    readdirSync(dir)
      .filter((file) => file.endsWith(".tac"))
      .map((file) => [file.slice(0, -4), readFileSync(new URL(file, dir), "utf8")]),
  ),
  placeConstants(map),
);

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
  follow(scene, map, programs, "ws://server");
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
  follow(scene, map, programs, "ws://[");
  expect(scene.notice).toBe("cannot connect to ws://[: The URL 'ws://[' is invalid.");
  frames[0]?.(0);
  expect(draw).toHaveBeenCalledTimes(1);
  // Not retried: the same address would fail the same way.
  vi.advanceTimersByTime(10_000);
  expect(FakeSocket.made).toHaveLength(0);
});
