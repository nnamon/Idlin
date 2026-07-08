//! Golden replay: a pinned (seed, content, inputs) history must produce the
//! exact same state hash forever, on every platform. CI failure here means
//! either an intentional content/sim change (update the constants below and
//! say so in the commit) or — much worse — a determinism leak.

use idlin_content::ContentDb;
use idlin_sim::{JoinRequest, TickInputs, World};
use std::path::Path;

const GOLDEN_SEED: u64 = 0x1D71_C0DE;
const GOLDEN_TICKS: u64 = 2_000;
/// Update via: cargo test -p idlin-sim --test golden -- --nocapture
/// Re-pinned for #148 A2.5 (the defense economy + real navigation): the
/// ENGINE moved — move intents now WALL-SLIDE and, when terrain blocks the
/// straight line, follow a deterministic A* path (fixed tie-breaking, cached
/// on the intent, serialized) — so every replay's movement differs wherever
/// geometry used to pin. Content moved too: the first ES bases, deeper
/// defensive tiers, strict (deny_unknown_fields) content loading. The
/// templates simplified (the escape-hack layers the engine now obsoletes
/// came out; the XP-drought futility detector with its boss exemption went
/// in). (Prior: 0x09C4 — A2.)
/// Re-pinned for #148 A2 (three archetypes): content moved (the shore's
/// lesson brain keys on the DECLARED archetype and opens midway on the
/// witch's kill when the socket beat already landed; the witch and the
/// Mother lost their archetype-punishing resist walls; the south beach
/// respawns as an XP floor; four ranged weapon bases) AND the grinder
/// template itself changed (north-bias wander, the route trichotomy, the
/// wall-shot escape, shed at 8 with a pickup cooldown) — the golden
/// replay's bots decide differently tick-by-tick. The tri-archetype
/// bands + the 4-seed tutorial pin the live behavior.
/// (Prior: 0xD821 — A1.)
/// Re-pinned for #148 A1 (the resist economy): content_hash-ONLY — the
/// four armour resist suffixes gained deeper tiers, and those .ron bytes
/// are the SOLE mover (critic-isolated: reverting only the affix files
/// restores the prior pin; reverting only the template's new gear rule
/// changes nothing here — the golden replay's decisions happen to be
/// identical under both rules). (Prior: 0x01F3 — T8.)
/// Re-pinned for #136 T8 (the balance pass): the Hollow's tune moved
/// content_hash (chanters sing frost only at L2; colossi three-hit instead
/// of two-shot) AND the grinder template raised its Hollow gate to level
/// 12 — the golden replay's bots carry the new brain, so their shore
/// decisions shift tick-by-tick. The three-seed salt-road band pins the
/// live pacing (sail ≤90k, deaths ≤40; actuals ~30k, ~10).
/// (Prior: 0xB833 — T6.)
/// Re-pinned for #136 T6 (the stock brain runs the whole game): the shore
/// REPLAY ITSELF changes — the grinder template gained the campaign brain
/// (routing, bag discipline, upkeep cadence), so its tutorial decisions
/// differ tick-by-tick; plus content moves (two new melee bases, the
/// hollow's sightline-chain map rework, the Mother's endurance retune).
/// The trio + the salt-road test pin the new behavior end to end.
/// (Prior: 0x2536 — T5.)
/// Re-pinned for #136 T5 (signature uniques): content_hash-ONLY (the four
/// UniqueDef files) — empirically isolated by the critic at the pre-review
/// pin: deleting the four .ron files reverted the digest to exactly the T4
/// pin. The code changes are inert in THIS replay: the tidewarden kill's
/// extra signature roll only shifts loot that has despawned by the hashed
/// tick (and rng state is not hashed), and no item with a unique_idx exists
/// here — the widening and the drop hook are pinned by their own unit
/// tests, not by this digest. (Prior: 0xD1BB — T4.)
/// Re-pinned for #136 T4 (charts): content_hash + a fingerprint widening.
/// Content: the Salt-Stained Chart base, the chart affix pool (of_plenty /
/// of_shoals), the Charted Shallows map zone, and Saltmere's chart_table
/// cell. Widening: World now serializes/hashes loot_quantity_bp,
/// chart_table, and is_chart_instance. The shore replay's BEHAVIOR is
/// unchanged (no chart exists there; the golden grinders never see one) —
/// verify by the trio agreeing. (Prior: 0x8AC7 — T3 boot.)
/// Re-pinned for #136 T3 (the Act 1 zones): content_hash-ONLY — two new
/// authored zones (the Saltworks, the Tidewarden's Hollow: maps, brains,
/// packs), six new monster defs incl. the two act bosses, the coast's road
/// north, the shore Tidewarden losing act_boss (he is the tutorial exam
/// again; the Mother in the Hollow ends Act 1), and the coast/test_range
/// ZoneKind flips (story/map — `map` now marks chart-instanced zones and the
/// server boots the world set FROM content). The golden's 2000-tick shore
/// replay never enters other zones and the shore's own behavior is
/// unchanged — only the folded content_hash moves. The trio agrees.
/// (Prior: 0x3A38 — T2.)
/// Re-pinned for #136 T2 (boss quality): the Tidewarden's def gains a PHASE
/// KIT — three below-half-life passives (2x crit chance, +50% crit multi,
/// +60% phys), chosen because the per-strike effective-offense path folds
/// exactly the offensive subset (cast/attack speed would have been dead
/// content — the pin test caught the first draft). content_hash moves AND
/// the golden fight's course changes below 50%. The trio agrees.
/// (Prior: 0x3722 — T1.)
/// Re-pinned for #136 T1 (the campaign spine), two intentional moves:
/// (1) content_hash — the Tidewarden's .ron gains `act_boss: Some(1)`; and
/// (2) a FINGERPRINT widening — every exit's `requires_act` (the story seal)
/// now folds into state_hash, adding a u32 per exit even at the default 0.
/// The replay DOES acquire new state — the grinder completes act 1 (story
/// bit + an ActCompleted beat) before departing — but the FINAL digest moves
/// only via the two contributions above: the storied character has departed
/// by the hashed tick and events are transient, never hashed. The trio agrees.
/// (Prior: 0x4E18 — #109 B2b.)
/// Re-pinned for #109 B2b (target-dependent strike conditions): the new
/// `Condition::TargetHasAilment` + the per-element "vs-ailed" weapon suffixes
/// (`of_scorch`/`of_jolt`/`of_rime`, MORE damage vs ignited/shocked/chilled) shift
/// content_hash (new affix files + their weapon-pool membership reweights the
/// suffix rolls) AND widen the FINGERPRINT — `CombatStats` gained `target_grants`
/// (the per-victim target-conditional grants), now folded into `state_hash`. The
/// 2000-tick grind's monster affix rolls move; the mechanism itself is inert in the
/// grind (the phys grinders inflict no elemental ailments, so no `TargetHasAilment`
/// fires) — the unit + strike tests prove it. The determinism trio still agrees.
/// (Prior: 0xA5C3 — #125 monster parity.)
/// Re-pinned for #125 full monster/character parity: monsters now derive through the
/// SAME pipeline as characters (`derive_from_sheet`) — folding rolled affixes + a new
/// fixed passive set + buffs + attribute conversion over the level/rarity-scaled def,
/// computing EVERY field (crit/leech/regen/ES/block/stagger/poise/knockback/cast-speed
/// were previously hardcoded). This fixes a real bug — a refresh (e.g. on chill) used to
/// rebuild from the RAW def, dropping the spawn-time scaling AND rolled affixes — and
/// folds the elite bulk into the base (flat-life affixes no longer bulk-scaled), so
/// every monster's stats over the 2000-tick grind move; `tide_husk` also gains a passive
/// kit (a small bloat + a gentle strike-time enrage, kept MILD so it doesn't overtune
/// the tutorial gauntlet). content_hash + grind outcomes both shift. Elite bulk
/// multiplies LIFE only, as before. The determinism trio still agrees.
/// (Prior: 0x19A4 — #125 with the overtuned tide_husk kit; 0x82D3 — #125 with the
/// elite-damage-bulk bug too; 0x960F — #109 RecentlyKilled.)
/// Re-pinned for the #86 grant-unification follow-up: `state_hash` was widened to
/// fingerprint all REPLAY-RELEVANT world state it had silently dropped — active-
/// buff grant internals, the full projectile payload, `intents.move_to`,
/// `CharacterState.build_plan`, the WHOLE `CombatStats` (regen/leech/range/stagger/
/// poise/knockback/use_ticks/speed/projectile/find factors), `MonsterState`
/// (pack_idx/affixes/display_name/skill supports), and the World's zone identity
/// (zone_idx/level/lines). The world is byte-identical (no sim-rule or content
/// change — `content_hash` is unchanged); only the FINGERPRINT widened, so the
/// digest of the same 2000-tick replay moves. The determinism trio still agrees
/// under the wider hash, confirming a representation change, not a leak. (The
/// later item-charges/affix-tier additions left the digest at this value — the
/// 2000-tick golden replay holds no items or monster affixes at the hashed tick.)
/// Re-pinned for #109 RecentlyKilled re-integrated onto current main (which carries #88
/// ailments + the #124 affix-pool inversion + #119 strike-conditions): (1) `CombatStats`
/// gained `last_kill_tick: u64`, folded into `state_hash` (a FINGERPRINT widening); AND
/// (2) the new `of_the_hunt` affix ("+phys for 4s after a kill"), now a member of the
/// `weapon` pool, shifts content_hash and the weapon-suffix rolls. Inert until a character
/// wields it and lands a kill; the determinism trio agrees.
/// --- prior re-pin chain (kept for the bisect trail) ---
/// Re-pinned for #109 (strike-time conditional affixes) re-integrated onto current main
/// (which carries #88 per-element ailments + the #124 affix-pool inversion): (1)
/// `CombatStats` gained `has_strike_conditions`, folded into `state_hash` (a FINGERPRINT
/// widening); AND (2) the new `of_desperation` affix (strike-time "+phys while below 35%
/// life"), now a member of the `weapon` pool, shifts content_hash and the weighted
/// weapon-suffix rolls, so the 2000-tick grind's outcomes move. The strike-time mechanism
/// is inert until a character wields such an affix below the threshold; the determinism
/// trio still agrees, confirming no leak.
/// --- prior #88/#124 re-pin chain (kept for the bisect trail) ---
/// Re-pinned for #88 first-class ailments MERGED onto a `main` that already carries
/// #50 (VM-ABI generation; main was 0xF08B…). #88 brings: a content_hash change (new
/// ailment affixes; `frost_nova`'s hardcoded chill debuff replaced by an inherent
/// Chill ailment) AND a sim-rule change (cold/fire/lightning hits proc Ignite/Shock/
/// Chill on crit or via ailment-chance), so the 2000-tick grind's outcomes move; AND
/// a FINGERPRINT widening — the ailment `CombatStats` fields (the per-element inflict
/// chances/crits_no_ailment/shock_max/chill_max/ailment_duration, spawn-set for
/// monsters from rolled affixes) and the in-flight projectile's `ailment_chance` now
/// fold into `state_hash`.
/// Re-pinned again for the per-element ailment-chance rework: the single blanket
/// `AilmentChance` stat (which scaled all ailments at once — too strong) is SPLIT into
/// `IgniteChance`/`ShockChance`/`ChillChance`, the proc picks chance by the hit's
/// element, `of_affliction` becomes a HYBRID composed of the three, and the keystone-
/// only `of_composure` weapon affix is DELETED (tombstoned). This moves content_hash
/// (affix effects + tombstone + stat vocab → 0xBA6F31C912F0421D), the fingerprint (3
/// chance fields hashed instead of 1), AND grind outcomes (monsters with of_affliction
/// now derive per-element chances). The determinism trio still agrees.
/// Re-pinned again for the single-element chance affixes: of_kindling (ignite),
/// of_conduction (shock), of_numbing (chill) added to the weapon pool, and the
/// all-elemental of_affliction hybrid made rarer (weight 50→20). Three new content
/// files + the weight edit move content_hash (→0xC089DD7B8DD3B1C1), and the weapon-
/// pool affix rolls shift monster stats over the 2000-tick grind. Both intentional.
/// Re-pinned for the affix-pool inversion: eligibility moves entirely to the pool
/// side — `AffixDef.pool` is removed, `content/pools/*.ron` now LIST their member
/// affixes, and items/monsters subscribe by name. This is content_hash-ONLY: the
/// `pool:` field stripped from 49 affix files + 8 new pool files change content_hash
/// (→0x95F068BD5300692A), but the resolved affix→pool membership is preserved EXACTLY
/// (pinned per-pool in `affix_pool_subscriptions_resolve`), so the roller's candidate
/// sets — and thus every loot roll and grind outcome — are byte-identical. The
/// determinism trio still agrees.
/// (Prior: 0x4839 — single-element chance affixes; 0x53B5 — per-element split; 0xBB5A
/// — #88-onto-#50 merge; 0xF08B — #50 part 2; 0x5662 — #86 state_hash widening; etc.)
const GOLDEN_HASH: u64 = 0x0B8C_E00D_3B06_2808;

#[test]
fn golden_replay() {
    let content = ContentDb::load(Path::new("../../content")).expect("content loads");
    let program = idlin_botc::template_grinder().expect("template assembles");
    let mut world = World::new(GOLDEN_SEED, &content);

    let joins = TickInputs {
        arrivals: Vec::new(),
        joins: vec![
            JoinRequest {
                name: "Golden".into(),
                program: program.clone(),
            },
            JoinRequest {
                name: "Replay".into(),
                program,
            },
        ],
    };
    world.tick(&joins);
    let empty = TickInputs::default();
    for _ in 1..GOLDEN_TICKS {
        world.tick(&empty);
    }

    let actual = world.state_hash();
    println!("golden state hash after {GOLDEN_TICKS} ticks: 0x{actual:016X}");
    println!("content hash: 0x{:016X}", content.content_hash);
    assert_eq!(
        actual, GOLDEN_HASH,
        "world history diverged from the golden fixture.\n\
         If you changed content or sim rules ON PURPOSE, update GOLDEN_HASH \
         to 0x{actual:016X} and call the change out in your commit message.\n\
         If you didn't, you have a determinism bug — bisect before touching \
         the constant."
    );
}
