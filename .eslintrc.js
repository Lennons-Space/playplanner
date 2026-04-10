module.exports = {
  extends: 'expo',
  rules: {
    // Warn on console.log in production code (use structured logging instead)
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
};
