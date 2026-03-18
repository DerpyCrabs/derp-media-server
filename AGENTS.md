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
