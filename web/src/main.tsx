import { createRoot } from "react-dom/client";
import { NetClient } from "./net/client";
import type { S2C } from "./gen/S2C";
import { WorldStore } from "./world/store";
import { ZoneRenderer } from "./scene/ZoneRenderer";
import { Overlay } from "./ui/Overlay";
import { ManagePage } from "./ui/ManagePage";

const params = new URLSearchParams(location.search);
/** `/idler/<name>`: the dedicated INDIVIDUAL idler view (#79) — streams that
 *  idler's world, follows + focuses them, and frames the UI as their own page
 *  (the shell the management portal will extend). `/idler/<name>/manage` is the
 *  management surface for that idler. Path-based on purpose, not a query param,
 *  so they read as real routes. */
const idlerMatch = location.pathname.match(/^\/idler\/([^/]+)(\/manage)?\/?$/);
// Tolerate a malformed %-escape: a bad deep link must not blank the SPA (it
// just won't match a real idler) — fall back to the raw segment.
const decodeIdler = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const idler = idlerMatch ? decodeIdler(idlerMatch[1]) : null;
/** `/idler/<name>/manage`: the per-idler management page — same stream, a
 *  management surface (no 3D scene) instead of the watch view. */
const manage = idler !== null && idlerMatch![2] != null;
/** ?watch=<name>: the raw per-idler stream WITHOUT the individual-view framing
 *  (dev affordance). `/idler/<name>` implies it. */
const watch = idler ?? params.get("watch");
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
    // ?at=N (#148 A7): fast-forward — apply the first N journal lines
    // instantly, then play at speed. The kill-cam API hands out these
    // line numbers for boss falls.
    const at = Number(params.get("at") ?? 0);
    while (i < at && i < lines.length) {
      try {
        store.handle(JSON.parse(lines[i]) as S2C);
      } catch {
        // torn line
      }
      i += 1;
    }
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

let zr: ZoneRenderer | undefined;
// Dev/probe handle: headless verification injects FX and reads state here.
(window as unknown as { __idlin?: object }).__idlin = { store, get zr() { return zr; } };

const overlayRoot = createRoot(document.getElementById("overlay")!);
if (manage && idler) {
  // Management page: no 3D scene — an opaque surface fed by the idler's stream.
  overlayRoot.render(<ManagePage store={store} idler={idler} />);
} else {
  zr = new ZoneRenderer(document.getElementById("scene")!, store, {
    follow: watch ?? undefined,
  });
  overlayRoot.render(<Overlay client={client} store={store} idler={idler} />);
}
