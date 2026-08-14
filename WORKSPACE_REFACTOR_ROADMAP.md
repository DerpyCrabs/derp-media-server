# Workspace Refactor Roadmap

Status: active; Stage 1 complete
Initiative branch: `derp-desk-attempt-2`
Baseline: `master` at `3695a88`
Last updated: 2026-08-14

This roadmap guides a focused refactor of Derp Media Server into a maintainable personal media and productivity workspace. It preserves current workflows while removing duplicated feature ownership and making integrations cheaper to add.

## Product contract

The application has three deliberate surfaces:

1. `/` is the fast, mobile-first Library. Opening the app, browsing or searching, tapping media, and playing it must remain the shortest path.
2. `/workspace` is the desktop tiled/window workspace.
3. `/canvas` is the desktop spatial workspace.

These surfaces may use different chrome, placement, and navigation. They must render the same Explorer, Reader, viewers, playback state, search behavior, and integration content wherever the user outcome is the same.

Workspace and Canvas are the primary capability and extension surfaces. Their full desktop workflows drive shared feature contracts. The root application is not a second feature implementation; it is a thin mobile host over the same modules, with compact navigation and modal/fullscreen placement.

The application is owner-only and self-hosted. Optimize for that reality, not for hypothetical enterprise or multi-user deployment.

## Goals

- Keep all current URLs, workflows, keyboard/touch behavior, and persisted user state working.
- Keep the mobile Library small and fast; desktop code must load only for desktop routes.
- Move shared behavior and content rendering into deep feature modules instead of sharing giant surface components.
- Render Explorer, Reader, and document/image viewers through one content runtime on all three surfaces.
- Share audio/video session, source, event, progress, queue, and media-host behavior while allowing deliberately different Library, Workspace, and Canvas controls.
- Separate content instances from Library modal/fullscreen placement, Workspace window geometry, and Canvas spatial geometry.
- Make new resource features one-implementation changes. Adding a browser action, document/image renderer, Reader capability, playback behavior, or integration must not require parallel root and Workspace implementations. Audio/video presentation may differ, but its state machine must not fork.
- Give filesystem and Hermes the same small integration contribution seam.
- Make server/client contracts typed and testable from one authority.
- Fix file-operation correctness before building abstractions on top of it.
- Delete replaced implementations and compatibility adapters promptly.

## Locked decisions

- Keep one Solid/Vite frontend build, one Rust/Axum server, and three route shells. Do not create microfrontends.
- Do not merge Workspace and Canvas into one responsive page. Their layout engines remain separate.
- Do not add a new Home, Spaces, Activity, sharing, or collaboration experience during this roadmap.
- Do not restore auth, sharing, offline support, runtime mounts, Grants, access policies, or service-worker update machinery.
- Do not build a dynamic plugin ABI, provider marketplace, iframe runtime, CRDT, durable command journal, or general resource identity catalog.
- Local files remain source of truth. SQLite stores application state and derived data, not primary file blobs.
- Local resource identity remains pragmatic: configured root identity plus normalized logical path. Existing path-mutation handling updates saved references after application-mediated rename or move. Rename-stable opaque identity is out of scope.
- Integrations register at compile time. Core feature modules may depend on integration contracts; they must not import Hermes.
- Surface modules own chrome, placement, and geometry only. Shared feature modules own behavior and resource content.
- Resource/provider capabilities must not disappear because a user opened the mobile Library. Root receives every applicable browse, search, edit, upload, paste, and integration action; only host-specific actions such as tile, split, taskbar, or spatial placement remain desktop-only.
- Workspace/Canvas are the reference hosts for complete capability. Root adapts their shared feature modules to mobile; root-specific business logic, mutation ownership, renderer forks, and integration branches are not allowed.
- A feature change that requires editing both root and Workspace implementations is a failed abstraction unless those edits concern different host chrome, placement, or audio/video controls.
- Preserve current storage formats through temporary read adapters. Do not dual-write old and new formats. Migrate one owner, verify, then remove its adapter.
- New paths become default-on inside their stage. Long-lived feature flags and permanent parallel implementations are not allowed.
- Current `master` fixes, especially Canvas/Hermes/Reader/path-mutation fixes from `074675b` and later removals, are mandatory baseline behavior.

## Target dependency direction

```text
src/surfaces/library     src/surfaces/workspace     src/surfaces/canvas
          \                       |                        /
           LibraryHost       WorkspaceHost             CanvasHost
                    \             |                   /
            src/features/{content,explorer,viewer,reader,playback,search}
                                   |
                    lib/domain + lib/api contracts
                                   |
                    integration contribution registry
                            /              \
                     filesystem           Hermes
                                   |
                    Rust application services and DTOs
                                   |
                         SQLite + filesystem + gateway
```

