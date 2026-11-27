// The fight at the ramp, at landing scale: citizens cutting through a swarm
// and a pack with wide blows, shots in the air, bodies bursting into ink that
// stays, drops with their rarity marked, hauls on backs, and the horde as a
// growing mass at the frame's edge. Drawn from the script in script.ts.

import {
  type BeastPose,
  beastPose,
  drawBrute,
  drawHorde,
  drawHound,
  drawSwarm,
  type Mite,
} from "./beasts.ts";
import { type CityState, drawCity } from "./city.ts";
import { type Draw, FORM, INK } from "./draw.ts";
import {
  CITIZEN_TILES,
  detailFor,
  drawCitizen,
  HAT_TOP,
  hurt,
  type Look,
  lookOf,
  type Pose,
  shooting,
  standing,
  swinging,
  walking,
} from "./figure.ts";
import {
  drawArrow,
  drawBurn,
  drawDrop,
  drawImpact,
  drawNumber,
  drawPot,
  drawSkid,
  drawSpills,
  drawStone,
  drawSwing,
  drawTelegraph,
  drawUnmade,
  RARITY,
  type Spill,
} from "./fx.ts";
import { clamp, hash, mix, smooth } from "./geom.ts";
import { clock, MONSTER_WORDS, RARITY_WORDS } from "./names.ts";
import { drawBorder, drawNews, drawStatus, drawTags, PICTURE, type Tag } from "./plate.ts";
import type { Scene } from "./scenes.ts";
import {
  BLADE,
  BOW,
  BRUTE,
  citizenAt,
  type Fight,
  FODDER,
  lastBefore,
  makeFight,
  monsterAt,
  PACK,
  POT,
  SLING,
  SWING_CONTACT,
  SWING_LENGTH,
} from "./script.ts";
import { measure } from "./surface.ts";
import { drawValeGround, drawValeStanding, SHOWN } from "./vale.ts";

/** Pixels a tile at a landing of the vale class. docs/decisions/0030 gives the range. */
export const LANDING_TILE = 32;
/** Where the ground under the middle of the city sits in the frame at a landing. */
export const LANDED = { x: 520, y: 700 } as const;
/** The closer framing of a fight at the ramp: pixels a tile, and where the city's middle then sits. */
const FIGHT_TILE = 44;
const FIGHT_AT = { x: 60, y: 640 } as const;
/** The landing's class and modifiers, as the status block gives them. */
export const LANDING = "Vale · tier 2 · doubled packs · more rares";
/** Seconds from the start of the fight scene until the horde reaches the ramp, and how fast it comes, in tiles a second. */
export const HORDE_AT = 150;
export const HORDE_SPEED = 0.25;
/** The city lifts off this long before the horde reaches the ramp. */
export const LIFT_MARGIN = 20;

/** Which of the crowd stay aboard at a landing: the lookout and the gun crews first. */
const ABOARD = [4, 5, 10, 0, 1, 2, 3, 6, 8, 11, 12, 13];

export function crewOf(count: number): { crowd: Look[]; aboard: Set<number>; out: Look[] } {
  const crowd = Array.from({ length: count }, (_, i) => lookOf(i + 1));
  const aboard = new Set(ABOARD.slice(0, count > 40 ? 12 : 3));
  return { crowd, aboard, out: crowd.filter((_, i) => !aboard.has(i)) };
}

export interface FightSceneOptions {
  readonly citizens: number;
  readonly monsters: number;
  readonly seconds: number;
  readonly volley?: boolean;
  /** Leave out the city and the land: only what moves. The bench times this. */
  readonly bare?: boolean;
}

interface Event {
  t: number;
  text: string;
  hold: number;
  rank: number;
}

