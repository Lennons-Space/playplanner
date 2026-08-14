import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseFlags,
  selectStaleVenues,
  buildSnapshot,
  processVenue,
  runEnrichExisting,
  loadOsmArchiveElements,
  loadCheckpoint,
  saveCheckpoint,
  type EnrichExistingDb,
  type VenueCandidateRow,
} from '../autonomous';
import { createCheckpoint } from '../autonomousCore';
import type { WebFetchResult } from '../../../types/webEnrichment';

describe('parseFlags', () => {
  it('defaults to dry-run, enrich-existing, limit 20, stale-days 30', () => {
    const f = parseFlags(['node', 'autonomous.ts']);
    expect(f.apply).toBe(false);
    expect(f.mode).toBe('enrich-existing');
    expect(f.limit).toBe(20);
    expect(f.staleDays).toBe(30);
    expect(f.maxRuntimeMinutes).toBeNull();
    expect(f.resume).toBe(false);
  });

  it('--apply is the only flag that turns on writes', () => {
    expect(parseFlags(['n', 's', '--apply']).apply).toBe(true);
    expect(parseFlags(['n', 's', '--dry-run']).apply).toBe(false);
    expect(parseFlags(['n', 's']).apply).toBe(false); // absence of --apply = dry-run
  });

  it('parses --discover, --limit, --stale-days, --max-runtime, --resume, --report-dir', () => {
    const f = parseFlags(['n', 's', '--discover', '--limit=50', '--stale-days=7', '--max-runtime=30', '--resume', '--report-dir=/tmp/x']);
    expect(f.mode).toBe('discover');
    expect(f.limit).toBe(50);
    expect(f.staleDays).toBe(7);
    expect(f.maxRuntimeMinutes).toBe(30);
    expect(f.resume).toBe(true);
    expect(f.reportDir).toBe('/tmp/x');
  });

  it('ignores garbage numeric values and keeps defaults', () => {
    const f = parseFlags(['n', 's', '--limit=notanumber', '--stale-days=-5']);
    expect(f.limit).toBe(20);
    expect(f.staleDays).toBe(30);
  });

  it('--stale-days=0 is valid (always due)', () => {
    expect(parseFlags(['n', 's', '--stale-days=0']).staleDays).toBe(0);
  });
});

describe('selectStaleVenues', () => {
  const now = new Date('2026-08-14T00:00:00.000Z');
  function row(id: string, overrides: Partial<VenueCandidateRow> = {}): VenueCandidateRow {
    return { id, name: id, website: 'https://x.example', is_verified: false, operating_status: 'active', ...overrides };
  }

  it('excludes venues with no website', () => {
    const rows = [row('a', { website: null })];
    expect(selectStaleVenues(rows, new Map(), 30, now, 10)).toHaveLength(0);
  });

  it('excludes non-active venues', () => {
    const rows = [row('a', { operating_status: 'suspected_closed' })];
    expect(selectStaleVenues(rows, new Map(), 30, now, 10)).toHaveLength(0);
  });

  it('never-checked venues (no last_checked entry) always qualify and sort first', () => {
    const rows = [row('checked'), row('never')];
    const lastChecked = new Map([['checked', '2026-08-13T00:00:00.000Z']]); // 1 day old
    const result = selectStaleVenues(rows, lastChecked, 30, now, 10);
    expect(result.map((r) => r.id)).toEqual(['never']); // checked is only 1 day old, below 30-day threshold
  });

  it('sorts oldest-checked first', () => {
    const rows = [row('recent'), row('old')];
    const lastChecked = new Map([
      ['recent', '2026-08-01T00:00:00.000Z'], // 13 days
      ['old', '2026-01-01T00:00:00.000Z'],    // ~225 days
    ]);
    const result = selectStaleVenues(rows, lastChecked, 5, now, 10);
    expect(result.map((r) => r.id)).toEqual(['old', 'recent']);
  });

  it('respects the limit', () => {
    const rows = [row('a'), row('b'), row('c')];
    expect(selectStaleVenues(rows, new Map(), 0, now, 2)).toHaveLength(2);
  });
});

describe('buildSnapshot', () => {
  it('maps opening_hours rows to DayHours with a single interval when open', () => {
    const snap = buildSnapshot(
      { description: 'd', price_range: 'free', website: 'w', phone: 'p', email: 'e' },
      [{ day_of_week: 1, is_closed: false, opens_at: '09:00', closes_at: '17:00' }],
    );
    expect(snap.opening_hours).toEqual([{ day_of_week: 1, is_closed: false, intervals: [{ opens: '09:00', closes: '17:00' }] }]);
  });

  it('maps a closed day to an empty intervals array', () => {
    const snap = buildSnapshot(
      { description: null, price_range: null, website: null, phone: null, email: null },
      [{ day_of_week: 0, is_closed: true, opens_at: null, closes_at: null }],
    );
    expect(snap.opening_hours).toEqual([{ day_of_week: 0, is_closed: true, intervals: [] }]);
  });
});

