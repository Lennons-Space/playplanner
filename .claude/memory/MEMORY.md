# Shared Project Memory

This file is the index for shared memory across all Claude accounts working on this project.
Each entry links to a memory file with more detail.

**Important:** Always read this file at the start of a session. Always update it when progress is made.

---

## Developer Profile
- [Developer Profile](user_profile.md) — First-time developer; use plain language and step-by-step guides

## Project Progress
- [Project Progress](project_progress.md) — Tech stack decisions, what's built, what's still to do, session log

## Profile Screen Plan (2026-04-12)
- [Profile Architecture](profile_architecture.md) — routes, data model, build phases, security findings

## Venue Photos Architecture (2026-04-13)
- Phase 2 design complete. Key decisions:
  - venue_photos table ALREADY EXISTS in migration 001 (is_approved bool, no status enum). Migration 007 ALTERS this table: adds `status` enum column (pending/approved/rejected), drops `is_approved`, adds `moderation_notes` and `moderated_by`. Also creates `venue-photos` storage bucket.
  - VenuePhoto type in types/index.ts must be updated: replace `is_approved: boolean` with `status: 'pending'|'approved'|'rejected'`, add `moderation_notes: string | null`, `moderated_by: string | null`.
  - useVenue hook in hooks/useVenues.ts must update its photo filter from `is_approved === true` to `status === 'approved'`.
  - EXIF stripping: use expo-image-manipulator (already a sub-dependency via expo-image-picker) to re-encode images before upload — this strips metadata including GPS.
  - Storage bucket name: `venue-photos` (hyphenated, not underscore — Supabase convention).
  - Storage path: `{venue_id}/{uuid}.jpg` — no user ID in path (GDPR data minimisation).
  - Upload flow: pick → strip EXIF → compress to JPEG → upload to storage → insert DB row (status=pending).
  - Moderation tab added to existing app/admin/moderation.tsx (tab switcher pattern).
  - Cover photo in venue detail: wire existing TODO comment at line 109 of app/venue/[id].tsx.

## Review Flow Architecture (2026-04-13)
All three core files are already built and wired together:
- `components/reviews/ReviewForm.tsx` — complete (star selector, title, body, visit date, privacy disclosure, submit with moderation_status=pending)
- `components/reviews/ReviewCard.tsx` — complete (respects show_reviews_publicly, initials avatar, pending badge, helpful count)
- `app/venue/[id]/review.tsx` — route screen, auth gate, duplicate gate (useMyReview), renders ReviewForm
- `app/venue/[id].tsx` — wired (useVenueReviews, ReviewCard list, "Write a review" navigates to /venue/[id]/review)
- `hooks/useReviews.ts` — complete (useVenueReviews, useMyReview, useSubmitReview, usePublicProfileReviews)

Key constraints already enforced:
- RLS: only approved reviews visible to non-owners (DB policy + client filter in useVenueReviews)
- One review per user per venue: DB unique(venue_id, user_id) + 23505 error translated to friendly message + useMyReview UI gate
- Own-venue check NOT yet in UI (venue.user_id check missing from review.tsx — see open risk below)
- Body max=1000 chars in form (task spec says 500 — MISMATCH to resolve before build)
- visit_date is optional; children_ages stubbed as [] (not collected yet)
- Privacy disclosure on form (GDPR Art.13)
- No sensitive data logged

Outstanding gaps to build next:
1. Own-venue prevention: add `venue.claimed_by !== user.id` check in app/venue/[id]/review.tsx
2. BODY_MAX discrepancy: form uses 1000, task spec says 500 — confirm with product owner
3. Tests: no tests yet for ReviewForm, ReviewCard, or the review route screen
4. secom-reviewer agent review (mandatory after build)
5. "Comment optional" in spec vs "body required" in form — confirm intended behaviour

## Agents
Three custom agents created (2026-04-09) — files at `C:\Users\Liame\.claude-work\agents\`:
- `Ui-agent` — screen wireframes, user flows, ICO-compliant UX design
- `Main-coder` — architecture, folder structure, data flows, security-first planning
- `secom-reviewer` — post-change code review: security, GDPR/ICO, completeness, performance
Each agent has bootstrapped memory at `C:\Users\Liame\.claude-work\agent-memory\<agent-name>\`

## Moderation approve silent-failure fix (2026-04-16)
Root cause: `supabase.update(...).eq('id', id)` without a chained `.select()`
uses `Prefer: return=minimal`, so PostgREST returns 204 No Content even when
RLS filtered the write down to zero rows. The venue/review stays `pending`,
no error is thrown, and the admin sees nothing happen ("approve is broken").

Fixes landed:
- `app/admin/moderation.tsx` moderateVenue + bulkApprove now chain `.select('id')`,
  throw a clear error when zero rows come back, log code/message/hint only
  (never the row — privacy), and invalidate `['venues']` so the public map
  refreshes immediately on approve. Bulk approve now reports the exact count.
- `hooks/useReviews.ts` useModerateReview — same `.select('id')` pattern,
  same zero-row guard, also invalidates `['myReview']` so the reviewer sees
  the rejection note (GDPR Art.13) immediately.
- Pending reviews query switched the join hint from
  `public_profiles!reviews_user_id_fkey` to `profiles!reviews_user_id_fkey`.
  The FK actually targets `profiles`; using the view hint was silently dropping
  reviewers whose `show_in_search = false` (default). Only username/full_name
  selected — no sensitive columns leak.
- Reviews tab now renders an error state instead of a false "all caught up"
  when the query fails. All 342 tests pass, type-check clean.
