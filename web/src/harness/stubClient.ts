import type { NetClient, NetStatus } from "../net/client";

/**
 * A `NetClient` that never opens a socket. The harness drives the store
 * directly through `store.handle()`, so the client only has to satisfy the
 * surface `Overlay` actually touches — `onStatus` and `send`. `onStatus`
 * fires the supplied status once and synchronously, so the link plaque
 * renders a fixed, deterministic state (no real connection, no RTT jitter).
 *
 * The single cast is deliberate: this is a test double, not a partial
 * `NetClient`, and structural typing the whole class here would be noise.
 */
export function stubClient(status: NetStatus): NetClient {
  return {
    start() {},
    stop() {},
    onStatus(fn: (s: NetStatus) => void) {
      fn(status);
      return () => {};
    },
    onMessage() {
      return () => {};
    },
    send() {},
  } as unknown as NetClient;
}

/** A plausible "live" link status for a fixture (no socket behind it). */
export const LIVE_STATUS: NetStatus = {
  connected: true,
  role: "Owner",
  serverVersion: "fixture",
  rttMs: 14,
  serverTick: 0,
  lastError: null,
};
