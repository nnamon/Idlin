import { useEffect, useState } from "react";
import type { WorldStore } from "../world/store";

/**
 * The per-idler MANAGEMENT page (#79 → the #17 portal): the shell a bot
 * developer / owner uses to manage their idler. Reached at `/idler/<name>/manage`.
 *
 * For now it just streams the idler's live event ticker — the bot editor, the
 * debug console (#77), and the whisper log (#78) plug in here later. Unlike the
 * watch view (`/idler/<name>`) there is NO 3D scene: this is a management
 * surface, an opaque page fed by the same per-idler stream (the net client
 * subscribes with `watch=<name>`, so `store.ticker` fills from that idler's
 * world).
 */
export function ManagePage({ store, idler }: { store: WorldStore; idler: string }) {
  const [, setVersion] = useState(0);
  // Re-render as the stream lands (same cheap poll the overlay uses).
  useEffect(() => {
    const h = setInterval(() => setVersion(store.version), 200);
    return () => clearInterval(h);
  }, [store]);

  const now = performance.now();
  // The dedicated page keeps a deeper, longer-lived tail than the in-scene ticker.
  const events = store.ticker.filter((t) => now - t.at < 120_000).slice(-60);

  return (
    <div className="manage-page">
      <header className="manage-head">
        <a className="manage-back" href={`/idler/${encodeURIComponent(idler)}`}>
          ‹ view
        </a>
        <span className="manage-title">{idler}</span>
        <span className="manage-tab">manage</span>
      </header>
      <section className="manage-panel">
        <div className="manage-panel-title">Event stream</div>
        <div className="manage-stream">
          {events.length === 0 ? (
            <div className="manage-empty">waiting for events…</div>
          ) : (
            events.map((t) => (
              <div className="manage-line" key={t.key} style={{ color: t.color }}>
                {t.text}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
