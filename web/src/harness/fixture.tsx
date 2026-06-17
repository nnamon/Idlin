// Harness entry: render the overlay from a canned fixture, with no socket and
// no live clock behind it. Driven by Playwright (see web/harness/) — load
// `/harness/fixture.html?fixture=<name>`, await `window.__harness.ready`, shoot.
import { createRoot } from "react-dom/client";
import { WorldStore } from "../world/store";
import { Overlay } from "../ui/Overlay";
import { stubClient } from "./stubClient";
import { FIXTURES } from "./fixtures";

declare global {
  interface Window {
    /** Set true once the fixture has rendered and fonts are ready — the
     *  capture driver awaits this instead of sleeping. */
    __harness?: { ready: boolean; name: string; label: string };
    /** Every fixture id, so the driver can assert the Node manifest covers
     *  exactly this registry (no silent drift between the two lists). */
    __harnessRegistry?: string[];
  }
}

/** Yield to the event loop WITHOUT a timer, so a frozen clock can't stall us.
 *  Drains React's commit + passive effects (which run on the scheduler's
 *  MessageChannel, not setTimeout). */
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(0);
  });
}

async function main(): Promise<void> {
  // Publish the registry first, so the drift check works even on the landing
  // page (no ?fixture=).
  window.__harnessRegistry = Object.keys(FIXTURES);

  const name = new URLSearchParams(location.search).get("fixture") ?? "";
  const overlay = document.getElementById("overlay")!;
  const fixture = FIXTURES[name];

  if (!fixture) {
    overlay.style.pointerEvents = "auto";
    overlay.innerHTML =
      `<div style="padding:24px;color:#d8cba6">Unknown fixture <b>${name || "(none)"}</b>.` +
      ` Available: ${Object.keys(FIXTURES).join(", ")}</div>`;
    return;
  }

  // Apply the whole canned sequence to a fresh store BEFORE the first render,
  // so the initial paint already reflects the final state.
  const store = new WorldStore();
  for (const msg of fixture.messages) store.handle(msg);

  const client = stubClient(fixture.status);
  createRoot(overlay).render(<Overlay client={client} store={store} />);

  // Drain the scheduler so the status effect (link plaque) commits, then wait
  // for the bundled font so text pixels are stable.
  for (let i = 0; i < 6; i++) await nextTask();
  await document.fonts.ready;

  window.__harness = { ready: true, name, label: fixture.label };
}

void main();
