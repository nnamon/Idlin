// Chat from the adapter to a tick's inputs: events go through the gate into
// the queue as they arrive, and each tick takes its inputs from the queue. A
// scripted crowd, if there is one, is heard at the start of each tick.

import type { ChatInput } from "@idlin/sim";
import { type Crowd, crowdEvents } from "./crowd.ts";
import type { ChatEvent } from "./events.ts";
import { Gate, type GateOptions } from "./gate.ts";
import { InputQueue } from "./queue.ts";

export interface ChatOptions extends GateOptions {
  readonly crowd?: Crowd;
  /** The world tick the crowd's 00:00 falls on. */
  readonly start?: number;
}

export class Chat {
  readonly gate: Gate;
  readonly queue = new InputQueue();
  private readonly crowd: Crowd | undefined;
  private readonly start: number;

  constructor(options: ChatOptions = {}) {
    this.gate = new Gate(options);
    this.crowd = options.crowd;
    this.start = options.start ?? 0;
  }

  /** Passes an event that arrived while the world was at `tick` through the gate and queues what it makes. */
  hear(event: ChatEvent, tick: number): void {
    for (const input of this.gate.pass(event, tick)) this.queue.push(input);
  }

  /** The inputs for the step from world tick `tick`, after the crowd has said its lines for that tick. */
  take(tick: number): ChatInput[] {
    if (this.crowd && tick >= this.start)
      for (const event of crowdEvents(this.crowd, tick - this.start)) this.hear(event, tick);
    return this.queue.take();
  }
}
