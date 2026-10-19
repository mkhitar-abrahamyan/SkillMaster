# Example: from bug report to verified fix

A bug taken through `bug-reproducer`, `test-gap-finder`, `ruthless-code-reviewer`, and
`session-handoff`. Output excerpts are illustrative.

**Prompt**

> Users in UTC-5 see the day before in the invoice date field. Reproduce and fix it, check the
> tests are solid, review the fix, and write a handoff for the team.

## 1. Reproduce and fix — `bug-reproducer`

The skill writes a failing test before reading for a fix. Pinning the timezone makes the
reproduction deterministic on any machine:

```bash
TZ=America/New_York yarn vitest run src/invoices/formatInvoiceDate.test.ts
```

```text
FAIL  formats a date-only value as the same calendar day
Expected: "03/01/2026"
Received: "02/28/2026"
```

```markdown
Root cause: src/invoices/formatInvoiceDate.ts:7 — `new Date("2026-03-01")` parses a date-only ISO
string as UTC midnight; `toLocaleDateString()` then renders it in local time, which is the previous
day anywhere west of UTC. Confidence: verified (fails under TZ=America/New_York, passes under TZ=UTC).
Fix: parse year, month, and day as local date parts; no other callers change.
Verification: the reproduction failed before the fix and passes after it; yarn vitest run src/invoices -> 58 passed.
```

**Result:** `Bug status: FIXED`

## 2. Check the tests — `test-gap-finder`

```markdown
| B1 | Date-only input, zone west of UTC  | asserted (reproduction)        | P1 |
| B2 | Date-only input, zone east of UTC  | untested -> added, mutation killed | P2 |
| B3 | Daylight-saving transition date    | untested -> added, mutation killed | P2 |
```

**Result:** `Coverage result: GAPS CLOSED`

## 3. Review — `ruthless-code-reviewer`

The review covers the fix and the new tests together. Here it found one sibling occurrence of the
same parsing pattern in `src/reports/period.ts`, reported as a P2 for a separate change.

**Result:** `Verdict: APPROVE WITH MINOR ISSUES`

## 4. Hand off — `session-handoff`

```markdown
Status: ready for review — fix verified, one related P2 left for a separate change.
| Unit tests | yarn vitest run src/invoices | 60 passed | yes |
Next actions:
1. Open a ticket for the same pattern in src/reports/period.ts:22.
```
