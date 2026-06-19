/* eslint-env node */
// app.config.js — dynamic Expo config.
//
// PURPOSE: inject the Android Google Maps API key from an environment variable.
// The static app.json kept the literal placeholder "$(GOOGLE_MAPS_API_KEY_ANDROID)",
// which Expo does NOT substitute, so every build shipped an invalid Maps key in the
// AndroidManifest and the basemap rendered blank (no tiles, no markers). This config
// preserves ALL of app.json (received as `config`) and only overrides the Android
// Maps key with the real value from process.env.
//
// WHERE THE KEY COMES FROM:
//   - EAS builds: an EAS environment variable for development / preview / production
//     (the build server sets EAS_BUILD=true and injects these into process.env).
//   - local `expo start` / `expo config`: the project .env, if present.
//
// FAIL-CLEAR POLICY: in a build/CI context the key is REQUIRED — we throw so a build
// can never ship a blank map. Locally we only warn and keep the app.json value, so
// `expo start` is not blocked (the installed dev/preview/production APK already has
// the real key baked into its manifest from its own EAS build). The key is a
// client-restricted Maps key and is NEVER logged or printed here.

module.exports = ({ config }) => {
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY_ANDROID;
  const isBuildContext =
    process.env.EAS_BUILD === 'true' || process.env.CI === 'true';

  if (!googleMapsApiKey && isBuildContext) {
    throw new Error(
      'GOOGLE_MAPS_API_KEY_ANDROID is not set for this build. It must be provided as ' +
        'an EAS environment variable (development/preview/production). Aborting so the ' +
        'build cannot ship with a blank Google map.',
    );
  }

  if (!googleMapsApiKey) {
    // eslint-disable-next-line no-console
    console.warn(
      '[app.config] GOOGLE_MAPS_API_KEY_ANDROID not set in this local environment; ' +
        'keeping the app.json value for local config resolution only. Installed builds ' +
        'bake the real key from their EAS environment.',
    );
  }

  const existingGoogleMaps =
    (config.android && config.android.config && config.android.config.googleMaps) || {};

  return {
    ...config,
    android: {
      ...config.android,
      config: {
        ...(config.android && config.android.config),
        googleMaps: {
          ...existingGoogleMaps,
          // Inject the real key when available; otherwise preserve the existing
          // app.json value for local-only resolution.
          apiKey: googleMapsApiKey || existingGoogleMaps.apiKey,
        },
      },
    },
  };
};
