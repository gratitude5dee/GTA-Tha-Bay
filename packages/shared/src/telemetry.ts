// C16 1.1 — telemetry event contract.
// Copied from spec/domains/09-backend-contracts.md section 3 and 09-backend-contracts-1.1.md section 4.
import type { DeviceClass, QualityTierId } from './platform/c13.ts';

export const C16_VERSION = '1.1.0' as const;

/** Names clients may send. Anything else is dropped at ingest. */
export const CLIENT_TELEMETRY_NAMES = [
  'app.start', 'app.ready', 'app.abnormal_exit', 'app.cold_resume', 'app.hidden',
  'perf.minute',
  'err.js', 'err.promise', 'err.gpu', 'err.asset',
  'net.ws', 'net.api',
  'mode.enter', 'mode.exit', 'mission.start', 'mission.fail', 'mission.complete',
  'cutscene.play', 'npc.turn.client',
  'xr.session', 'settings.tier_override', 'tier.decision', 'storage.persist', 'pose.calibrate', 'err.sim',
  // 1.1 additions (client part)
  'world.stream', 'unlock.emit',
  'npc.encounter.client', 'npc.voice.client', 'npc.builder.step',
  'racing.start', 'racing.finish', 'racing.pursuit_end', 'racing.photo', 'racing.replay_view',
  'fight.end', 'pose.session',
  'tycoon.run_end', 'tycoon.round', 'tycoon.negotiation',
  'ui.page', 'ui.onboard', 'pwa.install',
  'mod.install', 'mod.uninstall', 'mod.fault', 'mod.session', 'exp.enter', 'exp.exit',
] as const;

/** Written by Workers and Durable Objects only; never accepted from clients. */
export const SERVER_ONLY_TELEMETRY_NAMES = [
  'genai.cost', 'quota.block', 'genjob.state', 'room.tick', 'room.hours', 'budget.level', 'recon.drift',
  'auth.event', 'mod.case',
  'racing.verify_fail',
] as const;

export type ClientTelemetryName = (typeof CLIENT_TELEMETRY_NAMES)[number];
export type ServerTelemetryName = (typeof SERVER_ONLY_TELEMETRY_NAMES)[number];
export type TelemetryName = ClientTelemetryName | ServerTelemetryName;

export interface TelemetryEvent {
  name: TelemetryName;
  /** Client epoch ms. */
  ts: number;
  /** One random UUID per app launch; never the profile id. */
  sessionId: string;
  /** At most 16 keys; strings at most 128 chars. */
  props: Record<string, string | number | boolean>;
}

export interface TelemetryEnvelope {
  tier: QualityTierId;
  deviceClass: DeviceClass;
  osMajor: number;
  displayMode: 'standalone' | 'tab' | 'xr';
  backend: 'webgpu' | 'webgl2';
}

export interface TelemetryBatch {
  v: 1;
  build: string;
  /** Sequence number of events[0] within the session (dedupe). */
  seq0: number;
  env: TelemetryEnvelope;
  /** At most 50 events; body at most 64 KiB. */
  events: TelemetryEvent[];
}

export const TELEMETRY_LIMITS = {
  maxBodyBytes: 64 * 1024,
  maxEvents: 50,
  maxPropKeys: 16,
  maxStringChars: 128,
  maxPointsPerInvocation: 250,
} as const;
