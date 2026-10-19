# TypeScript and JavaScript Review Reference

Load this reference for TypeScript or JavaScript changes. Raise these only when the changed code
creates a concrete risk:

- Treat `any`, unsafe assertions, unchecked casts, and non-null assertions as boundary claims to
  verify against runtime data, not as bugs by themselves.
- Check nullable and optional values at the point they enter the system. Confirm interfaces and
  generated/API types match actual responses, including partial or malformed data.
- Look for narrowed values escaping their narrowing scope, weak generic constraints, duplicated
  domain types, and enums/constants that can drift from runtime values.
- Check promise rejection, missing `await`, accidental sequential or parallel execution, and
  cleanup of resources created by asynchronous work.
- Prefer a type or discriminated state that rules out invalid combinations when the change adds
  branching state or public API shapes.

Report a type concern only when it can produce incorrect runtime behavior, hide a real boundary
failure, or materially weaken a contract.
