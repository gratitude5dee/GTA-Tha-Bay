/**
 * A small JSON Schema (2020-12 subset) validator for the save schemas. The Workers and browser CSPs forbid code
 * generation from strings, so Ajv's compile cannot run here (spec/03 section 7, DL-694); the test suite cross-checks
 * this interpreter against Ajv on the same schemas.
 *
 * Supported keywords: type (name or list), enum, const, properties, required, additionalProperties (boolean or schema),
 * items, minItems, maxItems, minLength, maxLength, pattern, minimum, maximum, anyOf. Anything else is ignored.
 */
export interface JsonSchema {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  anyOf?: JsonSchema[];
  [k: string]: unknown;
}

function typeOk(t: string, v: unknown): boolean {
  switch (t) {
    case 'object': return typeof v === 'object' && v !== null && !Array.isArray(v);
    case 'array': return Array.isArray(v);
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'integer': return typeof v === 'number' && Number.isInteger(v);
    case 'boolean': return typeof v === 'boolean';
    case 'null': return v === null;
    default: return false;
  }
}

const deepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const regexCache = new Map<string, RegExp>();
function regex(p: string): RegExp {
  let r = regexCache.get(p);
  if (!r) {
    r = new RegExp(p, 'u');
    regexCache.set(p, r);
  }
  return r;
}

/** First violation as `path: message`, or null when the value is valid. */
export function validateSchema(schema: JsonSchema, value: unknown, path = '$'): string | null {
  if (schema.anyOf) {
    let last: string | null = null;
    for (const s of schema.anyOf) {
      const r = validateSchema(s, value, path);
      if (r === null) return null;
      last = r;
    }
    return last ?? `${path}: matches no anyOf branch`;
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeOk(t, value))) return `${path}: expected ${types.join('|')}`;
  }
  if (schema.const !== undefined && !deepEqual(schema.const, value)) return `${path}: expected const ${JSON.stringify(schema.const)}`;
  if (schema.enum && !schema.enum.some((e) => deepEqual(e, value))) return `${path}: not in enum`;
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return `${path}: below minimum ${schema.minimum}`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${path}: above maximum ${schema.maximum}`;
  }
  if (typeof value === 'string') {
    const len = [...value].length;
    if (schema.minLength !== undefined && len < schema.minLength) return `${path}: shorter than ${schema.minLength}`;
    if (schema.maxLength !== undefined && len > schema.maxLength) return `${path}: longer than ${schema.maxLength}`;
    if (schema.pattern !== undefined && !regex(schema.pattern).test(value)) return `${path}: does not match ${schema.pattern}`;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return `${path}: fewer than ${schema.minItems} items`;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${path}: more than ${schema.maxItems} items`;
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        const r = validateSchema(schema.items, value[i], `${path}[${i}]`);
        if (r !== null) return r;
      }
    }
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const k of schema.required ?? []) if (!(k in obj)) return `${path}: missing "${k}"`;
    const props = schema.properties ?? {};
    for (const k of Object.keys(obj)) {
      const sub = props[k];
      if (sub) {
        const r = validateSchema(sub, obj[k], `${path}.${k}`);
        if (r !== null) return r;
      } else if (schema.additionalProperties === false) {
        return `${path}: unexpected "${k}"`;
      } else if (typeof schema.additionalProperties === 'object') {
        const r = validateSchema(schema.additionalProperties, obj[k], `${path}.${k}`);
        if (r !== null) return r;
      }
    }
  }
  return null;
}
