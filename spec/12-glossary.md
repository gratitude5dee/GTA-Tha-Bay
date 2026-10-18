# 12 — Glossary

> v1.0 · Wave 5 (`product-traceability`) · 2026-10-18. Terms of 06 v1.1 §6 plus terms the domain specs introduce. Contract and id rules: 06 §4–§5.


**Anchor**: lat/lng plus `ChunkKey` placing an experience on the map (C17, radius ≤ 250 m).  
**Architect / Builder**: Opus 5.5 orchestrator that writes the spec / Sonnet 5.5 session that implements one milestone.  
**`AssetRef`**: C07 cross-domain asset reference `<kind>/<id>`.  
**Atlas pod**: the story's salvaged curb-mapping sensor, the campaign's evidence.  
**Autoplayer**: bot that plays every mission in CI on fixed seeds (`check:missions`).  
**Bake / `bakeId`**: `tools/map` output from open data; its 64-hex id is the world version.  
**Bark**: short baked ambient NPC line, no LLM.  
**BudgetGovernor**: `BudgetGovernorDO` setting spend levels L0–L3 at 70/85/100 % of a ceiling.  
**Cache key**: A-03 SHA-256 identifying one cutscene clip; generated at most once.  
**Canonical profile**: C02 sim profile whose state hashes match in Node, browsers and Worker.  
**Catalog / lock file**: published asset index / repo record of approved asset variants.  
**Checklist (device)**: scripted C13 `DeviceChecklist` run on a physical device, judged by `perf:verify`.  
**Chunk / Pack**: 256 m streamed world tile (C08) / `world_pack` asset holding 16 chunks.  
**`comingSoon`**: menu state of an unlocked mode whose milestone has not shipped (A-06).  
**Composure / Rattled**: fighter meter and the state when it breaks.  
**Consent record**: scoped proof required for the `consented` likeness tier.  
**Contract (C##)**: frozen shared interface C01–C17 with one owner.  
**Creator kit**: authored body, face and outfit presets used by the character creator, stand-ins and builder NPCs.  
**Curb Allocation Board**: the story's fictional city body auctioning curb rights.  
**Deal**: sim-computed tycoon offer that VC NPCs voice but never set.  
**detmath**: deterministic math library replacing transcendental `Math.*` in sim code.  
**Device-code login**: RFC 8628 flow the `dv` CLI uses to obtain a publish token (P2).  
**DirectorScript**: in-engine camera sequence with subtitles, the fallback for every cutscene.  
**District**: lower-case `d1…d10` world region; unlocks per district.  
**DO**: Cloudflare Durable Object (`RoomDO`, `EncounterDO`, `CutsceneJobDO`, …).  
**Domain spec**: `spec/domains/<nn>-<key>.md`, source of truth for its domain.  
**`dv`**: modder CLI (`@dv/cli`) with an MCP server.  
**Encounter**: server-held NPC conversation in `EncounterDO`; no client history.  
**Experience**: published UGC placed on the map, run as an `exp:<id>` session.  
**`FAL_MODE=mock`**: default in dev and CI; no live fal call without `--live`.  
**Frame data**: per-move startup, active, recovery and advantage frames (fighter).  
**GenJob / job key**: one genAI job and its SHA-256 dedupe key (C07).  
**Ghost**: recorded racing run replayed from inputs.  
**Heat**: wanted level driving the PursuitDirector.  
**Hype**: fighter meter; stocks pay for EX moves, supers and the Showstopper.  
**Identity profile / save profile**: UUIDv7 player identity (C12) / 32-hex save namespace (C05); New Game creates a new save profile.  
**Ink**: authored offline dialogue lines, the NPC fallback.  
**Kill-switch**: live removal of a character within 60 s, swapping in its stand-in.  
**Kill drill**: rehearsal of the kill-switch and purge (`@kill-drill`).  
**Lean / Standard character**: cheaper / full fal character recipe (≈ $1.05 / $3.67, DL-172).  
**Likeness tier**: `consented`, `parody`, `fictionalized`; C07 adds `original`.  
**`mini8w`**: fixed 8-week tycoon preset used by story mission `m.a2.01`.  
**Mod tier**: data (JSON Schema), script (QuickJS in `mod.worker`), ui (opaque iframe).  
**ModeContext**: C06 capability surface a mode receives from the host.  
**ModeHook / stub**: story call into a mode; the stub plays when the mode has not shipped.  
**P0–P3**: auth phases: local, device-registered, ChatGPT-linked, Thirdweb-linked.  
**Par bot**: racing bot setting a route's target time.  
**Play token**: HMAC-signed P0 token bound to a device key.  
**Prewarm**: staff batch generating cutscene clips ahead of play (M05c3, M10b).  
**Provenance record**: per-file origin, licence, generator and likeness record; CI refuses files without one.  
**R2**: Cloudflare object storage for assets, clips and UGC.  
**Render object**: unit of draw budgets (D-09).  
**Round**: tycoon fundraising event with cap-table math.  
**R-ID**: canonical requirement id `R-<AREA>-<NN>` (06 §2).  
**Shutdown / Showstopper**: gore-free fighter finisher / top-level super.  
**Slot / slice**: C05 save record (`core`, `story:*`, `mode:<id>`, `mod:<id>`) / its typed content.  
**Soul**: `soul.md`: frontmatter plus sections defining an NPC (C10).  
**Stand-in**: original authored character that replaces a killed one.  
**`StableKey`**: persistent entity id (`player:`, `veh:`, `npc:`, …); `EntityId` is session-only.  
**Talk objective**: C09 conversation with player-chosen outcomes.  
**Tier**: C13 quality tier: `desktop-ultra`, `desktop`, `mobile`, `mobile-low`, `xr-quest`, `xr-visionpro`.  
**Ticket**: 30 s credential authorizing a room WebSocket.  
**Trace report**: generated R-ID → milestone → test matrix (`tests/reports/trace.md`).  
**TSL**: three.js shading language; the only material path.  
**`UnlockEventId`**: C06 id `unlock.*` stored in `CoreSlice.unlocks`.  
**UNVERIFIED**: external fact not in the ledger; never inside an acceptance criterion.  
**VS**: vertical slice checkpoint (VS-Story M05c2, VS-Racing M07a2, VS-Fighter M08a2, VS-Tycoon M09a2).  
**OPFS / PWA / WebXR**: origin private file system / progressive web app / browser XR API (`immersive-vr` only).  
