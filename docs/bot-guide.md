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
include "gen_ids.bot";                   // generated NODE_*/GEM_*/… consts
build [ NODE_STR1, NODE_STR2, NODE_STR3 ]; // the whole plan, up front (tree-map ids)

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
        // (+28) — ready (+32) already folds cooldown/mana/weapon. The
        // full grinder template loops every slot and budgets mana.
        var used = -1;
        if (read_skills(0xE400, 1) > 0 && mem[0xE400 + 32] == 1) {
            var mode = mem[0xE400 + 28];
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
- `include "zone_lib.bot";` splices another file (resolved under
  `content/lib/`, depth-capped) — expanded by the content loader
  before compilation. `content/lib/` holds shared libraries
  (`zone_lib.bot`, the generated `gen_ids.bot`); they are never brains
  themselves.

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
240 node references in allocation order (level 100 earns 228 points). Each
node has a stable tagged content num (#54) — reference it by its generated
`NODE_*` const (the same id the tree map page and content-docs publish),
never a raw small number. The compiler embeds a packed i32 table (240 nodes
= 960 bytes max) and emits one `SetBuild` syscall during initialization;
SetBuild translates each num back to a tree node. SetBuild validates the WHOLE plan up front: every entry
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
| 7 | `UseSkill` | slot, target_id, x, y | 0 ok; **<0** a defined failure (slot / cooldown / busy / mana / range / LoS / mode / target / weapon — see the skill error-code table below) |
| 8 | `PickUp` | loot_id | 0 |
| 12 | `EquipBest` | — | number of swaps made. Covers ARMOUR + ACCESSORIES only — the weapon slot is never touched (a weapon is the build's identity; wield manually). Scoring weighs life, defenses (incl. ES), attributes, and resists. |
| 14 | `SetBuild` | table_addr, count | nodes resolved (compiler-emitted from `build [...]`; the table is packed i32 stable tagged node nums, translated to tree nodes at deploy) |
| 15 | `Random` | — | a value from your private RNG stream |
| 16 | `MoveItem` | inv_idx, x, y | 0 ok; −1 invalid/overlap |
| 17 | `DropItem` | inv_idx | 0 ok; −1 invalid |
| 18 | `ReadSkills` | out_addr, max (≤8) | count |
| 19 | `SocketGem` | node, inv_idx (−1,−1 = auto) | gems socketed, or −1. `node` is a stable tagged NODE num (#54 PR3) — a `NODE_*` const (the start socket is `NODE_START`), the same id space `SetBuild` takes, NOT a tree array index. `inv_idx` is the BAG slot of the gem to socket — gems are 1×1 bag items now (#54 PR2b), not a separate pouch; find them in `ReadInventory` (a record whose `num >> 23 == CAT_GEM`). Skill gems fill empty socket nodes; support gems attach INTO that node's skill gem. **Support capacity grows with the SKILL gem's level**: 1 slot, a 2nd at level 7, a 3rd at 14. **Supports are tag-gated**: the support must share a tag with the skill (a melee-only support refuses a spell), and a skill takes only ONE copy of each support — violations return −1 on manual sockets; auto mode (−1,−1) fills skills first (DAMAGE skills outrank pure utility buffs), then only supports that fit — and upgrades a supportless utility squatter out of its node when a damage skill waits in the bag (the squatter returns to the grid). A consumed gem leaves the bag; socketing frees its cell. |
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
| 27 | `ReadExits` | out_addr, max | the zone's exits as 16-byte records: (x raw, y raw, open, dest zone num). Returns the count written. The dest num matches the generated `ZONE_*` consts, so a brain can ROUTE (-1 = unknown). Exits are PLACES — walk to one and take it yourself. |
| 28 | `UseExit` | — | take the exit underfoot (within 1.5u). 0 = staged, you depart this tick; −1 no exit in reach; −2 the exit in reach is closed; −3 the exit is story-sealed (complete the required act first — check SelfStatus flags bit 1). There are NO forced transfers — leaving is always the bot's own call. |
| 24 | `ReadCurrency` | out_addr, max (≤16) | a positional count array: obol stacks as u32 words in registry order (alchemy 0, alter 1, augment 2, chaotic 3, divine 4, exalted 5, regal 6, scouring 7, transmute 8); returns how many were written. The slot's matching id is the `CURRENCY_*` const at the same position — read the count here, spend by num below. |
| 25 | `UseCurrency` | currency_num, inv_idx | spend one obol on the bag item at inv_idx. `currency_num` is the currency's stable tagged num (#54) — pass a `CURRENCY_*` const, not an array position. 0 ok; −1 unknown/non-currency num / no stock / no item; −2 the verb doesn't apply (wrong rarity, no room, nothing to change). Crafting rolls come from their own deterministic RNG stream — your strategy IS the build. |
| 30 | `SkillInfo` | slot, out_addr | the static geometry of the skill in `slot` (same 1-based slot space as ReadSkills) → a 3-word record at out_addr: `shape (0 target / 1 nova / 2 cone / 3 line / 4 point-AoE / 5 projectile), radius (Q16.16), skill_kind (0 attack / 1 spell)`. Returns 0, or −1 for an empty/invalid slot. You only need this to position AoE — `target_mode` rides in ReadSkills. |
| 31 | `ReadItemMods` | inv_idx, out_addr, max (≤16) | the rolled affixes on the bag item at `inv_idx` (its position in the ReadInventory list) → **4-word (16-byte) records, one PER EFFECT**: `affix_num (stable tagged, match `AFFIX_*` / content-docs), effect_index, value (the rolled amount), tier`. A plain affix emits one record; a HYBRID emits several sharing `affix_num`, counting up `effect_index` — `max` caps the total records. Which stat each row grants is definitional: look up `affixes[affix_num].effects[effect_index].stat` in content-docs. Returns the count written, or −1 for a bad index. The item BASE's facts (slot, dims, base stats) live in content-docs; this is the per-instance roll. |
| 32 | `ReadEquipment` | out_addr, max (≤12) | the WORN gear, one 4-word record per gear slot → `slot (0 weapon · 1 offhand · 2 helm · 3 chest · 4 boots · 5/6 flask · 7/8 ring · 9 belt · 10 amulet · 11 gloves), base_num (−1 if the slot is empty), rarity, item_level`. Returns the count written. Definitional facts (an item's slot/dims) live in content-docs; an empty slot reads `base_num −1`. Pair with `ItemSlot` to score bag candidates against what you wear. |
| 33 | `Equip` | inv_idx | wear the bag item at `inv_idx` in its content-defined slot — the MANUAL counterpart to `EquipBest`, so your own scoring decides. The displaced piece returns to the bag (first-fit, into the cells the incoming item vacates). 0 ok; −1 if the slot isn't gear, you don't meet its requirements, it's an offhand while a two-hander is wielded, **or the displaced piece can't re-home in the bag** (a deliberate swap never drops gear — free space first; unlike `EquipBest`, which juggles by dropping the worse piece). A two-handed weapon also sheds the offhand, which must fit too. |
| 34 | `ItemSlot` | base_num | the gear slot a gear item num belongs to (0 weapon … 5 flask, 7 ring, 9 belt, 10 amulet, 11 gloves), or −1 for a gem / unknown / non-gear num. The one definitional escape hatch (RFC #54 Q2): base reads stay pure, but matching a bag candidate to the worn piece needs `base_num → slot`. It does NOT tell you the weapon CLASS — keep a whitelist of the weapon bases your build can actually wield (a wand/bow would silence a melee skill at the weapon gate). |
| 35 | `Unequip` | gear_slot | bare a gear slot — move the worn item back to the bag, leaving the slot empty (the deliberate counterpart to `Equip`'s swap). `gear_slot` is the 0–11 index `ReadEquipment` reports. 0 ok; −1 if the index is out of range, the slot is already empty, or **the bag is full**. Like manual `Equip`, and unlike `EquipBest`'s auto-swap (which drops to juggle), `Unequip` REFUSES rather than ever dropping the item. |
| 36 | `ReadAilments` | net_id | the active ailments on the entity with `net_id` (your own from `SelfStatus`, an enemy's from `ReadEntities`) as a **bitmask**: `1 Ignite` (fire DoT), `2 Shock` (takes more damage), `4 Chill` (slowed). Returns 0 if the entity is unknown or unafflicted. Inflict ailments by hitting with the matching element while you have that element's chance (`ignite_chance` / `shock_chance` / `chill_chance`) (or on a crit, unless your gear says crits cannot cause ailments); the magnitude scales with the hit. |
| 37 | OpenMap | `inv_idx` | Spend a map from the bag at the town's Map Table: opens a private map instance at area level 12 + tier (tier = base + ilvl over 12), juiced by the map's rolled quantity/rarity affixes. Returns 0 on open, -1 bad index / not a map, -2 not at a table, -3 campaign incomplete (the gate is the content-derived FINAL act — all acts, not just Act 1), -4 not a character, -5 a departure is already staged this tick. The map is consumed ONLY on success; tiers cap at 16. |
| 38 | Sell | `inv_idx` | Sell a bag item at the town VENDOR cell (SelfStatus +76/+80; reach 3 cells). Pays ONE obol keyed to what the item was: normal→transmute, magic→alter, rare→alchemy, unique→regal; gems and maps sell as transmutes. Returns the obol's NUM, or -1 bad selection, -2 not at a vendor, -4 not a character. |
| 39 | Stash | `op, sel` | Move an item between bag and chest at the town STASH cell (+84/+88; reach 3). op 0 deposits `inventory[sel]` (chest cap 40, flat — no grid); op 1 withdraws `stash[sel]` first-fit into the bag. The chest is yours forever — it rides transfers and snapshots. Returns 1, or -1 bad selection, -2 not at the stash, -3 no room, -4 not a character. |
| 40 | ReadStash | `max, out` | Read the chest like ReadInventory (same 20-byte record); x/y are −1 (a chest has no grid). Returns the record count, or -4. |
| 109 | QueryMonsters | `max, out` | ZONE BRAINS ONLY. Live monsters as MONSTER_RECORD_SIZE (24B) records: net id, def NUM, life_pct, x, y (Q16.16), rarity. The boss-director syscall: watch a boss's live life and stage add waves / beat lines at thresholds. Buffers: allocate at 0xE800+ — the var allocator owns 0xC000 up, and zone_lib holds 0xD000/0xE000/0xE400. |

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

**SelfStatus** (23 words, 92 bytes):

| Offset | Field |
|---|---|
| +0 / +4 | x, y (Q16.16) |
| +8 / +12 | life, life_max |
| +16 / +20 | level, xp |
| +24 / +28 | map_w, map_h (Q16.16) |
| +32 | flags (bit 0 = dead; bit N = act N complete — bit 1 is Act 1, bit 2 is Act 2: your campaign progress) |
| +36 / +40 | anchor x, y (monsters: home; characters: zone spawn) |
| +44 | aggro radius (Q16.16; 0 for characters) |
| +48 | attack range (Q16.16) |
| +52 / +56 | mana, mana_max |
| +60 | energy shield |
| +64 | zone num (the zone's stable tagged content id — an OPAQUE handle: zones are private, so there are no `ZONE_*` consts to compare against. Watch it for CHANGES — when it differs from the value you saw last tick you've transferred maps — and branch your strategy on that, not on a hardcoded value) |
| +68 | the zone’s Map Table x (Q16.16), or −1 when the zone has none |
| +72 | the zone’s Map Table y (Q16.16), or −1 — walk here and `OpenMap` (37) once the campaign is complete |
| +76 / +80 | the town VENDOR cell x/y (Q16.16), or −1 — walk here and `Sell` (38) |
| +84 / +88 | the town STASH cell x/y (Q16.16), or −1 — walk here and `Stash` (39) / `ReadStash` (40) |

**ReadEntities record** (6 words, 24 bytes each): `id, kind (1 char / 2
monster / 3 loot), x, y, life_pct, rarity`. Filters: **1 = enemies of you**
(faction-relative — the same brain works as a player or a monster!), 2 =
characters, 3 = your own ground loot. Vision radius 50 units.

**ReadInventory record** (5 words, 20 bytes): `num, rarity, item_level, x, y`.
The first word is a stable tagged num (#54). The bag holds **both gear and
gems** now (#54 PR2b — gems are 1×1 items, no separate pouch), so check the
category: `num >> 23 == CAT_ITEM` → gear (look up slot/footprint `w`/`h`/base
stats by `num` in `ITEM_*` / `content-docs.json`; rolled affixes via
`ReadItemMods`); `num >> 23 == CAT_GEM` → a loose gem (always 1×1; `rarity` is
0/Normal and `item_level` carries the GEM LEVEL; socket it with `SocketGem`).
The bag is a **12×5 grid**; everything has a footprint and competes for space;
pickups fail when nothing fits — managing space (`MoveItem`, `DropItem`,
vendoring later) is your job.

**ReadSkills record** (10 words, 40 bytes): `slot_no, gem_num, level,
cooldown_left, range (Q16.16), mana_cost, use_ticks (cast time for spells, your
weapon's swing time for attacks), target_mode (0 entity / 1 point / 2 direction),
ready (1 = off cooldown, mana in pocket, not mid-use), life_cost`. `gem_num` is
the gem's stable tagged num (#54) — match it against the generated `GEM_*` consts.
Skill slots are 1..N in tree-socket order; slot 0 is always the basic weapon
attack. `mana_cost`, `use_ticks`, and `life_cost` are FINAL numbers — socketed
support gems (cost multipliers, attack/cast speed) and your own cast speed are
already folded in, so budget straight off the record. `life_cost` (#98) is 0 for
almost every skill; it is **ungated** — paid even past 0, so a life-cost skill can
kill its own caster — and so is deliberately **not** folded into `ready`: weigh it
against your `SelfStatus` life yourself. `target_mode` stays here (you need
it every fire to pick the UseSkill variant); the static geometry —
`shape`/`radius`/`skill_kind` — moved to `SkillInfo` (you only need it to
position AoE), and per-gem statics are in `content-docs.json`.

### Reading content: every id is a self-describing num

A read never tells you "this is a gem" or "this is an item" with a type flag —
it doesn't need to. Every content id is a **stable tagged num** whose high bits
ARE the category (`gen_ids.bot` defines `ID_SEQ_BITS = 23` and `CAT_GEM = 1`,
`CAT_ITEM = 2`, `CAT_AFFIX = 3`, …):

```c
// what kind of thing is this num?
if ((n >> ID_SEQ_BITS) == CAT_GEM)  { /* it's a gem  */ }
if ((n >> ID_SEQ_BITS) == CAT_ITEM) { /* it's an item */ }
// and to recognize a SPECIFIC one, compare against the generated const:
if (n == GEM_ARC) { /* this exact gem */ }
```

So a num like `16777221` is `CAT_ITEM` (`16777221 >> 23 == 2`) and specifically
`ITEM_RUSTED_CLEAVER`; `8388609` is `CAT_GEM` and `GEM_ARC`. This is why reads
can mix gems and gear in one buffer and stay unambiguous. The *definitional*
facts behind a num — an item's slot/footprint/base stats, a gem's damage
formulas, an affix's per-tier roll ranges — live in `content-docs.json`, keyed
by num; look them up once at authoring time and bake the constants you need.

### Worked examples (concrete bytes)

`read_inventory(0xD000, 60)` returns `3`; the first record (20 bytes at `0xD000`):

```
+0  base_num    16777221   // ITEM_RUSTED_CLEAVER  (>>23 == CAT_ITEM)
+4  rarity      1          // 0 normal · 1 magic · 2 rare · 3 unique
+8  item_level  5          // monster level at drop — gates affix tiers
+12 x           0          // bag column (0..11)
+16 y           0          // bag row    (0..4)
```
Need its slot or 2×3 footprint? It's a weapon — you know that from
`ITEM_RUSTED_CLEAVER` / content-docs; the read won't repeat it.

`read_skills(0xD100, 8)` returns `2`; the first record (40 bytes at `0xD100`):

```
+0  slot_no       1          // 1-based; slot 0 is the basic weapon attack
+4  gem_num       8388612    // GEM_FROST_NOVA  (>>23 == CAT_GEM)
+8  level         3
+12 cooldown_left 0          // ticks until recastable (0 = ok by cooldown)
+16 range         655360     // Q16.16 == 10.0 units  (0x000A0000)
+20 mana_cost     14         // FINAL — support cost-mults folded in
+24 use_ticks     9          // FINAL — support/cast-speed folded in
+28 target_mode   0          // 0 entity · 1 point · 2 direction
+32 ready         1          // cooldown + mana + weapon + not-mid-use all OK
+36 life_cost     0          // FINAL per-use life (#98); 0 for most skills.
                             // UNGATED — paid even past 0, so NOT in `ready`;
                             // weigh it against SelfStatus life yourself
```
To fire: `if (rec[+32]) { … }`, dispatch on `target_mode` — entity →
`use_skill(slot, target,…)`, point → `use_skill_at`, direction → `use_skill_dir`.

`skill_info(1, 0xD200)` returns `0`; the record (12 bytes at `0xD200`) — only
needed to aim AoE:

```
+0  shape      1          // 0 target · 1 nova · 2 cone · 3 line · 4 point-AoE · 5 projectile
+4  radius     262144     // Q16.16 == 4.0 units  (the nova/AoE radius)
+8  skill_kind 1          // 0 attack · 1 spell
```

`read_item_mods(0, 0xD300, 16)` on that magic cleaver returns the record count;
**one 16-byte (4-word) record PER EFFECT** — the per-instance rolls (the base's
static facts are in content-docs). A plain affix is one record; a HYBRID affix
emits several, sharing `affix_num` and counting `effect_index`:

```
record 0 @ +0:  affix_num    25165825  // AFFIX_HALE  (>>23 == CAT_AFFIX)
                effect_index 0         // which of the affix's effects this row is
                value        24        // the rolled amount (flat life here)
                tier         0         // which tier rolled (index into the affix's tiers)
record 1 @ +16: affix_num    …         // the next effect (same affix_num if hybrid)
                …
```

The granted stat isn't in the record — look it up by identity:
`content-docs → affixes[affix_num].effects[effect_index].stat`. What that stat
*means* is in the top-level `stats` vocabulary of content-docs: each entry has
`key` (the snake_case name `effects[].stat` uses), a human `name`, a one-line
`desc`, and `added_unit` — the unit an `Added`-layer value carries
(`flat` · `basis_points` · `per_second` · `factor_bp` · `centi_units`;
Increased/More layers are always basis-point percentages). Each affix doc also
carries an auto-derived `description` — the number-free mod template
(`"+# Dexterity, #% increased Evasion"`).

### Manual gem & gear selection (the optimization path)

`equip_best()` and `socket_gem(-1, -1)` are shortcuts for default bots; an
optimizing bot does its OWN selection — that's the whole point of stable nums
(RFC #54 P4). The grinder template does this now. The idiom:

```c
// GEMS — socket only skills your build can USE. A bow gem on a melee build is
// never in your plan, so you never socket it (the engine won't stop you —
// selection is YOUR job; this is the weapon-compat skip auto mode can't make).
// socket_gem takes a stable NODE num; this is idempotent (a filled node or an
// absent gem returns −1).
fn socket_into(node, gem_num) {
    var n = read_inventory(0xE800, 60);
    var i = 0;
    while (i < n) {
        if (mem[0xE800 + i * 20] == gem_num) {        // base_num == a planned gem
            // socket_gem returns the COUNT socketed (>0 ok); stop on success —
            // socketing shifts the bag, so the scanned buffer goes stale.
            if (socket_gem(node, i) > 0) { return 0; }
        }
        i = i + 1;
    }
    return -1;
}
// socket_into(NODE_START, GEM_HEAVY_SWING);  // First Spark socket, level 1
// socket_into(NODE_SOCKET_WAR, GEM_CLEAVE);  // a deeper socket, post-milestone

// GEAR — wear your own upgrades. read_equipment gives the worn piece per slot
// (base_num −1 = empty); item_slot(num) maps a bag candidate to its slot. The
// WEAPON slot is build-critical: a wand or bow silences your melee skills at the
// weapon gate, and reads carry no weapon class — so wield only your melee base.
read_equipment(0xED00, 12);
var n = read_inventory(0xE800, 60);
var i = 0;
while (i < n) {
    var rec = 0xE800 + i * 20;
    var s = item_slot(mem[rec]);                       // −1 unless this is gear
    if (s >= 0 && (s != 0 || mem[rec] == ITEM_RUSTED_CLEAVER)) {
        var er = 0xED00 + s * 16;
        if (mem[er + 4] < 0 || mem[rec + 8] > mem[er + 12]) {  // empty, or higher ilvl
            if (equip(i) == 0) { i = n; }              // bag shifted; re-scan next tick
        }
    }
    i = i + 1;
}
```

## Zone brains (the dungeon master is a bot)

A zone may name a `brain:` in its def — a bot program that runs once
per tick, bound to no entity, with a zone-scoped syscall table:

| # | builtin | what |
|---|---|---|
| 100 | `query_characters(out, max)` | 10-word records per idler: net, kills, level, x, y, weapon_class (−1/0 melee/1 bow/2 wand), life_pct, dead, build_len (0 = no declared build), archetype (0 melee / 1 bow / 2 wand / −1 unknown, classified from the declared plan) |
| 101 | `poll_events(out, max)` | drains this tick's events as 4-word records: kind (1 kill / 2 equip / 3 socket / 4 level / 5 died / 6 pickup), char net, a, b (kill: a = monster num — matches a `monster "..."` ref, b = level) |
| 102 | `narrate(line, char)` | fire an authored ZoneDef `lines:` entry into the ticker (char 0 = everyone). Address lines by name: `narrate(line "welcome", net)` |
| 103 | `drop_loot(kind, ref, x, y, owner)` | scripted drops: 0 = gear base (normal) at item num `ref`, 1 = gem at gem num `ref`, 2 = obol at currency num `ref`, 3 = rolled RARE at item level `ref` (kinds 0–2 take a stable content num — use `item "…"` / `gem "…"` / `currency "…"`; only kind 3's `ref` is a raw level). Story drops never despawn — scripted loot is often a gate key |
| 104 | `spawn_monster(def, x, y)` | a packless scripted spawn (never respawns); `def` is a monster num — `monster "…"` |
| 106 | `set_exit(idx, open)` | gate a ZoneDef exit open (1) or shut (0). Brains only GATE — characters take exits THEMSELVES with `use_exit`; forced transfers do not exist. |
| 107 | `set_gate(idx, open)` | open (1) or shut (0) a ZoneDef gate — a rect of cells that blocks movement AND line of sight while shut (nothing strains at, or shoots through, an unearned lesson). Address by id: `set_gate(gate "start", 1)` |
| 108 | `spawn_elite(def, x, y, rarity)` | a packless scripted spawn at forced rarity (1 = magic, 2 = rare) — fresh affixes rolled through the item affix system; `def` is a monster num — `monster "…"` |

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

## Deploying your brain (#148 A6)

The server takes live deployments — your `.bot` source, compiled with the
same prelude the stock brains get (every generated content num and ABI
const already in scope):

```sh
curl -X POST http://<server>/api/deploy \
  -H 'content-type: application/json' \
  -d '{"token": "<IDLIN_ADMIN_TOKEN>", "name": "MyBrain", "source": "<your .bot source>"}'
```

Your character joins **the shore** — the tutorial gates every brain the
same way the stock three were gated. Names are 1-24 chars of
`[A-Za-z0-9_-]` and must be unique; the worlds cap at 24 characters.
Compile errors come back verbatim. The mutating routes demand
`IDLIN_ADMIN_TOKEN` (unset = disabled, fail closed).

**The kill switch** recalls a runaway brain — the entity despawns, the
brain stops, nothing transfers:

```sh
curl -X POST http://<server>/api/kill \
  -d '{"token": "<IDLIN_ADMIN_TOKEN>", "name": "MyBrain"}'
```

**The leaderboard** (`GET /api/leaderboard`, public) ranks every live
character by campaign progress, then level, then kills — with lifetime
deaths as the honesty column and `program_hash` identifying the brain
across its characters.

### The headless harness

Before deploying, run the WHOLE game locally — the same loop the repo's
band tests use:

```sh
cargo run -p idlin-server --bin harness -- --brain my.bot --seed 0xC0FFEE
```

The JSON report lists every campaign milestone by name plus ticks-to-first-map,
deaths, and vendor sales; exit 1 = the road didn't complete (the report
names the wall). Runs are deterministic per (seed, brain): a red run
replays bit-identically, so a `debug()` in your brain lands on the same
tick every time.

## Lessons from the stock brains (1.0/2.0 field notes)

Hard-won disciplines the stock templates carry — steal them:

- **Budget cadence.** 5,000 instructions per tick sounds like plenty; a
  60-record bag scan inside a pack fight isn't. The stock brains run gear
  and socket upkeep on ONE tick in ten and rest the other nine.
- **Route trichotomy.** A route decision is one of: a destination num
  (travel), `-1` (stay — you're where you should be), or `0` (unknown —
  let the boredom valve decide). Collapsing stay into unknown made brains
  bounce out of boss rooms mid-fight.
- **The XP-drought futility detector.** Life bars lie (chip + regen
  yo-yo); XP only rises. Fifteen seconds of combat without earning any =
  walk away — with a UNIQUE-rarity exemption, because bosses pay all
  their XP at the end.
- **Bag discipline, then the vendor.** In the field, shed what upkeep
  didn't wear (keep maps and one copy of each build gem). In town, the
  same junk is OBOLS — sell it before you open the map, and only on
  the tick right after upkeep ran, so a freshly returned winner is worn,
  never sold.
- **Hold at nine tenths.** A ranged weapon's whole identity is range: at
  70% of reach a bow trades inside a caster boss's envelope; at 90% the
  answer can't reach back.

## Sound (#148 A8)

The broadcast talks: a synthesized WebAudio layer (zero assets — every
cue is oscillators and envelopes) voices the story beats the director
cuts to — kills (rate-limited), boss falls, act fanfares, deaths,
default**; the speaker button (bottom-right) is the opt-in, and its
click doubles as the browser's audio-unlock gesture. Volume persists
per-browser. Sound is presentation-only — it never touches the sim,
and the deterministic capture harness asserts the event→cue mapping
through the engine's log (headless Chromium plays nothing; ears verify
the rest).
