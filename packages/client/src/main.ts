import {
  compileBots,
  createWorld,
  parseMap,
  placeConstants,
  START_HOUR,
  spawnsNearCamp,
  step,
  TICKS_PER_GAME_HOUR,
  TICKS_PER_SECOND,
} from "@idlin/sim";
import mapJson from "../../../content/maps/first-light.json";
import type { MapLabel } from "./ground.ts";
import { FRAME_HEIGHT, FRAME_WIDTH, Scene } from "./scene.ts";
import "./style.css";

/** The shipped programs' source, by file name without the extension. */
function botSources(): Record<string, string> {
  const files = import.meta.glob("../../../content/bots/*.tac", {
    query: "?raw",
    import: "default",
    eager: true,
  });
  return Object.fromEntries(
    Object.entries(files).map(([path, text]) => [
      path.slice(path.lastIndexOf("/") + 1, -4),
      text as string,
    ]),
  );
}

/** Who lives at the camp, and which shipped program each one runs. */
const CAST = [
  { name: "Ash", program: "wanderer" },
  { name: "Birch", program: "homebody" },
  { name: "Cedar", program: "riverwalker" },
  { name: "Dara", program: "wanderer" },
  { name: "Elm", program: "homebody" },
  { name: "Fen", program: "riverwalker" },
];

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
  const startHour = Number.parseFloat(params.get("hour") ?? String(START_HOUR));

  const frame = must("frame");
  const fit = (): void => {
    const scale = Math.min(innerWidth / FRAME_WIDTH, innerHeight / FRAME_HEIGHT);
    frame.style.transform = `scale(${scale})`;
  };
  fit();
  addEventListener("resize", fit);

  const map = parseMap(mapJson);
  const world = createWorld(map, seed, compileBots(botSources(), placeConstants(map)));
  step(world, spawnsNearCamp(world, CAST));
  // The world starts at dawn (06:00); `?hour=` runs it forward to another time of day.
  const skip = Math.round(((((startHour - START_HOUR) % 24) + 24) % 24) * TICKS_PER_GAME_HOUR);

  const labels = (mapJson as { labels?: MapLabel[] }).labels ?? [];
  const scene = await Scene.create(frame, world.map, labels);
  const draw = (fraction: number): void => scene.draw(world, world.tick + fraction);
  const tick = (): void => {
    step(world);
    scene.observe(world);
  };
  scene.observe(world);
  for (let i = 0; i < skip; i++) tick();
  await document.fonts.ready;

  if (params.has("capture")) {
    window.idlin = {
      advance(ticks) {
        for (let i = 0; i < ticks; i++) tick();
        // A captured frame depends only on the world, not on the frames drawn before it.
        scene.forgetNameSpots();
        draw(0);
      },
      brightness() {
        scene.forgetNameSpots();
        draw(0);
        return scene.brightness();
      },
    };
    scene.forgetNameSpots();
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
    // the worst a returning viewer sees is one step of under a tile.
    owed = Math.min(owed + Math.max(0, now - (last ?? now)), tickMs * 3);
    last = now;
    while (owed >= tickMs) {
      tick();
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
