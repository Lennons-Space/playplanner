// =============================================================================
// scripts/enrich/__tests__/osmExtract.test.ts
//
// Tests for the pure OSM tag extractor: extractRawFacts(tags) -> RawFacts.
//
// WHY these tests matter:
//   The enrichment pipeline runs against thousands of venues. A wrong inference
//   (e.g. marking every untagged venue as "no toilets") poisons scores for the
//   entire dataset and silently misleads parents using the app's filters. These
//   tests are the only thing stopping a one-line regression from causing
//   widespread incorrect filtering for families.
//
// No mocks needed — extractRawFacts is a pure function with no side effects.
// No '@/' path aliases — this file runs outside the Expo app bundle.
// =============================================================================

import { extractRawFacts } from '../osmExtract';

// Tiny helper to make tag objects more readable in test bodies.
// Not strictly necessary, but makes the intent clear at a glance.
const tags = (t: Record<string, string>) => t;

// =============================================================================
// describe: indoor_outdoor derivation
// =============================================================================
// These tests lock in the classification precedence rules. The order in the
// source code matters: MIXED_TOURISM is checked before INDOOR_TOURISM, so zoo
// and theme_park return 'mixed' not 'indoor'. Any reordering breaks the filter.

describe('extractRawFacts — indoor_outdoor', () => {
  // Without this: a change to the indoor= branch could stop marking explicit
  // indoor venues as indoor, breaking the rainy-day filter for all such venues.
  it('returns "indoor" when indoor=yes is set', () => {
    expect(extractRawFacts(tags({ indoor: 'yes' })).indoor_outdoor).toBe('indoor');
  });

  // Without this: indoor=no might fall through to null instead of 'outdoor',
  // so an explicitly open-air venue is shown in indoor-only searches.
  it('returns "outdoor" when indoor=no is set', () => {
    expect(extractRawFacts(tags({ indoor: 'no' })).indoor_outdoor).toBe('outdoor');
  });

  // Without this: playgrounds could stop being classified as outdoor, so they
  // appear in rainy-day results and parents take children to a wet playground.
  it('returns "outdoor" for leisure=playground', () => {
    expect(extractRawFacts(tags({ leisure: 'playground' })).indoor_outdoor).toBe('outdoor');
  });

  // Without this: parks could be classified as indoor (if OUTDOOR_LEISURE set
  // is accidentally cleared), hiding them from outdoor filters.
  it('returns "outdoor" for leisure=park', () => {
    expect(extractRawFacts(tags({ leisure: 'park' })).indoor_outdoor).toBe('outdoor');
  });

  // Without this: museums could lose their indoor tag if INDOOR_TOURISM
  // changes, removing them from rainy-day recommendations.
  it('returns "indoor" for tourism=museum', () => {
    expect(extractRawFacts(tags({ tourism: 'museum' })).indoor_outdoor).toBe('indoor');
  });

  // Without this: galleries could be classified as outdoor or null, breaking
  // their use as a rainy-day venue recommendation.
  it('returns "indoor" for tourism=gallery', () => {
    expect(extractRawFacts(tags({ tourism: 'gallery' })).indoor_outdoor).toBe('indoor');
  });

  // Critical: theme_park is in BOTH MIXED_TOURISM and INDOOR_TOURISM. Without
  // this test, a reordering could return 'indoor' instead of 'mixed', hiding
  // theme parks from outdoor searches and misleading parents about the venue.
  it('returns "mixed" for tourism=theme_park (MIXED_TOURISM checked before INDOOR_TOURISM)', () => {
    expect(extractRawFacts(tags({ tourism: 'theme_park' })).indoor_outdoor).toBe('mixed');
  });

  // Same as above for zoo — it has indoor enclosures and outdoor areas, so
  // 'mixed' is the correct classification, not 'indoor'.
  it('returns "mixed" for tourism=zoo', () => {
    expect(extractRawFacts(tags({ tourism: 'zoo' })).indoor_outdoor).toBe('mixed');
  });

  // Without this: farms might silently become 'indoor' instead of 'mixed',
  // which would make them appear only in rainy-day results, not outdoor ones.
  it('returns "mixed" for tourism=farm', () => {
    expect(extractRawFacts(tags({ tourism: 'farm' })).indoor_outdoor).toBe('mixed');
  });

  // Without this: the building= weak fallback could be deleted, meaning venues
  // tagged only with building=yes (e.g. a village hall) never get indoor status.
  it('returns "indoor" for building=yes alone (last-resort weak signal)', () => {
    expect(extractRawFacts(tags({ building: 'yes' })).indoor_outdoor).toBe('indoor');
  });

  // Without this: building=no could be treated the same as building=yes and
  // return 'indoor', classifying demolished or non-existent buildings as indoor.
  it('returns null for building=no (explicit non-building should not be called indoor)', () => {
    expect(extractRawFacts(tags({ building: 'no' })).indoor_outdoor).toBeNull();
  });

  // Without this: a venue with no relevant tags could get a non-null value
  // from a future default, corrupting filter results for unassessed venues.
  it('returns null when no relevant tags are present (do not guess)', () => {
    expect(extractRawFacts(tags({ name: 'Mystery Place' })).indoor_outdoor).toBeNull();
  });

  // Without this: amenity=library (a valid indoor-signal amenity) could be
  // removed from the explicit list and libraries would lose their indoor tag.
  it('returns "indoor" for amenity=library', () => {
    expect(extractRawFacts(tags({ amenity: 'library' })).indoor_outdoor).toBe('indoor');
  });
});