Dependency rules:

- `surfaces/*` may import `features/*`; features must never import a surface.
- Workspace and Canvas must never import each other.
- Root surface must not own file queries, mutations, viewer controllers, Reader state machines, or provider actions. It composes shared features with mobile URL and overlay adapters.
- `lib/` must not import UI components from `src/`.
- Core content, explorer, reader, viewer, playback, pane, and layout code must not contain Hermes branches.
- HTTP route handlers call application queries/commands. They must not call other HTTP routes.
- Components use typed API/query modules, not scattered literal `/api/...` calls.

## Small target contracts

Names are illustrative. Keep contracts small even if implementation chooses different names.

```ts
type ResourceKey = {
  provider: string
  id: string
}

type ResourceSummary = {
  key: ResourceKey
  name: string
  kind: string
  mime?: string
  capabilities: readonly string[]
  presentation?: string
}

type ContentInstance =
  | { type: 'explorer'; location: ResourceKey }
  | { type: 'resource'; resource: ResourceKey; renderer: string }
  | { type: 'integration'; integration: string; view: string; state: unknown }

type OpenPlan = {
  renderer: string
  resource: ResourceKey
  disposition: 'replace' | 'modal' | 'fullscreen' | 'pane' | 'window'
}

interface SurfaceContentHost {
  open(plan: OpenPlan): void
  close(instanceId: string): void
  focus(instanceId: string): void
}

interface IntegrationModule {
  id: string
  browse?: BrowseProvider
  search?: SearchContributor
  actions?: ResourceActionProvider
  content?: readonly ContentRendererDescriptor[]
}
```

Provider owns interpretation of `ResourceKey.id`. Filesystem uses current configured-root and normalized-path semantics. Hermes uses opaque upstream IDs. No core module infers provider behavior from path strings.

`OpenPlan` is pure product behavior. Each surface maps it to its existing placement behavior: Library modal/fullscreen/route, Workspace pane/window, Canvas spatial window.

`ContentInstance` is the universal reusable unit. Explorer, Reader, image, text, PDF, unsupported-file, and integration renderers consume it through small typed controllers. It contains no coordinates, z-index, snap state, camera state, tiling state, or mobile dialog state.

There is no universal visual pane frame. `LibraryHost` presents shared content as a route, dialog, sheet, or fullscreen view. `WorkspaceHost` adds window/tab/taskbar chrome. `CanvasHost` adds spatial window chrome. All three mount the same content renderer beneath that chrome.

Shared feature modules should expose complete content, controllers, action descriptors, and dialogs where behavior is identical. Host slots stay narrow: title/chrome, available rectangle, URL synchronization, open disposition, focus, close, and desktop geometry. Avoid reducing Explorer, Reader, and document/image viewer reuse to a shared data hook while duplicating the full view and action layer.

Audio/video are an explicit presentation exception. Share `PlaybackSession`, source resolution, queue, progress/resume, persistence, event normalization, and media-element lifetime. Keep `LibraryMediaView`, `WorkspaceMediaView`, and `CanvasMediaView` free to render different controls and layouts over the same reactive session snapshot and commands. New playback behavior belongs below those views.

Explorer actions split into two groups:

- Resource actions derive from provider capabilities and remain available on every surface: browse, search, sort/view, select, create, upload, paste, rename, move/copy, delete, edit, download, knowledge-base actions, and integration actions.
- Host actions derive from the active surface: replace current view, open modal/fullscreen, open pane/window, split/tile, pin to taskbar, or place on Canvas.

Pointer and keyboard presentation may differ. For example, mobile may use long-press and a sheet where desktop uses right-click and a menu. Capability must remain the same unless hardware or screen constraints make the action genuinely impossible and the parity matrix records that exception.

## Rules for AI work

For every task:

1. Read `AGENTS.md` and this roadmap completely.
2. Inspect current code and tests before proposing files. Names in this roadmap are likely locations, not permission to create empty abstraction layers..
3. Add or update behavior tests before moving ownership. Tests should exercise the new small interface and the existing user workflow. Use Workspace/Canvas as the full-capability contract and mount the same feature in the root host.
4. Never solve duplication by wrapping an entire existing page inside another shell or by creating a prop bag for all surface behavior.
5. Avoid closed unions that require core edits for every integration. Renderer and integration IDs are registry keys.
6. Preserve Solid reactivity with signals, memos, `<Show>`, and `<For>`. Do not spread reactive snapshots into shared controllers.
7. When persistence changes, test direct upgrade, restart/idempotency, and malformed old state. Preserve recoverable old data instead of silently discarding it.
8. Report changed files, user-visible behavior, data migration behavior, tests run, adapters left, and next package. Do not push unless explicitly authorized.
9. Implement each resource feature once in `features/*` or an integration module. Surface tasks may add only host chrome, layout, URL, or interaction adaptation.

