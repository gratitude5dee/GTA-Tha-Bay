import type { SliceKind } from '@dv/shared';
import envelopeJson from '../../../../shared/schemas/save-record.v1.json';
import coreV1 from './schema/core.v1.schema.json';
import settingsV1 from './schema/settings.v1.schema.json';
import storyV1 from './schema/story.v1.schema.json';
import sandboxV1 from './schema/sandbox.v1.schema.json';
import tycoonV1 from '../../../../shared/schemas/tycoon/slice-1.schema.json';
import fighterV1 from '../../../../shared/schemas/fighter/slice-1.schema.json';
import vehicleInstanceV1 from '../../../../shared/schemas/racing/vehicle-instance.v1.schema.json';
import racingV1 from '../../../../shared/schemas/racing/racing-slice.schema.json';
import { validateSchema, type JsonSchema } from './validate.ts';

/** Schemas a slice schema may `$ref` by `$id`. The built-in validator has no `$ref`, so `inlineRefs` resolves them when the table below is built. */
const REF_REGISTRY: Readonly<Record<string, unknown>> = { [(vehicleInstanceV1 as { $id: string }).$id]: vehicleInstanceV1 };

/** A copy of `schema` with every `{ $ref }` node replaced by the registered schema (without its `$id` and `$schema`). Throws on an unknown ref. */
export function inlineRefs(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(inlineRefs);
  if (schema === null || typeof schema !== 'object') return schema;
  const o = schema as Record<string, unknown>;
  if (typeof o['$ref'] === 'string') {
    const target = REF_REGISTRY[o['$ref']] as Record<string, unknown> | undefined;
    if (!target) throw new Error(`unknown schema ref ${o['$ref']}`);
    const { $id: _id, $schema: _schema, ...rest } = target;
    return inlineRefs(rest);
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) out[k] = inlineRefs(o[k]);
  return out;
}

export const ENVELOPE_SCHEMA = envelopeJson as unknown as JsonSchema;

/** Slice schemas by kind and schema number. Mode slices and `mod:*` are validated as JSON objects only (until their owners add schemas). */
export const SLICE_SCHEMAS: Partial<Record<SliceKind, Record<number, JsonSchema>>> = {
  core: { 1: inlineRefs(coreV1) as JsonSchema },
  settings: { 1: settingsV1 as unknown as JsonSchema },
  story: { 1: storyV1 as unknown as JsonSchema },
  sandbox: { 1: sandboxV1 as unknown as JsonSchema },
  // M09a1: the tycoon slice schema is owned by the shared tycoon core (packages/shared/schemas/tycoon).
  tycoon: { 1: tycoonV1 as unknown as JsonSchema },
  // M08a2: the fighter slice schema is owned by the fighter mode (packages/shared/schemas/fighter).
  fighter: { 1: fighterV1 as unknown as JsonSchema },
  // M07a2: the racing slice (rep, purse, records, ghosts) is owned by the racing mode (packages/shared/schemas/racing).
  racing: { 1: racingV1 as unknown as JsonSchema },
};

/** The schema version this build writes for each kind. */
export const CURRENT_SCHEMA: Record<SliceKind, number> = {
  core: 1, settings: 1, story: 1, sandbox: 1, racing: 1, fighter: 1, tycoon: 1, mod: 1,
};

/** Validates slice data against the schema of (kind, schema). Null when valid or when the kind has no schema yet. */
export function validateSlice(kind: SliceKind, schema: number, data: unknown): string | null {
  const s = SLICE_SCHEMAS[kind]?.[schema];
  if (!s) return typeof data === 'object' && data !== null && !Array.isArray(data) ? null : `${kind}: data must be an object`;
  return validateSchema(s, data);
}

/** Validates a whole record envelope (C05 JSON Schema). */
export function validateEnvelope(rec: unknown): string | null {
  return validateSchema(ENVELOPE_SCHEMA, rec);
}
