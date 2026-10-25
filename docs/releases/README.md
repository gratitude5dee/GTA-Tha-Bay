# Release records

`docs/releases/<tag>/` holds the files a release run writes about itself. Today that is one file.

## `cutscenes.md`

Which Act 1 refs ship a generated clip and which stay in-engine (a DirectorScript with subtitles, R-CUT-03). `pnpm assets:gen prewarm --report` writes it; do not edit it by hand. It has no timestamps, so a rerun with the same state writes the same bytes.

```sh
# 1. build the release index and its private requests file (writes .private/releases/<tag>/cutscene-requests.json)
pnpm assets:cutscene-index -- --release <tag>

# 2. read the plan: provider gate, sheet gate, cache check, estimate against the USD 16 line (no spend)
pnpm assets:gen prewarm -- --release <tag> --env prod --report

# 3. spend: only on the operator workstation, with OPS_TOKEN, SUPABASE_URL and SUPABASE_SECRET_KEY set
pnpm assets:gen prewarm -- --release <tag> --env prod --live --report

# 4. run it again: every key is ready, so it submits nothing
pnpm assets:gen prewarm -- --release <tag> --env prod --live --report

# 5. the provenance gate over the shipped clips
pnpm check:c2pa -- --env prod
```

What the report says:

| Line | Meaning |
|---|---|
| `Provider` | The registry provider that was cleared (ADR-GENAI-01), or `none cleared`. With none cleared nothing is spent and all nine refs are in-engine. |
| `Generated clips` | Refs whose `cutscenes/<key>/manifest.json` exists after the run. |
| `Ledger delta` | Sum of `genai_ledger` rows of kind `cutscene` since the live run started, in USD micros. Settlement can lag the run, so read it again later. It must stay at or under 16,000,000 micros for the Act 1 line. |
| `Plays: in-engine` | Why: `no cleared provider`, `sheet missing: <ids>` (the Lean sheet crops of M10a1 and M10a2 are not approved yet), `over line`, `stale endpoint` (rebuild the index), or the state the Worker reported (`failed`, `blocked`, `pending`). |

A dry run without `--live` and without `--offline` makes HEAD requests to the media host and reads the ledger when the database key is set; `--offline` makes no network call and counts every key as a miss. Without a cleared provider the command prints `blocked: no cleared provider (ADR-GENAI-01)` and exits 0 before either.

The CLI never calls fal. `--live` posts the planned keys to route 28 of our Worker and polls route 27; the Worker's gate, governor and single-flight object decide what runs. After a live run it rebuilds the release index (`assets:cutscene-index --media <host>`), so ready keys become entries and the other refs keep their DirectorScript.
