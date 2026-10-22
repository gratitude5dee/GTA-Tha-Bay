import type { SliceKind } from '@dv/shared';
import envelopeJson from '../../../../shared/schemas/save-record.v1.json';
import coreV1 from './schema/core.v1.schema.json';
import settingsV1 from './schema/settings.v1.schema.json';
import storyV1 from './schema/story.v1.schema.json';
import sandboxV1 from './schema/sandbox.v1.schema.json';
import tycoonV1 from '../../../../shared/schemas/tycoon/slice-1.schema.json';
import { validateSchema, type JsonSchema } from './validate.ts';

export const ENVELOPE_SCHEMA = envelopeJson as unknown as JsonSchema;

/** Slice schemas by kind and schema number. Mode slices and `mod:*` are validated as JSON objects only (until their owners add schemas). */
export const SLICE_SCHEMAS: Partial<Record<SliceKind, Record<number, JsonSchema>>> = {
  core: { 1: coreV1 as unknown as JsonSchema },
  settings: { 1: settingsV1 as unknown as JsonSchema },
  story: { 1: storyV1 as unknown as JsonSchema },
  sandbox: { 1: sandboxV1 as unknown as JsonSchema },
  // M09a1: the tycoon slice schema is owned by the shared tycoon core (packages/shared/schemas/tycoon).
  tycoon: { 1: tycoonV1 as unknown as JsonSchema },
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
