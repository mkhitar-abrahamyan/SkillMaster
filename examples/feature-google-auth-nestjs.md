# Example: Google sign-in for a NestJS API

A feature taken through every stage of `skillmaster-workflow`. Output excerpts are illustrative;
paths, counts, and findings in your project will differ.

**Prompt**

> Use SkillMaster to implement Google authentication in my NestJS project. Understand the
> architecture, create a plan, implement the feature, test it, and review it for security problems.

## 1. Understand — `repo-context-builder`

Finds the existing auth module and its JWT strategy, how guards are registered, the user entity and
repository, the configuration pattern, and the real test commands from CI.

```markdown
| Task       | Command          | Provenance                                    |
|------------|------------------|-----------------------------------------------|
| Unit tests | `yarn test`      | verified                                      |
| E2E tests  | `yarn test:e2e`  | documented (CI) — needs the Postgres service  |
```

**Gate:** build and test commands known.

## 2. Plan — `feature-planner`

Asks only the questions that change the design, in one batch:

- When a Google email matches an existing password account, link the accounts or refuse?
- After Google sign-in, issue the existing JWT or a new session type?

```markdown
AC2  Given a Google profile whose email is not verified, When the callback runs,
     Then sign-in is refused and no account is created or linked.
AC3  Given a missing or tampered `state` value, When the callback runs, Then it returns 401.

Step 3  Create src/auth/strategies/google.strategy.ts like src/auth/strategies/jwt.strategy.ts.
        validate() maps the profile and rejects unverified or missing emails.
        verify: yarn test src/auth/strategies/google.strategy.spec.ts -> 3 passing

Risk    passport-oauth2's built-in state check stores state in a session, and this API is
        stateless. Mitigation: a signed, short-lived state cookie, covered by AC3.
```

**Gate:** `Plan readiness: READY` once the linking question is answered.

## 3. Implement

The plan's steps run in order, and each `verify:` line runs before the next step starts.

## 4. Verify — `ai-code-verifier`, `test-gap-finder`

The verifier checks the agent's own claims as strictly as anyone else's:

```markdown
| ID | Claim                                    | Status       | Evidence                                    |
|----|------------------------------------------|--------------|---------------------------------------------|
| C1 | Callback rejects a tampered state        | verified     | google.e2e-spec.ts "rejects tampered state" |
| C2 | All auth tests pass                      | contradicted | yarn test:e2e: 1 failed (refresh after link) |
```

The gap finder maps behaviors and proves each new test can fail:

```markdown
| B3 | Unverified Google email is refused | google.strategy.ts:41 | google.strategy.spec.ts | asserted (added) | P1 |
Mutation: removed the email_verified check -> test failed (killed)
```

Contradicted claims and findings go back to stage 3; this stage then runs again.

## 5. Review and attack — `ruthless-code-reviewer`, `adversarial-patch-attacker`

```markdown
### [P1] Post-login redirect trusts the returnTo query parameter
Location: src/auth/google.controller.ts:58-61
Confidence: verified
```

The attacker runs targeted tests: an email collision with an existing account, replaying an old
`state` value, and calling the callback with a code issued to a different client.

**Gate:** no P0/P1 findings remain; each P2 is fixed or justified.

## 6. Final report

```markdown
Delivery result: PARTIALLY VERIFIED

Verified (on final code): yarn test -> 214 passed; yarn test:e2e -> 31 passed; yarn lint -> clean
Unverified assumptions:
- The production redirect URI is registered in the Google Cloud OAuth client.
  Settle by checking the console; no access from this environment.
Residual risks: none above P3.
Next steps:
1. Register https://api.example.com/auth/google/callback in the OAuth client.
```

The report is `PARTIALLY VERIFIED`, not `VERIFIED`, because one deployment fact could not be
checked from here. It says so rather than claiming success.
