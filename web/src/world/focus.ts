/**
 * Which character is "in focus" — shared by the HUD overlay and the scene camera
 * so they always agree (#79).
 *
 * When pinned to a name (the individual view `/idler/<name>`, or the `?watch=` /
 * `?follow=` dev params) the focus is THAT character, or **nobody** if they are
 * absent from the streamed world — never the director's cue. A pinned page must
 * not silently frame (or label "your idler") whatever the broadcast happens to be
 * showing. Unpinned (the broadcast) follows the director's cue.
 *
 * Match is by name, CASE-INSENSITIVELY — `/idler/kargan` must resolve `Kargan`;
 * a URL the operator types should not have to match the proper-noun casing. This
 * mirrors the server's case-insensitive `routing.by_character` bind, so the
 * client focuses exactly who the server streams. Only CHARACTERS are candidates:
 * monsters share the name field (e.g. "Bone Stalker"), and a pinned page must
 * never resolve a monster (both the HUD and the camera call this, so the filter
 * lives here — one guarantee, not per-caller).
 */
export function resolveFocusId(
  pinnedName: string | null | undefined,
  entities: Iterable<{ id: number; name: string; kind: string }>,
  cueFocus: number | undefined,
): number | undefined {
  if (pinnedName == null) return cueFocus;
  const want = pinnedName.toLowerCase();
  for (const e of entities) {
    if (e.kind === "Character" && e.name.toLowerCase() === want) return e.id;
  }
  return undefined; // pinned but absent → no focus, NOT the director cue
}
