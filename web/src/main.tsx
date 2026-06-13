import { createRoot } from "react-dom/client";
import { NetClient } from "./net/client";
import type { S2C } from "./gen/S2C";
import { WorldStore } from "./world/store";
import { ZoneRenderer } from "./scene/ZoneRenderer";
import { Overlay } from "./ui/Overlay";
import { Portal } from "./ui/Portal";

if (location.pathname.startsWith("/portal")) {
  // The portal is a fetch-only home, separate from the live stream: no
  // WebSocket and no scene renderer. It mounts into the same #overlay root
  // (the only React root); the Portal root sets pointer-events:auto itself.
  createRoot(document.getElementById("overlay")!).render(<Portal />);
} else {
  const params = new URLSearchParams(location.search);
  /** ?watch=<name>: subscribe to that character's world (it follows them
   *  across transfers) instead of the featured broadcast. */
  const watch = params.get("watch");
  /** ?replay=<url>: play a recorded world journal (JSONL of wire messages)
   *  through the same renderer — no server connection at all. */
  const replay = params.get("replay");

  const wsProto = location.protocol === "https:" ? "wss" : "ws";
  const store = new WorldStore();
  const client = new NetClient(`${wsProto}://${location.host}/ws`, watch);
  client.onMessage((msg) => store.handle(msg));

  if (replay) {
    void (async () => {
      const res = await fetch(replay);
      const lines = (await res.text()).split("\n").filter(Boolean);
      let i = 0;
      const step = () => {
        if (i >= lines.length) return;
        try {
          store.handle(JSON.parse(lines[i]) as S2C);
        } catch {
          // a torn final line in a live recording is normal
        }
        i += 1;
        setTimeout(step, 100); // recorded at 10 Hz, replayed at 10 Hz
      };
      step();
    })();
  } else {
    client.start();
  }

  // Dev/probe handle: headless verification injects FX and reads state here.
  (window as unknown as { __idlin?: object }).__idlin = {
    store,
    get zr() {
      return zr;
    },
  };

  const zr = new ZoneRenderer(document.getElementById("scene")!, store);

  createRoot(document.getElementById("overlay")!).render(<Overlay client={client} store={store} />);
}
