// =============================================================================
// scripts/enrich/web/robotsParse.ts
//
// Pure robots.txt parser + matcher (spec §5). No I/O — the fetch layer hands us
// the already-downloaded body. Implements the widely-supported subset:
//   - User-agent grouping (consecutive User-agent lines share a group)
//   - Allow / Disallow with '*' wildcard and '$' end-anchor
//   - longest-match precedence; Allow wins ties (Google's rule)
//   - Crawl-delay
//
// Conservative by design: an EMPTY robots body (or no matching rule) → allowed.
// A literal "Disallow:" (empty value) imposes no restriction. The FETCH layer
// decides what to do when robots.txt can't be retrieved (fail-closed) — that is a
// network policy, not a parsing concern.
//
// No '@/' path alias — runs outside the Expo app bundle.
// =============================================================================

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsGroup {
  agents: string[]; // lowercased user-agent tokens
  rules: RobotsRule[];
  crawlDelaySec?: number;
}

export interface RobotsTxt {
  groups: RobotsGroup[];
}

export function parseRobots(body: string): RobotsTxt {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let sawRuleSinceAgent = false;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;

    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      // A new user-agent after rules starts a fresh group; consecutive
      // user-agents (before any rule) extend the same group.
      if (!current || sawRuleSinceAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
        sawRuleSinceAgent = false;
      }
      current.agents.push(value.toLowerCase());
    } else if (field === 'disallow') {
      if (!current) continue;
      sawRuleSinceAgent = true;
      if (value !== '') current.rules.push({ allow: false, pattern: value });
      // empty Disallow → no restriction (skip)
    } else if (field === 'allow') {
      if (!current) continue;
      sawRuleSinceAgent = true;
      if (value !== '') current.rules.push({ allow: true, pattern: value });
    } else if (field === 'crawl-delay') {
      if (!current) continue;
      sawRuleSinceAgent = true;
      const n = Number(value);
      if (!Number.isNaN(n) && n >= 0) current.crawlDelaySec = n;
    }
  }

  return { groups };
}

/** Pick the most specific group for `userAgent` ('*' is the fallback). */
function selectGroup(robots: RobotsTxt, userAgent: string): RobotsGroup | null {
  const ua = userAgent.toLowerCase();
  let best: RobotsGroup | null = null;
  let bestLen = -1;
  let star: RobotsGroup | null = null;

  for (const g of robots.groups) {
    for (const agent of g.agents) {
      if (agent === '*') {
        star = star ?? g;
      } else if (ua.includes(agent) && agent.length > bestLen) {
        best = g;
        bestLen = agent.length;
      }
    }
  }
  return best ?? star;
}

/** Is `path` (e.g. "/opening-times") crawlable for `userAgent`? */
export function isPathAllowed(robots: RobotsTxt, userAgent: string, path: string): boolean {
  const group = selectGroup(robots, userAgent);
  if (!group) return true;

  let decision = true; // default allow
  let bestLen = -1;

  for (const rule of group.rules) {
    const len = matchLength(rule.pattern, path);
    if (len < 0) continue;
    if (len > bestLen || (len === bestLen && rule.allow)) {
      bestLen = len;
      decision = rule.allow;
    }
  }
  return decision;
}

/** Crawl-delay for the matching group, in milliseconds, or null. */
export function crawlDelayMs(robots: RobotsTxt, userAgent: string): number | null {
  const group = selectGroup(robots, userAgent);
  if (!group || group.crawlDelaySec === undefined) return null;
  return group.crawlDelaySec * 1000;
}

// ── Pattern matching ──────────────────────────────────────────────────────────

/** Returns the matched specificity length, or -1 if the pattern doesn't match. */
function matchLength(pattern: string, path: string): number {
  // Fast path: no wildcards/anchors → simple prefix match.
  if (!pattern.includes('*') && !pattern.includes('$')) {
    return path.startsWith(pattern) ? pattern.length : -1;
  }
  // Specificity = pattern length minus the '*'/'$' meta chars.
  const specificity = pattern.replace(/[*$]/g, '').length;
  return globMatch(pattern, path) ? specificity : -1;
}

/**
 * Linear glob matcher for robots patterns ('*' = any run, '$' = end anchor).
 * Greedy with backtracking to the LAST '*' only → O(n·m) worst case, NOT regex
 * (robots.txt is attacker-hosted, so a regex here is a ReDoS vector — sec #5).
 */
function globMatch(pattern: string, path: string): boolean {
  let pi = 0;
  let si = 0;
  let starPi = -1;
  let starSi = 0;

  while (si < path.length) {
    const pc = pattern[pi];
    if (pc === '$') {
      // '$' only matches end-of-path; otherwise fall through to backtrack.
      if (pi === pattern.length - 1) return si === path.length;
    }
    if (pi < pattern.length && pc === '*') {
      starPi = pi;
      starSi = si;
      pi += 1;
    } else if (pi < pattern.length && pc === path[si]) {
      pi += 1;
      si += 1;
    } else if (starPi >= 0) {
      pi = starPi + 1;
      starSi += 1;
      si = starSi;
    } else {
      return false;
    }
  }
  // Consume any trailing '*' (and an optional final '$' that now matches the end).
  while (pi < pattern.length && pattern[pi] === '*') pi += 1;
  if (pi < pattern.length && pattern[pi] === '$') pi += 1;
  return pi === pattern.length;
}

function stripComment(line: string): string {
  const i = line.indexOf('#');
  return i < 0 ? line : line.slice(0, i);
}
