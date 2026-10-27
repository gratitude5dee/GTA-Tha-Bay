# Release records

`docs/releases/<tag>/` holds the files a release run writes about itself. Today that is one file.

## `cutscenes.md`

Which Act 1 refs ship a generated clip and which stay in-engine (a DirectorScript with subtitles, R-CUT-03). `pnpm assets:gen prewarm --report` writes it; do not edit it by hand. It has no timestamps, so a rerun with the same state writes the same bytes.

```sh
# 1. build the release index and its private requests file (writes .private/releases/<tag>/cutscene-requests.json)
pnpm assets:cutscene-index -- --release <tag>

# 2. read the plan and write the report: provider gate, sheet gate, cache check, estimate against the USD 16 line (no spend)
pnpm assets:gen prewarm -- --release <tag> --env prod --report

# 3. offline plan from files only, no network call at all
pnpm assets:gen prewarm -- --release <tag> --offline

# 4. the provenance gate over the shipped clips
pnpm check:c2pa -- --env prod
```

What the report says:

| Line | Meaning |
|---|---|
| `Provider` | The registry provider that was cleared (ADR-GENAI-01), or `none cleared`. With none cleared nothing is estimated and all nine refs are in-engine. |
| `Generated clips` | Refs whose `cutscenes/<key>/manifest.json` exists on the media host when the plan ran. |
| `Plays: in-engine` | Why: `no cleared provider`, `sheet missing: <ids>` (the Lean sheet crops of M10a1 and M10a2 are not approved yet), `pending` (route 27 says a job for the key is in flight), `over line`, `stale endpoint` (rebuild the index), or `planned` (a plan exists but nothing has been generated). |

A run without `--offline` makes HEAD requests to the media host, asks route 27 about every key whose manifest is missing, and reads the programme headroom from the ledger when `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are set (otherwise it prints a `SKIP` line and `headroom: unknown`). `--offline` makes no network call and counts every key as a miss. Without a cleared provider the command prints `blocked: no cleared provider (ADR-GENAI-01)` and exits 0 before any of that.

The CLI never calls fal. On Workers Free it never submits anything either: `--live` refuses with `blocked: no transcoder on Workers Free; lands in M05c4` (after the provider gate, and after the C2PA guard when `--env prod` and the Worker build has `C2PA_RESIGN` off), makes no network call and exits 0. Live submission, hand-off and the off-edge finish land in M05c4 (DL-750).