## Validation contract

After each work package, run focused Rust, Bun unit, and Playwright tests proportional to changed behavior. At every stage exit, all commands must pass:

```bash
bun run tsgo
bun run lint-errors
bun run fmt:check
cargo fmt --check
bun run test:unit
bun run test:batch
git diff --check
```

Keep E2E files independent and keep `tests/run-batches.ts` at six or fewer batches.

Every stage exit also requires:

- Production build and direct-navigation smoke tests for `/`, `/workspace`, and `/canvas`.
- Narrow-phone smoke test at 390x844 and desktop smoke test at 1440x900.
- No new browser console errors or failed network requests.
- Existing production-state fixture reopens with the same Library, Workspace, Canvas, Reader, and Hermes state.
- Current query/deep-link forms remain valid, including file, viewer, player, Reader, Workspace, and Canvas URLs.
- Bundle inspection proves the mobile Library route does not eagerly load Workspace, Canvas, desktop viewers, or Hermes chat chunks.
- New abstractions replace code or enable the next package; no unused framework scaffolding remains.

## Stage overview

| Stage | Release outcome                                                                                | Status      |
| ----- | ---------------------------------------------------------------------------------------------- | ----------- |
| 1     | Safe file operations, stable app lifetime, typed routes/contracts, fast route delivery         | Complete    |
| 2     | One resource/open model and one playback session across all surfaces                           | Not started |
| 3     | One Explorer/Reader/viewer content layer behind three surface hosts                            | Not started |
| 4     | Filesystem and Hermes use one integration seam; legacy persistence and duplicate paths removed | Not started |

---

## Stage 1 - Safe and fast foundation

### Outcome

Current behavior is locked by focused tests. Route delivery becomes correct and lazy. File mutations become safe enough to support shared controllers. Server and client receive one typed contract path. Application-level services have stable lifetime above route changes.

### Work packages

- [x] **1.1 Lock workflow, capability, and storage parity.** Build a compact workflow matrix for Library, Workspace, Canvas, Reader, and Hermes. Add an Explorer/resource capability matrix using Workspace/Canvas as the complete reference and classify each difference as shared-resource capability or legitimate host-only behavior. Add only missing high-value tests. Record current production bundle sizes and representative persisted settings/layout/canvas/Hermes fixtures. Preserve existing path-mutation tests and all fixes from `074675b`.
- [x] **1.2 Establish the composition root and typed routes.** Keep app-wide providers above the route switch in `src/index.tsx`; add a small `AppProviders` composition point without a generic service locator. Centralize parsing and generation for `/`, `/workspace`, `/canvas`, and current query/deep-link forms. Lazy-load Workspace and Canvas. Render a real frontend not-found state. Add a small desktop surface switcher without adding a new Home workflow.
- [x] **1.3 Fix HTTP and file-command safety.** Nest `/api` so unknown API routes return typed JSON 404 instead of SPA HTML. Expose a testable `build_router(state)`. Stream multipart uploads to bounded temporary files, validate them, then atomically finalize. Introduce a lean owner-only `FileCommandService` for create, edit, rename, move, and delete. Never return success after metadata repair fails; compensate or return typed `needsReconciliation`.
- [x] **1.4 Create one typed contract and query path.** Replace untyped response construction for config, file listing/mutations, settings, and events with Rust DTOs. Generate committed TypeScript declarations and fail validation when regeneration changes tracked output. Add a tagged `ApiErrorBody` and `AppEvent`. Centralize endpoint functions, TanStack query options, mutation options, and invalidation rules. Build SSR bootstrap data with the same application query functions and query keys used by HTTP/client code.
- [x] **1.5 Remove only obvious dead plumbing and fix baseline accessibility.** Remove empty page props, local-only source branches, admin-only scope wrappers, and unconditional read-only branches when tests prove they have no behavior. Add accessible names to icon-only controls and meaningful slider labels. Do not restructure Explorer, viewers, or panes yet.

### Likely code areas

