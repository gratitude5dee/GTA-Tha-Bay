/**
 * Build-time ink compilation (inkjs, MIT). The runtime loads compiled JSON only (M06a3), so the compiler stays in tools.
 */
import { Compiler, CompilerOptions } from 'inkjs/full';

export const REQUIRED_KNOTS = ['greeting', 'smalltalk', 'busy', 'deflect', 'farewell'] as const;

export interface InkResult {
  /** Compiled story JSON, or null when compilation failed. */
  json: string | null;
  errors: string[];
  warnings: string[];
  /** Top-level knot names. */
  knots: string[];
}

export function compileInk(source: string): InkResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const opts = new CompilerOptions(null, [], false, (message: string, type: number) => {
    // ErrorType: 0 author, 1 warning, 2 error
    (type === 2 ? errors : warnings).push(message.trim());
  }, null);
  try {
    const story = new Compiler(source, opts).Compile();
    if (errors.length) return { json: null, errors, warnings, knots: [] };
    const named = (story as unknown as { mainContentContainer: { namedContent: Map<string, unknown> } }).mainContentContainer.namedContent;
    return { json: story.ToJson() ?? null, errors, warnings, knots: [...named.keys()] };
  } catch (e) {
    errors.push((e as Error).message.split('\n')[0] ?? 'ink compile failed');
    return { json: null, errors, warnings, knots: [] };
  }
}

export function missingKnots(knots: readonly string[]): string[] {
  return REQUIRED_KNOTS.filter((k) => !knots.includes(k));
}

/** Structural check of a compiled ink JSON document (the data/ink.<id> asset). */
export function inkJsonProblems(json: string): string[] {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    return ['not valid JSON'];
  }
  const o = doc as { inkVersion?: unknown; root?: unknown };
  const out: string[] = [];
  if (typeof o.inkVersion !== 'number') out.push('inkVersion is not a number');
  if (!Array.isArray(o.root)) out.push('root is not an array');
  else {
    const named = o.root[o.root.length - 1] as Record<string, unknown> | null;
    const keys = named && typeof named === 'object' && !Array.isArray(named) ? Object.keys(named) : [];
    for (const k of missingKnots(keys)) out.push(`knot ${k} is not defined`);
  }
  return out;
}
