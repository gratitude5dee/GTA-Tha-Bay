/**
 * The fal program cap split into spending lines (M10d0, DL-741). The values come from `config/guardrails.yaml` (`genai.lines`) through the
 * generated constant; they sum to the program cap. The spike plan, its ledger and `genai:spike --verify` read `spike` here; the characters,
 * cutscenes and vehiclesProps lines are read by their pipelines (M10a1, M05c4, M10d1). Money is integer USD micros.
 */
import { GENAI_GUARDRAILS } from './guardrails.generated.ts';

export type GenaiLine = keyof typeof GENAI_GUARDRAILS.lines;

export const GENAI_LINES = ['spike', 'characters', 'cutscenes', 'vehiclesProps', 'buffer'] as const satisfies readonly GenaiLine[];

/** The cap of one line in USD micros. */
export function lineCapMicros(line: GenaiLine): number {
  return GENAI_GUARDRAILS.lines[line];
}

/** The sum of every line, equal to `GENAI_GUARDRAILS.programCapUsdMicros`. */
export function linesTotalMicros(): number {
  return GENAI_LINES.reduce((a, l) => a + GENAI_GUARDRAILS.lines[l], 0);
}