- `src/index.tsx`, `src/App.tsx`, `src/browser-history.ts`
- `src/media/AudioPlayer.tsx`
- `lib/api.ts`, `lib/query-keys.ts`, new typed route/query modules
- `server/server.rs`, `server/html.rs`, `server/routes/config.rs`, `server/routes/files.rs`, `server/path_metadata.rs`, `server/routes/sse.rs`
- Existing navigation, URL-state, upload, mobile-media, Workspace, Canvas, Reader, and Hermes tests

### Exit gates

- `/`, `/workspace`, and `/canvas` preserve direct navigation, refresh, back/forward, copied links, and existing query state.
- Mobile production entry excludes Workspace and Canvas chunks.
- Route changes do not destroy app-level service state.
- Unknown `/api/*` always returns JSON 404; unknown frontend routes never silently become Library.
- Upload memory remains bounded by stream/chunk buffers, not total file size.
- No file mutation reports success after required metadata work fails.
- Config and other prefetched data match before and after hydration.
- Touched endpoints have typed Rust DTOs, generated TypeScript contracts, canonical query options, and route-level tests.
- All existing stored layouts, Canvas documents, Reader state, and Hermes windows reopen unchanged.
- Capability matrix identifies every root omission. No shared resource action is classified as desktop-only merely because current root lacks its implementation.

### Completion record

- Completed: Work packages 1.1 through 1.5, including parity/bundle baselines, persisted-state fixtures, a stable provider composition root, typed lazy routes, safe file commands and uploads, generated API contracts, shared HTTP/SSR application queries, canonical client query/mutation options, dead-plumbing removal, and baseline accessibility fixes.
- Commits: Baseline is `master` at `3695a88`; roadmap measurement started at `ea0acf3`. Stage 1 implementation remains in the current working tree because no commit was requested.
- User-visible behavior: `/`, `/workspace`, and `/canvas` retain their existing workflows and deep links. Workspace and Canvas now load lazily, desktop navigation exposes a compact surface switcher, unknown frontend routes show a real 404, and unknown API routes return tagged JSON 404 responses.
- Data/schema behavior: No persistent-data or schema migration. Existing settings, Workspace layouts, Canvas collections, Reader state, and Hermes windows reopen through representative TypeScript and Rust fixtures. File mutations compensate failed metadata work or return a tagged `needsReconciliation` error.
- Tests and manual checks: `bun run test:unit` passes 70 Rust and 314 Bun tests; `bun run test:batch` passes all 377 Playwright tests across six batches. Type, generated-contract, lint, format, Rust-format, and diff checks pass. Production direct-navigation smoke checks pass for all three routes at 1440x900 and 390x844 with no console errors, page errors, failed requests, or HTTP error responses.
- Metrics before/after: Root entry is 762,953/215,327 raw/gzip bytes before and 345,407/98,011 after (-54.7%/-54.5%). The complete eager root closure is 1,018,225/387,000 before and 646,538/287,651 after (-36.5%/-25.7%). Total JavaScript is 3,117,733/940,645 before and 3,141,582/954,044 after (+0.8%/+1.4%); full client output is 3,618,304/1,158,171 before and 3,643,724/1,171,804 after (+0.7%/+1.2%). Workspace (149,194/40,589) and Canvas (73,817/21,778) are now separate raw/gzip dynamic entries; manifest reachability confirms neither they nor the desktop viewer/Hermes code are in the Library eager closure.
- Compatibility adapters removed: Untyped touched-endpoint response construction, unsafe generic listing casts, scattered touched-surface query/mutation invalidation, raw file-download URL use in components, empty page props, unconditional read-only branches, local-only source branches, and dead admin-scope wrappers.
- Intentional remaining duplication: Explorer/viewer/playback presentation remains surface-owned for Stages 2 and 3. Existing `FileItem` and path-URL shapes remain until package 2.1. Knowledge-base search and virtual-directory action endpoints remain specialized until their shared resource/integration contracts land.
- Next stage/package: Stage 2 package 2.1, defining resource address and transport semantics while keeping persisted path references compatible.

### Recovery

- File uploads finalize through atomic rename and remove abandoned temporary files.
- File commands must leave either old state or new state recoverable; typed reconciliation failure must identify incomplete metadata work.
- Route and contract work performs no persistent data migration.

### Non-goals

- No Explorer, Reader, viewer, pane, or playback rewrite.
- No Resource catalog or opaque filesystem identity.
- No visual redesign beyond navigation discoverability and accessibility fixes.
- No new product destination.

---

## Stage 2 - Shared resource, open, and playback core

### Outcome

