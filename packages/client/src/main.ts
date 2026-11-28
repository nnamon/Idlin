import { Chat, parseCrowd } from "@idlin/chat";
import {
  beat,
  compileBots,
  createCity,
  deckMap,
  placeConstants,
  step,
  TICKS_PER_SECOND,
} from "@idlin/sim";
import { follow } from "./live.ts";
import { HEIGHT, PlainView, WIDTH } from "./plain.ts";
import "./style.css";

/** Files by their name without the folder or the extension. */
const byName = <T>(files: Record<string, unknown>): Record<string, T> =>
  Object.fromEntries(
    Object.entries(files).map(([path, value]) => [
      path.slice(path.lastIndexOf("/") + 1, path.lastIndexOf(".")),
      value as T,
    ]),
  );

/** The shipped programs' source, by file name without the extension. */
const botSources = (): Record<string, string> =>
  byName(
    import.meta.glob("../../../content/bots/*.tac", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  );

/** The shipped crowd files' text, by file name without the extension. */
const crowdFiles = (): Record<string, string> =>
  byName(
    import.meta.glob("../../../content/chat/*.txt", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  );

/** What the page offers a capture tool in capture mode. */
export interface CaptureApi {
  /** Moves time on by this many ticks (fractions allowed, for frames between ticks) and draws. */
  advance(ticks: number): void;
  /** Mean brightness of the frame, one value per block of 40 by 40 pixels. */
  brightness(): number[];
  /** The frame scaled by `scale` (1 is its own size, 1920 by 1080), as base64 RGBA, with its size. */
  pixels(scale: number): { width: number; height: number; rgba: string };
  /** The world's tick, the beat it is in, and who is in it. */
  state(): { tick: number; beat: string; actors: { id: number; name: string }[] };
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
  const frame = must("frame");

  // `?lookdev=<scene>`: the look-development scenes, which have no world behind them.
  if (params.has("lookdev")) {
    const { runLookdev } = await import("./lookdev/index.ts");
    await runLookdev(params, frame);
    return;
  }

  const programs = compileBots(botSources(), placeConstants(deckMap(1)));
  const view = new PlainView(frame);
  // The frame is drawn at 1920 by 1080 and scaled as a whole to fit the window.
  const fit = (): void => {
    frame.style.transform = `scale(${Math.min(innerWidth / WIDTH, innerHeight / HEIGHT)})`;
  };
  fit();
  addEventListener("resize", fit);
  await document.fonts.ready;

  // By default the page follows the world server (`?server=ws://host:port` for another
  // address). It runs a city of its own for captures, or when the URL asks for one with
  // `?local` or any of the settings only a city of its own can take.
  if (!["capture", "local", "seed", "tick", "chat"].some((name) => params.has(name))) {
    const server = params.get("server") || `ws://${location.hostname}:4311`;
    follow(view, { programs }, server);
    return;
  }

  // `?chat=crowd-15` reads that crowd file from content/chat/ as the city's
  // chat, and its chatters are the citizens; with none, nobody is aboard.
  const world = createCity(seed, programs);
  const chatName = params.get("chat");
  const crowdText = chatName === null ? undefined : crowdFiles()[chatName];
  if (chatName !== null && crowdText === undefined)
    throw new Error(`no crowd file content/chat/${chatName}.txt`);
  const chat =
    crowdText === undefined ? null : new Chat({ crowd: parseCrowd(crowdText), start: world.tick });
  const tick = (): void => {
    step(world, chat?.take(world.tick) ?? []);
  };
  // `?tick=1800` runs the city on to that tick before the first frame.
  const skip = Number.parseInt(params.get("tick") ?? "0", 10);
  while (world.tick < skip) tick();

  if (params.has("capture")) {
    let fraction = 0;
    const draw = (): void => view.draw(world, fraction);
    window.idlin = {
      advance(ticks) {
        const total = fraction + Math.max(0, ticks);
        const whole = Math.floor(total + 1e-9);
        for (let i = 0; i < whole; i++) tick();
        fraction = Math.max(0, total - whole);
        draw();
      },
      brightness() {
        draw();
        return view.brightness();
      },
      pixels(scale) {
        draw();
        const { width, height, data } = view.pixels(scale);
        let binary = "";
        for (let i = 0; i < data.length; i += 0x8000) {
          binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
        }
        return { width, height, rgba: btoa(binary) };
      },
      state: () => ({
        tick: world.tick,
        beat: beat(world)?.beat ?? "",
        actors: world.actors.map(({ id, name }) => ({ id, name })),
      }),
    };
    draw();
    document.body.dataset.ready = "1";
    return;
  }

  const tickMs = 1000 / TICKS_PER_SECOND;
  let last: number | null = null;
  let owed = 0;
  const loop = (now: number): void => {
    // Time since the last frame, never negative. After a long pause (a hidden
    // tab) the world does not race to catch up: at most three ticks are owed.
    owed = Math.min(owed + Math.max(0, now - (last ?? now)), tickMs * 3);
    last = now;
    while (owed >= tickMs) {
      tick();
      owed -= tickMs;
    }
    view.draw(world, owed / tickMs);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

main().catch((error) => {
  document.body.dataset.error = String(error);
  throw error;
});
