/**
 * Stack layout for all profile sub-screens.
 *
 * Screens under app/profile/ (edit, privacy-settings, data-download, etc.)
 * are pushed on top of the main tab navigator as a modal-style stack.
 *
 * v2 dark restyle (Step 5, feat/exact-v2-design): `headerShown: false` here
 * — every screen renders its own in-app <V2Header/> (or, for edit/children-ages/
 * my-reviews/my-venues/data-download, previously relied on this Stack's
 * native header for back+title). Two problems forced this:
 *
 *   1. This Stack used to hard-code the pre-v2 coral palette
 *      (`headerStyle:{backgroundColor:'#FF6B6B'}`) — that bled the legacy
 *      light/coral/teal design into every pushed screen even after the
 *      screen body itself went dark.
 *   2. notifications.tsx and privacy-settings.tsx had NO
 *      `<Stack.Screen options={{title:...}}>` at all, so Expo Router fell
 *      back to rendering the literal route filename ("notifications",
 *      "privacy-settings") as a SECOND native header stacked above each
 *      screen's own custom header.
 *
 * Rather than restyle the native header AND patch the two missing titles
 * (leaving a mix of native-chrome and custom-chrome screens), every screen
 * now owns exactly one deliberate header — the same "fully custom chrome"
 * pattern already used by Venue Detail and Map. This is a visual/structural
 * change only; no route names, params or navigation behaviour changed.
 */
import { Stack } from 'expo-router';

export default function ProfileLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Each profile child screen mounts its own <V2Background/> behind a
        // transparent root (same per-screen pattern as Home / Venue Detail /
        // Map). This transparent contentStyle just stops the nested Stack's
        // default opaque scene fill from covering that per-screen mount.
        contentStyle: { backgroundColor: 'transparent' },
      }}
    />
  );
}
