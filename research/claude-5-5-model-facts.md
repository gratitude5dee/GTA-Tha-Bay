# Claude 5 family facts (from the bundled claude-api skill, cached 2026-10-06; treat as high-confidence, re-verify pricing at https://docs.claude.com before quoting in the spec)

| Model | ID | Context | Max output | Input $/MTok | Output $/MTok | Notes |
|---|---|---|---|---|---|---|
| Claude Opus 5.5 | `claude-opus-5-5` | 1M | 128K | $4.00 | $20.00 (cache read $0.20) | Thinking always on (`{type:"adaptive"}` or omit; `disabled`/`budget_tokens` = 400). Effort default **medium** — set `output_config.effort` explicitly (`xhigh`/`high` for architecture work). Forced `tool_choice any/tool` = 400. Fast mode available ($8/$40). Task budgets beta supported. |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | 1M | 128K | $2.00 | $10.00 (cache read $0.20) | Thinking adaptive by default; effort default **high** (recalibrated; start `medium` for agentic coding per guide). `between_tools` to turn thinking off. Forced tool_choice = 400. Safety stop_reason `refusal` categories: cyber, bio, frontier_llm, reasoning_extraction, general_harms. |
| Claude Haiku 5.5 | `claude-haiku-5-5` | 1M | — | $0.10 (≤100K prompt; $0.50 beyond) | $0.50 (≤100K; $2.50 beyond) | Cheap runtime model for in-game NPC dialogue / classifiers. Effort default medium. |
| Claude Fable 5.1 | `claude-fable-5-1` | 1M | 128K | $10.00 | $50.00 | Most capable; not needed for the build pipeline. |

Other load-bearing API facts for the spec/prompts:
- Structured outputs: `output_config: {format: {...}}` (not `output_format`). `strict: true` on tool definitions.
- Prompt caching: prefix-based; order tools → system → messages; up to 4 `cache_control` breakpoints; min cacheable prefix 512–4096 tokens; verify with `usage.cache_read_input_tokens`. Put soul.md (stable) first, volatile context last.
- Mid-conversation operator instructions: append `{role:"system"}` into `messages[]` (Opus 5.5, Sonnet 5.5, Haiku 5.5) without invalidating the cached prefix.
- Compaction beta `compact-2026-01-12` for very long sessions; must append full `response.content` back.
- Server tools: `web_search_20260209`, `web_fetch_20260209`, `code_execution_20260521`.
- Streaming required for large max_tokens (use 64K+ when streaming long spec outputs).
- Server-side fallbacks: `betas:["server-side-fallback-2026-07-01"]` + `fallbacks:"default"` on Opus 5.5 / Sonnet 5.5 to handle `refusal` stop reasons.
- No assistant prefill on any 5.x model — use structured outputs or system instructions for format control.
- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) = Claude Code harness as a library (built-in Read/Write/Edit/Bash/Glob/Grep/WebSearch/WebFetch + MCP + subagents) — relevant to the "personal coding agent mods the game" feature; Tool Runner (`client.beta.messages.toolRunner`) = loop over your own tools only.
- Managed Agents (beta `managed-agents-2026-04-01`) = Anthropic-hosted agent + sandbox; an option for the "build an experience" cloud modding flow but NOT required for v1.
