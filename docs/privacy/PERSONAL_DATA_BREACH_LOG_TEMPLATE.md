# Personal Data Breach Log — Template

**Use one copy of this template per incident.** Retain every completed log **even when no ICO
notification is made** — see `PERSONAL_DATA_BREACH_RESPONSE.md` §10 for why. This is a template, not a
record of any actual incident.

---

## Incident identification

- **Incident ID:**
- **Date/time detected:**
- **Date/time controller became aware** (may differ from detection — awareness is when a breach was
  reasonably established, not merely suspected):
- **Detected by:** (developer / admin / user report / external researcher / other)
- **Incident owner:**

## What happened

- **Nature of the breach:** (confidentiality breach / integrity breach / availability breach — a breach
  can be more than one of these at once)
- **Affected system(s):** (table / API endpoint / storage bucket / processor)
- **Root cause (initial assessment, refine as investigation proceeds):**

## Scope

- **Categories of individuals affected:**
- **Approximate number of individuals affected:**
- **Categories of personal data/records affected:**
- **Approximate number of records affected:**
- **Special-category or Children's-Code-relevant data involved?** (Y/N — if Y, flag for heightened review
  per `CHILDRENS_CODE_SCOPE_ASSESSMENT.md`)
- **Processor(s) implicated, if any:** (cross-reference `PROCESSOR_AND_VENDOR_REGISTER.md`)
- **International element, if any:** (cross-reference `INTERNATIONAL_TRANSFERS.md`)

## Containment

- **Immediate action taken:**
- **Date/time contained:**
- **Evidence preserved:** (what, and how)

## Risk assessment

- **Likely harm to individuals:**
- **Likelihood of that harm:**
- **Mitigating factors (encryption, pseudonymisation, short exposure window, trusted recipient, etc.):**
- **Conclusion — is the breach likely to result in a risk to individuals' rights and freedoms?** (Y/N,
  with reasoning)
- **If Y — is it likely to result in a HIGH risk?** (Y/N, with reasoning)

## Notification decisions

- **ICO notification required?** (Y/N, with reasoning — record even a "No" decision's reasoning in full)
- **If Y:** date notified: _______ · within 72 hours? (Y/N — if N, record the reason for the delay)
- **Individual notification required?** (Y/N, with reasoning)
- **If Y:** date notified: _______ · method: _______
- **Other regulator/processor notification required?** (e.g. an implicated processor's own jurisdiction)

## Remediation

- **Underlying cause fixed:** (description, date, verification method)
- **Verification that the fix actually works** (per this project's standing discipline: re-run the
  relevant privilege probe / test / gate — don't just assert it's fixed):

## Lessons learned

- **What allowed this to happen:**
- **What would have caught it sooner:**
- **Process/tooling changes recommended:**

## Closure

- **Date closed:**
- **Closed by:**
- **Final summary (for future reference — write for a reader with no memory of this incident):**
