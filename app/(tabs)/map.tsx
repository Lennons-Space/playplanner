/**
 * Map tab (Play Planner v2).
 *
 * This is a thin re-export of the existing, fully-featured Explore/Map screen
 * (`app/explore/map.tsx`) so the "Map" tab works immediately with all
 * production logic intact — location consent gate, clustering, postcode
 * search, weather, viewport fetching, pin-tap and the selected-venue card.
 * NONE of that logic is touched by the v2 reskin in this pass.
 *
 * A future phase can rebuild this screen's *layout* to the v2 full-bleed map
 * design (glass search pill, filter chips, slide-up venue card) while
 * continuing to reuse that same logic. The `/explore/map` route is kept so
 * existing `router.push('/explore/map')` links (e.g. Home's "Your area" row)
 * keep resolving.
 */
export { default } from '../explore/map';
