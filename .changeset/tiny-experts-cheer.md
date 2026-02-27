---
"better-convex": patch
---

Fix auth adapter date output regression.

`getAuth(ctx).api.*` date fields are normalized back to Convex-safe unix millis (`number`) on output, preventing unsupported `Date` values from leaking into raw Convex query/mutation/action returns (for example `auth.api.listOrganizations`).
