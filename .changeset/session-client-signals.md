---
"better-convex": patch
---

## Features

- Add `getSessionNetworkSignals(ctx, session?)` in `better-convex/auth` to expose session-derived `ip` and `userAgent` for query/mutation middleware and rate-limit guards without per-endpoint HTTP wrappers.
