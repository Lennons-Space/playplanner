// ─────────────────────────────────────────────────────────────────
// components/ui/index.ts — barrel export for all shared UI primitives
//
// Import from this file, not from individual component paths:
//   import { Icon, VenueCard, Chip } from '@/components/ui';
//
// Adding a new component? Export it here too so it's discoverable.
// ─────────────────────────────────────────────────────────────────

// Phase 0 (pre-existing)
export { Skeleton, VenueRowSkeleton } from './SkeletonLoader';

// Phase 1 — design system foundation
export { Icon } from './Icon';
export type { IconName, IconProps } from './Icon';

export { Stars } from './Stars';
export { Chip } from './Chip';
export { CategoryPlaceholder } from './CategoryPlaceholder';
export { VenueCard } from './VenueCard';
export type { VenueCardProps } from './VenueCard';
export { VenueMini } from './VenueMini';
export type { VenueMiniProps } from './VenueMini';
export { ScreenTitle } from './ScreenTitle';
export { IconBtn } from './IconBtn';
