// =============================================================================
// scripts/enrich/__tests__/intelligence.test.ts
//
// Tests for the pure intelligence scoring functions and computeIntelligence.
//
// WHY these tests matter:
//   These scorers determine which venues parents see when they filter by
//   "rainy day", "burn energy", "accessible", etc. A bug in the scoring
//   formula silently hides suitable venues from families or surfaces
//   unsuitable ones. Each test targets a specific rule that, if broken,
//   produces wrong filter results in the live app.
//
// No mocks needed — all functions are pure with no side effects or I/O.
// No '@/' path aliases — this file runs outside the Expo app bundle.
// =============================================================================

import {
  scoreParentConvenience,
  scoreRainyDay,
  scoreActivePlay,
  scoreLearning,
  scoreBudget,
  scoreAccessibility,
  computeRecommendedFor,
  computeIntelligence,
  type VenueForScoring,
} from '../intelligence';
import type { RawFacts, IntelligenceScores } from '../../../types/enrichment';

// =============================================================================
// Test helpers
// =============================================================================

/**
 * Returns a RawFacts object where every field is null.
 * Represents a venue that has been assessed but has no positive signals.
 * Using this as a base prevents tests from accidentally inheriting a truthy
 * value from a previous test's facts object.
 */
function nullFacts(): RawFacts {
  return {
    indoor_outdoor:        null,
    parking_available:     null,
    cafe_available:        null,
    toilets_available:     null,
    baby_change_available: null,
    wheelchair_accessible: null,
    visit_duration_mins:   null,
    activity_level:        null,
  };
}

/**
 * Returns a minimal VenueForScoring with safe defaults.
 * Default max_age is 12 (child-specific → earns +15 in scoreLearning).
 * Default min_age is 0 (toddler-friendly → earns 'toddler_friendly' tag).
 * Tests that want to isolate a specific field should override these.
 */
function venue(over: Partial<VenueForScoring> = {}): VenueForScoring {
  return {
    id:          'test-id',
    name:        'Test Venue',
    osm_id:      'node/123',
    data_source: 'osm',
    price_range: null,
    min_age:     0,
    max_age:     12,
    is_verified: false,
    description: null,
    category:    null,
    ...over,
  };
}

/**
 * Returns an IntelligenceScores object where every score is 0.
 * Useful for testing computeRecommendedFor in isolation without any
 * score-based tags being triggered.
 */
function zeroScores(): IntelligenceScores {
  return {
    parent_convenience_score: 0,
    rainy_day_score:          0,
    active_play_score:        0,
    learning_score:           0,
    budget_score:             0,
    accessibility_score:      0,
  };
}

// =============================================================================
// describe: scoreParentConvenience
// =============================================================================
// Scores how practical a venue is for parents. Toilets, baby change, parking,
// café, and wheelchair access each contribute a fixed number of points.
// Point values: toilets=25, baby=20, parking=20, café=20, wheelchair_yes=15.