Every currently openable item has one lean resource descriptor and one pure open plan. All three surfaces share one owner-only playback session while keeping current player, taskbar, dialog, and spatial presentation.

### Work packages

- [ ] **2.1 Define resource address and transport semantics.** Add `ResourceKey`, `ResourceSummary`, capabilities, presentation hints, and typed pages/errors. Filesystem identity remains configured-root plus normalized logical path; Hermes uses opaque IDs. Existing `FileItem` and path URLs remain behind temporary adapters. Saved path references continue to follow current path-mutation events.
- [ ] **2.2 Add one pure opener and lazy renderer registry.** Implement `openResource(resource, intent, context): OpenPlan`. Register renderer descriptors by MIME/kind and lazy import factory. Keep authorization, route mutation, pane geometry, and component state outside the registry. Route Library, Workspace, and Canvas opens through the same planner while each surface executes its existing disposition.
- [ ] **2.3 Define neutral content-host and integration contribution contracts.** Introduce host-neutral `ContentInstance`, content codec/sanitizer descriptors, narrow `LibraryHost`/`WorkspaceHost`/`CanvasHost` contracts, and compile-time `IntegrationModule` contribution shapes before new resource/viewer code hardcodes Hermes. Keep Workspace tiling and Canvas geometry types unchanged. Do not build a universal visual pane frame yet.
- [ ] **2.4 Introduce one owner-only `PlaybackSession` and media host.** Port only the useful state-machine ideas and tests from `derp-desk` commit `891bf76`: queue, source generation, stale-event rejection, play/pause, seek, next/previous, repeat, persistence, audio/video mode, and host continuity. Add a small media-element host that owns source/event synchronization without owning surface controls. Remove every Grant, offline, revocation, and shared-version branch before integration.
- [ ] **2.5 Migrate playback one surface at a time.** Mount the session and shared host lifecycle in the Stage 1 composition root. Migrate Workspace taskbar/pane and Canvas first, then replace root ownership with the same session. Keep each surface's visual controls and current media URLs unchanged; views consume one reactive snapshot and command interface. Delete `use-media-player` and `workspace-audio-store` ownership after the final caller moves; no proxy bridge may survive stage exit.

### Likely code areas

- New `lib/domain/resource.ts`, `src/features/open/`, `src/features/playback/`
- `lib/use-media-player.ts`, `lib/workspace-audio-store.ts`
- `src/media/MainMediaPlayers.tsx`, `src/media/AudioPlayer.tsx`
- `src/workspace/WorkspaceTaskbarAudio.tsx`, `src/workspace/WorkspaceViewerPane.tsx`
- `src/CanvasPage.tsx`, `lib/use-workspace.ts`, `lib/virtual-directory.ts`

### Tests to add or port selectively

- Resource contract fixtures and serialization tests.
- `openResource` table tests covering every current kind, intent, and surface.
- Lazy renderer-registry tests.
- Owner-only playback state-machine tests from `derp-desk` `891bf76`.
- Existing audio, video, audio-mode-switch, media Range, Workspace media-layout, and mobile resume tests.

### Exit gates

- Same resource and intent produce the same semantic open plan from all three surfaces.
- Core open/resource/content-host contracts contain no Hermes-only union member or path inference.
- One playback owner survives route changes and drives Library, Workspace, and Canvas.
- Queue, seek, resume, repeat, next/previous, audio/video switch, and stale media events retain current behavior.
- Existing distinct Library, Workspace, and Canvas media views remain visually compatible while sharing no playback state-machine logic.
- Old playback stores and bridge/proxy code are deleted.
- No server-wide resource catalog, identity reconciliation system, or new UI shell has appeared.

### Recovery

- Read current persisted player state through one bounded adapter, write only the new state, then remove the adapter after reload/restart tests pass.
- Keep existing path URLs and saved pane payloads readable. Stage 3 owns their internal pane migration.

### Non-goals

- No shared Explorer UI yet.
- No shared viewer implementation yet.
- No Workspace/Canvas persistence migration.
- No universal search palette or new media features.

---

## Stage 3 - One content feature layer behind three hosts

### Outcome

Workspace and Canvas use one shared Explorer, Reader, and viewer content layer. Root mounts that same layer through thin mobile adapters instead of maintaining a parallel implementation. Workspace and Canvas consume the same content renderers without importing each other. Workflows, layout engines, and stored geometry remain unchanged.

Stage 3 must proceed as vertical migrations. Do not create a large `PaneHost` first and pour existing pages into it. Extract complete feature slices from the desktop reference implementation, then mount the same slice in root. Do not stop at shared queries/controllers while duplicating content, actions, and dialogs.

