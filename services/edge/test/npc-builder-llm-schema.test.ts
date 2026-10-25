import llmSchema from '@dv/shared/schemas/npc/soul-1.0.llm.schema.json';
import { afterEach, describe, expect, it } from 'vitest';
import { builderSetup, type Builder } from './builder-helpers.ts';

// M06b1 AC-7: the generated LLM schema has no numeric, length or format keyword, at most 24 optional and 16 union-typed parameters, and the soul request
// uses output_config.format and no sampling parameter.
let b: Builder;
afterEach(() => b?.dispose());

const BANNED = new Set(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties', 'uniqueItems', 'format', 'pattern', 'if', 'then', 'else', 'allOf', 'contains']);

function walk(node: unknown, visit: (n: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) return node.forEach((x) => walk(x, visit));
  if (typeof node !== 'object' || node === null) return;
  const o = node as Record<string, unknown>;
  visit(o);
  for (const [k, v] of Object.entries(o)) if (k !== 'required') walk(v, visit);
}

describe('soul generation request', () => {
  it('has no numeric, length or format keyword, and stays inside the optional and union limits', () => {
    const banned: string[] = [];
    let optional = 0;
    let unions = 0;
    walk(llmSchema, (n) => {
      for (const k of Object.keys(n)) if (BANNED.has(k) && typeof n[k] !== 'object') banned.push(k);
      const props = n['properties'];
      if (typeof props === 'object' && props !== null) {
        const required = new Set((n['required'] as string[] | undefined) ?? []);
        optional += Object.keys(props).filter((p) => !required.has(p)).length;
      }
      if (Array.isArray(n['anyOf']) || Array.isArray(n['type'])) unions++;
    });
    expect(banned).toEqual([]);
    expect(optional).toBeLessThanOrEqual(24);
    expect(unions).toBeLessThanOrEqual(16);
    expect(optional).toBe(0); // every optional field is flattened to required-nullable
  });

  it('is sent with output_config.format, adaptive thinking on Sonnet, and no sampling parameter or prefill', async () => {
    b = await builderSetup();
    const d = await b.toPrivate();
    expect(d.state).toBe('private');
    const soul = b.calls.find((c) => c.intent.startsWith('builder-soul'))!;
    const body = soul.call.body;
    expect(body['model']).toBe('claude-sonnet-5-5');
    expect(body['max_tokens']).toBe(8000);
    expect(body['thinking']).toEqual({ type: 'adaptive' });
    const out = body['output_config'] as { effort: string; format: { type: string; schema: Record<string, unknown> } };
    expect(out.effort).toBe('medium');
    expect(out.format.type).toBe('json_schema');
    expect(out.format.schema).not.toHaveProperty('$schema');
    expect(out.format.schema['required']).toEqual((llmSchema as { required: string[] }).required);
    for (const k of ['temperature', 'top_p', 'top_k']) expect(body).not.toHaveProperty(k);
    const messages = body['messages'] as { role: string; content: string }[];
    expect(messages.at(-1)!.role).toBe('user'); // no assistant prefill
    expect(messages[0]!.content).toContain('<character_sheet origin="user" trust="untrusted">');
    expect(messages[0]!.content).toContain('poi.mission.shop-batista');
    expect(JSON.stringify(body['system'])).toContain('Never base the character on');
    expect(soul.call.headers['cf-aig-metadata']).toContain('npc-builder');
    // every model call of the builder is structured and free of sampling parameters
    for (const c of b.calls) {
      expect(c.call.body).not.toHaveProperty('temperature');
      expect((c.call.body['output_config'] as { format?: unknown }).format).toBeDefined();
    }
  });
});