describe('processVenue', () => {
  const AT = new Date('2026-08-14T12:00:00.000Z');
  const emptySnapshot = { description: null, price_range: null, website: null, phone: null, email: null, opening_hours: [] };

  it('classifies extracted proposals and returns closure signals from captured HTML', async () => {
    const fetchPage = async (): Promise<WebFetchResult> => ({
      kind: 'ok',
      page: {
        finalUrl: 'https://v.example/',
        html: '<html><body>We have now closed permanently.</body></html>',
        fromCache: false,
        page: { url: 'https://v.example/', httpStatus: 200, contentSha256: 'x', bytes: 10, fetchedAt: AT.toISOString() },
      },
    });
    const result = await processVenue(
      { venueId: 'v1', name: 'Test Venue', website: 'https://v.example/' },
      emptySnapshot,
      { now: AT, isVerified: false, isRecheck: false },
      { fetchPage },
    );
    expect(result.closureSignals.length).toBeGreaterThan(0);
    expect(result.closureAssessment.recommendedStatus).toBe('suspected_closed');
    expect(result.buckets).toHaveProperty('autoApply');
  });

  it('handles a venue with no website (skipped, no closure signals)', async () => {
    const fetchPage = jest.fn();
    const result = await processVenue(
      { venueId: 'v2', name: 'No Site', website: null },
      emptySnapshot,
      { now: AT, isVerified: false, isRecheck: false },
      { fetchPage },
    );
    expect(result.runResult.outcome).toBe('skipped_no_website');
    expect(result.closureSignals).toHaveLength(0);
    expect(fetchPage).not.toHaveBeenCalled();
  });
});

function fakeDb(overrides: Partial<EnrichExistingDb> = {}): EnrichExistingDb {
  return {
    selectCandidateVenues: async () => [],
    selectLastCheckedMap: async () => new Map(),
    getSnapshot: async () => ({ description: null, price_range: null, website: null, phone: null, email: null, opening_hours: [] }),
    proposeField: async () => 'proposal-1',
    setProposalScore: async () => {},
    autoApplyProposal: async () => {},
    flagSuspectedClosure: async () => {},
    ...overrides,
  };
}

