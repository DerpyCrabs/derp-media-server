# Agent Notes

- This is a single-user app installed as a personal instance. Multiple browser tabs belong to the same user; they are not collaborators
- Use `bun run lint` for lint and TypeScript checks. Oxlint config enables `typeAware` and `typeCheck`.
- Check `bun run lint` after changes.
- After larger changes, run `bun run test:batch`.
- The UI is **Effect + EffectWeb** under [`src/`](src/), compiled by `@effectweb/compiler` through Vite, with Tailwind in [`src/globals.css`](src/globals.css).
- Views render immutable snapshots; use `view`, `observe`, keyed `list`/`collection`, and `localComponent` for view-local state. Controllers own effects, queries, subscriptions, and DOM lifetimes.
- When adding e2e tests, keep files independent so they can run in parallel without ordering assumptions.
- `test:batch` runs **6 batches in parallel** with **1 Playwright worker each** (`fullyParallel: false` keeps tests inside a file ordered). Local `bun run test` also uses **1 worker** for easier debugging.

## Commands

- **Dev:** `bun run dev` — Rust API server launches Vite separately and proxies frontend requests.
- **Production:** `bun run build` then `bun run start` — Rust serves static `dist/client` with initial query data in `window.__INITIAL_DATA__` from [`server/html.rs`](server/html.rs).
- **E2E:** `bun run test` or `bun run test:batch` — specs in [`tests/e2e/`](tests/e2e/), config [`playwright.config.ts`](playwright.config.ts), batches in [`tests/run-batches.ts`](tests/run-batches.ts).

## EffectWeb patterns

- Use EffectWeb query definitions and the shared [`queryCache`](src/lib/api/cache.ts), `observeQuery`, and query groups for server data. Seed queries through the bootstrap helpers.
- Use `modelOwner` for immutable state and owned Effect commands for asynchronous work. Scope resources to their controller or app lifetime and dispose them explicitly.
- Keep view functions pure. Use `domBinding`/`domMount` for DOM resources and stable module-level acquisition functions; close subscriptions, timers, and media resources on disposal.
- The local EffectWeb checkout is `../EffectWeb`; its `packages/runtime/AUTHORING.md` and examples document the supported APIs.
- Don't write useless comments.
- Keep at most **6** e2e batches in `run-batches.ts` when extending CI.
