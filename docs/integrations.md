# Integration authoring

Integrations are compile-time modules. They contribute narrow capabilities while shared features
remain unaware of provider-specific paths, DTOs, and behavior. Adding an integration should require
its module and one registration entry on each side of the client/server boundary that it uses.

## Module layout and registration

Put server code under `server/integrations/<id>/`. Keep upstream transport, DTO normalization,
runtime/session state, and capability implementations inside that directory. Register the module
once in the server integration registry. Do not add provider branches to `AppState`, file routes, or
core route handlers.

Put frontend code under `src/integrations/<id>/`. Export one `IntegrationModule` and register it once
in `src/integrations/registry.ts`. A module may claim only the capabilities it implements:

- browse or inspect resources;
- resource actions;
- search;
- assistant/chat;
- content renderers, codecs, presentation, and lifecycle behavior.

Provider event transports stay private to their integration. Do not expose a second generic frontend
event bus through `IntegrationModule`.

Use an opaque `ResourceKey.id` for provider resources. Filesystem logical paths belong only to the
filesystem integration. Do not add compatibility decoders, alternate write formats, or fixtures for
superseded resource locators.

## Add an integration

1. Define server capability implementations and normalized DTOs in
   `server/integrations/<id>/`.
2. Register the server module once and add provider-conformance fixtures for every claimed
   capability.
3. Export a frontend `IntegrationModule` from `src/integrations/<id>/module.ts`.
4. Register that module once in `src/integrations/registry.ts`.
5. Add a fixture test proving browse, action, search, and content contributions are reachable through
   neutral registries. Core Explorer, viewer, Workspace, and Canvas files must remain unchanged.

Run the focused conformance gate while developing:

```bash
bun run test:conformance
```

## Add a resource action

Add one capability string and one action descriptor to the owning integration. Implement execution
through that integration's typed transport. Resource actions must remain available on every surface;
surface modules may only adapt placement or input presentation. Test descriptor visibility,
capability gating, normalized input, typed outcome, and error handling.

Do not add action switches to Explorer or any route shell.

## Add a search contributor

Implement the integration's search capability and return typed results with stable contributor and
result IDs, a `ResourceSummary`, score, optional detail/snippet, and supported actions. Results must
not expose fake filesystem paths for non-filesystem providers. Register through the integration
module; open panes may be supplied as host-local results to the shared search controller.

Test normalization, deterministic ranking, limits, cancellation, partial contributor failure,
deduplication, and opaque resource identity. Resource-result execution must use the shared
`openResource` planner. Host-local focus is the only search action that bypasses an `OpenPlan`.

Do not create provider-specific palettes. Library/Workspace and Canvas keep their existing chrome and
triggers over the shared search owner.

## Add a content renderer

Add one lazy renderer descriptor to the owning frontend integration. Match neutral resource kind,
MIME, presentation, or content state; do not inspect provider paths in core renderer code. Add a
versioned codec when content persists, plus sanitizer, presentation, and lifecycle descriptors when
needed.

Test resolution, lazy loading, codec round-trip, malformed and unknown payload recovery, close
lifecycle, and mounting through Library, Workspace, and Canvas hosts. Surface code may provide chrome
and geometry only.

## Contracts and verification

Rust DTOs are the authority for generated client declarations. Regenerate after contract changes and
commit the result:

```bash
bun run contracts:generate
```

Before handing off routine work, run:

```bash
bun run check
bun run verify:fast
```

Before release or a stage exit, run:

```bash
bun run verify
```

`check` is read-only and covers generated-contract drift, TypeScript, lint, formatting, Rust compile,
and whitespace errors. `verify:fast` adds provider conformance and client unit tests. `verify` adds the
complete Rust and six-batch Playwright suites.
