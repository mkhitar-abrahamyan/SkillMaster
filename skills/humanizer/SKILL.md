---
name: humanizer
description: Use when the user asks to make code review findings, a review report, or other technical findings simpler, friendlier, plainer, or easier to understand, or wants a review explained for a less technical reader or a junior teammate. Rewrites existing findings in plain, human language without changing priority, verification status, location, or verdict. Not for performing the review itself, which belongs to ruthless-code-reviewer.
license: MIT
---

# Skill: Humanizer

## Role

Take findings that already exist, usually from `ruthless-code-reviewer`, and restate them so a
teammate understands the problem and the fix on the first read. Change the wording only. The
review's facts, priorities, and verdict stay exactly as the reviewer produced them.

`ruthless-code-reviewer` applies this skill automatically to its final review. It is not applied to
`context-keeper` records or other machine-read notes, where exact wording matters.

Do not review code, re-verify findings, add findings, or drop findings. If the source findings are
missing or unclear, ask for them or run the reviewer first.

## What must not change

Keep each of these identical to the source finding:

- Priority (`P0` to `P3`) and the order of findings.
- **Verification status** (`VERIFIED`, `LIKELY`, `UNVERIFIED`). Do not make a `LIKELY` finding
  sound certain, or a `VERIFIED` one sound doubtful. Keep the unresolved assumption of an
  `UNVERIFIED` finding.
- File paths, line ranges, symbol names, commands, and quoted code.
- The verdict and the checks actually performed.

## Rewrite rules

1. **Say the impact first.** Start with what goes wrong for a user, the data, or the team, then
   explain why.
2. **One idea per sentence.** Use short sentences and everyday words. Replace jargon with a plain
   phrase, or explain it once in brackets when the term matters for finding the code.
3. **Show the trigger concretely.** Give a small example: "If two requests arrive at the same
   time, the second one overwrites the first."
4. **Give a next step.** End each finding with a fix direction in plain words, taken from the
   source. Do not invent a fix the reviewer did not suggest.
5. **Neutral, kind tone.** Describe the code, not the author. Avoid blame, sarcasm, drama, and
   filler such as "unfortunately" or "it seems like". Keep serious problems clearly serious: do
   not soften a `P0` or `P1` into a suggestion.
6. **No padding.** No praise sandwich, no greeting, no summary of what you are about to say.

## Output

Keep the reviewer's structure, with a plainer title and body:

### [P1] Plain-language title under 80 characters

**Location:** unchanged

**Verification status:** unchanged

Two to four short sentences: what breaks, when it happens, why, and what to do about it.

End with **Verdict:** unchanged label, plus one plain sentence on what it means for the author
("Fix the two P1 items, then it can merge").

Before sending, compare the result with the source: same number of findings, same priorities,
same status labels, same locations, same verdict. Correct any difference.
