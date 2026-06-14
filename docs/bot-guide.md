# Idlin Bot Programming Guide

Everything that acts in Idlin — player characters and monsters alike — is a
**bot**: a program running in a constrained virtual machine, observing the
world and acting on it exclusively through syscalls. This guide is the
complete reference for writing one.

Writing a good bot is a game of constraints: you get 64 KiB of memory, 5,000
instructions per tick, and a syscall window into the world. Everything else
is up to you.

## The machine

- **Stack machine, 32-bit signed words.** There are no registers; operands
  are pushed onto a stack and opcodes pop them (RPN style: `push 5; push 3;
  add` leaves 8).
- **Flat 64 KiB memory, all accesses wrap.** Address 0x10000 is address
  0x0000. Out-of-bounds access is impossible by construction; reading
  garbage is your bug, never a crash.
- **Every state is defined.** Bad opcode → halts your tick. Division by
  zero → 0. Stack underflow → wraps. Your bot can be wrong; it cannot crash
  the world or break determinism.

### Memory map

| Region | Address | Who writes it |
|---|---|---|
| Code | `0x0000`–`0x7FFF` (32 KiB max) | loaded from your program |
| Stack | grows **up** from `0x8000` | your pushes/pops |
| Free RAM | anywhere you like (convention: `0xC000`–`0xEFFF` for buffers) | you |
| **Param block** | `0xF000`–`0xF0FF` (256 B) | **the host**, rewritten every tick — chat commands and host-set parameters arrive here. Read-only in spirit: anything you write is overwritten next tick. |
| **Persist block** | `0xF200`–`0xF5FF` (1 KiB) | **you** — and the host preserves it across program redeployments and zone transfers. Your bot's long-term memory. Nothing outside your own code can write it. |

### Execution model

- The world ticks at **10 Hz**. Each tick, every living bot runs with a
  budget of **5,000 instructions**. Each syscall costs its instruction
  **plus 20** extra budget.
- `halt` ends your turn voluntarily. Running out of budget just pauses you:
  **PC and stack persist**, and you resume exactly where you stopped next
  tick. A typical bot is a loop ending in `halt; jmp main`.
- Dead characters don't run; you resume after respawn (50 ticks).
- Your program ships in a versioned `ILBC` container (the assembler adds
  it). A server whose bytecode format moved on will reject outdated
  programs at deploy time with a clear error — never misbehave silently.

## Instruction set

Operands are fetched after the opcode byte; rel16 offsets are relative to
the PC *after* the operand.

| Mnemonic | Hex | Operand | Effect |
|---|---|---|---|
| `halt` | 00 | | end this tick |
| `nop` | 01 | | nothing |
| `push N` | 02 | imm32 | push N |
| `pushs N` | 03 | imm16 | push N (sign-extended) |
| `pushz` | 04 | | push 0 |
| `pop` | 05 | | discard top |
| `dup` | 06 | | duplicate top |
| `swap` | 07 | | swap top two |
| `load` | 10 | | pop addr, push mem[addr] (32-bit LE) |
| `store` | 11 | | pop addr, pop value, mem[addr] = value |
| `loadsp N` | 12 | off16 | push mem[sp+N] (N in bytes, signed) |
| `storesp N` | 13 | off16 | pop value, mem[sp+N] = value (sp after the pop) |
| `jmp L` | 20 | rel16 | jump to label |
| `jmpif L` | 21 | rel16 | pop c; jump if c ≠ 0 |
| `jmpifz L` | 22 | rel16 | pop c; jump if c = 0 |
| `call L` | 23 | rel16 | push return address; jump |
| `callabs` | 24 | | pop target; push return address; jump |
| `ret` | 25 | | pop address; jump to it |
| `lt le gt ge eq ne` | 30–35 | | pop b, pop a; push (a OP b) as 0/1 (signed) |
| `add sub mul` | 40–42 | | pop b, pop a; push a OP b (wrapping) |
| `mulfx` | 43 | | Q16.16 multiply (for fixed-point positions) |
| `div` | 44 | | a / b, truncating; **b = 0 → 0** |
| `divfx` | 45 | | Q16.16 divide; b = 0 → 0 |
| `mod` | 46 | | a % b; b = 0 → 0 |
| `and or xor` | 47–49 | | bitwise |
| `shl` | 4a | | a << (b & 31) |
| `shr` | 4b | | a >> (b & 31), arithmetic |
| `neg` | 4c | | -a (wrapping) |
| `not` | 4d | | bitwise !a |
| `syscall` | 50 | | see ABI below |
| `abs` | 60 | | |a| (wrapping: i32::MIN stays) |
| `min` / `max` | 61/62 | | pop b, pop a; push min/max |

