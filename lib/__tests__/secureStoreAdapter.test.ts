/**
 * Tests for ExpoSecureStoreAdapter (lib/supabase.ts).
 *
 * Android's SecureStore has a hard 2048-byte limit per entry. Supabase session
 * tokens routinely exceed this, so the adapter splits values into 1800-byte
 * chunks, stores each chunk separately, and reassembles them on read.
 * These tests verify the chunking logic is correct in every boundary case so
 * a corrupted or over-size session token can never silently break auth.
 *
 * WHY jest.isolateModules + require (not static import):
 * lib/supabase.ts reads process.env at module evaluation time and throws if
 * the vars are absent. Static `import` statements are hoisted above ALL test
 * code by Babel, including process.env assignments. The only way to set env
 * vars *before* the module is first loaded is to use jest.isolateModules() +
 * require() inside the test body, which defers module evaluation until after
 * our env setup runs.
 */

// Mock expo-secure-store — hoisted above all code by Jest/Babel, so the mock
// is in place before ANY module is loaded. The adapter delegates entirely to
// this module; we capture the mock fns below inside isolateModules.
jest.mock('expo-secure-store', () => ({
  getItemAsync:    jest.fn(),
  setItemAsync:    jest.fn(),
  deleteItemAsync: jest.fn(),
}));

