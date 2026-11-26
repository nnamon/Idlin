import {
  createWorld,
  parseMap,
  spawnsNearCamp,
  step,
  TICKS_PER_GAME_HOUR,
  TICKS_PER_SECOND,
} from "@idlin/sim";
import mapJson from "../../../content/maps/first-light.json";
import { createHud } from "./hud.ts";
import { Scene } from "./scene.ts";
import "./style.css";

const NAMES = ["Ash", "Birch", "Cedar", "Dara", "Elm", "Fen"];
const FRAME_WIDTH = 1920;
const FRAME_HEIGHT = 1080;

declare global {
  interface Window {
    /** Present in capture mode (`?capture`): the page draws only when told to. */
    idlin?: { advance(ticks: number): void; brightness(): number[] };
  }
}

const must = (id: string): HTMLElement => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node;
};

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const seed = Number.parseInt(params.get("seed") ?? "1", 10) | 0;
  const startHour = Number.parseFloat(params.get("hour") ?? "6");

  const frame = must("frame");
  const fit = (): void => {
    const scale = Math.min(innerWidth / FRAME_WIDTH, innerHeight / FRAME_HEIGHT);
    frame.style.transform = `scale(${scale})`;
  };
  fit();
  addEventListener("resize", fit);

  const world = createWorld(parseMap(mapJson), seed);
  step(world, spawnsNearCamp(world, NAMES));
  // The world starts at dawn (06:00); `?hour=` runs it forward to another time of day.
  const skip = Math.round(((((startHour - 6) % 24) + 24) % 24) * TICKS_PER_GAME_HOUR);
  for (let i = 0; i < skip; i++) step(world);

  const scene = await Scene.create(must("world"), world.map);
  const hud = createHud(must("panel"), must("ticker"), must("tags"), {
    width: scene.width,
    height: scene.height,
  });
  const draw = (fraction: number): void =>
    hud.update(world, scene.draw(world, world.tick + fraction));
  await document.fonts.ready;

  if (params.has("capture")) {
    window.idlin = {
      advance(ticks) {
        for (let i = 0; i < ticks; i++) step(world);
        draw(0);
      },
      brightness() {
        draw(0);
        return scene.brightness();
      },
    };
    draw(0);
    document.body.dataset.ready = "1";
    return;
  }

  const tickMs = 1000 / TICKS_PER_SECOND;
  let last: number | null = null;
  let owed = 0;
  const loop = (now: number): void => {
    // Time since the last frame, never negative. After a long pause (a hidden
    // tab) the world does not race to catch up: at most three ticks are owed, so
    // nothing visibly jumps and the picture carries on from where it was.
    owed = Math.min(owed + Math.max(0, now - (last ?? now)), tickMs * 3);
    last = now;
    while (owed >= tickMs) {
      step(world);
      owed -= tickMs;
    }
    draw(owed / tickMs);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

main().catch((error) => {
  document.body.dataset.error = String(error);
  throw error;
});
