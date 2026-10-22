// Types for determinism.mjs (imported by TypeScript tests; the ESLint config imports the .mjs directly).
import type { Linter } from 'eslint';

export const SIM_FILES: string[];
export const SIM_IGNORES: string[];
export const TRANSCENDENTALS: string[];
export const DOM_GLOBALS: string[];
export const BANNED_PROPERTIES: { object?: string; property: string; message: string }[];
export const BANNED_GLOBALS: { name: string; message: string }[];
export const SIM_SYNTAX: { selector: string; message: string }[];
export const GLSL_SYNTAX: { selector: string; message: string }[];
export const MAP_SDK_IMPORT_PATTERN: { group: string[]; message: string };
export const MAPLIBRE_IMPORT_PATTERN: { group: string[]; message: string };
export const SIM_IMPORT_PATTERNS: { group: string[]; message: string }[];
export function determinismConfig(files?: string[], ignores?: string[]): Linter.Config;