export function fightScene(options: FightSceneOptions): Scene {
  const crew = crewOf(options.citizens);
  // The bench puts every citizen in the fight, so the count is the one asked for.
  const out = options.bare ? crew.crowd : crew.out;
  const fight: Fight = makeFight({
    seed: 362,
    citizens: out.length,
    monsters: options.monsters,
    seconds: options.seconds,
    prizeAt: 6.5,
    ...(options.volley ? { volley: true } : {}),
  });
  const n = out.length;
  const crowd = n > 40;
  const nameOf = (i: number): string => (out[i] as Look).name;
  // How far each citizen has walked by each step, for its stride.
  const walked = new Float32Array(fight.steps * n);
  for (let s = 1; s < fight.steps; s++) {
    for (let i = 0; i < n; i++) {
      const dx = (fight.cx[s * n + i] as number) - (fight.cx[(s - 1) * n + i] as number);
      const dy = (fight.cy[s * n + i] as number) - (fight.cy[(s - 1) * n + i] as number);
      walked[s * n + i] = (walked[(s - 1) * n + i] as number) + Math.hypot(dx, dy);
    }
  }
  const kills = fight.hits.filter((hit) => hit.kill);

  // The news: what happened, in the order it happened.
  const events: Event[] = [];
  const banks: { t: number; items: number }[] = [];
  for (const drop of fight.drops) {
    if (drop.rarity >= 2) {
      let nearest = 0;
      let best = Infinity;
      for (let i = 0; i < n; i++) {
        const [x, y] = citizenAt(fight, i, drop.t);
        const dist = Math.hypot(x - drop.x, y - drop.y);
        if (dist < best) {
          best = dist;
          nearest = i;
        }
      }
      const where = `${nameOf(nearest)} is nearest, ${Math.max(1, Math.round(best))} tiles`;
      if (drop.rarity === 3)
        events.push({
          t: drop.t,
          text: `Unique dropped: ${drop.name} · ${where}`,
          hold: 4.4,
          rank: 5,
        });
      else if (!crowd)
        events.push({
          t: drop.t,
          text: `Rare dropped: ${drop.name} · ${where}`,
          hold: 2.4,
          rank: 2,
        });
    }
    if (drop.by >= 0 && drop.pick < options.seconds && drop.rarity >= (crowd ? 2 : 1)) {
      const what =
        drop.rarity === 3
          ? `the unique ${drop.name}`
          : `a ${RARITY_WORDS[drop.rarity]} ${drop.name}`;
      events.push({
        t: drop.pick,
        text: `${nameOf(drop.by)} picked up ${what}`,
        hold: drop.rarity === 3 ? 5 : 2.4,
        rank: drop.rarity + 1,
      });
    }
  }
  for (let i = 0; i < n; i++) {
    for (const swing of fight.swings[i] as { t: number; hits: number }[]) {
      if (swing.hits >= (crowd ? 9 : 5))
        events.push({
          t: swing.t + SWING_CONTACT,
          text: `${nameOf(i)} hit ${swing.hits} with one swing`,
          hold: 2,
          rank: 1,
        });
    }
    for (const when of fight.knocked[i] as number[])
      events.push({
        t: when,
        text: `${nameOf(i)} thrown back by a ${MONSTER_WORDS[BRUTE]}`,
        hold: 2.2,
        rank: 2,
      });
    // A haul that goes back to nothing was banked at the ramp.
    const list = fight.hauls[i] as number[];
    let since = -1;
    for (let k = 2; k < list.length; k += 2) {
      if ((list[k + 1] as number) !== 0) continue;
      const when = list[k] as number;
      const from = since;
      const items = fight.drops.filter(
        (drop) => drop.by === i && drop.pick > from && drop.pick <= when,
      ).length;
      since = when;
      banks.push({ t: when, items });
      events.push({
        t: when,
        text: `${nameOf(i)} banked ${items} items at the ramp`,
        hold: 2.4,
        rank: 3,
      });
    }
  }
  events.sort((a, b) => a.t - b.t);
  banks.sort((a, b) => a.t - b.t);

  const mites: Mite[] = [];
  const spills: Spill[] = [];
  const order: number[] = [];
  const depth: number[] = [];
  const tags: Tag[] = [];
  const parked: CityState = {
    t: 0,
    gait: 0.1,
    walk: 0,
    settle: 1,
    ramp: 1,
    crowd: crew.crowd,
    aboard: (i) => crew.aboard.has(i),
  };

  const citizenPose = (i: number, t: number, face: number, id: number): Pose => {
    const swings = fight.swings[i] as { t: number; angle: number; stop: number }[];
    // The last swing begun.
    let lo = 0;
    let hi = swings.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((swings[mid] as { t: number }).t <= t) lo = mid + 1;
      else hi = mid;
    }
    const swing = lo > 0 ? swings[lo - 1] : undefined;
    if (swing) {
      let u = t - swing.t;
      if (u < SWING_LENGTH + swing.stop) {
        // Hit-stop: the body holds at contact for as long as the blow bit.
        if (u > SWING_CONTACT) u = Math.max(SWING_CONTACT, u - swing.stop);
        return swinging(u, Math.cos(swing.angle) >= 0 ? 1 : -1);
      }
    }
    const thrown = lastBefore(fight.knocked[i] as number[], t);
    if (t - thrown < 0.5) return hurt((t - thrown) / 0.5, face);
    const role = fight.roles[i] as number;
    if (role !== BLADE) {
      const loosed = fight.loosed[i] as number[];
      const last = lastBefore(loosed, t);
      if (t - last < 0.3) return shooting(1, face, t - last > 0.12);
      // Drawing for the next shot.
      const next = loosed.find((when) => when > t);
      if (next !== undefined && next - t < 0.4) return shooting(1 - (next - t) / 0.4, face, false);
    }
    const f = clamp(t / fight.dt, 1, fight.steps - 1);
    const a = Math.floor(f);
    const speed =
      ((walked[a * n + i] as number) - (walked[Math.max(0, a - 3) * n + i] as number)) /
      (3 * fight.dt);
    if (speed > 0.5)
      return walking((walked[a * n + i] as number) * 2.6, speed > 2.5 ? 1.6 : 1, face);
    return standing(id, t, face);
  };

  const haulOf = (i: number, t: number): number => {
    const list = fight.hauls[i] as number[];
    let haul = 0;
    for (let k = 0; k < list.length; k += 2) {
      if ((list[k] as number) <= t) haul = list[k + 1] as number;
      else break;
    }
    return haul;
  };

  /** The event to show now: the most important one still held, and the latest of those. */
  const news = (t: number): { text: string; alpha: number } => {
    let best: Event | null = null;
    for (const event of events) {
      if (event.t > t) break;
      if (t >= event.t + event.hold) continue;
      if (!best || event.rank >= best.rank) best = event;
    }
    if (best) return { text: best.text, alpha: 0.5 + 0.5 * smooth(0, 0.15, t - best.t) };
    return { text: `Horde reaches the ramp in ${clock(HORDE_AT - t)}`, alpha: 1 };
  };

  return {
    duration: options.seconds,
    draw(d: Draw, t: number): void {
      // Twelve citizens are framed closer, on the ramp and the ground in front of it;
      // a hundred and fifty need the whole landing.
      const zoom = crowd ? LANDING_TILE : FIGHT_TILE;
      d.push();
      d.move(crowd ? LANDED.x : FIGHT_AT.x, crowd ? LANDED.y : FIGHT_AT.y);
      d.scale(zoom);
      if (!options.bare) drawValeGround(d, SHOWN);

      // Ink on the ground: every kill so far, the oldest dried to stains.
      let count = 0;
      // With 150 fighting, only the newest spills are kept: each is some 200 vertices.
      const window = crowd ? 220 : 900;
      let first = 0;
      while (first < kills.length && (kills[first] as { t: number }).t <= t) first++;
      for (let k = Math.max(0, first - window); k < first; k++) {
        const hit = kills[k] as (typeof kills)[number];
        const kind = (fight.monsters[hit.slot] as { kind: number }).kind;
        let spill = spills[count];
        if (!spill) {
          spill = { x: 0, y: 0, dx: 0, dy: 0, age: 0, rank: 0, seed: 0 };
          spills[count] = spill;
        }
        spill.x = hit.x;
        spill.y = hit.y - 0.1;
        spill.dx = hit.dx;
        spill.dy = hit.dy;
        spill.age = t - hit.t;
        spill.rank = kind;
        spill.seed = hit.slot * 7 + 1;
        count++;
      }
      drawSpills(d, spills, count);
      for (const burn of fight.burns)
        if (burn.t <= t && t - burn.t < 6)
          drawBurn(d, burn.x, burn.y, t - burn.t, Math.round(burn.x * 31));
      for (const slam of fight.slams) {
        if (slam.t0 <= t && t < slam.t1 + 0.08)
          drawTelegraph(
            d,
            slam.x - Math.cos(slam.angle) * 1.2,
            slam.y - Math.sin(slam.angle) * 1.2,
            slam.angle,
            2.9,
            (t - slam.t0) / (slam.t1 - slam.t0),
          );
      }

      if (!options.bare) {
        drawValeStanding(d, SHOWN, false);
        d.push();
        d.scale(1 / 100);
        drawCity(d, { ...parked, t });
        d.pop();
      }

      // Drops. Commons lie a few seconds and are then left out; the rest lie until taken.
      const labels: { x: number; y: number; name: string; rarity: number }[] = [];
      for (let k = 0; k < fight.drops.length; k++) {
        const drop = fight.drops[k] as (typeof fight.drops)[number];
        if (drop.t > t) break;
        const age = t - drop.t;
        if (drop.rarity === 0 && age > (crowd ? 1.5 : 5)) continue;
        if (t > drop.pick + 0.12) continue;
        if (crowd && drop.rarity < 2 && age > 4) continue;
        drawDrop(d, drop.x, drop.y, drop.fx, drop.fy, age, drop.rarity, drop.kind, k * 13 + 5, t);
        // A rare is named for a few seconds after it lands; a unique for as long as it lies.
        if (drop.rarity >= 2 && age > 0.6 && (drop.rarity === 3 || age < 3.4))
          labels.push({
            x: d.sx(drop.x, drop.y),
            y: d.sy(drop.x, drop.y),
            name: drop.name,
            rarity: drop.rarity,
          });
      }

      // The swarm, as one drawing.
      let swarm = 0;
      order.length = 0;
      depth.length = 0;
      for (let slot = 0; slot < fight.monsters.length; slot++) {
        const m = fight.monsters[slot] as (typeof fight.monsters)[number];
        if (m.born > t) continue;
        if (m.died <= t) {
          if (m.kind !== FODDER && t - m.died < 0.3) {
            const at = monsterAt(fight, m, m.died);
            const hit = kills.find((each) => each.slot === slot);
            if (at && hit)
              drawUnmade(
                d,
                at[0],
                at[1],
                m.kind === BRUTE ? 1.9 : 1.1,
                hit.dx,
                hit.dy,
                (t - m.died) / 0.3,
                slot * 3,
              );
          }
          continue;
        }
        const at = monsterAt(fight, m, t);
        if (!at) continue;
        if (m.kind === FODDER) {
          const before = monsterAt(fight, m, t - 0.2) ?? at;
          let mite = mites[swarm];
          if (!mite) {
            mite = { x: 0, y: 0, face: 1, phase: 0, stretch: 1, flash: false, seed: 0 };
            mites[swarm] = mite;
          }
          const moved = Math.hypot(at[0] - before[0], at[1] - before[1]);
          mite.x = at[0];
          mite.y = at[1];
          mite.face =
            at[0] - before[0] > 0.02 ? 1 : at[0] - before[0] < -0.02 ? -1 : slot % 2 ? 1 : -1;
          mite.phase = t * (2 + moved * 14) + hash(slot, 3);
          mite.stretch = 1 + Math.min(0.3, moved * 0.9) + Math.sin(t * 9 + slot) * 0.04;
          mite.flash = false;
          mite.seed = slot;
          swarm++;
        } else {
          order.push(slot);
          depth.push(at[1]);
        }
      }
      drawSwarm(d, mites, swarm, 0.74);

      // Blows: the brush stroke each leaves, under the bodies that made them.
      for (let i = 0; i < n; i++) {
        const swings = fight.swings[i] as {
          t: number;
          angle: number;
          stop: number;
          hits: number;
        }[];
        for (let k = swings.length - 1; k >= 0; k--) {
          const swing = swings[k] as (typeof swings)[number];
          if (swing.t > t) continue;
          const age = t - (swing.t + SWING_CONTACT - 0.04);
          if (age > 0.42) break;
          if (age < 0) continue;
          const [x, y] = citizenAt(fight, i, swing.t);
          drawSwing(d, x, y - 0.4, 2.5, swing.angle, 2.6, age, (out[i] as Look).cloak, i * 17 + k);
        }
      }

      // Everything that stands, sorted by its feet.
      for (let i = 0; i < n; i++) {
        order.push(-1 - i);
        depth.push(citizenAt(fight, i, t)[1]);
      }
      const index = order
        .map((_, k) => k)
        .sort((a, b) => (depth[a] as number) - (depth[b] as number));
      const size = CITIZEN_TILES;
      tags.length = 0;
      for (const k of index) {
        const who = order[k] as number;
        if (who < 0) {
          const i = -1 - who;
          const [x, y, face] = citizenAt(fight, i, t);
          const look = out[i] as Look;
          const p = citizenPose(i, t, face, look.id);
          p.haul = haulOf(i, t);
          const thrown = lastBefore(fight.knocked[i] as number[], t);
          if (t - thrown < 0.45) drawSkid(d, x, y, face, 0, t - thrown, i * 7);
          drawCitizen(d, look, p, x, y, size, detailFor(size * zoom));
          tags.push({
            x: d.sx(x, y),
            y: d.sy(x, y) - size * zoom * HAT_TOP,
            name: look.name,
            rgb: look.cloak,
            must: !crowd,
          });
          continue;
        }
        const m = fight.monsters[who] as (typeof fight.monsters)[number];
        const at = monsterAt(fight, m, t) as [number, number];
        const before = monsterAt(fight, m, t - 0.25) ?? at;
        const vx = (at[0] - before[0]) / 0.25;
        const vy = (at[1] - before[1]) / 0.25;
        const speed = Math.hypot(vx, vy);
        const act = lastBefore(m.acts, t);
        const since = t - act;
        const hurtAge = t - m.hurt;
        const p: BeastPose = beastPose({
          face: vx > 0.15 ? 1 : -1,
          stride: (t * (m.kind === BRUTE ? 0.9 : 1.2 + speed * 0.35) + hash(who, 5)) % 1,
          speed: clamp(speed / (m.kind === BRUTE ? 1 : 3)),
          hurt: clamp(1 - hurtAge / 0.3),
          flash: hurtAge >= 0 && hurtAge < 0.07,
          ink: m.hurt > -1 ? 0.4 : 1,
          stretch:
            hurtAge >= 0 && hurtAge < 0.4
              ? 1 - 0.2 * Math.sin(hurtAge * 16) * (1 - hurtAge / 0.4)
              : 1,
        });
        if (hurtAge >= 0 && hurtAge < 0.45)
          drawSkid(d, at[0], at[1], m.hurtX, m.hurtY, hurtAge, who);
        if (m.kind === PACK) {
          if (since < 0.35) p.coil = smooth(0, 0.3, since);
          else if (since < 0.62) p.lunge = 1 - smooth(0.5, 0.62, since);
          drawHound(d, at[0], at[1], 0.72, p, m.build, who * 11);
        } else {
          if (since < 0.55) p.coil = smooth(0, 0.5, since);
          else if (since < 0.85) p.lunge = 1 - smooth(0.7, 0.85, since);
          drawBrute(d, at[0], at[1], 1.85, p, who * 11);
        }
      }

      // Where blows have just landed.
      let marks = 0;
      for (let k = fight.hits.length - 1; k >= 0 && marks < 60; k--) {
        const hit = fight.hits[k] as (typeof fight.hits)[number];
        if (hit.t > t) continue;
        if (t - hit.t > 0.17) break;
        const kind = (fight.monsters[hit.slot] as { kind: number }).kind;
        drawImpact(
          d,
          hit.x,
          hit.y - 0.3,
          t - hit.t,
          kind === FODDER ? 0.5 : kind === PACK ? 0.8 : 1.2,
          k,
        );
        marks++;
      }

      // Shots in the air.
      for (const shot of fight.shots) {
        if (shot.t0 > t) break;
        if (shot.t1 <= t) continue;
        const k = (t - shot.t0) / (shot.t1 - shot.t0);
        const x = shot.x0 + (shot.x1 - shot.x0) * k;
        const y = shot.y0 + (shot.y1 - shot.y0) * k;
        const len = Math.hypot(shot.x1 - shot.x0, shot.y1 - shot.y0) || 1;
        const dx = (shot.x1 - shot.x0) / len;
        const dy = (shot.y1 - shot.y0) / len;
        if (shot.kind === BOW)
          drawArrow(d, x, y, dx, dy, 0.6 + Math.sin(k * Math.PI) * 0.5, shot.who);
        else if (shot.kind === SLING)
          drawStone(d, x, y, 0.5 + Math.sin(k * Math.PI) * (1.2 + len * 0.12));
        else if (shot.kind === POT)
          drawPot(d, x, y, dx, dy, 0.5 + Math.sin(k * Math.PI) * (1.6 + len * 0.14), t, shot.who);
      }

      if (!options.bare) drawValeStanding(d, SHOWN, true);

      // Numbers: with this many blows in frame, only crits and blows on a brute are lettered.
      let lettered = 0;
      for (let k = fight.hits.length - 1; k >= 0 && lettered < 5; k--) {
        const hit = fight.hits[k] as (typeof fight.hits)[number];
        if (hit.t > t) continue;
        if (t - hit.t > 0.9) break;
        const kind = (fight.monsters[hit.slot] as { kind: number }).kind;
        if (!hit.crit && kind !== BRUTE) continue;
        if (crowd && !hit.crit) continue;
        drawNumber(d, hit.x, hit.y, hit.dx, hit.dy, t - hit.t, hit.damage, hit.crit, hit.kill);
        lettered++;
      }
      d.pop();

      // A rare or unique drop is named where it lies, in its colour; then a username over every citizen.
      const taken: number[] = [];
      for (const label of labels.slice(-6)) {
        const w = measure("roman", 24, label.name) + 14;
        const top = label.y + 14;
        const rgb = RARITY[label.rarity] as number;
        d.fill(d.box(label.x - w / 2, top, label.x + w / 2, top + 28), d.ground, 0.92);
        d.fill(d.box(label.x - w / 2, top + 28, label.x + w / 2, top + 32), rgb);
        d.text(label.name, label.x, top + 22, { size: 24, align: 0.5, rgb: mix(rgb, INK, 0.55) });
        taken.push(label.x - w / 2, top, label.x + w / 2, top + 32);
      }
      // With more names than there is room for, who gets first pick moves on every
      // few seconds, so each citizen is named in its turn.
      if (crowd) tags.push(...tags.splice(0, (Math.floor(t / 2.5) * 17) % tags.length));
      const shown = drawTags(d, tags, 1, taken);

      if (options.bare) {
        drawBorder(d);
        drawNews(
          d,
          `Bench: ${n} citizens, ${options.monsters} monsters, shots and ink`,
          1,
          `${shown} of ${n} names shown`,
          "",
        );
        return;
      }
      // The horde's mass grows as it nears.
      drawHorde(d, PICTURE.x1, PICTURE.y0, PICTURE.y1, 110 + (t / options.seconds) * 300, t);
      drawBorder(d);
      drawStatus(d, [
        `Landed · lift-off in ${clock(HORDE_AT - LIFT_MARGIN - t)}`,
        LANDING,
        `Horde ${Math.ceil((HORDE_AT - t) * HORDE_SPEED)} tiles from the ramp`,
      ]);
      drawLegend(d, t);
      let killed = 0;
      while (killed < kills.length && (kills[killed] as { t: number }).t <= t) killed++;
      let banked = 0;
      for (const bank of banks) if (bank.t <= t) banked += bank.items;
      const line = news(t);
      const names = crowd ? ` · ${shown} names shown` : "";
      drawNews(
        d,
        line.text,
        line.alpha,
        `${n} out · ${crew.aboard.size} aboard${names}`,
        `${killed} kills · ${banked} items banked`,
      );
    },
  };

  /** The citizens with the most to show for the landing so far: kills and how full the pack is. */
  function drawLegend(d: Draw, t: number): void {
    const tally = new Array<number>(n).fill(0);
    for (const hit of kills) {
      if (hit.t > t) break;
      if (hit.by >= 0) tally[hit.by] = (tally[hit.by] as number) + 1;
    }
    const all = tally.map((killCount, i) => ({ i, kills: killCount, haul: haulOf(i, t) }));
    const rows = [...all]
      .sort((a, b) => b.haul * 40 + b.kills - (a.haul * 40 + a.kills) || a.i - b.i)
      .slice(0, 4);
    // Under the leaders, everyone else three at a time, so each name is on the roster in its turn.
    const led = new Set(rows.map((row) => row.i));
    const rest = all.filter((row) => !led.has(row.i));
    const pages = Math.ceil(rest.length / 3);
    const page = pages > 0 ? Math.floor(t / 3) % pages : 0;
    const turn = rest.slice(page * 3, page * 3 + 3);
    rows.push(...turn);
    const stat = (row: { kills: number; haul: number }): string =>
      `${row.kills} ${row.kills === 1 ? "kill" : "kills"} · haul ${Math.round(row.haul * 100)}%`;
    // Wide enough for the longest name on it beside its numbers: a name is never cut short.
    let w = 380;
    for (const row of rows)
      w = Math.max(
        w,
        64 +
          measure("roman", 24, (out[row.i] as Look).name) +
          28 +
          measure("roman", 24, stat(row)) +
          22,
      );
    const x = PICTURE.x1 - w - 28;
    const y = PICTURE.y0 + 26;
    const h = 22 + rows.length * 46 + (turn.length > 0 ? 44 : 0);
    d.body(
      [
        x + 10,
        y,
        x + w - 10,
        y,
        x + w,
        y + 10,
        x + w,
        y + h - 10,
        x + w - 10,
        y + h,
        x + 10,
        y + h,
        x,
        y + h - 10,
        x,
        y + 10,
      ],
      { smooth: false, weight: FORM, seed: 77 },
    );
    rows.forEach((row, k) => {
      const look = out[row.i] as Look;
      const ry = y + 46 + k * 46 + (k >= 4 ? 10 : 0);
      const p = standing(look.id, t, 1);
      p.haul = row.haul;
      // The small figure beside a name is what tells two names a character apart.
      drawCitizen(d, look, p, x + 34, ry + 8, 34, 0);
      d.text(look.name, x + 64, ry, { size: 24 });
      d.text(stat(row), x + w - 22, ry, { size: 24, align: 1 });
    });
    if (turn.length > 0) {
      d.line(x + 20, y + 22 + 4 * 46 - 4, x + w - 20, y + 22 + 4 * 46 - 4, 0.75, 79);
      const from = 5 + page * 3;
      d.text(`${from} to ${from + turn.length - 1} of ${n}`, x + w / 2, y + h - 14, {
        size: 24,
        align: 0.5,
        alpha: 0.75,
      });
    }
  }
}