### Work packages

- [ ] **3.1 Build the complete shared Explorer feature.** Extract one Explorer data source/controller plus shared responsive view, action descriptors, menus, dialogs, rows/grid, breadcrumbs, search, upload/paste, selection, history, sort/view mode, stale-request cancellation, pagination, drag rules, and optimistic mutation reconciliation. Use provider capabilities for resource actions and host capabilities only for placement. Root and desktop may supply narrow toolbar/chrome slots, not separate feature bodies.
- [ ] **3.2 Cut over desktop reference hosts, then root mobile host.** Move `WorkspaceBrowserPane` first; Canvas receives the same feature through its host. Then replace `FileBrowser` internals with that exact Explorer feature plus mobile URL, long-press, sheet/dialog, and fullscreen adapters. Use the Stage 1 matrix to expose Workspace resource features currently missing from root. Delete root-owned file queries, mutations, action tables, and duplicated modal logic after cutover.
- [ ] **3.3 Extract shared Reader and non-media viewer content one type at a time.** Start with image and text, then Reader content and reading state, then PDF and unsupported resources. Each type gets one shared controller and content renderer. `ReaderDialog`, Library dialogs, Workspace panes, and Canvas windows become thin hosts around the same renderer. Unify autosave, read-only, outline/position, selection/AI actions, error, loading, and persistence behavior through tests. Audio/video keep their Stage 2 surface views over the common playback session and media host. Do not make wrappers that merely import the whole `WorkspaceViewerPane` or `ReaderDialog`.
- [ ] **3.4 Introduce the neutral content runtime and three hosts.** Only after renderers accept small host-neutral inputs, add a registry-driven content runtime. Explorer, Reader/viewer, and Hermes content register codecs, sanitizers, titles/icons, actions, and lazy renderers. `LibraryHost` owns URL/modal/fullscreen presentation, `WorkspaceHost` owns pane/window/tab/taskbar presentation, and `CanvasHost` owns spatial presentation. Canvas stops fabricating `PersistedWorkspaceState`.
- [ ] **3.5 Prove the contribution seam with real filesystem and Hermes content.** Both contributors use registered resource/action/content descriptors. Core Explorer, opener, viewer, Workspace layout, and Canvas layout receive no provider-specific branches. Keep current Hermes routes and backend transport until Stage 4.
- [ ] **3.6 Remove surface-shaped feature ownership.** Delete replaced handlers, viewer/Reader branches, pane proxies, root business logic, and giant prop plumbing per vertical slice. Replace broad modal/page prop bags with feature-scoped accessors/actions or contexts only where several descendants consume the same live state.

### Likely code areas

- `src/FileBrowser.tsx`, `src/workspace/WorkspaceBrowserPane.tsx`
- `src/file-browser/`, `src/workspace/WorkspaceBrowserModalLayer.tsx`
- `src/media/`, `src/workspace/WorkspaceViewerPane.tsx`
- `src/reader/`, especially `ReaderDialog.tsx`, `BookContent.tsx`, and `MarkdownContent.tsx`
- `src/WorkspacePage.tsx`, `src/CanvasPage.tsx`
- `src/workspace/workspace-page/WorkspacePageCanvas.tsx`
- `lib/use-workspace.ts`, `lib/workspace-bootstrap.ts`, `lib/workspace-file-open-target-picker.ts`
- New `src/features/explorer/`, `src/features/viewer/`, `src/features/panes/`

### Tests to add or port selectively

- Explorer controller tests for stale cancellation, history, selection, sort/view, pagination, optimistic rename/delete, and rollback. Use selected cases from `derp-desk` `4a51809`, not its implementation.
- Shared Explorer contract and action tests run against Library, Workspace, and Canvas hosts. Feature-parity tests prove root exposes all applicable provider actions from the Stage 1 matrix.
- Renderer contract tests mount the same image, text, Reader, PDF, and unsupported-resource content in all three host adapters.
- Playback contract tests drive each distinct media view against the same session snapshot/commands and prove no view owns queue, progress, source, or persistence state.
- Reader tests cover outline, position/resume, selection/AI actions, URL state, and content persistence without depending on `ReaderDialog`.
- Content codec and renderer tests; selected identity/draft-survival assertions from `derp-desk` `ff97490` are useful, but its Space UI and PaneHost are not.
- Existing Workspace layout, tab, cross-drag, file-open-target, Canvas, image, text, Reader, audio, video, and Hermes E2E suites remain authoritative.

### Exit gates

