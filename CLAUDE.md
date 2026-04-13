# CLAUDE.md

## Dev Context
Beginner:
- Use simple language, explain terms.
- Give step-by-step + why.
- Assume no prior tooling knowledge.
- Flag confusion risks early.

## Memory (REQUIRED)
`.claude/memory/`
- Start: read `MEMORY.md`
- End: update progress/decisions
- Shared source of truth

## Session
At 20k tokens → notify.

## Project
Parenting app (venues, groups, reviews).  
**Priority:** privacy, safety, UK/EU compliance.

---

## Core Rules (STRICT)
- Privacy by design/default.
- Extra protection for children’s data.
- No secrets or sensitive logs (esp. location).
- Assume attackers + strict regulators.
- After major changes → ALWAYS:
  `lint:fix → type-check → test:ci → security/privacy review → secret scan`

Fail fast on violations.

---

## Stack
RN + Expo, Supabase, Maps, Stripe, Zustand, React Query, NativeWind.

## Structure
`app/`, `components/`, `hooks/`, `lib/`, `store/`, `types/`, `constants/`, `supabase/`

---

## Key Flows
Auth (Supabase→store), location (permission→coords), venues (RPC), favourites, submissions (moderated), payments (Stripe webhook).

## DB
- RLS everywhere
- PostGIS for location
- Auto triggers (ratings, profiles, timestamps)

---

## Security (NEVER)
- Hardcode secrets / commit `.env`
- Log personal/location data
- Unsafe SQL / client-side auth

ALWAYS:
- Validate input
- Use secure patterns
- Run secret scans

---

## Location Rules
- OFF by default
- Explicit consent
- Clear indicator
- Reset after use
- Minimise + delete old data
- Prefer coarse location
- DPIA for high risk

---

## Social Safety
Before building:
- Threat model (abuse, leaks, fake content)
- Ensure consent + controls

Must:
- Private profiles default
- Moderation + reporting
- No auto-sharing
- Verified reviews where possible
- User rights (delete/export)

---

## Compliance (CHECK AFTER CHANGES)
UK/EU GDPR, ICO Children’s Code, EDPB, PECR:
- Consent, transparency
- Data minimisation
- Abuse risks

Fix immediately.

---

## Workflow
- Tests for all features (incl. consent edge cases)
- No sensitive logging
- Feature branches
- Document privacy decisions

---

## Continuous Checks (MANDATORY)
After changes to auth/location/profiles/groups/reviews/data:
- Run tests
- Security + privacy review
- Check leaks, consent bypass, spoofing

Fix immediately.

---

## Agent Behaviour
- Auto-run checks
- Proactively flag risks
- End summary must confirm:
  compliance ✓ bugs ✓ risks ✓

---

## Agents (Suggest FIRST)
- `agent-overseer` (plan/coordinate)
- `elite-engineer` (complex/sensitive)
- `agent-arch`, `secom-reviewer`, `bughunter`, `test-engineer`, etc.

Ask before spawning.