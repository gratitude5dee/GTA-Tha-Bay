// ESLint flat config. The C02 determinism rules (01-engine-contracts.md, "Determinism rules" 1) apply to
// sim source only; tests, scripts and fixtures are outside the scope. no-glsl-in-engine applies to packages/**.
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

// Sim code scope. sim/save/** is async IO outside ticks and is exempt (C02 rule 1).
export const SIM_FILES = [
  'packages/shared/src/**/*.{ts,tsx}',
  'packages/engine/src/sim/**/*.{ts,tsx}',
  'packages/modes/*/src/sim/**/*.{ts,tsx}',
];
export const SIM_IGNORES = ['packages/engine/src/sim/save/**'];

const TRANSCENDENTALS = [
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh',
  'exp', 'expm1', 'log', 'log1p', 'log2', 'log10', 'pow', 'cbrt', 'hypot', 'sqrt', 'random',
];

const BANNED_PROPERTIES = [
  ...TRANSCENDENTALS.map((property) => ({
    object: 'Math',
    property,
    message: `Math.${property} is not allowed in sim code (C02): use detmath or the seeded RNG.`,
  })),
  { object: 'performance', property: 'now', message: 'performance.now is not allowed in sim code (C02).' },
  { object: 'crypto', property: 'getRandomValues', message: 'crypto.getRandomValues is not allowed in sim code (C02).' },
  { property: 'toLocaleString', message: 'toLocaleString is not allowed in sim code (C02).' },
];

const DOM_GLOBALS = [
  'window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'self',
  'requestAnimationFrame', 'cancelAnimationFrame', 'HTMLElement', 'HTMLCanvasElement', 'Element',
  'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'PointerEvent', 'TouchEvent', 'OffscreenCanvas',
  'CanvasRenderingContext2D', 'WebGL2RenderingContext', 'AudioContext', 'XMLHttpRequest',
];

const BANNED_GLOBALS = [
  { name: 'Date', message: 'Date is not allowed in sim code (C02): time comes from the tick counter.' },
  { name: 'Intl', message: 'Intl is not allowed in sim code (C02).' },
  { name: 'setTimeout', message: 'Timers are not allowed in sim code (C02).' },
  { name: 'setInterval', message: 'Timers are not allowed in sim code (C02).' },
  { name: 'performance', message: 'performance is not allowed in sim code (C02).' },
  ...DOM_GLOBALS.map((name) => ({ name, message: `DOM global ${name} is not allowed in sim code (C02).` })),
];

const SIM_SYNTAX = [
  { selector: "BinaryExpression[operator='**']", message: 'The ** operator is not allowed in sim code (C02).' },
  { selector: "AssignmentExpression[operator='**=']", message: 'The **= operator is not allowed in sim code (C02).' },
  { selector: 'ForInStatement', message: 'for...in is not allowed in sim code (C02): iteration order must be explicit.' },
];

// P-03: TSL materials only, no GLSL anywhere under packages/**.
const GLSL_SYNTAX = [
  { selector: "Identifier[name='ShaderMaterial']", message: 'ShaderMaterial is not allowed: use TSL node materials (P-03).' },
  { selector: "Identifier[name='RawShaderMaterial']", message: 'RawShaderMaterial is not allowed: use TSL node materials (P-03).' },
  { selector: "Identifier[name='onBeforeCompile']", message: 'onBeforeCompile is not allowed: use TSL node materials (P-03).' },
  { selector: "TaggedTemplateExpression[tag.name='glsl']", message: 'glsl templates are not allowed: use TSL (P-03).' },
];

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/.wrangler/**',
    'test-results/**',
    'playwright-report/**',
    '.spike/**',
    '.claude/**',
    'spec/**',
    'research/**',
    'prompt-pack/**',
    'docs/**',
    'apps/web/public/**',
  ]),
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    files: ['packages/**/*.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', ...GLSL_SYNTAX] },
  },
  {
    files: SIM_FILES,
    ignores: SIM_IGNORES,
    rules: {
      'no-restricted-properties': ['error', ...BANNED_PROPERTIES],
      'no-restricted-globals': ['error', ...BANNED_GLOBALS],
      'no-restricted-syntax': ['error', ...SIM_SYNTAX, ...GLSL_SYNTAX],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['three', 'three/*'], message: 'three is not allowed in sim code (C02).' },
            { group: ['@dv/ui', '@dv/ui/*'], message: 'Sim code never imports the UI.' },
          ],
        },
      ],
    },
  },
]);