### Fixed-point positions

All world coordinates are **Q16.16 fixed point** in a 32-bit word: the top
16 bits are the integer part, the bottom 16 the fraction. `0x10000` = 1.0
world units. Use `mulfx`/`divfx` for fixed-point math, plain `add`/`sub`
work as-is. A zone is typically 60×60 units.

## The `.bot` language

The primary way to write a bot: a small C-like language compiled to the
same bytecode (the assembler below remains as the escape hatch). Brains in
`content/brains/*.bot` and the built-in templates are written in it.

```c
// the default brain, in its entirety
const N_VIGOR = 30;                      // node numbers: see the tree map page
build [ N_VIGOR, 2, 3, 10 ];             // the whole plan, up front

const SELF = 0xE000;
const ENTS = 0xE100;

fn main() {                            // main() runs once per tick
    self_status(SELF);
    if (mem[SELF + 32] & 1) { return; }     // dead

    if (read_entities(ENTS, 4, 3) > 0) { pick_up(mem[ENTS]); }
    equip_best();
    socket_gem(-1, -1);

    if (read_entities(ENTS, 8, 1) > 0) {
        var target = mem[ENTS];
        var tx = mem[ENTS + 8];
        var ty = mem[ENTS + 12];
        // Lead with the first READY skill, aimed per its target_mode
        // (+36) — ready (+44) already folds cooldown/mana/weapon. The
        // full grinder template loops every slot and budgets mana.
        var used = -1;
        if (read_skills(0xE400, 1) > 0 && mem[0xE400 + 44] == 1) {
            var mode = mem[0xE400 + 36];
            if (mode == 0) { used = use_skill(1, target, 0, 0); }
            if (mode == 1) { used = use_skill_at(1, tx, ty); }
            if (mode == 2) { used = use_skill_dir(1, tx - mem[SELF], ty - mem[SELF + 4]); }
        }
        if (used != 0) { use_skill(0, target, 0, 0); }
        move_to(tx, ty);
        return;
    }
    move_to((random() & 0x7FFFFFFF) % mem[SELF + 24],
            (random() & 0x7FFFFFFF) % mem[SELF + 28]);
}
```

**Language summary**

- `build [...]`: the FIRST declaration is free; re-declaring a plan
  that keeps every allocated node (append-steering) stays free; a plan
  that drops allocated nodes is a RESPEC — it consumes one Regret Obol
  from your currency (rejected loudly without one) and resets/re-walks
  the tree, unsocketing orphaned gems and shedding gear whose
  requirements you no longer meet.
- Top level: `const NAME = literal;`, `var name;` / `var name = expr;` /
  `var buf[N];` (word arrays), `fn name(params) { ... }`. A `fn main()` is
  required.
- Statements: assignment (`x = e;`, `mem[e] = e;`, `arr[i] = e;`),
  `if`/`else` (and `else if`), `while`, `break`, `continue`, `return e;`,
  call statements. Semicolons required; blocks always braced.
- Expressions: C precedence — `|| && | ^ & == != < <= > >= << >> + - * / %`
  and unary `- ! ~`. `&&`/`||` are logical (0/1) but **not**
  short-circuiting: both sides always evaluate.
