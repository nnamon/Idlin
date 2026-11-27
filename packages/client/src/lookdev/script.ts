// The fight at the ramp, written out ahead of time. This is not the game's
// simulation: it is a seeded choreography, stepped once when the scene opens
// and then read back by time, so any moment of the fight can be drawn (and
// captured) on its own. Distances are in tiles from the ground under the
// middle of the city; the ramp's foot is at about (8.9, 0).
//
// No canvas in here, so the script itself is tested (script.test.ts).

import { clamp, hash, rng } from "./geom.ts";
import { ITEM_KINDS, itemName } from "./names.ts";

export const FODDER = 0;
export const PACK = 1;
export const BRUTE = 2;

export const BLADE = 0;
export const BOW = 1;
export const SLING = 2;
export const POT = 3;

/** How long before contact a wide blow starts, and how long the whole of it takes. */
export const SWING_CONTACT = 0.23;
export const SWING_LENGTH = 0.69;

export interface FightOptions {
  readonly seed: number;
  readonly citizens: number;
  /** How many monsters are kept alive at once. */
  readonly monsters: number;
  readonly seconds: number;
  /** Archers loose more often and their shots fly slower, to hold a hundred in the air. */
  readonly volley?: boolean;
  /** The first blade kill after this many seconds drops a unique, which lies a while before anyone takes it. */
  readonly prizeAt?: number;
}

export interface Swing {
  readonly t: number;
  readonly angle: number;
  /** Seconds the swinger holds still at contact; known once the blow has landed. */
  stop: number;
  /** How many it hit. */
  hits: number;
}

export interface Shot {
  readonly t0: number;
  readonly t1: number;
  readonly who: number;
  readonly kind: number;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** The slot it hits, or -1 for a shot that lands on the ground. */
  readonly target: number;
}

export interface Hit {
  readonly t: number;
  readonly slot: number;
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
  readonly kill: boolean;
  readonly crit: boolean;
  readonly damage: number;
  /** The citizen who dealt it. */
  readonly by: number;
}

export interface Drop {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  /** Where it was thrown from. */
  readonly fx: number;
  readonly fy: number;
  /** 0 common, 1 magic, 2 rare, 3 unique. */
  readonly rarity: number;
  /** 0 a weapon, 1 a ring, 2 a helm, 3 body armour. */
  readonly kind: number;
  readonly name: string;
  /** When it is picked up, and by whom; Infinity and -1 if it is left. */
  pick: number;
  by: number;
}