// =============================================================================
// describe: museum — all three derived fields together
// =============================================================================
// We test all three fields in one describe so a reader can see the complete
// expected output for this common venue type in a single glance.

describe('extractRawFacts — tourism=museum (all derived fields)', () => {
  // Pre-compute once so the three sub-tests share the same call.
  const facts = extractRawFacts(tags({ tourism: 'museum' }));

  // Without this: a museum might lose indoor status if INDOOR_TOURISM changes.
  it('indoor_outdoor is "indoor"', () => {
    expect(facts.indoor_outdoor).toBe('indoor');
  });

  // Without this: a museum might be tagged as high-activity, putting it in
  // the "burn energy" category instead of the quiet learning category.
  it('activity_level is "low"', () => {
    expect(facts.activity_level).toBe('low');
  });

  // Without this: a museum could lose its 90-minute duration hint, causing
  // it to miss the "half_day" recommended_for tag in intelligence scoring.
  it('visit_duration_mins is 90', () => {
    expect(facts.visit_duration_mins).toBe(90);
  });
});

// =============================================================================
// describe: theme_park — all three derived fields together
// =============================================================================

describe('extractRawFacts — tourism=theme_park (all derived fields)', () => {
  const facts = extractRawFacts(tags({ tourism: 'theme_park' }));

  // Without this: theme park could be classified as indoor, hiding it from
  // parents filtering for outdoor venues.
  it('indoor_outdoor is "mixed"', () => {
    expect(facts.indoor_outdoor).toBe('mixed');
  });

  // Without this: theme park could become 'low' or 'high' instead of 'medium',
  // miscategorising its activity level in active-play scoring.
  it('activity_level is "medium"', () => {
    expect(facts.activity_level).toBe('medium');
  });

  // Without this: a 6-hour theme park day could lose its duration hint, causing
  // it to miss the "full_day" recommended_for tag.
  it('visit_duration_mins is 360', () => {
    expect(facts.visit_duration_mins).toBe(360);
  });
});

// =============================================================================
// describe: toilets_available
// =============================================================================

describe('extractRawFacts — toilets_available', () => {
  // Without this: venues with toilets=yes would stop earning the 25-point
  // parent convenience contribution, silently downranking them.
  it('returns true for toilets=yes', () => {
    expect(extractRawFacts(tags({ toilets: 'yes' })).toilets_available).toBe(true);
  });

  // Without this: dedicated toilet nodes in OSM (tagged amenity=toilets)
  // would be invisible to the extractor.
  it('returns true for amenity=toilets', () => {
    expect(extractRawFacts(tags({ amenity: 'toilets' })).toilets_available).toBe(true);
  });

  // Without this: toilets=no might be treated as null, so explicitly toilet-free
  // venues can never be filtered out by parents who need them.
  it('returns false for toilets=no (confirmed absence)', () => {
    expect(extractRawFacts(tags({ toilets: 'no' })).toilets_available).toBe(false);
  });

  // Most important: absence of a toilets tag does NOT mean no toilets. Most OSM
  // surveyors omit the tag. Without this, thousands of venues would be scored as
  // if they have no toilets, incorrectly penalising convenience scores.
  it('returns null when toilets tag is absent (absence is not "no toilets")', () => {
    expect(extractRawFacts(tags({ name: 'Untagged Venue' })).toilets_available).toBeNull();
  });
});