- Library, Workspace, and Canvas mount one Explorer feature with one data/mutation/action owner.
- Root contains no file-query, mutation, provider-action, Reader-state, non-media viewer-controller, or playback-state implementation.
- All resource capabilities in the Stage 1 matrix are available from root unless a tested host limitation is recorded.
- Root and desktop hosts render the same Reader and non-media viewer content modules, not parallel dialog and pane implementations.
- Audio/video views may differ by surface, but all consume one playback session, command API, source policy, and media-host lifecycle.
- Text autosave/read-only rules, audio metadata, progress, and errors no longer differ by surface accidentally.
- Workspace and Canvas import shared content features, never each other.
- Content renderer inputs and host slots are small and neutral; no replacement 60-property pane interface exists.
- Workspace tiling and Canvas spatial geometry remain separate and reopen existing state identically.
- Filesystem and Hermes content prove the integration contract without core provider branches.
- Adding a resource action or renderer requires one feature implementation. Surface edits are needed only for genuinely different chrome or placement.
- Replaced Explorer, Reader, viewer, and pane implementations are deleted before stage exit.

### Recovery

- Content codecs read current Library URL state and Workspace/Canvas payloads, write the new version, and preserve unknown/corrupt payloads for recovery.
- Migrate one pane kind at a time. A failed pane migration must not prevent unrelated panes or documents from loading.
- Do not dual-write Workspace and Canvas stores.

### Non-goals

- No unified Space document or fourth presentation.
- No Workspace or Canvas UX redesign.
- No Canvas persistence simplification yet.
- No backend Hermes rewrite yet.

---

## Stage 4 - Integration proof, persistence simplification, and deletion

### Outcome

Filesystem and Hermes are vertical integration modules behind one typed seam. Canvas and application state have one clear owner. Compatibility adapters, removed-feature residue, direct contract duplication, and obsolete feature implementations are gone.

Keep Stage 4 in two separately reversible parts: integration cutover first, persistence and deletion second.

### Work packages

- [ ] **4.1 Build the server integration registry.** Register filesystem and Hermes at compile time. Keep optional narrow capabilities for browse, inspect, actions, search, assistant/chat, panes, and events. Avoid one giant provider trait. Add a conformance suite that each claimed capability must pass.
- [ ] **4.2 Move Hermes into one vertical slice.** Group config, transport, typed upstream normalization, runtime/session service, browser contribution, chat/actions, events, and routes under `server/integrations/hermes/` and matching frontend integration ownership. `AppState`, `routes/files.rs`, Explorer, and layout engines must no longer contain Hermes-specific state or branches.
- [ ] **4.3 Remove fake path semantics from new state.** Hermes resources use opaque `ResourceKey`s and typed payloads. Keep one read-only compatibility decoder for existing `Hermes Sessions/...` URLs and persisted windows, migrate on successful load, then remove path inference from core code.
- [ ] **4.4 Unify search contribution without changing entry points.** Filesystem filename search, knowledge search, open panes, and Hermes may contribute typed results/actions. Keep current Library and Canvas palette triggers and chrome. Both execute Stage 2 `OpenPlan`; do not add Activity, Discovery, or a new Home page.
- [ ] **4.5 Simplify Canvas persistence.** Make server state authoritative with debounced saves and explicit versions. Keep an optional device-local crash draft only. Remove writer IDs, tombstone merge, offline queues, periodic reconciliation, and legacy collection machinery. Test direct upgrade, restart/idempotency, conflict behavior, and corrupt-state preservation.
- [ ] **4.6 Clean dependency and state boundaries.** Replace fake legacy JSON paths with typed/versioned SQLite-backed state names. Remove `lib/` imports from `src/`, dead auth/share/offline/runtime-mount types, old resource adapters, duplicated SSR builders, and unused settings branches. Do not combine this with a new Spaces model.
- [ ] **4.7 Finish extension DX and verification.** Add documented `check`, `verify:fast`, and `verify` scripts. Include generated-contract drift, TypeScript, lint, Rust, unit, provider-conformance, and E2E gates at appropriate speeds. Make pre-commit check-only or staged-file-only; remove `git add -u`. Document how to add one integration, action, search contributor, and content renderer.
- [ ] **4.8 Measure and delete.** Compare bundle, large-file counts, duplicate handlers, direct API strings, and duplicated playback/viewer/explorer ownership with Stage 1 baseline. Delete all compatibility adapters whose upgrade gates passed. Record any intentional remaining duplication and why it belongs to presentation.

### Likely code areas

