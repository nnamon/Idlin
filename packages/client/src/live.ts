// Live mode: the viewer following the world server.
import {
  type Kinds,
  type Message,
  type Programs,
  readMessage,
  TICKS_PER_SECOND,
  type World,
} from "@idlin/sim";
import type { PlainView } from "./plain.ts";

/** The content the server's world was made with; a world made with other content is refused. */
export interface LiveContent {
  readonly programs: Programs;
  readonly kinds?: Kinds;
}

/**
 * Live mode: draws the server's world. The server sends the whole world after
 * every tick; between two of them the picture moves on by the time since the
 * last, up to just short of the next tick. A lost connection is retried every
 * two seconds, and the last world stays on screen meanwhile. Until the first
 * world arrives the frame is drawn empty. While there is no connection the
 * page says it is waiting; an address the browser will not open is shown with
 * the reason and not retried.
 */
export function follow(
  view: Pick<PlainView, "notice" | "draw">,
  content: LiveContent,
  url: string,
): void {
  const { programs, kinds } = content;
  const tickMs = 1000 / TICKS_PER_SECOND;
  let world: World | null = null;
  let arrived = 0;
  const waiting = (note: string): void => {
    document.body.dataset.live = "waiting";
    view.notice = note;
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
        next = readMessage(String(event.data), null, programs, kinds);
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
      view.notice = "";
      arrived = performance.now();
    };
    socket.onclose = () => {
      if (view.notice === "") waiting("waiting for the world");
      setTimeout(connect, 2000);
    };
  };
  waiting("waiting for the world");
  connect();
  const loop = (now: number): void => {
    view.draw(world, Math.min(0.99, Math.max(0, now - arrived) / tickMs));
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