// =============================================================================
// describe: baby_change_available
// =============================================================================

describe('extractRawFacts — baby_change_available', () => {
  // Without this: the primary changing_table= key would not be recognised and
  // no venue would ever earn baby-change credit.
  it('returns true for changing_table=yes', () => {
    expect(extractRawFacts(tags({ changing_table: 'yes' })).baby_change_available).toBe(true);
  });

  // Without this: changing_table=no might fall through to null, hiding
  // confirmed absence from parents who need a changing table.
  it('returns false for changing_table=no (confirmed absence)', () => {
    expect(extractRawFacts(tags({ changing_table: 'no' })).baby_change_available).toBe(false);
  });

  // The toilets:changing_table= key is used by a significant portion of OSM
  // mappers. Without this test, that secondary key would be ignored and parents
  // looking for nappy changing would miss valid venues.
  it('returns true for toilets:changing_table=yes (secondary key)', () => {
    expect(
      extractRawFacts(tags({ 'toilets:changing_table': 'yes' })).baby_change_available,
    ).toBe(true);
  });

  // Without this: toilets:changing_table=no might not produce false, so
  // confirmed-absent via the secondary key goes unrecorded.
  it('returns false for toilets:changing_table=no (secondary key — confirmed absence)', () => {
    expect(
      extractRawFacts(tags({ 'toilets:changing_table': 'no' })).baby_change_available,
    ).toBe(false);
  });

  // Without this: absence of both keys could silently default to false,
  // penalising venues that simply were not surveyed for baby-change facilities.
  it('returns null when no changing_table tag is present', () => {
    expect(extractRawFacts(tags({ name: 'Untagged Venue' })).baby_change_available).toBeNull();
  });
});

// =============================================================================
// describe: wheelchair_accessible
// =============================================================================

describe('extractRawFacts — wheelchair_accessible', () => {
  // Without this: wheelchair=yes would not produce 'yes', so fully accessible
  // venues would disappear from accessibility filter results.
  it('returns "yes" for wheelchair=yes', () => {
    expect(extractRawFacts(tags({ wheelchair: 'yes' })).wheelchair_accessible).toBe('yes');
  });

  // Without this: wheelchair=limited might map to 'yes' or null, giving parents
  // a false impression of full accessibility at a venue that is only partially
  // accessible — a safety concern for wheelchair users.
  it('returns "limited" for wheelchair=limited', () => {
    expect(extractRawFacts(tags({ wheelchair: 'limited' })).wheelchair_accessible).toBe('limited');
  });

  // Without this: wheelchair=no might fall into the default null branch, hiding
  // confirmed inaccessibility from parents who need this to plan safely.
  it('returns "no" for wheelchair=no (confirmed inaccessible)', () => {
    expect(extractRawFacts(tags({ wheelchair: 'no' })).wheelchair_accessible).toBe('no');
  });

  // Without this: absence of a wheelchair tag could default to 'no', incorrectly
  // classifying the majority of unsurveyed venues as inaccessible.
  it('returns null when no wheelchair tag is present', () => {
    expect(extractRawFacts(tags({ name: 'Unsurveyed' })).wheelchair_accessible).toBeNull();
  });
});

// =============================================================================
// describe: cafe_available
// =============================================================================

