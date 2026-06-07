module.exports = {
  extends: 'expo',
  rules: {
    // Warn on console.log in production code (use structured logging instead)
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
  overrides: [
    {
      // Supabase Edge Functions run on Deno, not Node.
      // They use HTTP-style imports (https://esm.sh/...) that ESLint's
      // Node resolver cannot resolve — suppress false-positive errors.
      // console.log is the correct logging mechanism in Deno/Edge Functions.
      files: ['supabase/functions/**/*.ts'],
      rules: {
        'import/no-unresolved': 'off',
        'no-console': 'off',
      },
    },
    {
      // Node.js backend/import scripts (both .js and .ts) — __dirname, setTimeout,
      // Buffer, URL, process are built-in Node globals ESLint's default env does
      // not know about. These run on a trusted machine via tsx/node, NOT in the
      // Expo app bundle, so app-only rules do not apply here.
      files: ['scripts/**/*.{ts,js}'],
      env: {
        node: true,
        es2020: true,
      },
      rules: {
        // console.log is the correct output mechanism for CLI scripts.
        'no-console': 'off',
        // expo/no-dynamic-env-var guards against EXPO_PUBLIC_* inlining in the
        // app bundle. Backend scripts read real secrets (service role, API keys)
        // from process.env, and TS's noPropertyAccessFromIndexSignature forces
        // bracket access — so this rule is both inapplicable and contradictory here.
        'expo/no-dynamic-env-var': 'off',
      },
    },
    {
      // Jest test files — describe, it, expect, beforeEach, jest, etc. are Jest globals.
      // Without this override ESLint reports them as undefined variables.
      files: [
        '**/__tests__/**/*.{ts,tsx,js}',
        '**/*.test.{ts,tsx,js}',
        '**/*.spec.{ts,tsx,js}',
      ],
      env: {
        jest: true,
      },
    },
  ],
};
