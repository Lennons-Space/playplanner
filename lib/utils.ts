/**
 * Shared UI utilities used across multiple screens and components.
 * Extracted here to avoid duplicating logic between app/profile/[id].tsx
 * and components/reviews/ReviewCard.tsx.
 */

/**
 * Formats an ISO date string to "January 2024" style.
 * Returns '' if the value is missing or unparseable.
 */
export function formatMonthYear(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

/**
 * Returns the one or two initials to show in an avatar placeholder.
 * "Jane Smith" → "JS", "Jane" → "J".
 */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * Name-length-based avatar colour palette.
 * Cycles through colours using the display name's character length as the index.
 * This gives each user a consistent colour without any fingerprinting risk —
 * the index is derived from length, not from a user ID or hash.
 */
export const AVATAR_COLOURS = ['#A8E6CF', '#4ECDC4', '#FF8E8E', '#FFE66D', '#C3B1E1'];
