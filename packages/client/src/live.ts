// Live mode: the viewer following the world server.
import {
  type Atlas,
  createWorld,
  type Kinds,
  type Message,
  type Programs,
  readMessage,
  type Spawns,
  TICKS_PER_SECOND,
  type World,
} from "@idlin/sim";
import type { Scene } from "./scene.ts";

/** The content the server's world was made with; a world made with other content is refused. */
export interface LiveContent {
  readonly atlas: Atlas;
  readonly programs: Programs;
  readonly kinds?: Kinds;
  readonly spawns?: Spawns;
}

/**
 * Live mode: draws the server's world. The server sends the whole world after
 * every tick, with that tick's blows; between two of them the picture moves on by the time since the
 * last, up to just short of the next tick. A lost connection is retried every
 * two seconds, and the last world stays on screen meanwhile. Until the first
 * world arrives the map is drawn empty and the clock is hidden, since the
 * empty world's 06:00 is no time the server has reached. While there is no
 * connection the page says it is waiting; an address the browser will not
 * open is shown with the reason and not retried. Which region the map shows
 * the scene works out from the worlds it is given (see camera.ts).
 */
export function follow(
  scene: Pick<Scene, "notice" | "clockShown" | "observe" | "draw">,
  content: LiveContent,
  url: string,
): void {
  const { atlas, programs, kinds, spawns } = content;
  const tickMs = 1000 / TICKS_PER_SECOND;
  const empty = createWorld(atlas, 0, programs, kinds, spawns);
  let world: World | null = null;
  let arrived = 0;
  const waiting = (note: string): void => {
    document.body.dataset.live = "waiting";
    scene.notice = note;
  };
  const connect = (): void => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      // A malformed `?server=` address. Trying it again would fail the same way.
      waiting(
        `cannot connect to ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    socket.onmessage = (event) => {
      let next: Message;
      try {
        next = readMessage(String(event.data), atlas, programs, kinds, spawns);
      } catch (error) {
        // Most likely the server runs other content than this page was built with.
        // The server may be updated, so this keeps trying.
        console.error(error);
        waiting("this page cannot read the world");
        socket.close();
        return;
      }
      world = next.world;
      document.body.dataset.live = "connected";
      scene.notice = "";
      scene.clockShown = true;
      scene.observe(world, next.blows);
      arrived = performance.now();
    };
    socket.onclose = () => {
      if (scene.notice === "") waiting("waiting for the world");
      setTimeout(connect, 2000);
    };
  };
  scene.clockShown = false;
  waiting("waiting for the world");
  connect();
  const loop = (now: number): void => {
    if (world) {
      scene.draw(world, world.tick + Math.min(0.99, Math.max(0, now - arrived) / tickMs));
    } else scene.draw(empty, 0);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
