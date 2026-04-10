# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## About the Developer

The developer is a first-time app builder with no prior development experience. Always:
- Use plain, everyday language — avoid jargon, and when technical terms are unavoidable, explain them in simple terms.
- Give step-by-step instructions for any task (e.g. installing a tool, running a command, making a change).
- Explain *why* a step is needed, not just what to do.
- Don't assume prior knowledge of terminals, package managers, code editors, or version control.
- If something could go wrong or cause confusion for a beginner, flag it proactively.

## Shared Memory (Two Accounts — Read & Write Every Session)

All project progress, decisions, and context are stored in `.claude/memory/` inside this project directory so both Claude accounts can access it.

**At the start of every session:** Read `.claude/memory/MEMORY.md` and any linked files to get up to speed.
**During and at the end of every session:** Update `.claude/memory/MEMORY.md` and relevant memory files with any progress made, decisions taken, features completed, or blockers found. Create new memory files for new topics as needed.

This is the single source of truth shared across both accounts — keep it accurate and current.

## Session Management

When the session reaches 20,000 tokens used, notify the user and ask whether they would like to start a new session.

## Project Status

**Phase: Foundation complete. Next: install dependencies and wire up first screens.**

Project Rules for Secure Parenting Discovery App (UK & EU Standards)
**Project Type:** Location-based mobile/web app for parents to discover kid-friendly venues (softplays, parks, shops, etc.) with profiles, group sharing/posts, and business reviews.  
**Goal:** Build a production-ready, privacy-first, family-safe app fully compliant with **UK GDPR**, **EU GDPR**, the **ICO Age-Appropriate Design Code (Children's Code)**, and EDPB guidance on children's data. **Safety, security & data protection are #1 priority** — protect location data, parent profiles, group content, and reviews from leaks, abuse, or misuse. Zero tolerance for vulnerabilities, especially around families and children.

## Core Principles (Always Follow — Non-Negotiable)
- **Privacy by design and by default**: Follow UK GDPR & EU GDPR principles (lawfulness, fairness, transparency, purpose limitation, data minimisation, accuracy, storage limitation, integrity & confidentiality, accountability).
- **Heightened protection for children's data**: Even if the app targets parents, apply special safeguards per ICO Children's Code and EDPB guidance. Assume the service may be accessed by children.
- **Continuous validation**: After **ANY major code change** (or any change touching location, profiles, groups, reviews, auth, or personal data), ALWAYS run full tests + lint + security review + secret scan + feature-specific checks + Data Protection Impact Assessment (DPIA) considerations.
- Think like a paranoid senior security/privacy engineer focused on UK/EU family compliance. Assume malicious actors and strict ICO/EDPB enforcement.
- Fail fast on privacy violations, insufficient consent, or abuse vectors. Suggest fixes immediately.
- No hard-coded secrets. Never log raw locations or sensitive personal data.

## Architecture & Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | React Native + Expo SDK 51 | File-based routing via Expo Router v3 |
| Backend | Supabase | Auth + Postgres + Storage + Realtime |
| Maps | React Native Maps + Google Maps API | PROVIDER_GOOGLE on Android |
| Payments | Stripe (`@stripe/stripe-react-native`) | Subscriptions for users & businesses |
| State | Zustand (`store/`) | Auth state, filter state |
| Data fetching | TanStack React Query | Caching, loading states |
| Styling | NativeWind v4 (Tailwind for RN) | `tailwind.config.js` has brand colours |
| Fonts | Nunito (must download to `assets/fonts/`) | Regular, Medium, Bold, ExtraBold |
| Push notifications | Expo Notifications (wraps FCM/APNs) | |

### Folder structure
```
app/            Expo Router screens (file = route)
  (auth)/       Login, Register, Welcome — redirects if already logged in
  (tabs)/       Bottom tab nav: Explore (map), Search, Favourites, Profile
  venue/        [id].tsx = detail page, add.tsx = submission form
  business/     dashboard.tsx, upgrade.tsx
  admin/        moderation.tsx (admin-only)
components/     Reusable UI — not yet built, add here as needed
hooks/          useAuth, useLocation, useVenues (React Query wrappers)
lib/            supabase.ts, stripe.ts — initialisation only
store/          authStore.ts, filterStore.ts (Zustand)
types/          index.ts — all TypeScript interfaces matching DB schema
constants/      theme.ts (colours/fonts/spacing), categories.ts
supabase/
  migrations/   001_initial_schema.sql, 002_rpc_get_nearby_venues.sql
  seed.sql      Categories and facilities seed data
```

### Key data flows
- Auth: Supabase session → `useAuthListener` → `authStore` → all screens via `useUser()` / `useProfile()`
- Location: `useLocation()` requests permission then returns coords (falls back to London if denied)
- Venues on map: `useNearbyVenues(coords, filters)` calls Supabase RPC `get_nearby_venues` (PostGIS)
- Favourites: stored in `favourites` table, queried per user, toggled on venue detail screen
- Submissions: any user can submit a venue → `moderation_status='pending'` → admin approves in `/admin/moderation`
- Business premium: Stripe subscription → webhook → update `venues.is_premium` + `business_subscriptions`

### Database
- All tables in `supabase/migrations/001_initial_schema.sql`
- Row Level Security (RLS) enabled on every table — users can only access their own data
- PostGIS extension required for location queries (`get_nearby_venues` RPC)
- Triggers auto-maintain: `venue.location` (geography point), `review_count`, `average_rating`, `updated_at`, and new user profile creation

## Test & Quality Commands (Run These Automatically)

- Full test suite (watch mode): `npm test`
- Full test suite (CI, non-interactive): `npm run test:ci`
- Lint: `npm run lint`
- Lint + auto-fix: `npm run lint:fix`
- Type check (no emit): `npm run type-check`
- Run the dev server: `npx expo start` (add `--android` / `--ios` / `--web` to target a platform)
- Security scan: `npm audit` — run after any dependency change
- Secret leak scan: `npx trufflehog filesystem .` or equivalent before any commit

**Mandatory post-major-change sequence**: `npm run lint:fix` → `npm run type-check` → `npm run test:ci` → security + privacy review → secret scan → feature-specific tests.

- **Feature-specific tests** (mandatory after major changes):
  - Location permission flows (with "off by default" and clear indicators).
  - Consent mechanisms (granular, withdrawable, verifiable parental consent where needed).
  - Profile/group/review flows + moderation bypass tests.
  - Spoofing simulation, data minimisation checks, DPIA-relevant edge cases.

## Secrets Management Policy (Critical — Enforce Strictly)
Never hard-code any API keys (including map keys), credentials, or secrets. Use `.env` locally (never committed) + secret managers in production. Run secret scans after every config change.

## Forbidden Patterns (Never Do These)
- Hard-coded credentials, API keys, or secrets.
- Raw SQL, injection-prone patterns, client-side authorization for sensitive operations.
- Deprecated crypto; unvalidated user input (especially in reviews/posts).
- Exposing stack traces, internal paths, or raw personal data (including GPS coordinates).
- Committing `.env*` files.
- **UK/EU-specific forbids**:
  - Processing geolocation without explicit consent and clear justification.
  - Geolocation or profiling on by default.
  - Insufficient consent or transparency for children's data.
  - Logging raw locations, profiles, or review content in production.
  - Unmoderated social features that could expose families to harm.

## GPS/Location Privacy & Security Rules (Enforce on Every Task)
- **Geolocation off by default** (ICO Children's Code Standard 10) unless compelling reason justified in best interests of the child/family.
- Provide clear, prominent indicators when location is active.
- Revert sharing settings to off after each use.
- Data minimisation: Use coarse location where possible; delete old location data automatically.
- Explicit consent with clear benefit explanation before any GPS access.
- Hybrid location with basic spoofing resistance.
- Conduct DPIA for high-risk location processing.

## Profile, Groups & Reviews Security & Safety Rules (Enforce on Every Task)
**Before any social/profile feature:**
1. Perform threat modelling (abuse, harassment, fake reviews, data leaks, unauthorised sharing).
2. Ensure privacy requirements: granular consent, user controls (delete/export data, privacy zones), strong moderation.
3. Apply UK GDPR / EU GDPR + ICO Children's Code: transparency, high privacy default, age-appropriate design, verifiable parental consent where processing children's data (under 13 in UK / under 16 in most EU states).

**Implementation patterns (must use):**
- Profiles: Private by default; granular sharing controls.
- Groups/Posts: Moderation queue, rate limiting, abuse reporting/blocking; avoid features that connect to strangers without safeguards.
- Reviews: Verified check-ins where possible; prevent fake reviews; content moderation for harmful material.
- Sharing: Opt-in only; never auto-share location or sensitive family data.
- User rights: Easy access, rectification, erasure ("right to be forgotten"), consent withdrawal.

## UK & EU Compliance Review Checklist (Explicitly Run After Changes)
Review every relevant change against:
- UK GDPR & EU GDPR core principles and rights (including DPIA for high-risk processing).
- ICO Age-Appropriate Design Code (Children's Code) standards, especially geolocation, default high privacy, transparency, and no nudge techniques.
- EDPB guidance on children's data and age assurance (proportionate, least intrusive methods).
- PECR (Privacy and Electronic Communications Regulations) for electronic consent and tracking.
- Location data rules: explicit consent, minimisation, security.
- Social/UGC risks: abuse prevention, fake content, unauthorised access.

For each issue: Identify location, risk/exploit, severity (considering family impact), and exact fix.

## Continuous Security & Bug Checks (Mandatory Workflow — #1 Priority)
- After **every major code change** (and any change to location, profiles, groups, reviews, auth, consent flows, or personal data):
  - Run full test suite + feature-specific tests.
  - Perform full security + privacy/compliance review (UK GDPR/EU GDPR + ICO checklist).
  - Scan for bugs: permission failures, consent bypasses, moderation weaknesses, data leaks, spoofing.
  - Check attack vectors and privacy risks (including insufficient transparency or excessive tracking).
- If issues found: Fix immediately, re-run checks, provide diff + test coverage proof.
- Proactive alerts: Flag any potential GDPR violation, ICO Children's Code breach, family-privacy gap, or abuse vector.

## Coding Standards & Workflow
- Use modern, secure, up-to-date libraries only.
- Write tests for every new feature, including UK/EU edge cases (consent withdrawal, data subject requests, geolocation off/defaults, age-appropriate flows).
- Logging: Structured, no raw personal data or coordinates; include audit trails for accountability.
- Git: Feature branches. All checks (including privacy review) must pass before merge.
- Documentation: Clearly comment consent, minimisation, and compliance notes on sensitive code.

## Hooks & Continuous Monitoring (Claude Code Agent Behavior)
- **Auto-run after changes**: All tests + security/privacy/compliance reviews.
- **Proactive alerts**: Flag bugs, GDPR/ICO risks, consent issues, or family-safety gaps.
- **Self-review**: Before finishing any task, summarize: "UK & EU compliance checks passed / Bugs fixed / Potential attacks, abuse vectors & privacy risks mitigated / Consent, minimisation & Children's Code enforced."
- Invoke available tools (Snyk, secret scanners, mock location testers, consent flow simulators).

**Remember**: Your job is to deliver a family-trusted, compliant, bug-free app that meets the highest UK and EU data protection standards. If anything risks user privacy, consent, or family safety (or could attract ICO/EDPB enforcement), stop, explain the issue clearly, and propose the compliant alternative. Prioritise defence, transparency, and user rights over speed or features.

## Agent Suggestions (Proactive — Always Do This)

Whenever a task would be done better, faster, or in parallel by a specialised agent, say so **before starting**. Name the agent(s) explicitly and explain why they are the right fit. If two agents can work alongside each other (e.g. one researching while the other codes), say that too.

**Available agents and when to suggest them:**
- `agent-arch` — architectural decisions, build order, tech stack trade-offs, feature planning across multiple layers
- `Main-coder` — implementing features, folder structure, secure patterns for mobile/web (suggest for any significant new feature)
- `secom-reviewer` — after any code touching auth, location, profiles, groups, reviews, payments, or children's data (suggest proactively after meaningful changes)
- `Ui-agent` — screen wireframes, navigation flows, family-safety UI, accessibility, ICO Children's Code design review
- `Explore` — fast codebase searches across multiple files or patterns
- `Plan` — implementation strategy and step-by-step plans before starting a large task
- `claude-code-guide` — questions about Claude Code features, hooks, MCP servers, API usage

**How to suggest:** Say something like: *"@agent-arch would be most efficient here — it specialises in build-order decisions. We could also run @secom-reviewer in parallel to check compliance while arch plans the feature."* Then wait for the user to confirm before spawning.
