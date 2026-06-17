// Harness entry: render a fixture with no socket behind it. Driven by
// Playwright (see web/harness/) — load `/harness/fixture.html?fixture=<name>`,
// await `window.__harness.ready`, shoot.
//
//  - overlay fixtures mount the React HUD from injected store state; the
//    overlay is a pure function of that state, so it is deterministic by
//    construction (no clock needed — AGENTS.md §6).
//  - scene fixtures render the 3D ZoneRenderer in capture mode, under a seeded
//    global Math.random and a stepped virtual clock, so geometry, animation,
//    and the camera converge to reproducible pixels.
import { createRoot } from "react-dom/client";
import { WorldStore } from "../world/store";
import { Overlay } from "../ui/Overlay";
import { ZoneRenderer } from "../scene/ZoneRenderer";
import { stubClient } from "./stubClient";
import { makeSeededRandom } from "./random";
import { FIXTURES, type Fixture } from "./fixtures";

declare global {
  interface Window {
    /** Set true once the fixture has rendered and assets/fonts are ready — the
     *  capture driver awaits this instead of sleeping. */
    __harness?: { ready: boolean; name: string; label: string };
    /** Every fixture id, so the driver can assert the Node manifest covers
     *  exactly this registry (no silent drift between the two lists). */
    __harnessRegistry?: string[];
    /** Scene fixtures only: the live renderer, so the driver can drive
     *  `stepFrames`/read `virtualElapsedSeconds` (e.g. assert the clock is
     *  monotonic across calls). */
    __harnessRenderer?: ZoneRenderer;
  }
}

/** Yield to the event loop WITHOUT a timer. Drains React's commit + passive
 *  effects (which run on the scheduler's MessageChannel, not setTimeout). */
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(0);
  });
}

async function renderOverlay(fixture: Extract<Fixture, { kind: "overlay" }>): Promise<void> {
  const overlay = document.getElementById("overlay")!;
  const store = new WorldStore();
  for (const msg of fixture.messages) store.handle(msg);

  const client = stubClient(fixture.status);
  createRoot(overlay).render(<Overlay client={client} store={store} />);

  // Drain the scheduler so the status effect (link plaque) commits, then wait
  // for the bundled font so text pixels are stable.
  for (let i = 0; i < 6; i++) await nextTask();
  await document.fonts.ready;
}

async function renderScene(fixture: Extract<Fixture, { kind: "scene" }>): Promise<void> {
  // Seed every Math.random consumer (terrain noise, brazier phase, idle-anim
  // phase, three.js UUIDs) BEFORE building anything, so the scene is geometry-
  // and animation-reproducible.
  Math.random = makeSeededRandom(fixture.seed);

  const store = new WorldStore();
  for (const msg of fixture.messages) store.handle(msg);

  const scene = document.getElementById("scene")!;
  const renderer = new ZoneRenderer(scene, store, { capture: true, camera: fixture.camera });
  window.__harnessRenderer = renderer;
  await renderer.whenReady; // models + fonts loaded
  renderer.stepFrames(fixture.frames ?? 150); // settle animation deterministically
}

async function main(): Promise<void> {
  // Publish the registry first, so the drift check works even on the landing
  // page (no ?fixture=).
  window.__harnessRegistry = Object.keys(FIXTURES);

  const name = new URLSearchParams(location.search).get("fixture") ?? "";
  const fixture = FIXTURES[name];

  if (!fixture) {
    const overlay = document.getElementById("overlay")!;
    overlay.style.pointerEvents = "auto";
    overlay.innerHTML =
      `<div style="padding:24px;color:#d8cba6">Unknown fixture <b>${name || "(none)"}</b>.` +
      ` Available: ${Object.keys(FIXTURES).join(", ")}</div>`;
    return;
  }

  if (fixture.kind === "scene") await renderScene(fixture);
  else await renderOverlay(fixture);

  window.__harness = { ready: true, name, label: fixture.label };
}

void main();