describe('extractRawFacts — cafe_available', () => {
  // Without this: amenity=cafe stops contributing, so café venues score 0 for
  // on-site food even though they are literally a café.
  it('returns true for amenity=cafe', () => {
    expect(extractRawFacts(tags({ amenity: 'cafe' })).cafe_available).toBe(true);
  });

  // Without this: a restaurant inside a venue (common in museums, zoos) would
  // not register as food-available.
  it('returns true for amenity=restaurant', () => {
    expect(extractRawFacts(tags({ amenity: 'restaurant' })).cafe_available).toBe(true);
  });

  // Without this: fast food (common in theme parks, leisure centres) would not
  // contribute to the cafe score.
  it('returns true for amenity=fast_food', () => {
    expect(extractRawFacts(tags({ amenity: 'fast_food' })).cafe_available).toBe(true);
  });

  // Without this: absence of a food tag might become false, penalising the
  // majority of venues that have food but were not tagged for it in OSM.
  it('returns null when no food-related tag is present', () => {
    expect(extractRawFacts(tags({ name: 'Park' })).cafe_available).toBeNull();
  });
});

// =============================================================================
// describe: parking_available
// =============================================================================

describe('extractRawFacts — parking_available', () => {
  // Without this: a surface car park adjacent to a venue (a common OSM pattern)
  // would not count as parking being available.
  it('returns true for parking=surface', () => {
    expect(extractRawFacts(tags({ parking: 'surface' })).parking_available).toBe(true);
  });

  // Without this: parking=yes (the simplest affirmative value) would not
  // be recognised.
  it('returns true for parking=yes', () => {
    expect(extractRawFacts(tags({ parking: 'yes' })).parking_available).toBe(true);
  });

  // Without this: parking=no might be treated as null, so a venue with
  // confirmed no parking appears to have unknown parking status.
  it('returns false for parking=no (confirmed absence)', () => {
    expect(extractRawFacts(tags({ parking: 'no' })).parking_available).toBe(false);
  });

  // Without this: absent parking tags might silently default to false,
  // penalising the vast majority of venues where the surveyor omitted
  // the parking tag (the common case, not the exception).
  it('returns null when no parking tag is present', () => {
    expect(extractRawFacts(tags({ name: 'Venue' })).parking_available).toBeNull();
  });
});

// =============================================================================
// describe: all nullable fields are null when only name is provided
// =============================================================================
// This is the most important semantic rule in the whole enrichment system.
// NULL means "not assessed". If any field silently defaults to false it would
// incorrectly penalise thousands of venues that simply lack OSM coverage.
// Without this block, a single-field regression could corrupt the entire dataset.

describe('extractRawFacts — absent tags produce null, never false', () => {
  const facts = extractRawFacts(tags({ name: 'Test' }));

  it('parking_available is null, not false', () => {
    expect(facts.parking_available).toBeNull();
  });

  it('cafe_available is null, not false', () => {
    expect(facts.cafe_available).toBeNull();
  });

  it('toilets_available is null, not false', () => {
    expect(facts.toilets_available).toBeNull();
  });

  it('baby_change_available is null, not false', () => {
    expect(facts.baby_change_available).toBeNull();
  });

  it('wheelchair_accessible is null, not the string "no"', () => {
    expect(facts.wheelchair_accessible).toBeNull();
  });

  it('indoor_outdoor is null, not any string value', () => {
    expect(facts.indoor_outdoor).toBeNull();
  });

  it('visit_duration_mins is null, not 0', () => {
    expect(facts.visit_duration_mins).toBeNull();
  });

  it('activity_level is null, not "low"', () => {
    expect(facts.activity_level).toBeNull();
  });
});

// =============================================================================
// describe: visit_duration_mins derivation
// =============================================================================

describe('extractRawFacts — visit_duration_mins', () => {
  // Without this: a zoo could lose its 240-minute hint, causing it to miss
  // the "full_day" recommended_for tag and appear as a short visit in the app.
  it('returns 240 for tourism=zoo', () => {
    expect(extractRawFacts(tags({ tourism: 'zoo' })).visit_duration_mins).toBe(240);
  });

  // Without this: parks could lose their 120-minute estimate, causing them
  // to miss the "half_day" tag in recommended_for computation.
  it('returns 120 for leisure=park', () => {
    expect(extractRawFacts(tags({ leisure: 'park' })).visit_duration_mins).toBe(120);
  });

  // Without this: a venue type with no duration hint (e.g. a generic amenity)
  // might return 0 or undefined instead of null, breaking downstream null checks.
  it('returns null for a venue type with no duration estimate', () => {
    expect(extractRawFacts(tags({ amenity: 'bank' })).visit_duration_mins).toBeNull();
  });

  // This is the tourism > leisure priority rule. Without this test, a zoo tagged
  // as both tourism=zoo and leisure=park could use the park duration (120) instead
  // of the zoo duration (240), cutting the expected visit length in half.
  it('prefers tourism duration hint over leisure when both tags are present', () => {
    const facts = extractRawFacts(tags({ tourism: 'zoo', leisure: 'park' }));
    // zoo=240 must win over park=120
    expect(facts.visit_duration_mins).toBe(240);
  });
});

