import type { C2S } from "../gen/C2S";
import type { S2C } from "../gen/S2C";
import type { Role } from "../gen/Role";

export const PROTO_VERSION = 10;
const PING_INTERVAL_MS = 2000;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;

export interface NetStatus {
  connected: boolean;
  role: Role | null;
  serverVersion: string | null;
  rttMs: number | null;
  serverTick: number | null;
  lastError: string | null;
}

type StatusListener = (status: NetStatus) => void;
type MessageListener = (msg: S2C) => void;

/**
 * WebSocket client for the Idlin protocol. Sends Hello on connect, pings on
 * an interval to measure RTT, reconnects with capped exponential backoff, and
 * forwards world messages to subscribers (the WorldStore).
 */
export class NetClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<StatusListener>();
  private messageListeners = new Set<MessageListener>();
  private status: NetStatus = {
    connected: false,
    role: null,
    serverVersion: null,
    rttMs: null,
    serverTick: null,
    lastError: null,
  };
  private nonce = 0;
  private pingSentAt = new Map<number, number>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectDelay = RECONNECT_BASE_MS;
  private closed = false;

  constructor(private url: string) {}

  start(): void {
    this.closed = false;
    this.connect();
  }

  stop(): void {
    this.closed = true;
    this.clearPingTimer();
    this.ws?.close();
  }

  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  private connect(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = RECONNECT_BASE_MS;
      this.update({ connected: true, lastError: null });
      this.send({
        type: "Hello",
        data: { token: "dev", proto_version: PROTO_VERSION },
      });
      this.clearPingTimer();
      this.pingTimer = setInterval(() => this.ping(), PING_INTERVAL_MS);
      this.ping();
    };

    ws.onmessage = (ev) => {
      let msg: S2C;
      try {
        msg = JSON.parse(ev.data as string) as S2C;
      } catch {
        return;
      }
      switch (msg.type) {
        case "Welcome":
          this.update({
            role: msg.data.role,
            serverVersion: msg.data.server_version,
            serverTick: msg.data.server_tick,
          });
          break;
        case "Pong": {
          const sentAt = this.pingSentAt.get(msg.data.nonce);
          this.pingSentAt.delete(msg.data.nonce);
          this.update({
            rttMs: sentAt !== undefined ? Math.round(performance.now() - sentAt) : null,
            serverTick: msg.data.server_tick,
          });
          break;
        }
        case "Error":
          this.update({ lastError: `server error ${msg.data.code}: ${msg.data.msg}` });
          break;
        default:
          for (const l of this.messageListeners) l(msg);
          break;
      }
    };

    ws.onclose = () => {
      this.clearPingTimer();
      this.pingSentAt.clear();
      this.update({ connected: false, role: null, rttMs: null });
      if (!this.closed) {
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
      }
    };

    ws.onerror = () => {
      // onclose fires next; nothing to do here.
    };
  }

  private ping(): void {
    this.nonce = (this.nonce + 1) >>> 0;
    this.pingSentAt.set(this.nonce, performance.now());
    this.send({ type: "Ping", data: { nonce: this.nonce } });
  }

  send(msg: C2S): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private clearPingTimer(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private update(patch: Partial<NetStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l(this.status);
  }
}
