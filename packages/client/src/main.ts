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
import { castOf } from "./cast.ts";
import { fitFrame } from "./frame.ts";
import type { MapLabel } from "./ground.ts";
import { follow } from "./live.ts";
import { Scene } from "./scene.ts";
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

/** What the page offers a capture tool in capture mode. */
export interface CaptureApi {
  /** Moves time on by this many ticks (fractions allowed, for frames between ticks) and draws. */
  advance(ticks: number): void;
  /** Mean brightness of the frame, one value per tile-sized block. */
  brightness(): number[];
  /** The frame scaled by `scale` (1 is the frame's own size, 1920 by 1080 in a 16:9 window), as base64 RGBA, with its size. */
  pixels(scale: number): { width: number; height: number; rgba: string };
  /** The world's tick, and who is in it. */
  state(): { tick: number; actors: { id: number; name: string }[] };
}

declare global {
  interface Window {
    /** Present in capture mode (`?capture`): the page draws only when told to. */
    idlin?: CaptureApi;
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

  const map = parseMap(mapJson);
  const world = createWorld(map, seed, compileBots(botSources(), placeConstants(map)));
  // `?crowd=50` fills the camp with that many residents, to see how a crowd reads.
  const crowd = Number.parseInt(params.get("crowd") ?? "", 10);
  step(world, spawnsNearCamp(world, castOf(Number.isNaN(crowd) ? 6 : crowd)));
  // The world starts at dawn (06:00); `?hour=` runs it forward to another time of day.
  const skip = Math.round(((((startHour - START_HOUR) % 24) + 24) % 24) * TICKS_PER_GAME_HOUR);

  const labels = (mapJson as { labels?: MapLabel[] }).labels ?? [];
  const scene = await Scene.create(frame, world.map, labels);
  // The frame fills the window: scaled as a whole, and wider or taller than 16:9 where the window is.
  const fit = (): void => {
    const { width, height, scale, below, columns } = fitFrame(
      innerWidth,
      innerHeight,
      scene.width,
      scene.height,
    );
    scene.resize(width, height, below, columns);
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
    frame.style.transform = `scale(${scale})`;
  };
  fit();
  addEventListener("resize", () => {
    fit();
    // In capture mode nothing else would redraw.
    if (params.has("capture")) scene.draw(world, world.tick);
  });
  // By default the page follows the world server (`?server=ws://host:port` for another
  // address). It runs a world of its own for captures, or when the URL asks for one with
  // `?local` or any of the settings only a world of its own can take.
  if (!["capture", "local", "seed", "hour", "crowd"].some((name) => params.has(name))) {
    await document.fonts.ready;
    const server = params.get("server") || `ws://${location.hostname}:4311`;
    follow(scene, world.map, world.programs, server);
    return;
  }

  const draw = (fraction: number): void => scene.draw(world, world.tick + fraction);
  const tick = (): void => {
    step(world);
    scene.observe(world);
  };
  scene.observe(world);
  for (let i = 0; i < skip; i++) tick();
  await document.fonts.ready;

  if (params.has("capture")) {
    let fraction = 0;
    window.idlin = {
      advance(ticks) {
        const total = fraction + Math.max(0, ticks);
        const whole = Math.floor(total + 1e-9);
        for (let i = 0; i < whole; i++) tick();
        fraction = Math.max(0, total - whole);
        draw(fraction);
      },
      brightness() {
        draw(fraction);
        return scene.brightness();
      },
      pixels(scale) {
        draw(fraction);
        const { width, height, data } = scene.pixels(scale);
        let binary = "";
        for (let i = 0; i < data.length; i += 0x8000) {
          binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
        }
        return { width, height, rgba: btoa(binary) };
      },
      state: () => ({
        tick: world.tick,
        actors: world.actors.map(({ id, name }) => ({ id, name })),
      }),
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
