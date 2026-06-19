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
 * Match is by exact name to mirror the server's `routing.by_character` lookup —
 * the client must focus exactly who the server is streaming.
 */
export function resolveFocusId(
  pinnedName: string | null | undefined,
  characters: Iterable<{ id: number; name: string }>,
  cueFocus: number | undefined,
): number | undefined {
  if (pinnedName == null) return cueFocus;
  for (const c of characters) {
    if (c.name === pinnedName) return c.id;
  }
  return undefined; // pinned but absent → no focus, NOT the director cue
}