describe('scoreParentConvenience', () => {
  // Without this: the scorer might give a non-zero base score, causing every
  // venue to appear more convenient than it is, even with no amenities.
  it('returns 0 when all facts are null', () => {
    expect(scoreParentConvenience(nullFacts()).score).toBe(0);
  });

  // Without this: toilets might not earn 25 points, silently downranking
  // venues that have one of the most important family amenities.
  // We also check the breakdown key so an audit can reconstruct the score.
  it('toilets_available=true adds exactly 25 points (verified in breakdown too)', () => {
    const result = scoreParentConvenience({ ...nullFacts(), toilets_available: true });
    expect(result.score).toBe(25);
    expect(result.breakdown['toilets_available']).toBe(25);
  });

  // Without this: baby change (20) and parking (20) could lose their points
  // independently without the failure being noticed in an end-to-end test.
  it('baby_change_available=true + parking_available=true → 40 (20 + 20)', () => {
    const result = scoreParentConvenience({
      ...nullFacts(),
      baby_change_available: true,
      parking_available:     true,
    });
    expect(result.score).toBe(40);
  });

  // Without this: the maximum possible score could silently become more than
  // 100 if a new amenity is added without adjusting existing point values.
  it('all five amenities present → exactly 100 (25 + 20 + 20 + 20 + 15)', () => {
    const result = scoreParentConvenience({
      ...nullFacts(),
      toilets_available:     true,   // +25
      baby_change_available: true,   // +20
      parking_available:     true,   // +20
      cafe_available:        true,   // +20
      wheelchair_accessible: 'yes',  // +15
    });
    expect(result.score).toBe(100);
  });

  // Without this: wheelchair=limited could incorrectly earn 15 (full credit)
  // instead of 8 (partial credit), overstating accessibility for partially
  // accessible venues and misleading wheelchair users.
  it('wheelchair_accessible=limited adds 8 (partial credit, not 15)', () => {
    const result = scoreParentConvenience({ ...nullFacts(), wheelchair_accessible: 'limited' });
    expect(result.score).toBe(8);
  });

  // Without this: the clamp function could be removed and scores could exceed
  // 100, producing nonsensical percentages in UI or downstream comparisons.
  it('score is always clamped to a maximum of 100', () => {
    const result = scoreParentConvenience({
      ...nullFacts(),
      toilets_available:     true,
      baby_change_available: true,
      parking_available:     true,
      cafe_available:        true,
      wheelchair_accessible: 'yes',
    });
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

// =============================================================================
// describe: scoreRainyDay
// =============================================================================
// Scores how suitable a venue is when the weather is bad.
// Point values: indoor=50, mixed=25, café=20, toilets=15, baby_change=10,
// duration>=90mins=5.

describe('scoreRainyDay', () => {
  // Without this: a venue with no indoor signal might not score zero, causing
  // outdoor venues to appear in rainy-day recommendations.
  it('returns 0 when all facts are null', () => {
    expect(scoreRainyDay(nullFacts()).score).toBe(0);
  });

  // Without this: the primary rainy-day signal (indoor) could lose its 50-point
  // contribution, halving the maximum possible score and pushing all venues
  // below the 65-point threshold for the 'rainy_day' tag.
  it('indoor_outdoor=indoor contributes 50 points', () => {
    expect(scoreRainyDay({ ...nullFacts(), indoor_outdoor: 'indoor' }).score).toBe(50);
  });

  // Without this: a mixed venue (like a zoo or theme park with indoor areas)
  // could score either 0 or 50, both of which would be wrong.
  it('indoor_outdoor=mixed contributes 25 points (half credit)', () => {
    expect(scoreRainyDay({ ...nullFacts(), indoor_outdoor: 'mixed' }).score).toBe(25);
  });

  // Without this: the combination of the three most common rainy-day signals
  // (indoor + café + toilets) could break without being caught by individual tests.
  it('indoor + cafe + toilets → 85 (50 + 20 + 15)', () => {
    expect(
      scoreRainyDay({
        ...nullFacts(),
        indoor_outdoor:    'indoor',
        cafe_available:    true,
        toilets_available: true,
      }).score,
    ).toBe(85);
  });

  // Without this: the duration bonus could be deleted or the threshold could
  // change from 90 to 60, and venues with only a moderate stay duration would
  // incorrectly gain or lose the +5 rainy-day bonus.
  it('visit_duration_mins=90 adds exactly +5 (long-stay bonus)', () => {
    const withDuration    = scoreRainyDay({ ...nullFacts(), visit_duration_mins: 90 });
    const withoutDuration = scoreRainyDay(nullFacts());
    expect(withDuration.score - withoutDuration.score).toBe(5);
  });

  // Without this: the threshold for the duration bonus could accidentally be
  // lowered to 60, incorrectly awarding +5 to short-stay venues like galleries.
  it('visit_duration_mins=60 does NOT add +5 (threshold is >= 90)', () => {
    expect(scoreRainyDay({ ...nullFacts(), visit_duration_mins: 60 }).score).toBe(0);
  });

  // Without this: stacking all signals could produce a score above 100,
  // making comparison with the 65-point threshold meaningless.
  it('score is always clamped to a maximum of 100', () => {
    const result = scoreRainyDay({
      ...nullFacts(),
      indoor_outdoor:        'indoor',
      cafe_available:        true,
      toilets_available:     true,
      baby_change_available: true,
      visit_duration_mins:   120,
    });
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

// =============================================================================
// describe: scoreActivePlay
// =============================================================================
// Scores how much physical activity children can get at a venue.
//
// Cap rule: activity_level=high (+40) and active category slug (+35) are
// capped at 55 combined. This prevents double-counting when both signals
// agree on the same venue type (e.g. a soft-play centre with a playground tag).
//
// Additional bonuses: duration>=60mins (+15), outdoor (+10).

describe('scoreActivePlay', () => {
  // Without this: a venue with no physical activity signals could earn a
  // non-zero score, polluting "burn energy" results with passive venues.
  it('returns 0 when all facts are null and no category is set', () => {
    expect(scoreActivePlay(nullFacts(), venue()).score).toBe(0);
  });

  // Without this: activity_level=high from OSM (e.g. a sports centre) could
  // stop earning the 40-point contribution, removing it from active-play filters.
  it('activity_level=high alone → 40 points', () => {
    expect(
      scoreActivePlay({ ...nullFacts(), activity_level: 'high' }, venue()).score,
    ).toBe(40);
  });

  // Without this: an active category slug (e.g. soft-play) without an OSM
  // activity tag could stop earning the 35-point contribution, hiding soft-play
  // centres from "burn energy" search results.
  it('active category slug (soft-play) alone → 35 points', () => {
    expect(
      scoreActivePlay(nullFacts(), venue({ category: { slug: 'soft-play' } })).score,
    ).toBe(35);
  });

  // Critical: this is the double-counting cap. Without this test, a regression
  // that removes the cap would give soft-play centres with both signals a score
  // of 75 (40+35), allowing them to consume the full duration and outdoor bonus
  // and still end up at 100, which over-counts the contribution of a single type
  // of evidence (the venue category). The cap at 55 is intentional.
  it('activity_level=high + active category slug → capped at 55, not 75 (40 + 35)', () => {
    const result = scoreActivePlay(
      { ...nullFacts(), activity_level: 'high' },
      venue({ category: { slug: 'soft-play' } }),
    );
    expect(result.score).toBe(55);
  });

  // Without this: the duration bonus (+15 for >= 60 mins) could be lost,
  // so venues with long activity durations would score the same as quick visits.
  it('activity_level=high + visit_duration_mins=60 → 55 (40 + 15)', () => {
    expect(
      scoreActivePlay(
        { ...nullFacts(), activity_level: 'high', visit_duration_mins: 60 },
        venue(),
      ).score,
    ).toBe(55);
  });

  // Without this: the outdoor bonus could be deleted, so parks and sports fields
  // lose their 10-point bonus and score the same as indoor venues of the same type.
  it('indoor_outdoor=outdoor adds exactly +10 to the score', () => {
    const outdoor = scoreActivePlay({ ...nullFacts(), indoor_outdoor: 'outdoor' }, venue());
    const neutral = scoreActivePlay(nullFacts(), venue());
    expect(outdoor.score - neutral.score).toBe(10);
  });

  // Without this: stacking all active signals could push the score above 100,
  // making it impossible to use the score as a 0–100 percentage.
  it('score is always clamped to a maximum of 100', () => {
    const result = scoreActivePlay(
      {
        ...nullFacts(),
        activity_level:     'high',
        visit_duration_mins: 60,
        indoor_outdoor:      'outdoor',
      },
      venue({ category: { slug: 'soft-play' } }),
    );
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

// =============================================================================
// describe: scoreLearning
// =============================================================================
// Scores the educational value of a venue.
// Point values: educational_slug=40, description>50chars=25, verified=20,
// max_age<=16=15 (child-specific venue).
//
// IMPORTANT: The default venue() factory has max_age=12 which IS <= 16 and
// earns +15. Tests that want to isolate other signals must set max_age=18
// to prevent this automatic +15 from inflating the baseline.

describe('scoreLearning', () => {
  // Without this: a venue with no educational signals and max_age > 16 could
  // still earn points, polluting learning results with adult venues.
  it('returns 0 when no category, no description, not verified, and max_age=18', () => {
    // max_age=18 ensures the child-specific bonus (+15) does not apply.
    expect(scoreLearning(nullFacts(), venue({ max_age: 18 })).score).toBe(0);
  });

  // Without this: a museum category slug could stop contributing 40 points,
  // causing museums to fall below the 65-point threshold for the 'learning' tag.
  it('educational category slug (museum) adds 40 points (verified in breakdown)', () => {
    const result = scoreLearning(
      nullFacts(),
      venue({ category: { slug: 'museum' }, max_age: 18 }),
    );
    expect(result.score).toBe(40);
    expect(result.breakdown['educational_category_slug']).toBe(40);
  });

  // Without this: a description longer than 50 characters could stop earning
  // 25 points, penalising venues with curated, informative descriptions.
  it('description longer than 50 characters adds 25 points', () => {
    const result = scoreLearning(
      nullFacts(),
      venue({ description: 'A'.repeat(51), max_age: 18 }),
    );
    expect(result.score).toBe(25);
  });

  // Without this: the boundary condition could shift from > 50 to >= 50,
  // causing a 50-character description (very short) to earn the same credit
  // as a genuinely long educational description.
  it('description of exactly 50 characters does NOT earn 25 points (threshold is > 50)', () => {
    expect(
      scoreLearning(nullFacts(), venue({ description: 'A'.repeat(50), max_age: 18 })).score,
    ).toBe(0);
  });

  // Without this: the is_verified bonus could be dropped, removing the
  // incentive for venues to become verified and reducing data quality signals.
  it('is_verified=true adds 20 points', () => {
    expect(
      scoreLearning(nullFacts(), venue({ is_verified: true, max_age: 18 })).score,
    ).toBe(20);
  });

  // Without this: the child-specific bonus could be lost, meaning venues
  // designed for children (max_age=12) score the same as adult venues.
  it('max_age <= 16 adds 15 points (child-specific venue bonus)', () => {
    // Use max_age=16 to hit the boundary exactly. Note: no other signals.
    expect(scoreLearning(nullFacts(), venue({ max_age: 16 })).score).toBe(15);
  });

  // Without this: the max_age check threshold could change, making adult
  // venues (age 17-99) incorrectly earn the child-specific bonus.
  it('max_age=18 does NOT add 15 points (not a child-specific venue)', () => {
    expect(scoreLearning(nullFacts(), venue({ max_age: 18 })).score).toBe(0);
  });

  // Without this: all four signals stacking would exceed 100 without being
  // caught. This is also a readable spec for the maximum achievable score.
  it('museum + long description + verified + child age → exactly 100 (40+25+20+15)', () => {
    const result = scoreLearning(
      nullFacts(),
      venue({
        category:    { slug: 'museum' },
        description: 'A'.repeat(100),
        is_verified: true,
        max_age:     12,
      }),
    );
    expect(result.score).toBe(100);
  });
});

// =============================================================================
// describe: scoreBudget
// =============================================================================
// Maps price_range directly to a score. Null price data is treated neutrally
// (score=35) so recently imported venues are not unfairly penalised.

describe('scoreBudget', () => {
  // Without this: free venues (parks, playgrounds) would not score 100 and
  // could fall below the 65-point threshold for the 'budget_friendly' tag.
  it('price_range=free → 100', () => {
    expect(scoreBudget(venue({ price_range: 'free' })).score).toBe(100);
  });

  // Without this: a budget venue could silently be scored the same as a
  // moderate venue (40), unfairly ranking them equal in cost.
  it('price_range=budget → 70', () => {
    expect(scoreBudget(venue({ price_range: 'budget' })).score).toBe(70);
  });

  // Without this: a moderate venue could score too high or too low, breaking
  // the expected separation between budget-tier and mid-tier venues.
  it('price_range=moderate → 40', () => {
    expect(scoreBudget(venue({ price_range: 'moderate' })).score).toBe(40);
  });

  // Without this: a premium venue could score 0, causing it to rank below
  // venues with missing price data (35), which would be misleading.
  it('price_range=premium → 10', () => {
    expect(scoreBudget(venue({ price_range: 'premium' })).score).toBe(10);
  });

  // Without this: null price data could score 0, causing all newly imported
  // venues (which rarely have price data immediately) to rank at the very
  // bottom of budget searches — unfairly penalising new content.
  it('price_range=null → 35 (neutral score, unknown price is not punished)', () => {
    expect(scoreBudget(venue({ price_range: null })).score).toBe(35);
  });
});

// =============================================================================
// describe: scoreAccessibility
// =============================================================================
// Scores how accessible a venue is for families with mobility needs.
// Point values: wheelchair_yes=50, wheelchair_limited=25, toilets=20,
// parking=15, baby_change=10, indoor=5.

describe('scoreAccessibility', () => {
  // Without this: a venue with no accessibility signals could earn points,
  // causing inaccessible venues to appear in accessible search results.
  it('returns 0 when all facts are null', () => {
    expect(scoreAccessibility(nullFacts()).score).toBe(0);
  });

  // Without this: wheelchair=yes could lose its 50-point contribution, making
  // fully accessible venues fall below the 65-point threshold for the
  // 'accessible' tag and hiding them from families who depend on this filter.
  it('wheelchair_accessible=yes → 50 points', () => {
    expect(
      scoreAccessibility({ ...nullFacts(), wheelchair_accessible: 'yes' }).score,
    ).toBe(50);
  });

  // Without this: wheelchair=limited could incorrectly earn full credit (50)
  // instead of partial credit (25), overstating accessibility for venues that
  // are only partially accessible — a potential safety issue for wheelchair users.
  it('wheelchair_accessible=limited → 25 points (partial credit)', () => {
    expect(
      scoreAccessibility({ ...nullFacts(), wheelchair_accessible: 'limited' }).score,
    ).toBe(25);
  });

  // Without this: the most common combination for a fully accessible venue
  // (wheelchair access + toilets + parking) could break without an integration-
  // level check catching it.
  it('wheelchair=yes + toilets + parking → 85 (50 + 20 + 15)', () => {
    expect(
      scoreAccessibility({
        ...nullFacts(),
        wheelchair_accessible: 'yes',  // +50
        toilets_available:     true,   // +20
        parking_available:     true,   // +15
      }).score,
    ).toBe(85);
  });

  // Without this: the indoor environment bonus (+5) could be accidentally
  // removed, which would not be caught by any individual score test since
  // it is a small bonus that changes the score of every indoor venue.
  it('indoor_outdoor=indoor adds exactly +5 (controlled indoor environment)', () => {
    const indoor  = scoreAccessibility({ ...nullFacts(), indoor_outdoor: 'indoor' });
    const neutral = scoreAccessibility(nullFacts());
    expect(indoor.score - neutral.score).toBe(5);
  });

  // Without this: all six positive signals combined could exceed 100, producing
  // an invalid score that would break percentage-based comparisons.
  it('score is always clamped to a maximum of 100', () => {
    const result = scoreAccessibility({
      ...nullFacts(),
      wheelchair_accessible: 'yes',
      toilets_available:     true,
      parking_available:     true,
      baby_change_available: true,
      indoor_outdoor:        'indoor',
    });
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

// =============================================================================
// describe: computeRecommendedFor
// =============================================================================
// Converts scores and facts into pre-computed filter tags. This is the output
// that powers GIN-indexed O(1) filter queries in the database. Every tag here
// maps directly to a parent-facing filter in the app — a wrong tag means a
// venue is hidden from or wrongly shown to parents using that filter.
//
// Score-based tag threshold is 65/100.
// Fact-based tags derive directly from Layer 1 values.

describe('computeRecommendedFor', () => {
  // Without this: high-scoring indoor learning venues (museums, science centres)
  // might not receive the 'indoor', 'learning', and 'rainy_day' tags they
  // earned, making them invisible to parents filtering for rainy-day activities.
  it('high learning score + high rainy_day score + indoor facts → includes indoor, learning, rainy_day', () => {
    const scores = { ...zeroScores(), learning_score: 80, rainy_day_score: 70 };
    const facts  = { ...nullFacts(), indoor_outdoor: 'indoor' as const };
    const result = computeRecommendedFor(scores, facts, venue());
    expect(result).toContain('indoor');
    expect(result).toContain('learning');
    expect(result).toContain('rainy_day');
  });

  // Without this: free venues (parks, free museums) would not receive the
  // 'free' tag, hiding them from parents filtering specifically for free days out.
  it('price_range=free → includes the "free" tag', () => {
    const result = computeRecommendedFor(
      zeroScores(),
      nullFacts(),
      venue({ price_range: 'free' }),
    );
    expect(result).toContain('free');
  });

  // Without this: a theme park (360-minute visit) could receive 'half_day'
  // instead of 'full_day', misleading parents about how long to plan for.
  it('visit_duration_mins=360 → includes "full_day", excludes "half_day"', () => {
    const result = computeRecommendedFor(
      zeroScores(),
      { ...nullFacts(), visit_duration_mins: 360 },
      venue(),
    );
    expect(result).toContain('full_day');
    expect(result).not.toContain('half_day');
  });

  // Without this: a museum (90-minute visit) could receive 'full_day' instead
  // of 'half_day', causing parents to over-plan or under-plan their day.
  it('visit_duration_mins=90 → includes "half_day", excludes "full_day"', () => {
    const result = computeRecommendedFor(
      zeroScores(),
      { ...nullFacts(), visit_duration_mins: 90 },
      venue(),
    );
    expect(result).toContain('half_day');
    expect(result).not.toContain('full_day');
  });

  // Without this: venues accepting babies and toddlers (min_age=0) could lose
  // the 'toddler_friendly' tag, hiding them from parents of very young children.
  it('min_age=0 → includes "toddler_friendly"', () => {
    const result = computeRecommendedFor(zeroScores(), nullFacts(), venue({ min_age: 0 }));
    expect(result).toContain('toddler_friendly');
  });

  // Without this: a venue for ages 3+ could be tagged 'toddler_friendly',
  // misleading parents of 1-2 year olds into visiting an unsuitable venue.
  // The toddler threshold is min_age <= 2, so min_age=3 must NOT qualify.
  it('min_age=3 → does NOT include "toddler_friendly"', () => {
    const result = computeRecommendedFor(zeroScores(), nullFacts(), venue({ min_age: 3 }));
    expect(result).not.toContain('toddler_friendly');
  });

  // Without this: the 'family_day_out' combination tag could be lost, removing
  // it from the filter that parents use when planning a full-day trip with
  // physical activities (e.g. a soft-play with 2+ hours of capacity).
  it('active_play_score=40 + visit_duration_mins=120 → includes "family_day_out"', () => {
    const scores = { ...zeroScores(), active_play_score: 40 };
    const facts  = { ...nullFacts(), visit_duration_mins: 120 };
    const result = computeRecommendedFor(scores, facts, venue());
    expect(result).toContain('family_day_out');
  });

  // Without this: the family_day_out threshold (active_play >= 40) could change,
  // causing venues with a score of 39 to incorrectly earn the tag.
  it('active_play_score=39 → does NOT include "family_day_out" (just below threshold)', () => {
    const scores = { ...zeroScores(), active_play_score: 39 };
    const facts  = { ...nullFacts(), visit_duration_mins: 120 };
    const result = computeRecommendedFor(scores, facts, venue());
    expect(result).not.toContain('family_day_out');
  });

  // Without this: a zoo or theme park (indoor_outdoor='mixed') could either
  // gain the 'indoor' tag (wrong — it has significant outdoor areas) or lose
  // the 'outdoor' tag (wrong — it should appear in outdoor searches).
  it('indoor_outdoor=mixed → includes "outdoor", excludes "indoor"', () => {
    const result = computeRecommendedFor(
      zeroScores(),
      { ...nullFacts(), indoor_outdoor: 'mixed' },
      venue(),
    );
    expect(result).toContain('outdoor');
    expect(result).not.toContain('indoor');
  });

  // Without this: score-based tags could be awarded at any score including 0,
  // meaning every venue would earn every tag regardless of actual suitability.
  it('all zero scores + no facts → no score-based tags are awarded', () => {
    // Use min_age=3 to also suppress 'toddler_friendly'. price_range=null
    // so 'free' is not included either. nullFacts so no indoor/outdoor tag.
    const result = computeRecommendedFor(zeroScores(), nullFacts(), venue({ min_age: 3 }));
    expect(result).not.toContain('rainy_day');
    expect(result).not.toContain('burn_energy');
    expect(result).not.toContain('learning');
    expect(result).not.toContain('accessible');
    expect(result).not.toContain('parent_friendly');
    expect(result).not.toContain('budget_friendly');
    expect(result).toHaveLength(0);
  });

  // Off-by-one: score=64 must NOT earn a tag. This tests the boundary condition
  // that separates venues that deserve a tag from those that just miss it.
  // Without this: changing >= 65 to > 64 or >= 64 would award tags incorrectly.
  it('all scores at 64 (one below threshold) → no score-based tags (uses min_age=3)', () => {
    const scores = {
      rainy_day_score:          64,
      active_play_score:        64,
      learning_score:           64,
      budget_score:             64,
      accessibility_score:      64,
      parent_convenience_score: 64,
    };
    // min_age=3 → no toddler_friendly; nullFacts → no indoor/outdoor; null price → no free
    const result = computeRecommendedFor(scores, nullFacts(), venue({ min_age: 3 }));
    expect(result).toHaveLength(0);
  });

  // Without this: changing >= 65 to > 65 would break the boundary exactly at
  // threshold, hiding venues that have just enough score to qualify.
  it('rainy_day_score=65 (exactly at threshold) → includes "rainy_day"', () => {
    const result = computeRecommendedFor(
      { ...zeroScores(), rainy_day_score: 65 },
      nullFacts(),
      venue({ min_age: 3 }),
    );
    expect(result).toContain('rainy_day');
  });
});

// =============================================================================
// describe: computeIntelligence (integration)
// =============================================================================
// Tests the full pipeline: facts + venue → scores + tags + breakdown.
// These are integration tests that exercise all six scorers together.
// If a scorer's output changes, these tests catch whether that change
// correctly flows through to the recommended_for tags.

describe('computeIntelligence — integration', () => {
  // Represents a typical indoor soft-play centre — one of the most common
  // venue types in the app. Without this: a soft-play with toilets and high
  // activity might not get the 'burn_energy' or 'rainy_day' tags, making it
  // invisible to the two most commonly used parent filters.
  //
  // Score arithmetic for this scenario:
  //   active_play: both high activity AND soft-play slug → 55 (cap) + duration>=60 +15 = 70 → burn_energy
  //   rainy_day: indoor(50) + toilets(15) + duration>=90(5) = 70 → rainy_day
  it('soft-play indoor with high activity, toilets, 90min duration → burn_energy, rainy_day, indoor, toddler_friendly', () => {
    const facts: RawFacts = {
      indoor_outdoor:        'indoor',
      parking_available:     null,
      cafe_available:        null,
      toilets_available:     true,
      baby_change_available: null,
      wheelchair_accessible: null,
      visit_duration_mins:   90,
      activity_level:        'high',
    };
    const v = venue({ category: { slug: 'soft-play' }, min_age: 0 });
    const result = computeIntelligence(facts, v);

    // active_play = 55 (high+slug cap) + 15 (duration>=60) = 70 → above threshold
    expect(result.scores.active_play_score).toBeGreaterThanOrEqual(65);
    // rainy_day = 50 (indoor) + 15 (toilets) + 5 (duration>=90) = 70 → above threshold
    expect(result.scores.rainy_day_score).toBeGreaterThanOrEqual(65);
    expect(result.recommended_for).toContain('burn_energy');
    expect(result.recommended_for).toContain('rainy_day');
    expect(result.recommended_for).toContain('indoor');
    expect(result.recommended_for).toContain('toddler_friendly');
  });

  // Represents a family-friendly zoo — mixed indoor/outdoor, wheelchair
  // accessible, long visit, with parking and toilets.
  //
  // Score arithmetic:
  //   accessibility: wheelchair_yes(50) + toilets(20) + parking(15) = 85 → accessible
  //   duration: 240 mins >= 180 → full_day
  //   indoor_outdoor: mixed → outdoor tag
  it('zoo with wheelchair access, toilets, parking, 240min → outdoor, accessible, full_day', () => {
    const facts: RawFacts = {
      indoor_outdoor:        'mixed',
      parking_available:     true,
      cafe_available:        null,
      toilets_available:     true,
      baby_change_available: null,
      wheelchair_accessible: 'yes',
      visit_duration_mins:   240,
      activity_level:        'medium',
    };
    const v = venue({ category: { slug: 'zoo' }, min_age: 0 });
    const result = computeIntelligence(facts, v);

    expect(result.recommended_for).toContain('outdoor');
    expect(result.recommended_for).toContain('accessible');
    expect(result.recommended_for).toContain('full_day');
  });

  // Without this: a code change could drop one of the six score_breakdown keys,
  // causing the audit system to silently lose information about how a score
  // was computed — making it impossible to investigate why a score changed.
  it('score_breakdown contains all six dimension keys for audit trail', () => {
    const result = computeIntelligence(nullFacts(), venue());
    expect(result.score_breakdown).toHaveProperty('parent_convenience');
    expect(result.score_breakdown).toHaveProperty('rainy_day');
    expect(result.score_breakdown).toHaveProperty('active_play');
    expect(result.score_breakdown).toHaveProperty('learning');
    expect(result.score_breakdown).toHaveProperty('budget');
    expect(result.score_breakdown).toHaveProperty('accessibility');
  });

  // Without this: any of the six scorers could produce NaN, Infinity, or a
  // value outside 0-100, causing silent corruption in the database JSONB columns
  // and breaking filter comparisons.
  it('every score in the result is a finite number clamped to 0–100', () => {
    // Use every positive signal available to maximise the chance of overflow.
    const facts: RawFacts = {
      indoor_outdoor:        'indoor',
      parking_available:     true,
      cafe_available:        true,
      toilets_available:     true,
      baby_change_available: true,
      wheelchair_accessible: 'yes',
      visit_duration_mins:   360,
      activity_level:        'high',
    };
    const v = venue({
      price_range:  'free',
      is_verified:  true,
      description:  'A'.repeat(200),
      max_age:      12,
      min_age:      0,
      category:     { slug: 'soft-play' },
    });
    const { scores } = computeIntelligence(facts, v);

    for (const [dimensionKey, score] of Object.entries(scores)) {
      expect(typeof score).toBe('number');
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
      // Redundant but produces a clear failure message if this ever breaks:
      if (score < 0 || score > 100) {
        throw new Error(`${dimensionKey} is out of range: ${score}`);
      }
    }
  });

  // Without this: a free venue with no other signals might have its budget
  // score incorrectly computed, causing it to miss or gain the 'budget_friendly'
  // tag unexpectedly.
  it('free venue with no other signals → budget_score=100 and includes budget_friendly', () => {
    const result = computeIntelligence(nullFacts(), venue({ price_range: 'free', min_age: 3 }));
    expect(result.scores.budget_score).toBe(100);
    expect(result.recommended_for).toContain('budget_friendly');
  });
});
