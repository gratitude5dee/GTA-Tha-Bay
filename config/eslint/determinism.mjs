// C02 determinism rules (spec/domains/01-engine-contracts.md, "Determinism rules" 1) as ESLint flat-config pieces.
// The root eslint.config.js applies them to SIM_FILES; packages/engine/test/lint.bans.spec.ts applies the same
// rules to the fixtures in packages/engine/test/fixtures/banned/. Plain .mjs so both can import it without a loader.

// Sim code scope. sim/save/** is async IO outside ticks and is exempt (C02 rule 1).
export const SIM_FILES = [
  'packages/shared/src/**/*.{ts,tsx}',
  'packages/engine/src/sim/**/*.{ts,tsx}',
  'packages/modes/*/src/sim/**/*.{ts,tsx}',
];
export const SIM_IGNORES = ['packages/engine/src/sim/save/**'];

export const TRANSCENDENTALS = [
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh',
  'exp', 'expm1', 'log', 'log1p', 'log2', 'log10', 'pow', 'cbrt', 'hypot', 'sqrt', 'random',
];

export const BANNED_PROPERTIES = [
  ...TRANSCENDENTALS.map((property) => ({
    object: 'Math',
    property,
    message: `Math.${property} is not allowed in sim code (C02): use detmath or the seeded RNG.`,
  })),
  { object: 'performance', property: 'now', message: 'performance.now is not allowed in sim code (C02).' },
  { object: 'crypto', property: 'getRandomValues', message: 'crypto.getRandomValues is not allowed in sim code (C02).' },
  { property: 'toLocaleString', message: 'toLocaleString is not allowed in sim code (C02).' },
];

export const DOM_GLOBALS = [
  'window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'self',
  'requestAnimationFrame', 'cancelAnimationFrame', 'HTMLElement', 'HTMLCanvasElement', 'Element',
  'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'PointerEvent', 'TouchEvent', 'OffscreenCanvas',
  'CanvasRenderingContext2D', 'WebGL2RenderingContext', 'AudioContext', 'XMLHttpRequest',
];

export const BANNED_GLOBALS = [
  { name: 'Date', message: 'Date is not allowed in sim code (C02): time comes from the tick counter.' },
  { name: 'Intl', message: 'Intl is not allowed in sim code (C02).' },
  { name: 'setTimeout', message: 'Timers are not allowed in sim code (C02).' },
  { name: 'setInterval', message: 'Timers are not allowed in sim code (C02).' },
  { name: 'performance', message: 'performance is not allowed in sim code (C02).' },
  ...DOM_GLOBALS.map((name) => ({ name, message: `DOM global ${name} is not allowed in sim code (C02).` })),
];

export const SIM_SYNTAX = [
  { selector: "BinaryExpression[operator='**']", message: 'The ** operator is not allowed in sim code (C02).' },
  { selector: "AssignmentExpression[operator='**=']", message: 'The **= operator is not allowed in sim code (C02).' },
  { selector: 'ForInStatement', message: 'for...in is not allowed in sim code (C02): iteration order must be explicit.' },
  // C01 rule 4: every sort passes a total comparator (default sort is by string and ignores ties).
  {
    selector: "CallExpression[callee.property.name=/^(sort|toSorted)$/][arguments.length=0]",
    message: 'sort() without a comparator is not allowed in sim code (C01 rule 4): pass a total comparator.',
  },
];

// P-03: TSL materials only, no GLSL anywhere under packages/**.
export const GLSL_SYNTAX = [
  { selector: "Identifier[name='ShaderMaterial']", message: 'ShaderMaterial is not allowed: use TSL node materials (P-03).' },
  { selector: "Identifier[name='RawShaderMaterial']", message: 'RawShaderMaterial is not allowed: use TSL node materials (P-03).' },
  { selector: "Identifier[name='onBeforeCompile']", message: 'onBeforeCompile is not allowed: use TSL node materials (P-03).' },
  { selector: "TaggedTemplateExpression[tag.name='glsl']", message: 'glsl templates are not allowed: use TSL (P-03).' },
];

// third_party/ files are copied (ported with a header), never imported (ADR-REUSE-01, M00f). Merged into every
// no-restricted-imports entry, because a later matching flat-config object replaces the rule's options.
export const THIRD_PARTY_IMPORT_PATTERN = {
  group: ['**/third_party/**'],
  message: 'third_party/ is never imported: port the file with its attribution header (ADR-REUSE-01).',
};

export const SIM_IMPORT_PATTERNS = [
  THIRD_PARTY_IMPORT_PATTERN,
  { group: ['three', 'three/*'], message: 'three is not allowed in sim code (C02).' },
  { group: ['@dv/ui', '@dv/ui/*'], message: 'Sim code never imports the UI.' },
];

/** The rule block for sim code. `files`/`ignores` pick where it applies. */
export function determinismConfig(files = SIM_FILES, ignores = SIM_IGNORES) {
  return {
    files,
    ignores,
    rules: {
      'no-restricted-properties': ['error', ...BANNED_PROPERTIES],
      'no-restricted-globals': ['error', ...BANNED_GLOBALS],
      'no-restricted-syntax': ['error', ...SIM_SYNTAX, ...GLSL_SYNTAX],
      'no-restricted-imports': ['error', { patterns: SIM_IMPORT_PATTERNS }],
    },
  };
}
