; ============================================================
; Idlin grinder template — the default chat-player brain.
;
; Per tick: refresh self status; if dead, sleep. Pick up own
; loot nearby, then engage the nearest monster (attack intent +
; walk toward it; the sim stops movement once in range). If
; nothing is around, wander to a random point in the zone.
;
; Syscall ABI: args pushed in reverse order, then `sys num argc`.
; See idlin-sim/src/bots.rs for struct layouts (mirrored here).
; ============================================================

.equ SELF   0xE000     ; SelfStatus buffer
.equ ENTS   0xE100     ; entity query buffer (24-byte records)
.equ F_MON  1          ; ReadEntities filter: monsters
.equ F_LOOT 3          ; ReadEntities filter: own ground loot

; SelfStatus layout: +0 x, +4 y, +8 life, +12 life_max, +16 level,
;                    +20 xp, +24 map_w, +28 map_h, +32 flags (bit0 = dead)
; Entity record:     +0 id, +4 kind, +8 x, +12 y, +16 life_pct, +20 rarity

main:
    push SELF
    sys 1 1            ; SelfStatus(SELF)
    pop

    push SELF+32       ; flags
    load
    pushs 1
    and
    jmpif sleep        ; dead: nothing to do until respawn

    ; --- loot: pick up the nearest of our drops, if any ---
    pushs F_LOOT
    pushs 4
    push ENTS
    sys 2 3            ; count = ReadEntities(ENTS, 4, F_LOOT)
    jmpifz no_loot
    push ENTS
    load               ; nearest loot id
    sys 8 1            ; PickUp(id)
    pop
no_loot:

    ; --- gear: let the host equip any upgrades from the bag ---
    sys 12 0           ; EquipBest()
    pop

    ; --- spend any pending passive point (host auto-picks a node) ---
    pushs -1
    sys 13 1           ; AllocPassive(-1)
    pop

    ; --- combat: nearest monster, or wander if none ---
    pushs F_MON
    pushs 8
    push ENTS
    sys 2 3            ; count = ReadEntities(ENTS, 8, F_MON)
    jmpifz wander

    pushz              ; y = 0 (unused for targeted skills)
    pushz              ; x = 0
    push ENTS
    load               ; target id (records are distance-sorted)
    pushz              ; slot 0 = basic attack
    sys 7 4            ; UseSkill(0, id, 0, 0)
    pop

    push ENTS+12
    load               ; target y
    push ENTS+8
    load               ; target x
    sys 6 2            ; MoveTo(x, y)
    pop

    halt
    jmp main

wander:
    sys 15 0           ; Random()
    push 0x7FFFFFFF
    and
    push SELF+24       ; map_w (Q16.16)
    load
    mod                ; x = rand % map_w
    sys 15 0
    push 0x7FFFFFFF
    and
    push SELF+28       ; map_h
    load
    mod                ; y   (stack: x y)
    swap               ; MoveTo pops x first
    sys 6 2
    pop
sleep:
    halt
    jmp main