// =============================================================================
// describe: leisure=trampoline_park — all derived fields
// =============================================================================
// Trampoline parks were previously unclassified (all nulls) because the tag
// was missing from INDOOR_LEISURE, HIGH_ACTIVITY, and DURATION_HINTS.
// These tests lock in the correct behaviour after the fix.

describe('extractRawFacts — leisure=trampoline_park (all derived fields)', () => {
  const facts = extractRawFacts(tags({ leisure: 'trampoline_park', name: 'Jump Zone' }));

  // Without this: trampoline parks appear in outdoor/sunny-day results and miss
  // the rainy-day filter entirely — parents visit a trampoline park expecting
  // indoor shelter only to find the score suggested outdoor.
  it('indoor_outdoor is "indoor" (trampoline parks are enclosed buildings)', () => {
    expect(facts.indoor_outdoor).toBe('indoor');
  });

  // Without this: trampoline parks score 0 for active_play and never earn the
  // burn_energy recommended_for tag, hiding them from the "burn some energy" filter.
  it('activity_level is "high" (jumping is high-intensity physical activity)', () => {
    expect(facts.activity_level).toBe('high');
  });

  // Without this: trampoline parks have null duration and miss the half_day tag,
  // so parents planning a 90-minute session see no recommended duration signal.
  it('visit_duration_mins is 90 (typical family session length)', () => {
    expect(facts.visit_duration_mins).toBe(90);
  });
});

// =============================================================================
// describe: leisure=indoor_play — all derived fields
// =============================================================================
// Soft-play centres in OSM commonly use leisure=indoor_play. Without this fix
// they were unclassified (all nulls), so they missed burn_energy and indoor tags
// and appeared as unknown venues in filters designed for family soft-play.

describe('extractRawFacts — leisure=indoor_play (all derived fields)', () => {
  const facts = extractRawFacts(tags({ leisure: 'indoor_play', name: 'Pip-Squeeks Play Centre' }));

  // Without this: soft-play centres appear in outdoor results or get no
  // indoor_outdoor classification at all, so the rainy-day filter misses them.
  it('indoor_outdoor is "indoor" (soft-play centres are enclosed buildings)', () => {
    expect(facts.indoor_outdoor).toBe('indoor');
  });

  // Without this: soft-play centres score 0 for active_play and never earn the
  // burn_energy tag — the primary reason parents search for soft-play.
  it('activity_level is "high" (soft-play is high-energy children\'s activity)', () => {
    expect(facts.activity_level).toBe('high');
  });

  // Without this: soft-play centres have null duration and miss the half_day tag.
  // A 60-minute session is the standard drop-in slot at most UK soft-play centres.
  it('visit_duration_mins is 60 (standard soft-play session length)', () => {
    expect(facts.visit_duration_mins).toBe(60);
  });
});

// =============================================================================
// describe: outdoor sports clubs — sport= tag overrides sports_centre 'indoor'
// =============================================================================
// Cricket clubs, rugby grounds, and football clubs all use leisure=sports_centre
// for their clubhouse. Without this fix they were classified as 'indoor', which
// put them in rainy-day filters and hid them from sunny-day/outdoor results.

