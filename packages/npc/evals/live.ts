import { parseJudgeText, judgeParams, type JudgeItem, type JudgePort } from './judge.ts';
import type { JudgeScores, ModelPort } from './types.ts';

/**
 * The network ports of `npc:eval --live` and `--record`: one non-streamed Messages call for the character, and the Message Batches API for
 * the judge. Both use the `ci-evals` workspace key (`ANTHROPIC_EVALS_KEY`) and go to the Anthropic API directly, never through the game's
 * Worker or gateway. Endpoints and fields are those of the batch-processing guide (spec/03 section 7, checked 2026-10-22):
 *   POST /v1/messages/batches {requests:[{custom_id, params}]} -> {id, processing_status}
 *   GET  /v1/messages/batches/{id} until processing_status = "ended"
 *   GET  /v1/messages/batches/{id}/results -> JSON lines {custom_id, result:{type:"succeeded", message:{content:[{type:"text", text}]}}}
 * `custom_id` matches ^[a-zA-Z0-9_-]{1,64}$.
 */
export const ANTHROPIC_ORIGIN = 'https://api.anthropic.com';
const headers = (key: string): Record<string, string> => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' });

const textOf = (message: unknown): string => {
  const content = (message as { content?: { type?: string; text?: string }[] } | null)?.content ?? [];
  return content.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text as string).join('');
};

export function anthropicModel(key: string, fetchFn: typeof fetch = fetch): ModelPort {
  return {
    async complete(body) {
      try {
        const res = await fetchFn(`${ANTHROPIC_ORIGIN}/v1/messages`, { method: 'POST', headers: headers(key), body: JSON.stringify(body) });
        if (!res.ok) return null;
        const json = (await res.json()) as { model?: string; content?: unknown; stop_reason?: string };
        if (json.stop_reason === 'refusal') return null;
        return { text: textOf(json), model: json.model ?? String(body['model']) };
      } catch {
        return null;
      }
    },
  };
}

export interface BatchOptions {
  fetchFn?: typeof fetch;
  /** Milliseconds between polls (default 15 s). */
  pollMs?: number;
  /** Gives up after this long (default 2 h). */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export function anthropicBatchJudge(key: string, o: BatchOptions = {}): JudgePort {
  const fetchFn = o.fetchFn ?? fetch;
  const sleep = o.sleep ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)));
  const now = o.now ?? ((): number => Date.now());
  return {
    async judge(items: readonly JudgeItem[]): Promise<Map<string, JudgeScores>> {
      const out = new Map<string, JudgeScores>();
      if (items.length === 0) return out;
      const ids = new Map<string, string>();
      const requests = items.map((item, i) => {
        const custom = `t${i}`;
        ids.set(custom, item.id);
        return { custom_id: custom, params: judgeParams(item) };
      });
      const created = await fetchFn(`${ANTHROPIC_ORIGIN}/v1/messages/batches`, { method: 'POST', headers: headers(key), body: JSON.stringify({ requests }) });
      if (!created.ok) throw new Error(`batch create failed (${created.status})`);
      const batch = (await created.json()) as { id: string };
      const deadline = now() + (o.timeoutMs ?? 2 * 3_600_000);
      for (;;) {
        const r = await fetchFn(`${ANTHROPIC_ORIGIN}/v1/messages/batches/${batch.id}`, { headers: headers(key) });
        if (!r.ok) throw new Error(`batch status failed (${r.status})`);
        const s = (await r.json()) as { processing_status?: string };
        if (s.processing_status === 'ended') break;
        if (now() > deadline) throw new Error('batch did not end in time');
        await sleep(o.pollMs ?? 15_000);
      }
      const results = await fetchFn(`${ANTHROPIC_ORIGIN}/v1/messages/batches/${batch.id}/results`, { headers: headers(key) });
      if (!results.ok) throw new Error(`batch results failed (${results.status})`);
      for (const line of (await results.text()).split('\n')) {
        if (line.trim() === '') continue;
        const row = JSON.parse(line) as { custom_id?: string; result?: { type?: string; message?: unknown } };
        const id = row.custom_id === undefined ? undefined : ids.get(row.custom_id);
        if (id === undefined || row.result?.type !== 'succeeded') continue;
        const scores = parseJudgeText(textOf(row.result.message));
        if (scores !== null) out.set(id, scores);
      }
      return out;
    },
  };
}
