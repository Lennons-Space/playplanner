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
  ],
};
