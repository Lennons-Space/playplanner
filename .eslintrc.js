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
      // Node.js import scripts — __dirname, setTimeout, Buffer, URL are built-in
      // globals in Node that ESLint's default env does not know about.
      files: ['scripts/**/*.js'],
      env: {
        node: true,
        es2020: true,
      },
      rules: {
        // console.log is the correct mechanism for CLI scripts
        'no-console': 'off',
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