- `server/app.rs`, `server/server.rs`, `server/routes/files.rs`
- `server/hermes.rs`, `server/hermes_process.rs`, `server/routes/hermes_chat.rs`, `server/virtual_directory.rs`
- `lib/virtual-directory.ts`, `lib/hermes-session-store.ts`
- `src/hermes/`, `src/canvas/CanvasSearchPalette.tsx`, `src/file-browser/FileSearchPalette.tsx`
- `src/CanvasPage.tsx`, `lib/canvas-persistence.ts`, `server/store.rs`
- `package.json`, `.husky/pre-commit`, integration developer documentation

### Tests to add or port selectively

- Small provider-conformance concept from `derp-desk` `c5c95a3`, rewritten for this registry.
- Hermes DTO normalization, reconnect, ID collision, old fake-path decode, action, pane, and event tests.
- Search normalization/ranking fixtures from `derp-desk` `58b5b72`; do not port EventFeed, Activity, Trash, or its full discovery implementation.
- Canvas upgrade/restart/corrupt-state cases inspired by selected `f50687f` tests; do not port offline journals or Space UX.
- Integration-template fixture proving one module and one registration point are sufficient.

### Exit gates

- Filesystem and Hermes pass the same declared capability contracts.
- Adding a fixture integration requires its module plus one registration entry; Explorer, viewer, Workspace, Canvas, and core route files remain unchanged.
- No new state stores fake provider resources as filesystem paths.
- `AppState`, file routes, shared feature code, and layout engines contain no Hermes-specific branches.
- Canvas has one server-authoritative persistence path and optional crash draft, with verified upgrade from current state.
- Direct `/api` strings remain only in typed API/integration transport modules.
- `lib/` has no imports from `src/`.
- Removed auth, sharing, offline, runtime-mount, Grant, and access-policy plumbing is absent.
- Three route shells contain presentation and geometry; Explorer, viewer, playback, open planning, search behavior, and integration contracts each have one owner.
- Stage 1 bundle and duplication metrics improve materially, with numbers recorded in the completion record.
- Integration authoring guide and fast/full verification commands work from a clean checkout.

### Recovery

- Complete integration cutover before persistence cleanup. Keep commits separately reversible.
- Read old Hermes/path and Canvas formats without dual-writing them. Migrate only after successful validation and retain recoverable corrupt input.
- Back up application DB before persistent schema migration.

### Non-goals

- No dynamic third-party plugins or marketplace.
- No new productivity feature, assistant workflow, Activity feed, Trash, or universal Home.
- No opaque filesystem identity catalog.
- No unified Workspace/Canvas Space model unless requested as a separate future initiative.

---

## Using the `derp-desk` branch

Treat `derp-desk` as a test and design quarry, never as a merge target. Do not cherry-pick large stage commits.

Useful references:

- Stage 1: `f49dc2e` for behavior-first baseline tests. Use only reduced typed-route ideas from `b09bce3`; do not port its shell expansion.
- Stage 2: opener/resource contract tests around `5262599` and `91ca014`; owner-only playback core and tests from `891bf76`.
- Stage 3: Explorer behavior cases from `4a51809`; selected pane identity and draft-survival assertions from `ff97490`. Do not port its SpaceRoute, Focus view, or Workspace-shaped PaneHost.
- Stage 4: provider-conformance idea from `c5c95a3`, search fixtures from `58b5b72`, and selected upgrade/restart tests from `f50687f`.

Reject all Grant, auth, share, offline, service-worker, runtime-mount, access-policy, EventFeed, Activity, Trash, command-journal, and durable identity-catalog code. Port tests before implementation, then rewrite the smallest owner-only module on current `master`.

## Completion record template

Append one record under the completed stage:

```markdown
### Completion record

- Completed:
- Commits:
- User-visible behavior:
- Data/schema behavior:
- Tests and manual checks:
- Metrics before/after:
- Compatibility adapters removed:
- Intentional remaining duplication:
- Next stage/package:
```

## Finish line

Roadmap is complete when:

- Library, Workspace, and Canvas workflows remain familiar and all current state upgrades safely.
- Mobile Library does not download desktop workbench code.
- Explorer, Reader/non-media viewer content, playback behavior, open planning, search behavior, and integration contracts each have one owner.
- Workspace and Canvas differ only where presentation and geometry genuinely differ.
- Filesystem and Hermes are independent vertical modules behind one compile-time registry.
- Adding a small integration does not require edits across App, Explorer, Workspace, Canvas, and file routes.
- Replaced duplicate implementations and temporary adapters are deleted.
- Fast checks support routine AI work; full validation protects releases.
