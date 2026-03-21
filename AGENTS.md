# Agent Notes

- Use `bun run tsgo` for TypeScript checks. Do not use `tsc`.
- Check `bun run lint-errors` after changes.
- After larger changes, run `bun run test:batch`.
- The UI is **Solid.js** under [`src/`](src/) with Vite ([`vite.config.ts`](vite.config.ts)), Tailwind ([`src/globals.css`](src/globals.css)), and [`@tanstack/solid-query`](https://tanstack.com/query/latest/docs/framework/solid/overview) for server-prefetched data (`window.__DEHYDRATED_STATE__` from [`server/html.ts`](server/html.ts)).
- Prefer explicit reactivity: signals, memos, `<Show>` / `<For>`; use `class` for CSS. Avoid breaking prop reactivity when spreading props.
- Shared view must not use admin-only routes; share flows stay scoped by `shareToken`.
- When adding e2e tests, keep files independent so they can run in parallel without ordering assumptions.
- `test:batch` sets `BATCH_ID`; Playwright uses **4 workers** (parallel **files**; `fullyParallel: false` keeps tests inside a file ordered). Local `bun run test` uses **1 worker** for easier debugging.

## Commands

- **Dev:** `bun run dev` — Fastify + Vite middleware ([`server/index.ts`](server/index.ts)).
- **Production:** `bun run build` then `bun run start` (static `dist/client`).
- **E2E:** `bun run test` or `bun run test:batch` — specs in [`tests/e2e/`](tests/e2e/), config [`playwright.config.ts`](playwright.config.ts), batches in [`tests/run-batches.ts`](tests/run-batches.ts).

## Solid patterns

- Use `useQuery` / `useMutation` from `@tanstack/solid-query` for new data flows.
- Prefer `solid-js/store` over zustand for new client state; existing code may still use zustand with `getState()` / `subscribe()` from Solid.
- Don't add redundant "solid" prefixes in file names under `src/`.
- Don't write useless comments.
- Keep at most **6** e2e batches in `run-batches.ts` when extending CI.

For framework docs, see the [Solid.js reference](https://docs.solidjs.com/).
