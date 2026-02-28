---
"better-convex": patch
---

## Features

- Add `polymorphic` query config support for `findMany()`, `findFirst()`, and `findFirstOrThrow()` to synthesize discriminated-union targets from `one()` relations.
- Support custom target aliases with `polymorphic.as` (default alias is `target`) while preserving discriminated-union narrowing by discriminator value.

## Patches

- Validate polymorphic configs at runtime and throw on discriminator/case mismatches or schema parse failures.
- Auto-load required polymorphic case relations during synthesis and strip them from results unless explicitly requested via `with`.
- Reject `pipeline` + `polymorphic` combinations with explicit query-builder errors.