// Lazily-loaded references — populated inside loadAdapter() before each suite.
// Typed here so TypeScript is happy throughout the test bodies.
let ExpoSecureStoreAdapter: {
  getItem:    (key: string) => Promise<string | null>;
  setItem:    (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};
let mockGetItem:    jest.MockedFunction<(key: string) => Promise<string | null>>;
let mockSetItem:    jest.MockedFunction<(key: string, value: string) => Promise<void>>;
let mockDeleteItem: jest.MockedFunction<(key: string) => Promise<void>>;

function loadAdapter() {
  jest.resetModules(); // clear any previously evaluated copy of supabase.ts

  // Set env vars BEFORE requiring supabase.ts — this is what makes the
  // module-level validation check pass inside supabase.ts lines 68-70.
  process.env.EXPO_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const supabaseModule = require('../supabase');
  ExpoSecureStoreAdapter = supabaseModule.ExpoSecureStoreAdapter;

  // Re-acquire the jest mock fns from the already-mocked expo-secure-store module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const SecureStore = require('expo-secure-store');
  mockGetItem    = SecureStore.getItemAsync;
  mockSetItem    = SecureStore.setItemAsync;
  mockDeleteItem = SecureStore.deleteItemAsync;
}

// Helper: build a string of exactly `n` characters (ASCII 'a')
function makeString(n: number): string {
  return 'a'.repeat(n);
}

beforeAll(() => {
  loadAdapter();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSetItem.mockResolvedValue(undefined);
  mockDeleteItem.mockResolvedValue(undefined);
});

// ======================================================================
// getItem
// ======================================================================
describe('ExpoSecureStoreAdapter.getItem', () => {
  // A small, non-chunked value: no `.chunks` key exists, so the adapter
  // should fall through to a plain SecureStore.getItemAsync on the base key.
  it('returns the value directly when no chunking key exists', async () => {
    mockGetItem.mockImplementation(async (key: string) => {
      if (key === 'session.chunks') return null;
      if (key === 'session')        return 'small-value';
      return null;
    });

    const result = await ExpoSecureStoreAdapter.getItem('session');

    expect(result).toBe('small-value');
  });

  // When a chunked value was stored previously, the adapter must read each
  // chunk in order and concatenate them to reconstruct the original string.
  it('reassembles chunked values in the correct order', async () => {
    mockGetItem.mockImplementation(async (key: string) => {
      if (key === 'session.chunks') return '3';
      if (key === 'session.0')      return 'chunk-A';
      if (key === 'session.1')      return 'chunk-B';
      if (key === 'session.2')      return 'chunk-C';
      return null;
    });

    const result = await ExpoSecureStoreAdapter.getItem('session');

    expect(result).toBe('chunk-Achunk-Bchunk-C');
  });

  // If one chunk is missing (e.g. written partially before a crash), the
  // session would be corrupted. Returning null forces a re-authentication
  // rather than feeding broken data to Supabase.
  it('returns null when a chunk is missing (incomplete chunked value)', async () => {
    mockGetItem.mockImplementation(async (key: string) => {
      if (key === 'session.chunks') return '3';
      if (key === 'session.0')      return 'chunk-A';
      if (key === 'session.1')      return null; // missing chunk
      if (key === 'session.2')      return 'chunk-C';
      return null;
    });

    const result = await ExpoSecureStoreAdapter.getItem('session');

    expect(result).toBeNull();
  });

  // No entry of any kind — getItem should return null rather than throwing.
  it('returns null when no value is stored for the key', async () => {
    mockGetItem.mockResolvedValue(null);

    const result = await ExpoSecureStoreAdapter.getItem('session');

    expect(result).toBeNull();
  });
});

// ======================================================================
// setItem
// ======================================================================
describe('ExpoSecureStoreAdapter.setItem', () => {
  // A value well under the 1800-byte threshold must be written as a single
  // entry. Writing it as a chunk unnecessarily would waste SecureStore slots
  // and complicate reads.
  it('stores a small value directly without chunking', async () => {
    const value = 'small-token';

    await ExpoSecureStoreAdapter.setItem('session', value);

    // Must clean up any old .chunks key from a previous chunked write
    expect(mockDeleteItem).toHaveBeenCalledWith('session.chunks');
    // Must write the value directly under the base key
    expect(mockSetItem).toHaveBeenCalledWith('session', value);
    // Must NOT write any .0, .1, etc. chunk keys
    const chunkKeyCalls = mockSetItem.mock.calls.filter(([k]) => /session\.\d+/.test(k));
    expect(chunkKeyCalls).toHaveLength(0);
  });

  // A value larger than 1800 bytes must be split into chunks of at most
  // 1800 bytes each. The chunk count must be stored so getItem knows how
  // many chunks to read back.
  it('splits a large value into chunks and stores the chunk count', async () => {
    const value = makeString(3700); // spans 3 chunks: 1800 + 1800 + 100

    await ExpoSecureStoreAdapter.setItem('session', value);

    expect(mockSetItem).toHaveBeenCalledWith('session.0', value.slice(0, 1800));
    expect(mockSetItem).toHaveBeenCalledWith('session.1', value.slice(1800, 3600));
    expect(mockSetItem).toHaveBeenCalledWith('session.2', value.slice(3600));
    expect(mockSetItem).toHaveBeenCalledWith('session.chunks', '3');
    // Must delete the plain key so getItem doesn't accidentally return
    // an old non-chunked value for the same key.
    expect(mockDeleteItem).toHaveBeenCalledWith('session');
  });

  // Boundary: exactly 1800 bytes must NOT be chunked. Chunking begins only
  // when the value EXCEEDS 1800 bytes (strictly greater than).
  it('does not chunk a value that is exactly 1800 bytes (lower boundary)', async () => {
    const value = makeString(1800);

    await ExpoSecureStoreAdapter.setItem('session', value);

    expect(mockDeleteItem).toHaveBeenCalledWith('session.chunks');
    expect(mockSetItem).toHaveBeenCalledWith('session', value);
    const chunkKeyCalls = mockSetItem.mock.calls.filter(([k]) => /session\.\d+/.test(k));
    expect(chunkKeyCalls).toHaveLength(0);
  });

  // Boundary: 1801 bytes is the first size that triggers chunking.
  // Two chunks: one full 1800-byte chunk and one 1-byte remainder.
  it('chunks a value that is 1801 bytes (upper boundary, first chunked size)', async () => {
    const value = makeString(1801);

    await ExpoSecureStoreAdapter.setItem('session', value);

    expect(mockSetItem).toHaveBeenCalledWith('session.0', value.slice(0, 1800));
    expect(mockSetItem).toHaveBeenCalledWith('session.1', value.slice(1800));
    expect(mockSetItem).toHaveBeenCalledWith('session.chunks', '2');
    expect(mockDeleteItem).toHaveBeenCalledWith('session');
  });
});

// ======================================================================
// removeItem
// ======================================================================
describe('ExpoSecureStoreAdapter.removeItem', () => {
  // Removing a plain (non-chunked) key must just delete the key itself.
  // There are no chunk sub-keys to clean up.
  it('deletes only the base key when no chunking key exists', async () => {
    mockGetItem.mockResolvedValue(null); // no .chunks key

    await ExpoSecureStoreAdapter.removeItem('session');

    expect(mockDeleteItem).toHaveBeenCalledWith('session');
    // Must not try to delete chunk sub-keys
    const chunkDeletes = mockDeleteItem.mock.calls.filter(([k]) => /session\.\d+/.test(k));
    expect(chunkDeletes).toHaveLength(0);
  });

  // Removing a chunked key must delete every chunk sub-key, the .chunks
  // count key, AND the base key. Leaving orphaned chunk keys would leak
  // data and consume limited SecureStore space.
  it('deletes all chunk sub-keys, the .chunks key, and the base key', async () => {
    mockGetItem.mockImplementation(async (key: string) => {
      if (key === 'session.chunks') return '3';
      return null;
    });

    await ExpoSecureStoreAdapter.removeItem('session');

    expect(mockDeleteItem).toHaveBeenCalledWith('session.0');
    expect(mockDeleteItem).toHaveBeenCalledWith('session.1');
    expect(mockDeleteItem).toHaveBeenCalledWith('session.2');
    expect(mockDeleteItem).toHaveBeenCalledWith('session.chunks');
    expect(mockDeleteItem).toHaveBeenCalledWith('session');
  });
});
