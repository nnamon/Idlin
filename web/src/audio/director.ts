// The sound director (#148 A8): GameEvent → cue, with rate limiting so a
// pack wipe doesn't machine-gun the viewer. Pure mapping — the capture
// harness asserts it through the engine's log.

import type { GameEvent } from "../gen/GameEvent";
import type { SoundEngine } from "./engine";

/** Trash-kill cues per second, max — the grind hums, it doesn't hammer. */
const KILL_RATE_PER_S = 2;

export class SoundDirector {
  private lastKillAt = 0;

  constructor(private engine: SoundEngine) {}

  onEvent(ev: GameEvent): void {
    switch (ev.type) {
      case "MonsterKilled":
        if (ev.data.rarity >= 3) {
          this.engine.play("boss-fall");
        } else {
          const now = performance.now();
          if (now - this.lastKillAt >= 1000 / KILL_RATE_PER_S) {
            this.lastKillAt = now;
            this.engine.play("kill");
          }
        }
        break;
      case "ActCompleted":
        this.engine.play("act-complete");
        break;
      case "CharacterDied":
        this.engine.play("death");
        break;
      case "LevelUp":
        this.engine.play("level-up");
        break;
      case "CharacterDeparted":
        if (ev.data.dest === "charted_shallows") this.engine.play("sail");
        break;
      case "VoyageTally":
        this.engine.play("tally");
        break;
      case "LootDropped":
        if (ev.data.rarity >= 2) this.engine.play("rare-drop");
        break;
      case "CharacterRemoved":
        this.engine.play("recall");
        break;
      default:
        break;
    }
  }
}
