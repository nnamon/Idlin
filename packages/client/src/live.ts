// Live mode: the viewer following the world server.
import {
  type Atlas,
  createWorld,
  type Programs,
  restore,
  TICKS_PER_SECOND,
  type World,
} from "@idlin/sim";
import type { Scene } from "./scene.ts";
import { awayFrom, regionView, rosterOf } from "./view.ts";

/**
 * Live mode: draws the server's world. The server sends the whole world after
 * every tick; between two of them the picture moves on by the time since the
 * last, up to just short of the next tick. A lost connection is retried every
 * two seconds, and the last world stays on screen meanwhile. Until the first
 * world arrives the map is drawn empty and the clock is hidden, since the
 * empty world's 06:00 is no time the server has reached. While there is no
 * connection the page says it is waiting; an address the browser will not
 * open is shown with the reason and not retried. The map shows region `shown`
 * of the world, and the page calls the regions by `names` (see `regionNames`).
 */
export function follow(
  scene: Pick<Scene, "notice" | "clockShown" | "observe" | "draw">,
  atlas: Atlas,
  programs: Programs,
  url: string,
  shown = 0,
  names: readonly string[] = atlas.regions.map((region) => region.map.name),
): void {
  const tickMs = 1000 / TICKS_PER_SECOND;
  const empty = createWorld(atlas, 0, programs);
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
      let next: World;
      try {
        next = restore(String(event.data), atlas, programs);
      } catch (error) {
        // Most likely the server runs other content than this page was built with.
        // The server may be updated, so this keeps trying.
        console.error(error);
        waiting("this page cannot read the world");
        socket.close();
        return;
      }
      world = next;
      document.body.dataset.live = "connected";
      scene.notice = "";
      scene.clockShown = true;
      scene.observe(regionView(world, shown), world, shown);
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
      const map = regionView(world, shown);
      scene.draw(
        map,
        world.tick + Math.min(0.99, Math.max(0, now - arrived) / tickMs),
        rosterOf(world),
        awayFrom(world, map, names),
      );
    } else scene.draw(regionView(empty, shown), 0);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
