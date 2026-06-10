; ============================================================
; Hostile NPC brain: leash to anchor, chase and attack the
; nearest enemy within aggro range, wander when idle.
;
; Runs on the exact same VM and syscalls as player bots —
; NPC behavior is content, not engine code.
;
; SelfStatus layout: +0 x, +4 y, +8 life, +12 life_max,
;   +16 level, +20 xp, +24 map_w, +28 map_h, +32 flags,
;   +36 anchor_x, +40 anchor_y, +44 aggro_radius, +48 attack_range
; Entity record: +0 id, +4 kind, +8 x, +12 y, +16 life_pct, +20 rarity
; ============================================================

.equ SELF    0xE000
.equ ENTS    0xE100
.equ WTIMER  0xD000      ; wander countdown (persists across ticks)
.equ F_ENEMY 1           ; ReadEntities: enemies of my faction
.equ LEASH   0x190000    ; 25 u (Q16.16): max manhattan distance from anchor

main:
    push SELF
    sys 1 1              ; SelfStatus(SELF)
    pop

    ; --- leash: manhattan distance to anchor ---
    push SELF            ; x
    load
    push SELF+36         ; anchor_x
    load
    sub
    call abs
    push SELF+4
    load
    push SELF+40
    load
    sub
    call abs
    add                  ; [mdist]
    push LEASH
    gt
    jmpif go_home

    ; --- enemies in sight? ---
    pushs F_ENEMY
    pushs 4
    push ENTS
    sys 2 3
    jmpifz idle

    ; engage only within aggro radius (manhattan approximation)
    push ENTS+8
    load
    push SELF
    load
    sub
    call abs
    push ENTS+12
    load
    push SELF+4
    load
    sub
    call abs
    add                  ; distance to nearest enemy
    push SELF+44         ; aggro radius
    load
    gt
    jmpif idle

    ; attack + chase
    pushz                ; y (unused for targeted skill)
    pushz                ; x
    push ENTS
    load                 ; target id
    pushz                ; slot 0
    sys 7 4
    pop
    push ENTS+12
    load
    push ENTS+8
    load
    sys 6 2              ; MoveTo(target)
    pop
    halt
    jmp main

idle:
    ; countdown in VM memory: wander to a fresh point every 3-9 seconds
    push WTIMER
    load
    pushs 1
    sub
    dup
    push WTIMER
    store
    pushz
    gt
    jmpif rest

    ; wander point = anchor + (rand % 8u) - 4u, per axis
    sys 15 0
    push 0x7FFFFFFF
    and
    push 0x80000         ; 8 u
    mod
    push 0x40000         ; 4 u
    sub
    push SELF+36
    load
    add                  ; x
    sys 15 0
    push 0x7FFFFFFF
    and
    push 0x80000
    mod
    push 0x40000
    sub
    push SELF+40
    load
    add                  ; y    (stack: x y)
    swap
    sys 6 2              ; MoveTo(x, y)
    pop
    ; reset countdown: 30 + rand % 60 ticks
    sys 15 0
    push 0x7FFFFFFF
    and
    pushs 60
    mod
    pushs 30
    add
    push WTIMER
    store
rest:
    halt
    jmp main

go_home:
    push SELF+40
    load
    push SELF+36
    load
    sys 6 2              ; MoveTo(anchor)
    pop
    halt
    jmp main

abs:
    ; i32 absolute value. Entry stack: [x, ret]
    swap                 ; [ret, x]
    dup
    pushz
    lt                   ; x < 0 ?
    jmpifz abs_done
    neg
abs_done:
    swap                 ; [|x|, ret]
    ret