- `mem[addr]` reads/writes raw memory. `arr[i]` is word-indexed
  (`mem[arr + i*4]`); an array name alone is its address, and indexing a
  scalar treats its value as a base address (poor man's pointers).
- Numbers: decimal or `0x` hex, 32-bit; `0xFFFFFFFF` is the i32 bit pattern.
- **Content refs**: `item "rusted_cleaver"`, `gem "arc"`,
  `monster "tidewarden"`, `zone "saltmere"`, `currency "transmute_obol"`,
  `line "welcome"`, `exit "saltmere"`, `gate "start"` — each is an
  expression that becomes the thing's INDEX, resolved by name when the
  content database loads. Use them anywhere a number goes (most readably
  in `const`s). Unknown ids refuse to load, so adding content can never
  silently shift what a script means. `line`/`exit`/`gate` resolve
  against the zone that names the brain (`exit` by destination zone id;
  `gate` by its `id:` in zone.ron). Refs are a CONTENT-LOAD feature:
  deploy-compiled player templates can't use them.
- `include "std/zone_lib.bot";` splices another file (resolved under
  `content/brains/`, depth-capped) — expanded by the content loader
  before compilation. `content/brains/std/` holds shared libraries;
  they are never brains themselves.

**Semantics that matter**

- `main()` is invoked by an implicit per-tick loop. Returning ends your
  tick; calling `halt()` mid-function ends the tick *right there* and
  resumes from that point next tick (great for multi-tick waits).
- **All variables are statically allocated** (globals from `0xC000`):
  globals AND locals persist across ticks; initializers (`var x = 100;` at
  top level) run once per deploy. There are no stack frames — which means
  **no recursion** (a recursive call reuses the same parameter slots).
- Builtins: every syscall by snake_case name (`self_status`,
  `read_entities`, `move_to`, `use_skill`, `pick_up`, `equip_best`,
  `random`, `move_item`, `drop_item`, `read_skills`, `socket_gem`,
  `read_inventory`, `debug`), plus `abs`, `min`, `max`, `mulfx`, `divfx`
  (Q16.16 math), and `halt`.
- Compile errors carry line numbers; arity is checked for every builtin.

**The `build` declaration — your passive tree, up front**

A bot declares its ENTIRE passive plan at the top of the program: up to
240 node references in allocation order (level 100 earns 228 points). Each node has a stable numeric id
(`num` in content, shown as `#N` on the tree map page) — use literals or
named `const`s. The compiler embeds a packed u16 table (99 nodes = 198
bytes max) and emits one `SetBuild` syscall during initialization. SetBuild validates the WHOLE plan up front: every entry
must resolve and be connected to the start node, your allocated set, or an
earlier entry — a bad plan is rejected loudly (BuildRejected on the
ticker) rather than silently sticking mid-build; from then on the sim allocates
the next connected entry automatically every time you level. Allocation is
append-only — sockets you've unlocked (and the gems in them) can never be
invalidated. Changing your build means deploying a new bot program, which
is also how respec works: future points follow the new plan, allocated
nodes persist. There is no per-tick passive decision to make.

## Assembly syntax

```asm
; comments run to end of line
.equ BUF 0xC000           ; named constant
.equ HALF 0x8000          ; 0.5 in Q16.16

main:                     ; label
    push BUF+8            ; constants/labels allow a +/- literal offset
    load
    pushs 10
    lt
    jmpif low_branch
    halt
    jmp main
low_branch:
    ; ...
.word 1, 0xFF             ; raw 32-bit data words
```

The `sys N A` macro expands to `pushs A; pushs N; syscall` — syscall number
N with A args (you must have pushed the args first).

## Syscall ABI

Convention for `Syscall(arg1, arg2, ... argN)`:

1. Push the args in **reverse** order (argN first, arg1 last).
2. `sys <number> <argc>`.
3. The host consumes everything and pushes exactly **one result word**.

Unknown syscall numbers return -1. Queries write fixed-layout structs to an
address you supply and return a count/status.

| # | Syscall | Args (in order) | Returns |
|---|---|---|---|
| 0 | `Debug` | up to 8 values | 0 (values logged host-side) |
| 1 | `SelfStatus` | out_addr | 0; writes the status struct |
| 2 | `ReadEntities` | out_addr, max (≤16), filter | count; sorted by distance |
| 5 | `ReadInventory` | out_addr, max (≤60) | count |
| 6 | `MoveTo` | x, y (Q16.16) | 0 |
| 7 | `UseSkill` | slot, target_id, x, y | 0 ok; **-1** unknown slot / on cooldown |
| 8 | `PickUp` | loot_id | 0 |
| 12 | `EquipBest` | — | number of swaps made |
| 14 | `SetBuild` | table_addr, count | nodes resolved (compiler-emitted from `build [...]`; the table is packed u16 name-hash refs) |
| 15 | `Random` | — | a value from your private RNG stream |
| 16 | `MoveItem` | inv_idx, x, y | 0 ok; −1 invalid/overlap |
| 17 | `DropItem` | inv_idx | 0 ok; −1 invalid |
| 18 | `ReadSkills` | out_addr, max (≤8) | count |
| 19 | `SocketGem` | node, pouch_idx (−1,−1 = auto) | gems socketed, or −1. Skill gems fill empty socket nodes; support gems attach INTO that node's skill gem. **Support capacity grows with the SKILL gem's level**: 1 slot, a 2nd at level 7, a 3rd at 14. **Supports are tag-gated**: the support must share a tag with the skill (a melee-only support refuses a spell), and a skill takes only ONE copy of each support — violations return −1 on manual sockets; auto mode (−1,−1) fills skills first (DAMAGE skills outrank pure utility buffs), then only supports that fit — and upgrades a supportless utility squatter out of its node when a damage skill waits in the pouch (the utility gem returns to the pouch). |
**Attacks commit you.** A swing occupies your character for the weapon's
use time (attack-speed scaled): movement and further actions wait until it
finishes. Plan movement around your swings — or get caught flat-footed.

Attacks require **line of sight**: a solid wall tile (cliff, rock) between
you and the target blocks the strike entirely — `UseSkill` will simply not
land while cover intervenes. Movement slides along wall edges, so walking
at a blocked target eventually rounds the cover. `LineOfSight` (21) lets a
bot test a lane before committing:

```c
if (read_entities(ENTS, 8, F_ENEMY) > 0) {
    var target = mem[ENTS];
    var tx = mem[ENTS + 8];
    var ty = mem[ENTS + 12];
    if (line_of_sight(tx, ty) == 1) {
        use_skill(0, target, 0, 0);   // lane is clear: swing
    }
    move_to(tx, ty);                  // either way, keep closing
}
```

| 20 | `CountEntities` | filter | zone-wide count of matching entities (same filter codes as ReadEntities, no distance cap). `count_entities(1)` answers "how many enemies are left in this area?" — useful for clear-the-zone logic. |
| 21 | `LineOfSight` | x, y (raw Q16.16) | 1 if the straight line from you to (x, y) is clear of obstacles, 0 if blocked, −1 on error. Attacks enforce the same check, so test before you swing. |
| 22 | `UseSkillAt` | slot, x, y (raw Q16.16) | point-aimed skills (ground-target AoE): cast at a location you compute. Same return codes as UseSkill. |
| 23 | `UseSkillDir` | slot, dx, dy (raw Q16.16 vector) | direction-aimed skills (cones, lines, projectile volleys): sweep where you point. Same return codes as UseSkill. |
| 26 | `Say` | line_idx | speak a speech-bubble line: monsters use their def's `lines:`, characters the global `content/speech.ron` set (index wraps — bots can NEVER inject arbitrary text). 0 ok; −1 no lines for you; −2 rate-limited (characters 10s, monsters 5s). |
| 27 | `ReadExits` | out_addr, max | the zone's exits as 16-byte records: (x raw, y raw, open, reserved). Returns the count written. Exits are PLACES — walk to one and take it yourself. |
| 28 | `UseExit` | — | take the exit underfoot (within 1.5u). 0 = staged, you depart this tick; −1 no exit in reach; −2 the exit in reach is closed. There are NO forced transfers — leaving is always the bot's own call. |
| 24 | `ReadCurrency` | out_addr, max (≤16) | obol counts as u32 words in content order (alchemy 0, alter 1, augment 2, chaotic 3, divine 4, exalted 5, regal 6, scouring 7, transmute 8); returns how many were written. |
| 25 | `UseCurrency` | currency_idx, inv_idx | spend one obol on the bag item at inv_idx. 0 ok; −1 bad index / no stock / no item; −2 the verb doesn't apply (wrong rarity, no room, nothing to change). Crafting rolls come from their own deterministic RNG stream — your strategy IS the build. |

### Skill-use return codes

`UseSkill` / `UseSkillAt` / `UseSkillDir` validate immediately and queue the
use on success. Diagnose failures — they are part of the game:

| code | meaning |
|---|---|
| 0 | queued; it fires this tick |
| −1 | no such skill slot |
| −2 | on cooldown |
| −3 | you're mid-swing/cast (use time) |
| −4 | not enough mana |
| −5 | out of range |
| −6 | no line of sight |
| −7 | wrong aim for this gem's target_mode (check ReadSkills) |
| −8 | invalid target (dead, friendly, zero direction) |
| −9 | wrong weapon for this skill (a bow skill in a cleaver hand; bare hands count for nothing) |

Each gem declares its `target_mode` in content: entity / point / direction.
A direction gem will refuse `UseSkill(slot, id)` with −7 — aim it with
`use_skill_dir(slot, dx, dy)` instead.

Attack skills also declare eligible **weapon classes** (melee / bow /
wand): Cleave needs a melee weapon in hand, Power Shot a bow; spells
never care. The ReadSkills `ready` flag already factors this in — an
unready skill with mana and no cooldown is probably a weapon mismatch.

### Intents, not actions

Movement, attacks, and pickups are **intents**: the sim validates and
resolves them in its pipeline after all bots run. One movement + one attack
+ one pickup per tick; last write wins. Attack/pickup intents clear every
tick (re-issue them); a movement intent **persists** until you arrive, so a
budget-starved bot keeps walking.

The sim is the sole authority: `UseSkill` on a corpse whiffs, `PickUp` on
someone else's loot does nothing, walking stops at the zone edge, and you
can never hit your own faction.

### Struct layouts

**SelfStatus** (17 words, 68 bytes):

| Offset | Field |
|---|---|
| +0 / +4 | x, y (Q16.16) |
| +8 / +12 | life, life_max |
| +16 / +20 | level, xp |
| +24 / +28 | map_w, map_h (Q16.16) |
| +32 | flags (bit 0 = dead) |
| +36 / +40 | anchor x, y (monsters: home; characters: zone spawn) |
| +44 | aggro radius (Q16.16; 0 for characters) |
| +48 | attack range (Q16.16) |
| +52 / +56 | mana, mana_max |
| +60 | energy shield |
| +64 | zone index (ContentDb::zones, sorted ids — branch your whole strategy on WHICH map you stand in) |

**ReadEntities record** (6 words, 24 bytes each): `id, kind (1 char / 2
monster / 3 loot), x, y, life_pct, rarity`. Filters: **1 = enemies of you**
(faction-relative — the same brain works as a player or a monster!), 2 =
characters, 3 = your own ground loot. Vision radius 50 units.

**ReadInventory record** (8 words, 32 bytes): `base_idx, slot (0 weapon /
1 offhand / 2 helm / 3 chest / 4 boots), rarity, item_level, x, y, w, h`. The bag is a
**12×5 grid**; items have footprints; pickups fail when nothing fits —
managing space (`MoveItem`, `DropItem`, vendoring later) is your job.

**ReadSkills record** (12 words, 48 bytes): `slot_no, gem_idx, level,
cooldown_left, range (Q16.16), shape (0 target / 1 nova / 2 cone / 3 line /
4 point-AoE / 5 projectile), radius (Q16.16), mana_cost, use_ticks (cast
time for spells, your weapon's swing time for attacks), target_mode
(0 entity / 1 point / 2 direction), skill_kind (0 attack / 1 spell),
ready (1 = off cooldown, mana in pocket, not mid-use)`. Skill slots are
1..N in tree-socket order; slot 0 is always the basic weapon attack.
`mana_cost` and `use_ticks` are FINAL numbers — socketed support gems
(mana multipliers, attack/cast speed) and your own cast speed are already
folded in, so budget straight off the record.

## Zone brains (the dungeon master is a bot)

A zone may name a `brain:` in its def — a bot program that runs once
per tick, bound to no entity, with a zone-scoped syscall table:

| # | builtin | what |
|---|---|---|
| 100 | `query_characters(out, max)` | 10-word records per idler: net, kills, level, x, y, weapon_class (−1/0 melee/1 bow/2 wand), life_pct, dead, build_len (0 = no declared build), archetype (0 melee / 1 bow / 2 wand / −1 unknown, classified from the declared plan) |
| 101 | `poll_events(out, max)` | drains this tick's events as 4-word records: kind (1 kill / 2 equip / 3 socket / 4 level / 5 died / 6 pickup), char net, a, b (kill: a = monster def idx, b = level) |
| 102 | `narrate(line, char)` | fire an authored ZoneDef `lines:` entry into the ticker (char 0 = everyone). Address lines by name: `narrate(line "welcome", net)` |
| 103 | `drop_loot(kind, idx, x, y, owner)` | scripted drops: 0 = gear base (normal), 1 = gem, 2 = obol, 3 = rolled RARE at item level `idx`. Story drops never despawn — scripted loot is often a gate key |
| 104 | `spawn_monster(def, x, y)` | a packless scripted spawn (never respawns) |
| 106 | `set_exit(idx, open)` | gate a ZoneDef exit open (1) or shut (0). Brains only GATE — characters take exits THEMSELVES with `use_exit`; forced transfers do not exist. |
| 107 | `set_gate(idx, open)` | open (1) or shut (0) a ZoneDef gate — a rect of cells that blocks movement AND line of sight while shut (nothing strains at, or shoots through, an unearned lesson). Address by id: `set_gate(gate "start", 1)` |
| 108 | `spawn_elite(def, x, y, rarity)` | a packless scripted spawn at forced rarity (1 = magic, 2 = rare) — fresh affixes rolled through the item affix system |

Events are DATA the script drains — there are no callbacks; the VM
stays one `main()` per tick. `content/brains/withered_shore.bot` is
the canonical example: the whole tutorial choreography is script.

## The param block (how chat reaches you)

Chat commands and host configuration are written into `0xF000`–`0xF0FF`
every tick. Treat it as read-only input. Layout is per-template (you define
what your parameters mean); the default template reserves the first words
for strategy/skill/tier preferences.

## The persist block (your long-term memory)

`0xF200`–`0xF5FF` survives **program redeployments and zone transfers** —
ordinary memory does not (a redeploy zeroes RAM and restarts at PC 0).
Store learned state there: kill counts per spot, item valuations, a phase
flag for multi-stage plans. Players have no channel into it; only your code
writes it.

## Budget arithmetic

5,000 instructions/tick, syscalls cost +20. A typical sense-decide-act loop
(SelfStatus + ReadEntities + UseSkill + MoveTo + logic) spends well under
300 — you have headroom for real algorithms (pathing heuristics, bag
packing, target scoring). If you blow the budget, you simply continue next
tick — design loops so partial progress is safe.

## Worked example

The default player template (`crates/idlin-botc/src/templates/grinder.asm`)
is the canonical example: status check → loot pickup → gear/passive/gem
upkeep → fight nearest enemy preferring skill 1 with basic-attack fallback
→ wander when bored. The hostile monster brain
(`content/brains/hostile_melee.asm`) shows the same ABI from the other
side: leash, aggro, wander — entirely in bot code, no engine AI.

A minimal complete bot:

```asm
; chase-and-hit: the smallest useful brain
.equ SELF 0xE000
.equ ENTS 0xE100

main:
    push SELF
    sys 1 1            ; SelfStatus(SELF)
    pop

    pushs 1            ; filter: enemies
    pushs 1            ; max: 1
    push ENTS
    sys 2 3            ; ReadEntities(ENTS, 1, enemies)
    jmpifz rest        ; nothing visible

    pushz              ; y
    pushz              ; x
    push ENTS          ; record +0 = target id
    load
    pushz              ; slot 0 = basic attack
    sys 7 4            ; UseSkill(0, id, 0, 0)
    pop

    push ENTS+12       ; record +12 = target y
    load
    push ENTS+8        ; record +8 = target x
    load
    sys 6 2            ; MoveTo(x, y)
    pop
rest:
    halt
    jmp main
```

## Determinism rules (why some things look odd)

The whole world is bit-exact reproducible. For bot authors this means:

- `Random` (syscall 15) is your **own** seeded stream — same world seed,
  same history, same numbers. There is no wall clock; count ticks instead.
- Query results are sorted deterministically (distance, then id).
- All math is integer/fixed-point. There are no floats anywhere.