export interface Slam {
  /** The wind-up starts, and the blow lands. */
  readonly t0: number;
  readonly t1: number;
  readonly slot: number;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

export interface Monster {
  readonly kind: number;
  readonly born: number;
  died: number;
  /** The step it was born on, and its position at each step from then. */
  readonly first: number;
  readonly track: number[];
  /** The last blow it took and lived: when, and which way. */
  hurt: number;
  hurtX: number;
  hurtY: number;
  /** When each of its lunges or slams began. */
  readonly acts: number[];
  readonly build: number;
}

export interface Fight {
  readonly options: FightOptions;
  readonly dt: number;
  readonly steps: number;
  /** Citizen positions and facings, `steps` rows of `citizens`. */
  readonly cx: Float32Array;
  readonly cy: Float32Array;
  readonly cface: Int8Array;
  readonly roles: Uint8Array;
  readonly swings: Swing[][];
  readonly loosed: number[][];
  readonly knocked: number[][];
  /** Each citizen's haul over time: pairs of time and size. */
  readonly hauls: number[][];
  readonly monsters: Monster[];
  readonly shots: Shot[];
  readonly hits: Hit[];
  readonly drops: Drop[];
  readonly slams: Slam[];
  /** Where a firepot landed, and when. */
  readonly burns: { t: number; x: number; y: number }[];
}

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Citizen extends Body {
  role: number;
  cool: number;
  /** Frozen in a swing until this time. */
  busy: number;
  face: number;
  haul: number;
  /** The drop it is going to pick up, or -1. */
  errand: number;
  home: boolean;
  /** Where it holds its ground: the fight is kept at the ramp. */
  homeX: number;
  homeY: number;
}

interface Live extends Body {
  slot: number;
  kind: number;
  hp: number;
  stun: number;
  cool: number;
  /** For a pack monster or brute: -1 idle, otherwise when its move began. */
  act: number;
  ax: number;
  ay: number;
  aim: number;
  jitter: number;
  /** Sliding from a blow until this time. */
  reel: number;
}

/** Where the ramp meets the ground. */
export const RAMP = { x: 8.9, y: 0 } as const;

export function makeFight(options: FightOptions): Fight {
  const random = rng(options.seed);
  const dt = 1 / 30;
  const steps = Math.round(options.seconds / dt);
  const n = options.citizens;
  const cx = new Float32Array(steps * n);
  const cy = new Float32Array(steps * n);
  const cface = new Int8Array(steps * n);
  const roles = new Uint8Array(n);
  const swings: Swing[][] = Array.from({ length: n }, () => []);
  const loosed: number[][] = Array.from({ length: n }, () => []);
  const knocked: number[][] = Array.from({ length: n }, () => []);
  const hauls: number[][] = Array.from({ length: n }, () => [0, 0]);
  const monsters: Monster[] = [];
  const shots: Shot[] = [];
  const hits: Hit[] = [];
  const drops: Drop[] = [];
  const slams: Slam[] = [];
  const burns: { t: number; x: number; y: number }[] = [];
  const crowd = n > 40;

  const ROLE = [BLADE, BLADE, BOW, BLADE, SLING, BLADE, BOW, POT];
  const citizens: Citizen[] = [];
  for (let i = 0; i < n; i++) {
    const role = ROLE[i % ROLE.length] as number;
    roles[i] = role;
    // They have come down the ramp and spread: blades to the front, the rest behind.
    const depth =
      role === BLADE ? 4 + random() * (crowd ? 9 : 3.5) : 1 + random() * (crowd ? 7 : 3);
    const homeY = (random() - 0.5) * (crowd ? 22 : 11);
    citizens.push({
      x: RAMP.x + depth,
      y: homeY * 0.8,
      vx: 0,
      vy: 0,
      role,
      cool: random() * 1.2,
      busy: 0,
      face: 1,
      haul: 0,
      errand: -1,
      home: false,
      homeX: RAMP.x + depth,
      homeY,
    });
  }

  const live: Live[] = [];
  let prized = false;
  const pending: { t: number; shot: Shot }[] = [];
  const landing: {
    t: number;
    who: number;
    swing: { angle: number; stop: number; hits: number };
  }[] = [];
  const burning: { until: number; x: number; y: number }[] = [];
  const want = options.monsters;
  const brutes = Math.max(1, Math.round(want / 90));
  const packs = Math.round(want * 0.12);
  let clumpLeft = 0;
  let clumpX = 0;
  let clumpY = 0;

  const spawn = (kind: number, step: number, t: number, warm: boolean): void => {
    // They come out of the woods and the crags on the far side, in clumps.
    if (clumpLeft <= 0) {
      clumpLeft = kind === FODDER ? 9 + Math.floor(random() * 10) : 3;
      clumpX = warm ? RAMP.x + 8 + random() * 22 : 33 + random() * 7;
      clumpY = [-9, -4.5, 0.5, 4.5, 7.5][Math.floor(random() * 5)] as number;
    }
    clumpLeft--;
    const x = clumpX + (random() - 0.5) * 3.4;
    const y = clamp(clumpY + (random() - 0.5) * 3.4, -12, 8.5);
    const slot = monsters.length;
    monsters.push({
      kind,
      born: warm ? -1 : t,
      died: Infinity,
      first: step,
      track: [],
      hurt: -9,
      hurtX: 0,
      hurtY: 0,
      acts: [],
      build: Math.floor(random() * 3),
    });
    live.push({
      slot,
      kind,
      x,
      y,
      vx: 0,
      vy: 0,
      hp: kind === FODDER ? 1 : kind === PACK ? 2 : 7,
      stun: 0,
      cool: 0.5 + random() * 2,
      act: -1,
      ax: 0,
      ay: 0,
      aim: 0,
      jitter: random() * 100,
      reel: 0,
    });
  };

  const countOf = (kind: number): number => {
    let count = 0;
    for (const m of live) if (m.kind === kind) count++;
    return count;
  };

  const strike = (
    m: Live,
    t: number,
    dx: number,
    dy: number,
    damage: number,
    by: number,
    push: number,
  ): boolean => {
    const record = monsters[m.slot] as Monster;
    m.hp -= damage;
    const kill = m.hp <= 0;
    const crit = random() < 0.12;
    hits.push({
      t,
      slot: m.slot,
      x: m.x,
      y: m.y,
      dx,
      dy,
      kill,
      crit,
      damage: Math.round((crit ? 2.2 : 1) * (38 + random() * 60) * damage),
      by,
    });
    if (kill) {
      record.died = t;
      // Every kill drops something; most of it is common and goes unshown later.
      const roll = random();
      const rich = m.kind === BRUTE ? 0.3 : m.kind === PACK ? 0.05 : 0;
      const prize =
        !prized &&
        options.prizeAt !== undefined &&
        t >= options.prizeAt &&
        by >= 0 &&
        m.x > RAMP.x + 6;
      if (prize) prized = true;
      // The only unique is the one the script calls for.
      const rarity = prize ? 3 : roll < 0.035 + rich * 0.5 ? 2 : roll < 0.17 + rich ? 1 : 0;
      const throwBy = 0.6 + random() * 1.2;
      const spread = (random() - 0.5) * 1.2;
      const kind = Math.floor(random() * ITEM_KINDS);
      drops.push({
        t,
        x: clamp(m.x + dx * throwBy - dy * spread, RAMP.x + 1, 34),
        y: clamp(m.y + dy * throwBy + dx * spread, -11, 8),
        fx: m.x,
        fy: m.y,
        rarity,
        kind,
        name: itemName(drops.length + options.seed, rarity, kind),
        pick: Infinity,
        by: -1,
      });
    } else {
      record.hurt = t;
      record.hurtX = dx;
      record.hurtY = dy;
      m.stun = m.kind === FODDER ? 1 : 2;
      m.vx = dx * push;
      m.vy = dy * push;
      m.act = -1;
      // Thrown back, it slides a moment before it has its feet again.
      m.reel = t + 0.35;
      m.cool = Math.max(m.cool, 0.9);
    }
    return kill;
  };

  // Start in the thick of it.
  for (let i = 0; i < want; i++)
    spawn(i < brutes ? BRUTE : i < brutes + packs ? PACK : FODDER, 0, 0, true);

  for (let step = 0; step < steps; step++) {
    const t = step * dt;

    // Blows that were swung land.
    for (let k = landing.length - 1; k >= 0; k--) {
      const blow = landing[k] as {
        t: number;
        who: number;
        swing: { angle: number; stop: number; hits: number };
      };
      if (blow.t > t) continue;
      landing.splice(k, 1);
      const c = citizens[blow.who] as Citizen;
      let heavy = false;
      for (let j = live.length - 1; j >= 0; j--) {
        const m = live[j] as Live;
        const mx = m.x - c.x;
        const my = m.y - c.y;
        const md = Math.hypot(mx, my) || 1;
        if (md > 2.3) continue;
        let off = Math.atan2(my, mx) - blow.swing.angle;
        off = Math.atan2(Math.sin(off), Math.cos(off));
        if (Math.abs(off) > 1.25) continue;
        blow.swing.hits++;
        if (m.kind !== FODDER) heavy = true;
        if (strike(m, t, mx / md, my / md, 1, blow.who, m.kind === BRUTE ? 2 : 7))
          live.splice(j, 1);
      }
      // The swinger holds still with what it hit: two frames for fodder, four for anything bigger.
      blow.swing.stop = blow.swing.hits === 0 ? 0 : heavy ? 4 / 60 : 2 / 60;
      c.busy += blow.swing.stop;
    }

    // Shots in the air arrive.
    for (let k = pending.length - 1; k >= 0; k--) {
      const p = pending[k] as { t: number; shot: Shot };
      if (p.t > t) continue;
      pending.splice(k, 1);
      const shot = p.shot;
      const len = Math.hypot(shot.x1 - shot.x0, shot.y1 - shot.y0) || 1;
      const dx = (shot.x1 - shot.x0) / len;
      const dy = (shot.y1 - shot.y0) / len;
      if (shot.kind === POT) {
        burns.push({ t, x: shot.x1, y: shot.y1 });
        burning.push({ until: t + 2.4, x: shot.x1, y: shot.y1 });
      } else {
        const m = live.find((each) => each.slot === shot.target);
        if (m && Math.hypot(m.x - shot.x1, m.y - shot.y1) < 1.6) {
          if (strike(m, t, dx, dy, 1, shot.who, shot.kind === SLING ? 5 : 3))
            live.splice(live.indexOf(m), 1);
        }
      }
    }
    for (let k = burning.length - 1; k >= 0; k--) {
      const fire = burning[k] as { until: number; x: number; y: number };
      if (fire.until < t) {
        burning.splice(k, 1);
        continue;
      }
      if (step % 6 !== 0) continue;
      for (let j = live.length - 1; j >= 0; j--) {
        const m = live[j] as Live;
        const dist = Math.hypot(m.x - fire.x, m.y - fire.y);
        if (dist < 1.7 && m.kind !== BRUTE) {
          if (strike(m, t, (m.x - fire.x) / (dist || 1), (m.y - fire.y) / (dist || 1), 1, -1, 2))
            live.splice(j, 1);
        }
      }
    }

    // Citizens.
    for (let i = 0; i < n; i++) {
      const c = citizens[i] as Citizen;
      c.cool -= dt;
      let nearest: Live | null = null;
      let nearestD = Infinity;
      for (const m of live) {
        const dist = Math.hypot(m.x - c.x, (m.y - c.y) * 1.25);
        const weight = dist - (m.kind === PACK && c.role !== BLADE ? 3 : 0);
        if (weight < nearestD) {
          nearestD = weight;
          nearest = m;
        }
      }
      let tx = c.x;
      let ty = c.y;
      let speed = 0;
      if (c.busy > t) {
        // In a swing: the feet are planted.
      } else if (c.home) {
        // Carrying a full haul back to the ramp.
        tx = RAMP.x + 0.4;
        ty = RAMP.y;
        speed = 2.3;
        if (Math.hypot(tx - c.x, ty - c.y) < 0.5) {
          c.home = false;
          c.haul = 0;
          (hauls[i] as number[]).push(t, 0);
        }
      } else if (c.errand >= 0) {
        const drop = drops[c.errand] as Drop;
        tx = drop.x;
        ty = drop.y;
        speed = 2.9;
        if (Math.hypot(tx - c.x, ty - c.y) < 0.35 && t > drop.t + 0.5) {
          drop.pick = t;
          drop.by = i;
          c.errand = -1;
          c.haul = Math.min(1, c.haul + ([0.1, 0.2, 0.4, 0.6][drop.rarity] as number));
          (hauls[i] as number[]).push(t, c.haul);
          if (c.haul >= 0.95) c.home = true;
        }
      } else if (nearest) {
        const dx = nearest.x - c.x;
        const dy = nearest.y - c.y;
        const dist = Math.hypot(dx, dy) || 1;
        if (c.role === BLADE) {
          // It goes to meet what comes near, and no further: the line holds at the ramp.
          const leashed = Math.hypot(nearest.x - c.homeX, nearest.y - c.homeY) < 7;
          if (leashed && dist > 1.5) {
            tx = nearest.x;
            ty = nearest.y;
            speed = 2.7;
          } else if (!leashed && Math.hypot(c.homeX - c.x, c.homeY - c.y) > 1) {
            tx = c.homeX;
            ty = c.homeY;
            speed = 2.2;
          }
          if (dist < 2.2 && c.cool <= 0) {
            // A wide blow: everything in the arc in front is hit when it lands.
            const swing = { t, angle: Math.atan2(dy, dx), stop: 0, hits: 0 };
            (swings[i] as Swing[]).push(swing);
            landing.push({ t: t + SWING_CONTACT, who: i, swing });
            c.busy = t + SWING_LENGTH * 0.8;
            c.cool = 0.95 + random() * 0.4;
            c.face = dx >= 0 ? 1 : -1;
          }
        } else {
          const keep = c.role === BOW ? 7.5 : c.role === SLING ? 6 : 6.5;
          if (dist < keep - 1.5) {
            tx = c.x - dx;
            ty = c.y - dy * 0.4;
            speed = 2.4;
          } else if (dist > keep + 2.5 && c.x < c.homeX + 2) {
            tx = nearest.x;
            ty = nearest.y;
            speed = 2.4;
          }
          if (dist < keep + 6 && c.cool <= 0) {
            const fast = options.volley === true;
            const flight =
              c.role === BOW
                ? dist / (fast ? 7 : 21)
                : c.role === SLING
                  ? 0.55 + dist * 0.03
                  : 0.85 + dist * 0.03;
            const lead = c.role === POT ? 1 : 0.3;
            const shot: Shot = {
              t0: t + 0.12,
              t1: t + 0.12 + flight,
              who: i,
              kind: c.role,
              x0: c.x,
              y0: c.y,
              x1: nearest.x + nearest.vx * flight * lead,
              y1: nearest.y + nearest.vy * flight * lead,
              target: nearest.slot,
            };
            shots.push(shot);
            pending.push({ t: shot.t1, shot });
            (loosed[i] as number[]).push(t);
            c.busy = t + 0.3;
            c.cool =
              c.role === BOW
                ? fast
                  ? 0.33
                  : 0.8 + random() * 0.3
                : c.role === SLING
                  ? 1.0 + random() * 0.3
                  : 2.6 + random() * 0.8;
            c.face = dx >= 0 ? 1 : -1;
          }
        }
        // Something worth having on the ground nearby.
        // Nobody turns from a monster within reach to pick something up, save for a unique.
        const free = nearestD > 3.2 || step % 90 === i % 90;
        if (c.busy <= t && step % 10 === i % 10 && c.haul < 0.95 && free) {
          for (let k = drops.length - 1; k >= 0 && k > drops.length - 60; k--) {
            const drop = drops[k] as Drop;
            if (drop.rarity === 0 || drop.pick !== Infinity || drop.by !== -1) continue;
            if (t < drop.t + (drop.rarity === 3 ? 4 : 0.4)) continue;
            if (Math.hypot(drop.x - c.x, drop.y - c.y) < 5 + drop.rarity * 2) {
              drop.by = -2 - i;
              c.errand = k;
              break;
            }
          }
        }
      }
      // Hold a rough line rather than bunching on one monster.
      ty += (c.homeY - c.y) * 0.04;
      if (speed > 0) {
        const dx = tx - c.x;
        const dy = ty - c.y;
        const dist = Math.hypot(dx, dy) || 1;
        c.vx += ((dx / dist) * speed - c.vx) * 0.25;
        c.vy += ((dy / dist) * speed * 0.8 - c.vy) * 0.25;
        if (Math.abs(dx) > 0.3) c.face = dx > 0 ? 1 : -1;
      } else {
        c.vx *= 0.6;
        c.vy *= 0.6;
      }
    }
    // Citizens keep off each other's feet.
    for (let i = 0; i < n; i++) {
      const a = citizens[i] as Citizen;
      for (let j = i + 1; j < n; j++) {
        const b = citizens[j] as Citizen;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.abs(dx) > 0.9 || Math.abs(dy) > 0.9) continue;
        const dist = Math.hypot(dx, dy) || 0.01;
        if (dist < 0.85) {
          const push = ((0.85 - dist) / dist) * 0.5;
          a.x -= dx * push;
          a.y -= dy * push;
          b.x += dx * push;
          b.y += dy * push;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const c = citizens[i] as Citizen;
      c.x = clamp(c.x + c.vx * dt, RAMP.x + 0.3, 33);
      c.y = clamp(c.y + c.vy * dt, -12, 8.6);
      cx[step * n + i] = c.x;
      cy[step * n + i] = c.y;
      cface[step * n + i] = c.face;
    }

    // Monsters.
    const cell = new Map<number, Live[]>();
    for (const m of live) {
      const key = Math.floor(m.x) * 512 + Math.floor(m.y + 64);
      const list = cell.get(key);
      if (list) list.push(m);
      else cell.set(key, [m]);
    }
    for (const m of live) {
      const record = monsters[m.slot] as Monster;
      if (m.stun > 0) {
        m.stun--;
        record.track.push(m.x, m.y);
        continue;
      }
      // The nearest citizen, looked for now and then.
      let target: Citizen | null = null;
      let best = Infinity;
      const stride = crowd ? 3 : 1;
      for (let i = (m.slot + step) % stride; i < n; i += stride) {
        const c = citizens[i] as Citizen;
        const dist = Math.hypot(c.x - m.x, c.y - m.y);
        if (dist < best) {
          best = dist;
          target = c;
        }
      }
      m.cool -= dt;
      let wantX = 0;
      let wantY = 0;
      if (target && m.reel <= t) {
        const dx = target.x - m.x;
        const dy = target.y - m.y;
        const dist = Math.hypot(dx, dy) || 1;
        const ux = dx / dist;
        const uy = dy / dist;
        if (m.kind === FODDER) {
          const wobble = Math.sin(t * 5 + m.jitter) * 0.7;
          const speed = dist > 0.8 ? 3.3 : 0.2;
          wantX = (ux - uy * wobble) * speed;
          wantY = (uy + ux * wobble) * speed;
        } else if (m.kind === PACK) {
          if (m.act >= 0) {
            const k = t - m.act;
            if (k < 0.35) {
              // Coiled.
              wantX = -m.ax * 0.6;
              wantY = -m.ay * 0.6;
            } else if (k < 0.6) {
              wantX = m.ax * 9;
              wantY = m.ay * 9;
            } else {
              m.act = -1;
              m.cool = 1.4 + hash(m.slot, step) * 1.6;
            }
          } else if (dist < 3.2 && m.cool <= 0) {
            m.act = t;
            m.ax = ux;
            m.ay = uy;
            record.acts.push(t);
          } else if (dist > 2.6) {
            const side = Math.sin(t * 1.7 + m.jitter) * 0.5;
            wantX = (ux - uy * side) * 4.2;
            wantY = (uy + ux * side) * 4.2;
          } else {
            // Circling for an opening.
            const way = m.slot % 2 ? 1 : -1;
            wantX = -uy * way * 1.8;
            wantY = ux * way * 1.8;
          }
        } else {
          if (m.act >= 0) {
            const k = t - m.act;
            if (k >= 0.55 && k - dt < 0.55) {
              // The slam lands: citizens in front are thrown back.
              for (let i = 0; i < n; i++) {
                const c = citizens[i] as Citizen;
                const cdx = c.x - (m.x + m.ax * 1.2);
                const cdy = c.y - (m.y + m.ay * 1.2);
                const cd = Math.hypot(cdx, cdy) || 1;
                if (cd < 1.9) {
                  c.vx = (cdx / cd) * 7;
                  c.vy = (cdy / cd) * 5;
                  c.busy = t + 0.5;
                  (knocked[i] as number[]).push(t);
                }
              }
            }
            if (k > 1.2) {
              m.act = -1;
              m.cool = 2.2;
            }
          } else if (dist < 2.3 && m.cool <= 0) {
            m.act = t;
            m.ax = ux;
            m.ay = uy;
            record.acts.push(t);
            slams.push({
              t0: t,
              t1: t + 0.55,
              slot: m.slot,
              x: m.x + ux * 1.2,
              y: m.y + uy * 1.2,
              angle: Math.atan2(uy, ux),
            });
          } else if (dist > 1.6) {
            wantX = ux * 1.1;
            wantY = uy * 1.1;
          }
        }
      }
      // Bodies press apart, so a swarm is a mass and not a point.
      const gx = Math.floor(m.x);
      const gy = Math.floor(m.y + 64);
      const room = m.kind === FODDER ? 0.42 : m.kind === PACK ? 0.9 : 1.6;
      // One thrown back by a blow goes through the press; the rest make way.
      for (let ox = m.reel > t ? 2 : -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const list = cell.get((gx + ox) * 512 + gy + oy);
          if (!list) continue;
          for (const other of list) {
            if (other === m) continue;
            const dx = m.x - other.x;
            const dy = m.y - other.y;
            const dist = Math.hypot(dx, dy) || 0.01;
            const reach =
              (room + (other.kind === FODDER ? 0.42 : other.kind === PACK ? 0.9 : 1.6)) / 2;
            if (dist < reach) {
              wantX += (dx / dist) * (reach - dist) * 5;
              wantY += (dy / dist) * (reach - dist) * 5;
            }
          }
        }
      }
      const ease = m.kind === BRUTE ? 0.1 : 0.3;
      m.vx += (wantX - m.vx) * ease;
      m.vy += (wantY - m.vy) * ease;
      m.x += m.vx * dt;
      m.y = clamp(m.y + m.vy * dt, -12.5, 9);
      record.track.push(m.x, m.y);
    }

    // Keep the numbers up: for each that fell this step another comes out of the east.
    for (let k = live.length; k < want; k++) {
      const kind = countOf(BRUTE) < brutes ? BRUTE : countOf(PACK) < packs ? PACK : FODDER;
      spawn(kind, step + 1, t, false);
    }
  }

  return {
    options,
    dt,
    steps,
    cx,
    cy,
    cface,
    roles,
    swings,
    loosed,
    knocked,
    hauls,
    monsters,
    shots,
    hits,
    drops,
    slams,
    burns,
  };
}

/** How many monsters are alive at a time, and how many shots are in the air. */
export function census(fight: Fight, t: number): { monsters: number; shots: number } {
  let alive = 0;
  for (const m of fight.monsters) if (m.born <= t && m.died > t) alive++;
  let flying = 0;
  for (const shot of fight.shots) if (shot.t0 <= t && shot.t1 > t) flying++;
  return { monsters: alive, shots: flying };
}

/** A monster's place at a time, or null before it is born. */
export function monsterAt(fight: Fight, m: Monster, t: number): [number, number] | null {
  const f = t / fight.dt - m.first;
  const last = m.track.length / 2 - 1;
  if (f < 0 || last < 0) return null;
  const i = Math.min(last, Math.floor(f));
  const j = Math.min(last, i + 1);
  const k = Math.min(1, f - i);
  const x0 = m.track[i * 2] as number;
  const y0 = m.track[i * 2 + 1] as number;
  return [
    x0 + ((m.track[j * 2] as number) - x0) * k,
    y0 + ((m.track[j * 2 + 1] as number) - y0) * k,
  ];
}

/** A citizen's place and facing at a time. */
export function citizenAt(fight: Fight, i: number, t: number): [number, number, number] {
  const n = fight.options.citizens;
  const f = clamp(t / fight.dt, 0, fight.steps - 1);
  const a = Math.floor(f);
  const b = Math.min(fight.steps - 1, a + 1);
  const k = f - a;
  const x0 = fight.cx[a * n + i] as number;
  const y0 = fight.cy[a * n + i] as number;
  return [
    x0 + ((fight.cx[b * n + i] as number) - x0) * k,
    y0 + ((fight.cy[b * n + i] as number) - y0) * k,
    fight.cface[a * n + i] as number,
  ];
}

/** The last entry of a sorted list of times that is not after `t`, or -Infinity. */
export function lastBefore(times: readonly number[], t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] as number) <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? (times[lo - 1] as number) : -Infinity;
}
