# The Portal — a web home separate from the stream (first draft)

The stream overlay is for *watching*. The **portal** (served at `/portal`) is
for *participating*: a browsable home where a viewer plans an idler's build and
preferences. This is the start of the "build your idler" loop the broadcast is
meant to invite. (Issue #17.)

## What v1 ships (all client-side, no server state)

- **Served at `/portal`.** One axum route serves the SPA shell
  (`ServeFile` → `web/dist/index.html`); `web/src/main.tsx` mounts `<Portal/>`
  instead of the live overlay when the path starts with `/portal`, and does NOT
  open the WebSocket — the portal is fetch-only.
- **Build planner.** The passive tree from `/api/tree`, made interactive: click
  to allocate nodes outward from the start, see running grant totals, and export
  a `build [ … ]` list (the REAL compiler mechanism — node `num` values, start
  excluded since it's implicit) to paste into a bot's source. Selection is
  connectivity-gated and self-pruning, so the exported plan is always a valid
  allocation order.
- **Bot-preferences composer.** A small form that packs named preferences into
  the `0xF000` param block with a live hex preview. This is the *channel* the
  host uses to pass parameters to a bot; the specific offsets here are an
  **illustrative convention** — no template reads them yet.
- **Templates gallery.** The built-in templates (today: the grinder) with
  descriptions and a link to the bot guide.

Nothing here mutates server state; the portal emits copy-pasteable artifacts.

## Out of scope (the identity story comes first)

The issue is explicit: *"needs an identity story before any of it is real."* So
the genuinely-participatory parts are deferred until there is auth:

- **Identity / auth.** Twitch or GitHub OAuth, so a viewer owns a character.
- **Live deploy.** Pushing a planned build / params to YOUR idler needs a new
  *authenticated* client→server message — e.g. `C2S::Deploy { program }` and
  `C2S::SetParams { bytes }` — that writes the character's program / param
  block (`Bot::redeploy` and `Bot.params` already exist server-side; the wire
  verb + the permission check do not). Today `C2S` is `Hello`/`Ping`/
  `DirectorMode`/`Inspect` only — there is no write path, by design.
- **A real bot-prefs contract.** A template that actually reads documented
  `0xF000` offsets, so the composer drives behavior rather than illustrating it.
- **Wiki hosting.** The generated wiki (items/affixes/gems/monsters/zones/
  brains) published somewhere browsable. The repo is private, so GitHub Pages is
  out — this needs a hosting decision, tracked separately.
- **Templates API.** The gallery is a static list; a `/api/templates` endpoint
  (name + description + source) would let it grow with content.

## Verification note

Like the other client-side work, visual verification here is by build only
(`tsc --noEmit` strict + `vite build`); there is no headless-browser pass in
this loop. The build planner's export format is verified against the real
`build [...]` / `set_build` mechanism (node `num`, start implicit).
