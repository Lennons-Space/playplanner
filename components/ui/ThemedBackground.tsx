/**
 * ThemedBackground — mount-point wrapper around the atmosphere layer (Step
 * 10A Part 2, dual-theme foundation; Phase A of the v2 Light-theme
 * correction).
 *
 * Phase A UPDATE: <V2Background/> is now mode-aware internally (it reads
 * `useAppTheme()` itself and resolves its base gradients/glows/motion colours
 * per mode — see components/ui/V2Background.tsx). Light mode is therefore no
 * longer a flat placeholder surface — it renders the real, weather-driven
 * atmosphere, same as dark. This component no longer needs to branch on mode
 * at all; it stays only as a thin re-export / stable mount point, since every
 * screen's call site already imports `ThemedBackground` rather than
 * `V2Background` directly, and Phase B work will continue to use it.
 */

import { V2Background, type V2BackgroundProps } from '@/components/ui/V2Background';

export type ThemedBackgroundProps = V2BackgroundProps;

export function ThemedBackground(props: ThemedBackgroundProps) {
  // V2Background resolves mode (useAppTheme) and atmosphere internally —
  // both dark and light render the real thing now, so this is a pure
  // pass-through kept for the stable import path at call sites.
  return <V2Background {...props} />;
}
