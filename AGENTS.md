# Agent Notes

- Use `bun run lint` for lint and TypeScript checks. Oxlint config enables `typeAware` and `typeCheck`.
- Check `bun run lint` after changes.
- After larger changes, run `bun run test:batch`.
- The UI is **Solid.js** under [`src/`](src/) with Vite ([`vite.config.mts`](vite.config.mts)), Tailwind ([`src/globals.css`](src/globals.css)), and [`@tanstack/solid-query`](https://tanstack.com/query/latest/docs/framework/solid/overview) for server-prefetched data (`window.__DEHYDRATED_STATE__` from [`server/html.rs`](server/html.rs)).
- Prefer explicit reactivity: signals, memos, `<Show>` / `<For>`; use `class` for CSS. Avoid breaking prop reactivity when spreading props.
- When adding e2e tests, keep files independent so they can run in parallel without ordering assumptions.
- `test:batch` runs **6 batches in parallel** with **1 Playwright worker each** (`fullyParallel: false` keeps tests inside a file ordered). Local `bun run test` also uses **1 worker** for easier debugging.

## Commands

- **Dev:** `bun run dev` — Rust API server launches Vite separately and proxies frontend requests.
- **Production:** `bun run build` then `bun run start` — Rust serves static `dist/client` with dehydrated TanStack Query state.
- **E2E:** `bun run test` or `bun run test:batch` — specs in [`tests/e2e/`](tests/e2e/), config [`playwright.config.ts`](playwright.config.ts), batches in [`tests/run-batches.ts`](tests/run-batches.ts).

## Solid patterns

- Use `useQuery` / `useMutation` from `@tanstack/solid-query` for new data flows.
- Client global state uses `solid-js/store` in [`src/lib/`](src/lib/) with `getState()` / `subscribe()`; [`useStoreSync`](src/lib/solid-store-sync.ts) bridges into component memos when needed.
- Don't add redundant "solid" prefixes in file names under `src/`.
- Don't write useless comments.
- Keep at most **6** e2e batches in `run-batches.ts` when extending CI.

For framework docs, see the [Solid.js reference](https://docs.solidjs.com/).