describe('extractRawFacts — outdoor sports clubs classified as mixed, not indoor', () => {
  // Without this: a cricket club appears in rainy-day results and is hidden from
  // sunny outdoor searches — the opposite of what parents expect.
  it('returns "mixed" for leisure=sports_centre + sport=cricket', () => {
    expect(
      extractRawFacts(tags({ leisure: 'sports_centre', sport: 'cricket' })).indoor_outdoor,
    ).toBe('mixed');
  });

  // Without this: a rugby club is classified as indoor, hiding it from the
  // outdoor filter used by parents looking for active outdoor activities.
  it('returns "mixed" for leisure=sports_centre + sport=rugby_union', () => {
    expect(
      extractRawFacts(tags({ leisure: 'sports_centre', sport: 'rugby_union' })).indoor_outdoor,
    ).toBe('mixed');
  });

  // Without this: a football club (the most common leisure venue type in the UK)
  // is incorrectly classified as indoor, corrupting the outdoor filter at scale.
  it('returns "mixed" for leisure=sports_centre + sport=football', () => {
    expect(
      extractRawFacts(tags({ leisure: 'sports_centre', sport: 'football' })).indoor_outdoor,
    ).toBe('mixed');
  });

  // Without this: golf courses could be wrongly classified as indoor if a mapper
  // adds a sports_centre tag to the clubhouse element.
  it('returns "mixed" for leisure=sports_centre + sport=golf', () => {
    expect(
      extractRawFacts(tags({ leisure: 'sports_centre', sport: 'golf' })).indoor_outdoor,
    ).toBe('mixed');
  });

  // Edge case: a sports_centre with no sport tag still returns 'indoor'. The fix
  // only activates when an outdoor sport is explicitly named — do not over-apply.
  it('returns "indoor" for leisure=sports_centre with no sport tag (no override)', () => {
    expect(
      extractRawFacts(tags({ leisure: 'sports_centre' })).indoor_outdoor,
    ).toBe('indoor');
  });

  // Guard: explicit indoor=yes must always win, even if an outdoor sport is named.
  // A mapper who adds indoor=yes is making a deliberate claim about the venue.
  it('returns "indoor" when indoor=yes is set even if sport=cricket (explicit tag wins)', () => {
    expect(
      extractRawFacts(tags({ indoor: 'yes', leisure: 'sports_centre', sport: 'cricket' })).indoor_outdoor,
    ).toBe('indoor');
  });
});

// =============================================================================
// describe: activity_level derivation
// =============================================================================

describe('extractRawFacts — activity_level', () => {
  // Without this: sports centres would not be classified as high-activity,
  // hiding them from the "burn energy" filter.
  it('returns "high" for leisure=sports_centre', () => {
    expect(extractRawFacts(tags({ leisure: 'sports_centre' })).activity_level).toBe('high');
  });

  // Without this: any sport= tag (e.g. sport=football, sport=tennis) would
  // not trigger high-activity classification, so sports fields never appear
  // in active-play results regardless of what sport is played there.
  it('returns "high" for any sport= tag (broad signal for physical activity)', () => {
    expect(extractRawFacts(tags({ sport: 'football' })).activity_level).toBe('high');
  });

  // Without this: aquariums could gain high-activity status (e.g. if LOW_ACTIVITY
  // set is accidentally cleared), putting them in "burn energy" results.
  it('returns "low" for tourism=aquarium', () => {
    expect(extractRawFacts(tags({ tourism: 'aquarium' })).activity_level).toBe('low');
  });

  // Without this: playgrounds (high-energy children's venues) could lose their
  // high-activity classification.
  it('returns "high" for leisure=playground', () => {
    expect(extractRawFacts(tags({ leisure: 'playground' })).activity_level).toBe('high');
  });

  // Without this: trampoline parks score 0 for active_play — they are clearly
  // high-intensity venues and must appear in burn-energy results.
  it('returns "high" for leisure=trampoline_park', () => {
    expect(extractRawFacts(tags({ leisure: 'trampoline_park' })).activity_level).toBe('high');
  });

  // Without this: a venue with no activity signal might return undefined or a
  // default value instead of null, breaking null checks in the scorer.
  it('returns null when no activity signal is present', () => {
    expect(extractRawFacts(tags({ name: 'Unclassified' })).activity_level).toBeNull();
  });

  // Without this: zoo's medium activity level could be overridden by some other
  // classification, making it appear either high or low on the active-play scale.
  it('returns "medium" for tourism=zoo (walking around, not sustained exertion)', () => {
    expect(extractRawFacts(tags({ tourism: 'zoo' })).activity_level).toBe('medium');
  });
});
