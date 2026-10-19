/**
 * Typed wrappers over the generated Ajv standalone validators (validators.gen.ts, `pnpm npc:schemas`).
 * Nothing here compiles a schema at runtime.
 */
import * as gen from './validators.gen.ts';

export interface SchemaIssue {
  /** JSON pointer of the failing value, '' for the root. */
  path: string;
  keyword: string;
  message: string;
  /** Pointer into the schema, for example '#/allOf/6/then/properties/likeness/properties/basis/const'. */
  schemaPath: string;
}

interface AjvError { instancePath: string; keyword: string; message?: string; schemaPath: string }
type AjvFn = ((data: unknown) => boolean) & { errors?: AjvError[] | null };

function run(fn: AjvFn, data: unknown): SchemaIssue[] {
  if (fn(data)) return [];
  return (fn.errors ?? []).map((e) => ({ path: e.instancePath, keyword: e.keyword, message: e.message ?? 'invalid', schemaPath: e.schemaPath }));
}

const fns = gen as unknown as Record<string, AjvFn>;
const make = (name: string) => (data: unknown): SchemaIssue[] => run(fns[name] as AjvFn, data);

export const validateSoul = make('validateSoulFrontmatter');
export const validateRoster = make('validateRosterManifest');
export const validateRosterBundle = make('validateRosterBundle');
export const validateNpcTurn = make('validateNpcTurn');
export const validateNpcIntent = make('validateNpcIntent');
export const validateNpcSummary = make('validateNpcSummary');
export const validateDialogueRequest = make('validateDialogueRequest');
export const validateVoiceCatalog = make('validateVoiceCatalog');
export const validateBarkPool = make('validateBarkPool');

export const formatIssue = (i: SchemaIssue): string => `${i.path === '' ? '/' : i.path} ${i.message}`;
