import { CLIENT_TELEMETRY_NAMES, TELEMETRY_LIMITS, type TelemetryBatch } from '@dv/shared';
import namesSchema from '@dv/shared/schemas/telemetry/names.schema.json' with { type: 'json' };
import { apiError } from '../errors.ts';
import { requestCountry } from '../geo.ts';
import { scrub } from '../scrub.ts';
import type { Ctx } from '../router.ts';

type Scalar = string | number | boolean;

interface PropSpec {
  type?: 'string' | 'number' | 'integer' | 'boolean';
  enum?: readonly Scalar[];
  maxLength?: number;
}
interface NameSpec {
  properties: Record<string, PropSpec>;
  required: readonly string[];
  additionalProperties: boolean;
}

const NAME_SPECS = namesSchema.$defs as unknown as Record<string, NameSpec>;
const CLIENT_NAMES: ReadonlySet<string> = new Set(CLIENT_TELEMETRY_NAMES);

const TIERS = ['desktop-ultra', 'desktop', 'mobile', 'mobile-low', 'xr-quest', 'xr-visionpro'];
const DEVICE_CLASSES = ['desktop', 'iphone', 'ipad', 'android', 'quest', 'avp', 'unknown'];
const DISPLAY_MODES = ['standalone', 'tab', 'xr'];
const BACKENDS = ['webgpu', 'webgl2'];

const MAX_BLOBS = 20;
const MAX_DOUBLES = 20;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validEnvelope(env: unknown): env is TelemetryBatch['env'] {
  return (
    isRecord(env) &&
    TIERS.includes(env['tier'] as string) &&
    DEVICE_CLASSES.includes(env['deviceClass'] as string) &&
    Number.isInteger(env['osMajor']) &&
    (env['osMajor'] as number) >= 0 &&
    (env['osMajor'] as number) <= 999 &&
    DISPLAY_MODES.includes(env['displayMode'] as string) &&
    BACKENDS.includes(env['backend'] as string)
  );
}

function propMatches(spec: PropSpec, value: unknown): value is Scalar {
  if (spec.enum) return spec.enum.includes(value as Scalar);
  switch (spec.type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return false;
  }
}

/** Returns the scrubbed props in schema order, or null when the event does not match its per-name schema. */
function cleanProps(name: string, props: unknown): Record<string, Scalar> | null {
  const spec = NAME_SPECS[name];
  if (!spec || !isRecord(props)) return null;
  const keys = Object.keys(props);
  if (keys.length > TELEMETRY_LIMITS.maxPropKeys) return null;
  for (const key of keys) if (!spec.properties[key] && !spec.additionalProperties) return null;
  for (const key of spec.required) if (!(key in props)) return null;
  const out: Record<string, Scalar> = {};
  for (const [key, propSpec] of Object.entries(spec.properties)) {
    if (!(key in props)) continue;
    const value = props[key];
    if (!propMatches(propSpec, value)) return null;
    if (typeof value === 'string') {
      const limit = Math.min(propSpec.maxLength ?? TELEMETRY_LIMITS.maxStringChars, TELEMETRY_LIMITS.maxStringChars);
      out[key] = scrub(value).slice(0, limit);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export async function handleTelemetry(ctx: Ctx): Promise<Response> {
  const { request, env, requestId } = ctx;

  const contentType = request.headers.get('Content-Type') ?? '';
  if (!/^application\/json\s*(;|$)/i.test(contentType)) {
    return apiError('unsupported_media_type', 'Content-Type must be application/json.', requestId);
  }
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > TELEMETRY_LIMITS.maxBodyBytes) {
    return apiError('payload_too_large', 'Telemetry body exceeds 64 KiB.', requestId);
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > TELEMETRY_LIMITS.maxBodyBytes) {
    return apiError('payload_too_large', 'Telemetry body exceeds 64 KiB.', requestId);
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return apiError('bad_request', 'Body is not valid JSON.', requestId);
  }
  if (
    !isRecord(body) ||
    body['v'] !== 1 ||
    typeof body['build'] !== 'string' ||
    body['build'].length === 0 ||
    body['build'].length > 64 ||
    !Number.isInteger(body['seq0']) ||
    (body['seq0'] as number) < 0 ||
    !validEnvelope(body['env']) ||
    !Array.isArray(body['events'])
  ) {
    return apiError('bad_request', 'Body is not a valid TelemetryBatch.', requestId);
  }
  if (body['events'].length > TELEMETRY_LIMITS.maxEvents) {
    return apiError('payload_too_large', 'A batch holds at most 50 events.', requestId);
  }

  const envelope = body['env'];
  const build = scrub(body['build']).slice(0, 64);
  const country = requestCountry(request) ?? '';
  let dropped = 0;
  let written = 0;

  for (const raw of body['events'] as unknown[]) {
    if (written >= TELEMETRY_LIMITS.maxPointsPerInvocation) {
      dropped += 1;
      continue;
    }
    if (
      !isRecord(raw) ||
      typeof raw['name'] !== 'string' ||
      !CLIENT_NAMES.has(raw['name']) ||
      typeof raw['ts'] !== 'number' ||
      !Number.isFinite(raw['ts']) ||
      typeof raw['sessionId'] !== 'string' ||
      raw['sessionId'].length === 0 ||
      raw['sessionId'].length > 64
    ) {
      dropped += 1;
      continue;
    }
    const props = cleanProps(raw['name'], raw['props']);
    if (!props) {
      dropped += 1;
      continue;
    }
    const spec = NAME_SPECS[raw['name']]!;
    const blobs: string[] = [envelope.tier, envelope.deviceClass, envelope.displayMode, envelope.backend, build, country, scrub(raw['sessionId']).slice(0, 64)];
    const doubles: number[] = [envelope.osMajor, raw['ts']];
    for (const key of Object.keys(spec.properties)) {
      const value = props[key];
      if (value === undefined) continue;
      if (typeof value === 'string') blobs.push(value);
      else doubles.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
    }
    env.AE?.writeDataPoint({
      indexes: [raw['name']],
      blobs: blobs.slice(0, MAX_BLOBS),
      doubles: doubles.slice(0, MAX_DOUBLES),
    });
    written += 1;
  }

  // Telemetry is never on the player's critical path: always 204, even when AE is not bound.
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store', 'X-DV-Dropped': String(dropped) } });
}
