import { useEffect, useState } from "react";
import type { NetClient, NetStatus } from "../net/client";

const TICK_HZ = 10;

export function Overlay({ client }: { client: NetClient }) {
  const [status, setStatus] = useState<NetStatus | null>(null);

  useEffect(() => client.onStatus(setStatus), [client]);

  const uptime =
    status?.serverTick != null
      ? formatUptime(status.serverTick / TICK_HZ)
      : "—";

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        padding: "10px 14px",
        background: "rgba(10, 10, 18, 0.8)",
        border: "1px solid #33334a",
        borderRadius: 6,
        color: "#c8c8e0",
        fontSize: 13,
        lineHeight: 1.7,
      }}
    >
      <div style={{ color: "#9a7bff", fontWeight: 700, letterSpacing: 1 }}>IDLIN</div>
      <div>
        link:{" "}
        <span style={{ color: status?.connected ? "#7bff9a" : "#ff6a6a" }}>
          {status?.connected ? `connected (${status.role ?? "?"})` : "disconnected"}
        </span>
      </div>
      <div>rtt: {status?.rttMs != null ? `${status.rttMs} ms` : "—"}</div>
      <div>
        world: tick {status?.serverTick ?? "—"} ({uptime})
      </div>
      {status?.lastError && <div style={{ color: "#ffb36a" }}>{status.lastError}</div>}
    </div>
  );
}

function formatUptime(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${m}m ${sec}s` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}
