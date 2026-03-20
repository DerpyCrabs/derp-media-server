# Agent Notes

- Use `bun run tsgo` for TypeScript checks. Do not use `tsc`.
- Check `bun run lint-errors` after changes.
- After larger changes, run `bun run test:batch`.
- Prefer modern React patterns: derive state, keep components focused, and extract custom hooks when logic is reusable.
- Avoid `useEffect` and `useRef` unless there is a clear need. Prefer declarative data flow, event handlers, memoization, and derived state.
- For data fetching, caching, invalidation, and request state, use `@tanstack/react-query`. New request flows should go through TanStack Query.
- When implementing features in admin view you need to think if they should also be added to shared view.
- Shared view should never access admin view routes and should have their own routes scoped by shareToken.
- When adding e2e tests try to not depend on other tests so that test files can run in parallel without changes
- `test:batch` sets `BATCH_ID`; Playwright then uses **4 workers** (parallel **files**, `fullyParallel: false` keeps tests inside a file ordered). Local `bun run test` stays **1 worker** so it’s easier to debug.

## Solid.js (`solid/`)

The app can ship a **Solid** client beside React. The Fastify server chooses the UI via `UI_FRAMEWORK` (`react` default, `solid` for the Solid tree). Same API, same HTML dehydration hook (`window.__DEHYDRATED_STATE__` from the server).

### Running and building

- **Dev:** `bun run dev:solid` — serves with Vite middleware from `solid/vite.config.ts` (see `server/index.ts`).
- **Production:** `bun run build:solid` then `bun run start:solid`, or `bun run build:all` to build both clients.
- **Typecheck:** `bun run tsgo` checks the main TS project **and** `solid/tsconfig.json`. Root `tsconfig.json` **excludes** `solid/` so JSX modes stay separate (React vs Solid).
- **Styles:** `solid/globals.css` is a **copy** of `src/globals.css`, imported only from Solid entry (`../globals.css`). Keep React and Solid themes in sync **deliberately** when design tokens change.

### Tests (Solid)

- **Single config:** `bun run test:solid` — Playwright uses [`playwright.solid.config.ts`](playwright.solid.config.ts), `webServer.env.UI_FRAMEWORK=solid`, specs under `tests/e2e-solid/`. Default URL port **5974** (React tests use **5973**) so both can run locally without clashing.
- **Batches:** `bun run test:batch:solid` runs [`tests/run-batches-solid.ts`](tests/run-batches-solid.ts) (parallel batches + `BATCH_ID`, same fixture pattern as `test:batch`).
- **Adding specs:** Add `tests/e2e-solid/<name>.spec.ts` and extend `BATCHES` in `run-batches-solid.ts` when you want a file in CI batch runs. Reuse [`tests/fixtures/setup.ts`](tests/fixtures/setup.ts) / teardown via the Solid Playwright config.
- After Solid UI changes, run `bun run test:solid` or `test:batch:solid`; after mixed changes, still run `bun run test:batch` for the React suite.

### Migration (React → Solid)

**Roadmap (test-driven, copy React e2e → implement Solid until green):** [`docs/solid-migration-plan.md`](docs/solid-migration-plan.md).

Work **feature-by-feature**, not a big-bang rewrite:

1. **Shared non-UI code** — Prefer importing from `lib/`, `server/`, types, etc. via the `@/*` alias (resolved from repo root in `solid/vite.config.ts`). Keep browser-only APIs out of shared modules or gate them.
2. **Routes and parity** — Mirror admin vs shared rules from React: shared flows stay scoped by `shareToken`; do not point shared views at admin-only routes. When you add an admin screen in Solid, decide if shared view needs the same behavior.
3. **Server HTML / data** — `server/html.ts` already prefetches and `JSON.stringify`s TanStack Query dehydrated state. The Solid entry (`solid/src/index.tsx`) uses **`@tanstack/solid-query`**: `hydrate(queryClient, window.__DEHYDRATED_STATE__)` before render (when present) and wraps the app in **`QueryClientProvider`**. Use **`useQuery` / `useMutation`** from `@tanstack/solid-query` for new data flows (same core as React Query).
4. **UI** — Rebuild screens in `solid/src/` with Solid components. **Do not use** `react-rnd`, `@base-ui/react`, or React shadcn wrappers—implement Solid equivalents (windowing via pointer-driven layout; primitives via **Kobalte** or small accessible building blocks; Tailwind tokens from `solid/globals.css`). Aim for **fewer DOM nodes** and **less incidental markup** than the React tree where it improves clarity and performance.
5. **E2E** — Port tests under `tests/e2e-solid/`; keep files independent for parallel runs. **Adapt** Solid specs when the UI is intentionally leaner (prefer `role` / `data-testid` over React-specific structure); keep the same **user-visible and API** behavior.

### Solid patterns (when editing `solid/src/`)

- **Reactivity is explicit** — Use signals (`createSignal`), derived values (`createMemo`), and control flow (`<Show>`, `<Switch>` / `<Match>`). Prefer **`class`** for CSS classes (not `className`).
- **Props and spreading** — Avoid breaking reactivity: don’t destructure props in a way that unwraps getters; use **`props.x`** or **split props** helpers from `solid-js` when needed.
- **Effects** — Use `onMount` / `createEffect` sparingly; many React `useEffect` cases become event handlers, memos, or resources.
- **Side effects in JSX** — Don’t rely on render running for one-off side effects; use `onMount` or user events.
- **Lists** — Use `<For>` with a stable key callback when rendering collections; avoid indexing into large lists without keys.
- **Async data** — Prefer TanStack Solid Query instead of ad-hoc `createSignal` + effect chains.
- Don't add solid to names, they are already in solid directory
- Don't write useless comments

For framework docs and APIs, see the [Solid.js reference](https://docs.solidjs.com/).