describe('runEnrichExisting', () => {
  const AT = () => new Date('2026-08-14T12:00:00.000Z');
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-enrich-test-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const venue: VenueCandidateRow = { id: 'v1', name: 'Test Venue', website: 'https://v.example/', is_verified: false, operating_status: 'active' };
  const fetchPageOk = async (): Promise<WebFetchResult> => ({
    kind: 'ok',
    page: {
      finalUrl: 'https://v.example/',
      html: '<html><body><a href="tel:+441234567890">Call us</a></body></html>',
      fromCache: false,
      page: { url: 'https://v.example/', httpStatus: 200, contentSha256: 'x', bytes: 10, fetchedAt: AT().toISOString() },
    },
  });

  it('dry run (apply=false) never calls any db write method', async () => {
    const proposeField = jest.fn();
    const autoApplyProposal = jest.fn();
    const db = fakeDb({ selectCandidateVenues: async () => [venue], proposeField, autoApplyProposal });
    const flags = parseFlags(['n', 's', '--enrich-existing', '--limit=5', '--report-dir=' + tmpDir]);
    const checkpoint = createCheckpoint('run-1', 'enrich-existing', AT());

    await runEnrichExisting(db, fetchPageOk, flags, checkpoint, AT, 'run-1');
    expect(proposeField).not.toHaveBeenCalled();
    expect(autoApplyProposal).not.toHaveBeenCalled();
  });

  it('apply mode persists a checkpoint file that marks the venue processed', async () => {
    const db = fakeDb({ selectCandidateVenues: async () => [venue] });
    const flags = parseFlags(['n', 's', '--enrich-existing', '--apply', '--limit=5', '--report-dir=' + tmpDir]);
    const checkpoint = createCheckpoint('run-1', 'enrich-existing', AT());

    const result = await runEnrichExisting(db, fetchPageOk, flags, checkpoint, AT, 'run-1');
    expect(result.checkpoint.processedVenueIds).toContain('v1');
    expect(result.checkpoint.complete).toBe(true);

    const reloaded = loadCheckpoint(tmpDir, 'enrich-existing');
    expect(reloaded?.processedVenueIds).toContain('v1');
  });

  it('counts a suspected closure and flags it via the DB in apply mode, without needing admin action', async () => {
    const flagSuspectedClosure = jest.fn();
    const fetchPageClosed = async (): Promise<WebFetchResult> => ({
      kind: 'ok',
      page: {
        finalUrl: 'https://v.example/',
        html: '<html><body>We have now closed permanently.</body></html>',
        fromCache: false,
        page: { url: 'https://v.example/', httpStatus: 200, contentSha256: 'x', bytes: 10, fetchedAt: AT().toISOString() },
      },
    });
    const db = fakeDb({ selectCandidateVenues: async () => [venue], flagSuspectedClosure });
    const flags = parseFlags(['n', 's', '--enrich-existing', '--apply', '--limit=5', '--report-dir=' + tmpDir]);
    const checkpoint = createCheckpoint('run-1', 'enrich-existing', AT());

    const result = await runEnrichExisting(db, fetchPageClosed, flags, checkpoint, AT, 'run-1');
    expect(result.report.suspectedClosures).toBe(1);
    expect(flagSuspectedClosure).toHaveBeenCalledWith('v1', expect.any(String));
  });

  it('--resume skips venues already in the checkpoint', async () => {
    const selectCandidateVenues = jest.fn().mockResolvedValue([venue, { ...venue, id: 'v2', name: 'Venue 2' }]);
    const db = fakeDb({ selectCandidateVenues });
    const flags = parseFlags(['n', 's', '--enrich-existing', '--resume', '--limit=5', '--report-dir=' + tmpDir]);
    let checkpoint = createCheckpoint('run-1', 'enrich-existing', AT());
    checkpoint = { ...checkpoint, processedVenueIds: ['v1'] };

    const result = await runEnrichExisting(db, fetchPageOk, flags, checkpoint, AT, 'run-1');
    expect(result.checkpoint.processedVenueIds).toEqual(expect.arrayContaining(['v1', 'v2']));
    expect(result.report.venuesCrawled).toBe(1); // only v2 was actually processed this run
  });

  it('max-runtime stops the run early without marking the checkpoint complete', async () => {
    const twoVenues = [venue, { ...venue, id: 'v2', name: 'Venue 2' }];
    const db = fakeDb({ selectCandidateVenues: async () => twoVenues });
    const flags = parseFlags(['n', 's', '--enrich-existing', '--max-runtime=1', '--limit=5', '--report-dir=' + tmpDir]);
    const checkpoint = createCheckpoint('run-1', 'enrich-existing', AT());

    let calls = 0;
    const clock = () => {
      calls += 1;
      // First call establishes startedAt; make the deadline already passed by the second call.
      return calls <= 1 ? AT() : new Date(AT().getTime() + 10 * 60_000);
    };

    const result = await runEnrichExisting(db, fetchPageOk, flags, checkpoint, clock, 'run-1');
    expect(result.checkpoint.complete).toBe(false);
  });
});

describe('loadOsmArchiveElements', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-osm-test-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns an empty array when the archive directory does not exist', () => {
    expect(loadOsmArchiveElements(path.join(tmpDir, 'missing'))).toEqual([]);
  });

  it('loads and flattens elements from multiple JSON files', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.json'), JSON.stringify([{ type: 'node', id: 1 }]));
    fs.writeFileSync(path.join(tmpDir, 'b.json'), JSON.stringify([{ type: 'node', id: 2 }, { type: 'way', id: 3 }]));
    const elements = loadOsmArchiveElements(tmpDir);
    expect(elements).toHaveLength(3);
  });

  it('skips a malformed file without aborting the whole load', () => {
    fs.writeFileSync(path.join(tmpDir, 'good.json'), JSON.stringify([{ type: 'node', id: 1 }]));
    fs.writeFileSync(path.join(tmpDir, 'bad.json'), '{not valid json');
    const elements = loadOsmArchiveElements(tmpDir);
    expect(elements).toHaveLength(1);
  });
});

describe('checkpoint persistence', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-checkpoint-test-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns null when no checkpoint file exists', () => {
    expect(loadCheckpoint(tmpDir, 'enrich-existing')).toBeNull();
  });

  it('round-trips a saved checkpoint', () => {
    const cp = createCheckpoint('run-1', 'enrich-existing', new Date('2026-08-14T00:00:00.000Z'));
    saveCheckpoint(tmpDir, 'enrich-existing', cp);
    expect(loadCheckpoint(tmpDir, 'enrich-existing')).toEqual(cp);
  });

  it('returns null for a corrupted checkpoint file rather than throwing', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'checkpoint-enrich-existing.json'), 'not json{{{');
    expect(loadCheckpoint(tmpDir, 'enrich-existing')).toBeNull();
  });
});
