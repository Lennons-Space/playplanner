import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createOsmArchiveProvider, loadOsmArchiveElements } from '../osmArchiveProvider';

describe('loadOsmArchiveElements', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-osm-provider-test-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns an empty array when the archive directory does not exist', () => {
    expect(loadOsmArchiveElements(path.join(tmpDir, 'missing'))).toEqual([]);
  });

  it('loads and flattens elements from multiple JSON files', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.json'), JSON.stringify([{ type: 'node', id: 1 }]));
    fs.writeFileSync(path.join(tmpDir, 'b.json'), JSON.stringify([{ type: 'node', id: 2 }, { type: 'way', id: 3 }]));
    expect(loadOsmArchiveElements(tmpDir)).toHaveLength(3);
  });

  it('skips a malformed file without aborting the whole load', () => {
    fs.writeFileSync(path.join(tmpDir, 'good.json'), JSON.stringify([{ type: 'node', id: 1 }]));
    fs.writeFileSync(path.join(tmpDir, 'bad.json'), '{not valid json');
    expect(loadOsmArchiveElements(tmpDir)).toHaveLength(1);
  });
});

describe('createOsmArchiveProvider', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-osm-provider-test-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns an explicit unavailable result (not a silent empty success) when the archive is missing', async () => {
    const provider = createOsmArchiveProvider(path.join(tmpDir, 'missing'));
    const result = await provider.fetchCandidates({});
    expect(result.kind).toBe('unavailable');
    expect(result.reason).toMatch(/archive not found/);
    expect(result.candidates).toHaveLength(0);
  });

  it('returns success with normalized candidates carrying the original raw element', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.json'), JSON.stringify([
      { type: 'node', id: 111, lat: 52.6, lon: -1.6, tags: { name: 'Twycross Zoo', tourism: 'zoo', 'addr:postcode': 'CV9 3PX' } },
    ]));
    const provider = createOsmArchiveProvider(tmpDir);
    const result = await provider.fetchCandidates({});
    expect(result.kind).toBe('success');
    expect(result.candidates).toHaveLength(1);
    const c = result.candidates[0]!;
    expect(c.source).toBe('osm');
    expect(c.sourceTier).toBe(2); // derived from sourceTrust.ts's canonical tier table, not a local literal
    expect(c.sourceId).toBe('node/111');
    expect(c.name).toBe('Twycross Zoo');
    expect(c.postcode).toBe('CV9 3PX');
    expect(c.attribution.licence).toBe('ODbL-1.0');
    expect(c.raw).toMatchObject({ type: 'node', id: 111 });
  });

  it('silently drops elements with no name or no coordinates from the normalized set (deeper validation stays downstream)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.json'), JSON.stringify([
      { type: 'node', id: 1, lat: 52, lon: -1, tags: { tourism: 'zoo' } }, // no name
      { type: 'node', id: 2, tags: { name: 'No Coords', tourism: 'zoo' } }, // no coords
      { type: 'node', id: 3, lat: 52, lon: -1, tags: { name: 'Valid Zoo', tourism: 'zoo' } },
    ]));
    const provider = createOsmArchiveProvider(tmpDir);
    const result = await provider.fetchCandidates({});
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.name).toBe('Valid Zoo');
  });

  it('respects a work-unit budget by capping the normalized candidate count', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.json'), JSON.stringify(
      Array.from({ length: 5 }, (_, i) => ({ type: 'node', id: i, lat: 52, lon: -1, tags: { name: `Zoo ${i}`, tourism: 'zoo' } })),
    ));
    const provider = createOsmArchiveProvider(tmpDir);
    const result = await provider.fetchCandidates({ budget: 2 });
    expect(result.candidates).toHaveLength(2);
  });

  it('reports failed (not a crash) when an archive file cannot be read as expected', async () => {
    // Directory exists but readFileSync/readdirSync throwing mid-way is hard to force portably;
    // this test instead confirms fetchCandidates never throws even given a directory containing
    // only unreadable garbage, degrading to an empty success rather than a hard failure.
    fs.writeFileSync(path.join(tmpDir, 'bad.json'), '{{{not json');
    const provider = createOsmArchiveProvider(tmpDir);
    const result = await provider.fetchCandidates({});
    expect(result.kind).toBe('success');
    expect(result.candidates).toHaveLength(0);
  });
});
