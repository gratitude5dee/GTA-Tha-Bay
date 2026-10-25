import type { SpendEvent } from '@dv/shared';
import { now } from '../clock.ts';
import type { AppDeps } from '../deps.ts';
import type { Env } from '../env.ts';
import { sendSpend } from '../ops/queue.ts';
import { costMicros, emptyUsage, mergeUsage, type Usage } from '../npc/settle.ts';
import { currentTiming, selectBuilderUpstream, UpstreamError, type Upstream } from '../npc/upstream.ts';
import { writeServerEvent } from '../telemetry/server.ts';

/**
 * The model calls of the NPC builder (M06b1): one non-streaming-to-the-client helper over the Upstream interface, so the fixture upstream and the
 * live one (key `ANTHROPIC_BUILDER_KEY`, workspace `npc-builder`) both serve every builder call. Fixture requests name the call in `intent`
 * (`builder-classify`, `builder-soul`, `builder-repair`, `builder-judge:<probe>`; probe turns use `probe:<name>`) and the draft's NPC id or
 * `_builder` in `npcId`, so a test chooses the answer per call. Nothing here logs a prompt, a backstory or an answer.
 */
export const BUILDER_FIXTURE_NPC = '_builder';

export interface ModelAnswer {
  text: string;
  stop: string | null;
  model: string | undefined;
  usage: Usage;
  /** Micros this call cost at the F-034 prices of the model that answered. */
  micros: number;
}

export class BuilderUnavailable extends Error {
  constructor(readonly reason: 'no_key' | 'upstream' | 'refusal' | 'truncated') {
    super(`builder model unavailable: ${reason}`);
    this.name = 'BuilderUnavailable';
  }
}

export function builderUpstream(env: Env): Upstream {
  const up = selectBuilderUpstream(env);
  if (up === null) throw new BuilderUnavailable('no_key');
  return up;
}

const CF_AIG_HEADERS = (env: Env): Record<string, string> => ({
  'cf-aig-metadata': JSON.stringify({ workspace: 'npc-builder', env: env.AIG_ENV ?? env.ENVIRONMENT }),
  'cf-aig-collect-log-payload': 'false',
});

/** Sends one request and collects the streamed text. Rejects with BuilderUnavailable on an upstream error, a refusal or a cut-off answer. */
export async function callModel(
  env: Env,
  up: Upstream,
  body: Record<string, unknown>,
  fixture: { npcId: string; intent: string; hero?: boolean },
  timeoutMs = 150_000,
): Promise<ModelAnswer> {
  const ac = new AbortController();
  const timer = currentTiming().setTimeout(() => ac.abort(), timeoutMs);
  const usage = emptyUsage();
  let text = '';
  let model: string | undefined;
  let stop: string | null = null;
  try {
    for await (const ev of up.stream({ body, betas: [], headers: CF_AIG_HEADERS(env) }, ac.signal, {
      npcId: fixture.npcId,
      intent: fixture.intent,
      turnIndex: 0,
      model: String(body['model']),
      hero: fixture.hero ?? false,
    })) {
      if (ev.type === 'message_start') {
        const m = ev['message'] as { model?: unknown; usage?: unknown } | undefined;
        if (typeof m?.model === 'string') model = m.model;
        mergeUsage(usage, m?.usage);
      } else if (ev.type === 'content_block_delta') {
        const d = ev['delta'] as { type?: unknown; text?: unknown } | undefined;
        if (d?.type === 'text_delta' && typeof d.text === 'string') text += d.text;
      } else if (ev.type === 'message_delta') {
        const d = ev['delta'] as { stop_reason?: unknown } | undefined;
        if (typeof d?.stop_reason === 'string') stop = d.stop_reason;
        mergeUsage(usage, ev['usage']);
      } else if (ev.type === 'error') {
        throw new UpstreamError(529, 'error event in stream');
      }
    }
  } catch (e) {
    if (e instanceof UpstreamError || ac.signal.aborted) throw new BuilderUnavailable('upstream');
    throw e;
  } finally {
    currentTiming().clearTimeout(timer);
  }
  if (stop === 'refusal') throw new BuilderUnavailable('refusal');
  if (stop === 'max_tokens') throw new BuilderUnavailable('truncated');
  return { text, stop, model, usage, micros: costMicros(usage, model).micros };
}

/** The JSON object of an answer, or null when it does not parse to one. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown;
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `output_config.format` for a schema (the `$schema` and `$id` keys are not accepted in a structured-output request). */
export function formatOf(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _s, $id: _i, ...rest } = schema;
  return { type: 'json_schema', schema: rest };
}

/** A request body for a Haiku call with thinking off and low effort, structured output, no sampling parameter, no prefill. */
export function haikuBody(opts: { system: string; user: string; schema: Record<string, unknown>; maxTokens: number; model?: string }): Record<string, unknown> {
  return {
    model: opts.model ?? 'claude-haiku-5-5',
    max_tokens: opts.maxTokens,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low', format: formatOf(opts.schema) },
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  };
}

/**
 * Books the cost of a builder call that has no reservation of its own (classifier, probes, preview). Soul generations are settled through their
 * `builder_text` reservation instead. The event goes through the SPEND queue, or straight into the governor where none is bound.
 */
export async function recordBuilderSpend(env: Env, deps: Pick<AppDeps, 'log'>, micros: number, model: string | undefined, requestId: string): Promise<void> {
  if (micros <= 0) return;
  const ev: SpendEvent = { ts: now(), vendor: 'anthropic', model: model ?? 'unknown', kind: 'builder', usdMicros: micros, settled: true, requestId, env: env.ENVIRONMENT };
  try {
    if (!(await sendSpend(env, ev))) {
      await (env.GOVERNOR.get(env.GOVERNOR.idFromName(`gov:${env.ENVIRONMENT}`)) as unknown as { ingest(b: SpendEvent[]): Promise<void> }).ingest([ev]);
    }
    writeServerEvent(env, 'genai.cost', { vendor: 'anthropic', model: costMicros(emptyUsage(), model).label, usdMicros: micros, cacheHit: false, tier: 'local' }, now());
  } catch {
    deps.log(JSON.stringify({ event: 'builder.spend.lost' }));
  }
}
