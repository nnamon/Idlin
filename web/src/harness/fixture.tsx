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
import { SoundEngine } from "../audio/engine";
import { SoundDirector } from "../audio/director";
import { Overlay } from "../ui/Overlay";
import { ItemTooltip } from "../ui/ItemTooltip";
import { ContentDocs } from "../world/contentDocs";
import { ManagePage } from "../ui/ManagePage";
import { ZoneRenderer } from "../scene/ZoneRenderer";
import { silhouette } from "../scene/IconFactory";
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

/** Sound (#148 A8): every harness mount runs the REAL event→cue mapping
 *  and exposes the engine's log — the capture spec asserts cues without
 *  audible output (the context never unlocks headless; the log always
 *  records). */
function wireAudio(store: WorldStore): void {
  const audio = new SoundEngine();
  const soundDirector = new SoundDirector(audio);
  store.onEvent = (ev) => soundDirector.onEvent(ev);
  (window as unknown as { __idlinAudio?: SoundEngine }).__idlinAudio = audio;
}

async function renderOverlay(fixture: Extract<Fixture, { kind: "overlay" }>): Promise<void> {
  const overlay = document.getElementById("overlay")!;
  const store = new WorldStore();
  wireAudio(store);
  // The live client paints slot icons (3D model renders + canvas silhouettes);
  // the headless harness has no WebGL/model pipeline, so feed it the
  // deterministic canvas silhouettes alone — enough to verify the doll reads
  // with real icons rather than the cramped name-text fallback.
  store.icons = { icon: (_name, kind) => silhouette(kind) };
  wireAudio(store);
  for (const msg of fixture.messages) store.handle(msg);

  const client = stubClient(fixture.status);
  // The speaker button (#148 A8): fixtures opt in via `sound: true` — the
  // engine is fresh (muted, 🔇) so the shot is deterministic.
  const btnAudio = fixture.sound ? new SoundEngine() : null;
  createRoot(overlay).render(
    <Overlay client={client} store={store} idler={fixture.idler ?? null} audio={btnAudio} />,
  );

  // Drain the scheduler so the status effect (link plaque) commits, then wait
  // for the bundled font so text pixels are stable.
  for (let i = 0; i < 6; i++) await nextTask();
  await document.fonts.ready;
  // Await any sprite <img> (e.g. the orb-frame) so the shot isn't raced against
  // async image decode — otherwise the byte-stable capture flakes.
  await Promise.all(
    Array.from(overlay.querySelectorAll("img")).map((img) => img.decode().catch(() => {})),
  );
}

/** The per-idler management page (#79): no 3D scene — an opaque surface fed by
 *  the idler's stream (here, canned messages populate the event ticker). */
async function renderManage(fixture: Extract<Fixture, { kind: "manage" }>): Promise<void> {
  const overlay = document.getElementById("overlay")!;
  const store = new WorldStore();
  wireAudio(store);
  for (const msg of fixture.messages) store.handle(msg);
  createRoot(overlay).render(<ManagePage store={store} idler={fixture.idler} />);
  for (let i = 0; i < 6; i++) await nextTask();
  await document.fonts.ready;
}

async function renderTooltip(fixture: Extract<Fixture, { kind: "tooltip" }>): Promise<void> {
  const overlay = document.getElementById("overlay")!;
  const docs = new ContentDocs(fixture.docsJson);
  createRoot(overlay).render(
    <div style={{ padding: 24, display: "inline-block" }}>
      <ItemTooltip item={fixture.item} docs={docs} />
    </div>,
  );
  for (let i = 0; i < 6; i++) await nextTask();
  await document.fonts.ready;
}

async function renderScene(fixture: Extract<Fixture, { kind: "scene" }>): Promise<void> {
  // Seed every Math.random consumer (terrain noise, brazier phase, idle-anim
  // phase, three.js UUIDs) BEFORE building anything, so the scene is geometry-
  // and animation-reproducible.
  Math.random = makeSeededRandom(fixture.seed);

  const store = new WorldStore();
  wireAudio(store);
  for (const msg of fixture.messages) store.handle(msg);

  const scene = document.getElementById("scene")!;
  const renderer = new ZoneRenderer(scene, store, {
    capture: true,
    camera: fixture.camera,
    follow: fixture.follow,
    fog: fixture.fog,
  });
  window.__harnessRenderer = renderer;
  await renderer.whenReady; // models + fonts loaded
  renderer.stepFrames(fixture.frames ?? 150); // settle animation deterministically
}

/** The whole game view: render the 3D scene, then mount the React HUD over it
 *  from the SAME store — so the overlay (orbs, panels) is shot in real context. */
async function renderFull(fixture: Extract<Fixture, { kind: "full" }>): Promise<void> {
  Math.random = makeSeededRandom(fixture.seed);
  const store = new WorldStore();
  wireAudio(store);
  store.icons = { icon: (_name, kind) => silhouette(kind) };
  for (const msg of fixture.messages) store.handle(msg);

  const scene = document.getElementById("scene")!;
  const renderer = new ZoneRenderer(scene, store, { capture: true, camera: fixture.camera });
  window.__harnessRenderer = renderer;
  await renderer.whenReady;
  renderer.stepFrames(fixture.frames ?? 150);

  const overlay = document.getElementById("overlay")!;
  const client = stubClient(fixture.status);
  createRoot(overlay).render(
    <Overlay client={client} store={store} idler={fixture.idler ?? null} />,
  );
  for (let i = 0; i < 6; i++) await nextTask();
  await document.fonts.ready;
  await Promise.all(
    Array.from(overlay.querySelectorAll("img")).map((img) => img.decode().catch(() => {})),
  );
}

async function main(): Promise<void> {
  // Freeze the wall clock so any wall-clock-derived render is byte-stable across
  // runs — specifically the event ticker's age-based fade (opacity = f(now - at)):
  // both the event timestamps (set in store.handle) and the render's `now` then
  // read the SAME constant, so the fade is fixed instead of drifting with real
  // elapsed ms. The scene runs on its own stepped virtual clock and is already
  // wall-clock-independent (scene-shore is byte-stable), so this is safe there.
  performance.now = () => 1000;

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
  else if (fixture.kind === "full") await renderFull(fixture);
  else if (fixture.kind === "manage") await renderManage(fixture);
  else if (fixture.kind === "tooltip") await renderTooltip(fixture);
  else await renderOverlay(fixture);

  window.__harness = { ready: true, name, label: fixture.label };
}

void main();
