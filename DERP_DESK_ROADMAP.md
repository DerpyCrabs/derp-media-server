# Derp Desk Roadmap

Status: active; Stage 1 complete
Initiative branch: `derp-desk`
Last updated: 2026-08-11

This document is execution contract for evolving Derp Media Server into Derp Desk through independently releasable stages. Each stage must leave product deployable, preserve existing data and URLs, and pass full validation before next stage begins.

## Product contract

Derp Desk is self-hosted, file-first personal content workbench:

> Mount user-owned files; browse, read, edit, and play them; arrange resources into durable Spaces; ask an assistant with explicit context; share capability-scoped views.

Media remains first-class. Phone media flow is non-negotiable:

1. Open app.
2. See Library immediately.
3. Browse or search.
4. Tap media.
5. Play full-screen.
6. Resume reliably, including offline.

Desktop workbench must extend this flow, never replace or slow it.

## Locked decisions

- One repository, one Rust server, one shared domain model.
- Separate presentation Modules: mobile media, desktop Space, shared/grant view.
- `/` and PWA `start_url` remain fast, mobile-first Library. `/home` and “resume last Space” are explicit destinations, never pre-render redirects based on user-agent or stored preference.
- User files remain source of truth. SQLite stores application state, stable references, derived metadata, indexes, and operation journals—not primary blobs.
- Identity model remains one owner plus capability Grants. Multi-user accounts, RBAC, SaaS tenancy, and billing stay out of scope.
- Owner and shared HTTP routes remain separate Adapters. Shared UI must never call owner-only routes.
- Desktop windowing, canvas, editors, and Hermes code must be lazy-loaded. Phone media route must not download them.
- Preserve `/api/media/*`, `/api/share/:token/media/*`, HTTP Range semantics, native player behaviour, and offline object-store keys during architecture stages. Change them only in an explicitly scoped media migration.
- Existing URLs, share links, configuration, database state, and local browser state receive compatibility Adapters and tested migrations.
- Database migrations stay additive through compatibility period. Old state is not deleted automatically.
- No generic plugin/iframe runtime, CRDT collaboration, provider marketplace, or default whole-library embeddings.
- Add a Seam only where behaviour really varies. Filesystem/Hermes, owner/grant, online/offline, and server/local optimistic state are real Adapter seams. SQLite does not need a public generic repository Interface.
- New Modules must be deep: small Interface, high Leverage, tests through that Interface. Replace old shallow paths after all callers migrate; do not leave permanent parallel abstractions.

## Target model

| Noun       | Meaning                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| Library    | Owner's aggregate of Sources                                                                                             |
| Source     | Physical mount or provider Adapter, initially filesystem and Hermes                                                      |
| Resource   | Addressable file, folder, note, book, media item, Collection, or assistant session                                       |
| Collection | Query-backed Resource such as Favorites, Recent, Most Played, Shared, saved search, or knowledge collection              |
| Pane       | Browser, viewer/editor, or assistant content state without geometry                                                      |
| Space      | Durable named set of Panes with focus, tiled, and spatial arrangements                                                   |
| Grant      | Capability-scoped access to a Resource, Collection, or Space                                                             |
| Activity   | Long-running or resumable work: playback, reading, upload, indexing, offline save, preview generation, or assistant turn |

```text
Mobile Media UI    Desktop Space UI    Shared UI
       \                 |                /
        ExplorerModel / ViewerHost / PlaybackSession
                         |
              typed queries and commands
                         |
        AccessPolicy -- ResourceCatalog -- ContentCommands
                         |
       SpaceEngine -- Discovery -- ActivityHub -- EventFeed
                         |
           SQLite | Filesystem | Hermes Adapters
```

## Stage discipline for AI work

Treat one stage as one release milestone. Work packages inside a stage may use separate branches or pull requests, but stage is complete only when every exit gate passes.

Stage exit means new path is default-on, independently deployable, and observable; a hidden implementation behind disabled switch is not complete. Cutover switches may be simple checked configuration rather than generic flag framework, but old/new paths must be dynamically exclusive and both tested during compatibility epoch.

For every AI session:

1. Read `AGENTS.md` and this roadmap completely.
2. State current stage and work package. Do not implement later-stage ideas opportunistically.
3. Inspect current code and tests before proposing files. Roadmap names likely locations, not mandatory structure.
4. Preserve unrelated user changes. Check `git status --short --branch` before and after work.
5. Write or update tests at Module Interface before deleting old implementation paths.
6. Use compatibility Adapter first, migrate callers, prove parity, then delete replaced path.
7. Record migrations, commands run, failures, and remaining compatibility code in stage completion record.
8. Do not commit, push, delete user data, or remove compatibility state unless explicitly authorized.
9. Implement and test stage rollback switch before changing default path. Never dual-execute filesystem mutations.

Suggested stage prompt:

```text
Implement Stage N, work package N.M from DERP_DESK_ROADMAP.md.
Read AGENTS.md and entire stage first. Inspect current implementation and tests.
Stay inside package scope and preserve all compatibility/mobile invariants.
Plan first, implement, add Interface-level and regression tests, run targeted checks,
then report changed files, migration behaviour, tests, and remaining stage work.
```

## Validation contract

After each work package, run targeted Rust, Bun unit, and Playwright tests proportional to changed behaviour. At every stage exit, all commands below must pass:

```powershell
bun run tsgo
bun run lint-errors
bun run fmt:check
cargo fmt --check
bun run test:unit
bun run test:batch
git diff --check
```

`test:batch` must remain at six or fewer batches. Rebalance files when adding end-to-end coverage.

Every stage also requires:

- Fresh-install test using empty data directory.
- Direct upgrade tests from current production and every retained compatibility schema, including skipped releases and state written after binary rollback—not only previous stage.
- Restart/idempotency test for every migration.
- Owner and Grant capability test where applicable.
- Desktop Chromium and narrow phone viewport smoke tests.
- Phone flow: browse -> play -> seek -> reload -> resume -> offline replay.
- Production build smoke test with SSR-dehydrated state, not only Vite development mode.
- No new console errors, failed network requests, or owner-route calls from shared pages.
- Route-level bundle inspection proving desktop-only chunks stay out of initial phone Library/player journey.
- Service-worker install inspection proving lazy desktop chunks are not eagerly precached.
- Checked numeric budgets for eager compressed bytes, install precache bytes, fixed-fixture browse/search p95 where affected, and allowed deltas.

## Stage overview

| Stage | Release outcome                                                | Depends on                    | Status                |
| ----- | -------------------------------------------------------------- | ----------------------------- | --------------------- |
| 1     | Cohesive shell with protected mobile media path                | Current `canvas` baseline     | Complete (2026-08-11) |
| 2     | Stable Resource read plane and one opener                      | 1                             | Not started           |
| 3     | Authorized, recoverable content commands                       | 2                             | Not started           |
| 4     | One ExplorerModel across owner, Grant, pane, and offline views | 3                             | Not started           |
| 5     | One playback session across routes and presentations           | 2-4                           | Not started           |
| 6     | Versioned SpaceEngine with safe legacy import                  | 2-5                           | Not started           |
| 7     | One Space UX with Focus, Tiled, and Map presentations          | 6                             | Not started           |
| 8     | Typed events, unified discovery, Continue, and activity        | 2-7                           | Not started           |
| 9     | Shareable and read-only offline-capable Spaces                 | 3, 6-8                        | Not started           |
| 10    | ConversationHub and contextual assistant workflow              | 2-9                           | Not started           |
| 11    | First-class Knowledge Spaces                                   | 2-10                          | Not started           |
| 12    | Compatibility retirement and operational consolidation         | 1-11 plus compatibility epoch | Not started           |

---

## Stage 1 - Product shell and mobile safety baseline

### Outcome

Current features become discoverable as one product. `/` remains familiar fast Library; optional `/home` adds cohesion without risking phone launch. No domain migration yet.

### Work packages

- [x] **1.1 Freeze baseline behaviour and budgets.** Run full suite. Add missing regression coverage for phone browse/play/resume/offline, owner/share isolation, media Range responses, old query-string routes, Workspace, and Canvas. Check in measured compressed root-entry bytes, install-precache bytes, first-page browse p95 on a fixed large fixture, and permitted deltas; CI fails regression unless budget is deliberately reviewed.
- [x] **1.2 Introduce typed route Module.** Centralize parsing and generation for Home, Library, player/reader, Space compatibility, assistant, offline, and share routes. Keep `server/html.rs`, SPA fallback, service-worker navigation, and manifest start URL aligned through shared route-case fixtures. Replace direct history monkey-patching where possible while preserving existing query URLs. Unknown paths render real not-found UI instead of silently falling back to Library.
- [x] **1.3 Split route bundles and isolate PWA shell caching.** Lazy-load Workspace, Canvas, Reader/PDF/book renderers, editors, Settings manager, Offline manager, and Hermes. Build manifest distinguishes eager dependency closure from optional runtime chunks. Precache only immutable unspecialized build shell/assets; never store personalized SSR-dehydrated owner/share navigation HTML under shared `/index.html` cache key. Until Stage 9 packs dependencies atomically, keep renderer/worker assets required by existing offline PDF/book flows available. Loading `/`, `/library`, or direct media player on phone must not request or install desktop-only chunks.
- [x] **1.4 Make PWA upgrades safe.** Version shell caches by build. Do not delete prior assets while controlled old clients may request old lazy chunks; either retain previous cache until clients close or present explicit reload/update flow. Preserve existing offline IndexedDB/object-store identifiers.
- [x] **1.5 Add responsive owner shell.** Desktop rail may show all real destinations. Phone uses at most four targets—Library, Spaces, Search, More—with Home, Shared, Offline, and Settings inside More. Every destination wraps current working UI; no placeholders. Shell respects combined safe-area/player/navigation offset and disappears during fullscreen video. Share/login surfaces remain outside owner shell.
- [x] **1.6 Add opt-in useful Home.** `/home` uses existing stats/recent/progress data: Continue, recent Library locations, recent Canvas/Workspace entry points, active offline work. No empty placeholder destinations. Keep `/` and manifest `start_url` as Library.
- [x] **1.7 Apply UI branding.** Change visible title, manifest, icons, and description to Derp Desk. Keep Cargo package, executable name, environment names, cache/database identifiers, and old URLs unchanged.
- [x] **1.8 Prepare safe passcode-fragment rollout.** Accept and immediately scrub both fragment and legacy `?p=` secrets, but keep generating `?p=` during first compatibility release. Stage 2 switches generation to fragment only after fragment-capable clients are deployed; old query links remain accepted.
- [x] **1.9 Keep offline observation eager.** Minimal save-progress/completion observer and toast stay in shell until ActivityHub exists. Lazy-load only manager UI so navigating away cannot lose job feedback.

### Likely code areas

- `src/App.tsx`, `src/browser-history.ts`, new `src/lib/routes.ts`
- `src/FileBrowser.tsx`, `src/ThemeSwitcher.tsx`, `src/ThemeSwitcherMenuContent.tsx`
- `src/lib/share-url.ts`, `src/SharePasscodeGate.tsx`
- `index.html`, `public/manifest.webmanifest`, `public/service-worker.js`, `scripts/generate-service-worker.ts`, `scripts/service-worker-assets.ts`, `vite.config.ts`, `server/html.rs`
- `tests/e2e/navigation.spec.ts`, `mobile-media-management.spec.ts`, `audio-player.spec.ts`, `video-player.spec.ts`, `share-audio-api.spec.ts`, `url-state.spec.ts`, `offline-mode.spec.ts`, `passcode-shares.spec.ts`

### Exit gates

- Old `/workspace`, `/canvas`, `?path=`, `?viewing=`, and `?reader=` links still work.
- Owner can reach every current major surface from shell without manually typing URL.
- Shared link never renders owner shell or requests owner routes.
- Checked production manifest proves root entry cannot reach Workspace, Canvas, Hermes, Reader/PDF/book, or editor implementations. Compressed-byte and browse-p95 budgets pass.
- Fresh install -> save unopened PDF/book -> disconnect -> reload -> read succeeds before optional renderer precache is reduced.
- Two-build PWA upgrade leaves an old open tab able to lazy-load its Reader after new worker installs.
- Owner -> share -> offline/root and share -> owner navigation tests prove cached HTML/state cannot cross authorization scope.
- `/` performs no Space query. At 320x568 and 390x844, Library has no horizontal overflow, touch targets remain usable, and navigation never covers global player.
- Back/forward, refresh, copied deep links, direct production navigation, offline navigation, PWA launch, and SSR dehydration work for every new route and legacy alias.

### Rollback

- `new_shell` switch restores current header and route selection.
- Visible brand strings are reversible; old manifest/cache/storage identifiers remain valid.
- Legacy passcode link parser remains during compatibility period.

### Non-goals

- No Resource identity migration.
- No Workspace/Canvas merge.
- No new Activity, search, or assistant backend.

### Completion record

- Completed: 2026-08-11; all work packages 1.1–1.9 and Stage 1 exit gates verified.
- Commit/release: `f49dc2e`, `b09bce3`, `9c414a1`, `ab2b39c`, `041b619` on `derp-desk`; release not pushed.
- Data migrations: None. Server schema, user files, configuration, and legacy browser/offline state remain in place. Added only defensive read projections and additive `derp-desk-recent-owner-locations-v1` local state.
- Compatibility Adapters retained: `/`, `/library`, `/workspace`, `/canvas`, `?ws=`, `?path=`, `?viewing=`, `?reader=`, raw History API notification bridge, legacy `?p=` share generation/parser, fragment parser, `NEW_SHELL=0`, old owner/share media routes, and existing database/cache/object-store identifiers.
- Targeted tests: Typed-route TS/Rust shared fixtures; owner/Grant isolation; query/fragment passcode scrub; owner and Grant Range semantics; phone browse/play/seek/reload/resume/offline replay; Home/shell at desktop and 320x568/390x844; fresh offline PDF/EPUB; natural and forced two-build service-worker upgrades with a sibling old-build tab; cached-HTML scope isolation; offline observer/cleanup/retry; Workspace/Canvas compatibility. Final focused recovery runs: cleanup/offline notice 3/3, forced upgrade 2/2, natural upgrade 2/2.
- Full validation: `bun run tsgo`, `bun run lint-errors`, `bun run fmt:check` (373 files), `cargo fmt --check`, `bun run test:unit` (Rust 42/42; Bun 409/409, 1,073 assertions, 60 files), `bun run test:batch` (6/6 batches; 537/537 invocations), and `git diff --check` all passed. Production budget gate: root 320,499 raw/88,371 gzip; eager closure 686,159 raw/299,220 gzip; install precache 39 files, 2,927,261 raw/944,732 gzip; fixed 1,000-entry browse p95 6.6 ms. Earlier attempts exposed two stale failure-injection expectations and one transient Canvas timing miss (21.025 px against a 20 px tolerance); characterizations were corrected, the exact Canvas case reran 2/2, and the final full batch rerun was green.
- Manual desktop smoke: Production login, Library, Home, owner rail destinations, More actions, public Grant isolation, and typed 404 verified. Real rollback verifier proved default-on and `NEW_SHELL=0` API/SSR values plus mutually exclusive Library/Home/Workspace presenters.
- Manual phone smoke: Production 320x568 audit showed exactly four 80x63.33 navigation targets, no horizontal overflow, usable More destinations, and no shell on login/share/not-found. Automated 320x568 and 390x844 media/player/safe-area/fullscreen coverage passed.
- Known follow-ups explicitly deferred: Stage 2 Resource read plane/unified opener and fragment-only passcode generation; Stage 9 atomic offline dependency packs; Stage 12 compatibility retirement. Cross-tab simultaneous replacement of the same legacy offline path remains non-transactional; within-tab owner/Grant work is serialized and failed directory refresh restores prior entries. Forced PWA activation intentionally retains prior shell caches until a later natural activation can safely reclaim them. Reader chunk still emits Vite's >500 kB warning while all checked eager/install budgets pass.

---

## Stage 2 - Resource read plane and unified opener

### Outcome

Every openable thing has typed identity, kind, presentation, and provider-supported operations. Library, Workspace, Canvas, SSR, and Hermes read through one deep ResourceCatalog Module while legacy path routes remain compatible. Effective owner/Grant capabilities arrive in Stage 3.

### Required Interfaces

Illustrative shape; implementation may refine names while preserving small surface:

```rust
struct LibraryId(String);
struct SourceId(String);
struct ResourceId(String); // globally unique within installation
struct ResourceRef { library_id: LibraryId, resource_id: ResourceId }
struct ResourceLocator { source_id: SourceId, provider_locator: String }
struct ResourceVersion(String); // opaque, provider-produced

impl ResourceCatalog {
    async fn browse(&self, context: &ReadContext, query: BrowseQuery)
        -> Result<ResourcePage, CatalogError>;
    async fn inspect(&self, context: &ReadContext, resource: &ResourceRef)
        -> Result<ResourceDetail, CatalogError>;
}
```

Legacy path parsing/serialization stays in compatibility Adapter, not permanent ResourceCatalog Interface.

Frontend opener:

```ts
openResource(ref: ResourceRef, intent: OpenIntent, context: OpenContext): OpenPlan
```

`OpenContext` contains current owner/Grant scope identifier, surface/Space, effective capabilities when available, and presentation constraints. It never contains a passcode/token secret. Function is pure; caller executes returned plan.

### Work packages

- [ ] **2.1 Lock serialization contract.** Define LibraryId, SourceId, global ResourceId, ResourceRef, mutable ResourceLocator, opaque ResourceVersion, ResourceSummary, ResourceKind, provider-supported operations, and typed errors in Rust and TypeScript. Add golden JSON compatibility fixtures or generation so shapes cannot drift. Never infer version client-side from path or mtime.
- [ ] **2.2 Add durable Library/Source identity.** Persist IDs independent of display name, absolute path, root count, or root order. Add `legacy_library_keys` mapping and dual-read/write retained namespaces. Match old Sources only by explicit configured ID or unambiguous legacy ID/canonical path; simultaneous name+path changes without ID stop for recovery instead of guessing.
- [ ] **2.3 Add Resource identity catalog.** Filesystem Resources receive durable IDs and mutable locators. Every persisted ResourceRef retains legacy locator during compatibility. In-app moves retain ID. External moves reconcile best-effort; ambiguous fingerprint/platform identity leaves old Resource missing and creates new identity rather than silently rebinding. Backfill lazily from observed resources and state—never scan/hash entire Library before first page renders.
- [ ] **2.4 Build ResourceCatalog.** Hide root mapping, traversal/symlink rules, exclusions, built-in Collections, pagination, preview metadata, and intrinsic provider operations. Existing share validation remains read authorization Adapter until AccessPolicy lands.
- [ ] **2.5 Add real provider Adapters.** Local filesystem and minimal read-only Hermes provider satisfy internal provider Interface. Favorites, Most Played, and Shared become Collection Resources. Recent waits for ActivityHub. Keep fake paths only in compatibility Adapter.
- [ ] **2.6 Unify application queries.** Axum handlers and `server/html.rs` call same typed query Modules. Remove route-to-route calls and independently assembled SSR JSON.
- [ ] **2.7 Add narrow ViewerRegistry and one opener.** Registry maps Resource kind/MIME to built-in renderer/opener descriptors containing dynamic-import factories. Route generation, access, offline policy, and pane geometry stay in their owning Modules. Route existing Library, Workspace, Canvas, and share opens through pure `openResource` planning plus caller executor.
- [ ] **2.8 Complete passcode-fragment rollout.** After Stage 1 compatibility parser has shipped, generated links use fragment secret. Both fragment and legacy query forms remain accepted and scrubbed.

### Likely code areas

- New `server/resources/`, `server/application_queries/`, `lib/resource.ts`, `src/lib/open-resource.ts`, `src/lib/viewer-registry.ts`
- `server/media.rs`, `server/virtual_directory.rs`, `server/config.rs`, `server/state_db.rs`, `server/html.rs`
- `lib/types.ts`, `lib/virtual-directory.ts`
- `src/FileBrowser.tsx`, `src/WorkspacePage.tsx`, `src/CanvasPage.tsx`, `src/workspace/WorkspaceViewerPane.tsx`

### Tests to add

- Resource serialization and Rust/TypeScript golden-contract tests.
- Direct upgrade from current production schema and every retained compatibility schema, including skipped releases and rollback/re-upgrade writes.
- Stable Source/Resource identity across display rename, root reorder, app-mediated file rename, and restart.
- External rename reconciliation, ambiguity that never silently rebinds, and defined missing-resource behaviour.
- Provider conformance suite for filesystem and Hermes.
- Path traversal, symlink, exclusion, Unicode, multiple-root, missing-resource, and stale-version cases.
- ViewerRegistry and `openResource` table tests for every supported MIME/kind, context, and intent; test imports stay lazy.
- SSR and client-query response parity.
- Large upgrade fixture proves first listing/media open stays within checked Stage 1 browse budget while registry reconciliation continues incrementally.

### Exit gates

- Same ResourceRef produces same open plan and provider-supported operations from Library, Workspace, Canvas, and shared view. Existing authorization still controls actual action until Stage 3.
- No new code outside compatibility Adapter uses provider path strings to infer identity, kind, or appearance.
- Reordering/renaming configured roots with stable IDs does not select a different application-state namespace; ambiguous legacy configuration halts with recovery guidance.
- Existing path URLs and persisted path fields continue through compatibility Adapter; new persisted refs include legacy locator until retirement.

### Rollback

- `catalog_reads` switch routes reads back through legacy listing implementation.
- New tables/fields are additive; `FileItem.path`, root IDs, and legacy namespace fields remain serialized/written for old clients.
- Downgrade after root edit uses `legacy_library_keys`; re-upgrade reconciles writes produced by rolled-back binaries.

### Non-goals

- Resource mutations remain on existing routes until Stage 3.
- Media byte/range routes remain direct and unchanged; ResourceCatalog returns identity, metadata, capabilities, and existing playback URLs.
- No public provider/plugin interface.
- No whole-library content index.

---

## Stage 3 - AccessPolicy and recoverable ContentCommands

### Outcome

One implementation owns every file mutation for owner and Grant callers. Operations are capability-checked, journaled, observable, recoverable, and safe across filesystem/SQLite partial failure.

### Required Interfaces

```rust
enum Principal { Owner, Grant(GrantId) }

impl AccessPolicy {
    async fn authorize(&self, context: &RequestContext, action: Action, resource: &ResourceRef)
        -> Result<AuthorizedResource, AccessError>;
}

impl ContentCommands {
    async fn execute(&self, context: &RequestContext, command: ContentCommand)
        -> Result<CommandReceipt, CommandError>;
}
```

### Work packages

- [ ] **3.1 Stabilize Grant persistence.** Assign internal GrantId mapped to current share token. Replace full-list delete/reinsert persistence with targeted typed Grant reads/updates before adding new columns; old binaries must not erase newer extension state.
- [ ] **3.2 Establish RequestContext.** Authentication Adapters turn owner cookie or Grant token/session into Principal. Async AccessPolicy resolves Resource and Grant facts, intersects provider-supported operations with policy, and returns authoritative effective capabilities. UI-provided booleans are never trusted.
- [ ] **3.3 Define command algebra.** Create file/folder and upload use destination parent ResourceRef plus validated child name. Replace uses target and expected ResourceVersion. Copy/move use source, destination parent, target name, expected versions, and idempotency key. Existing delete semantics stay unchanged in this stage.
- [ ] **3.4 Extract mutation implementation.** Move validation, quota, editable-root checks, path resolution, filesystem work, metadata relocation, image cleanup, search invalidation, and event creation out of route files.
- [ ] **3.5 Add scoped operation journal.** Journal only commands crossing non-atomic filesystem/application-state steps. Unique `(principal_scope, idempotency_key)` binds immutable request digest and stored receipt. Track lease, attempts, planned/applied/finalized, failed, and `needs_reconciliation`; never store content or credentials. Use staging/temp renames where applicable and reconcile at startup.
- [ ] **3.6 Convert owner routes.** Existing endpoints become thin transport Adapters over ContentCommands without changing request compatibility.
- [ ] **3.7 Convert Grant routes.** Keep `/api/share/...` separate, but route through same commands and AccessPolicy. Preserve quotas and existing restrictions.
- [ ] **3.8 Freeze typed receipt/event envelope.** Successful commands produce stable command ID, resulting opaque versions, affected refs, visibility scope, and versioned event. Maintain legacy SSE payload Adapter until Stage 8; later EventFeed persists this envelope without reinterpretation.

### Likely code areas

- New `server/access/`, `server/content_commands/`, command journal tables in `server/state_db.rs`
- `server/routes/files.rs`, `server/routes/share_access.rs`, `server/path_metadata.rs`
- `server/routes/auth.rs`, `server/shares.rs`, `server/routes/sse.rs`

### Tests to add

- Table-driven Principal x Capability x Command authorization matrix.
- Same command conformance tests through owner and Grant transport Adapters.
- Quota, read-only, editable-root, traversal, symlink, conflict, overwrite, and version mismatch cases.
- Repeated idempotency key with same digest returns stored receipt; different digest is rejected.
- Fault injection at every journal transition; restart finishes, compensates, or exposes typed `needs_reconciliation` with operator recovery action.
- Rename/move preserves Resource ID, favorites, reader progress, legacy Canvas/workspace references, and share roots.
- Old-binary Grant update followed by re-upgrade preserves/reconciles newer typed fields.

### Exit gates

- No route handler directly mutates filesystem content.
- Owner and Grant behaviour differ only through AccessPolicy/capabilities, not duplicated mutation implementations.
- Injected failure never reports success for lost work. Uncompensatable external changes remain visible as `needs_reconciliation`, never silent or permanently hidden.
- Existing upload/edit/share tests pass unchanged or through explicit compatibility assertions.

### Rollback

- Migrate commands one at a time behind per-command cutover switches. A request executes exactly one implementation.
- Before disabling a command implementation, drain or recover its journal entries.
- Existing transport response/error shapes remain compatibility Adapters.

### Non-goals

- No collaborative editing.
- No background workflow engine beyond command journal/reconciliation.
- No Trash/undo semantics change yet; Stage 8 adds it after Activity UI exists.

---

## Stage 4 - One ExplorerModel

### Outcome

Library, Workspace browser panes, shared folders, and Offline browse through one headless ExplorerModel. Presenters may differ, but navigation, selection, queries, actions, and capability semantics live once.

### Required Interface

```ts
interface ExplorerModel {
  getSnapshot(): ExplorerSnapshot
  subscribe(listener: () => void): () => void
  dispatch(intent: ExplorerIntent): Promise<ExplorerOutcome>
  dispose(): void
}
```

Resource Adapter, pure opener, history, local storage, clock, and online state are injected when model is constructed. Model emits an OpenPlan; presenter executes it. Interface also specifies pagination, cancellation, stale responses, optimistic updates, typed errors, selection persistence, subscription ordering, and disposal.

### Work packages

- [ ] **4.1 Extract state machine.** Navigation, breadcrumbs, selection, sorting, view mode, pagination/virtualization, keyboard focus, refresh, and mutation reconciliation become explicit model state/actions.
- [ ] **4.2 Add caller Adapters.** Owner online, Grant-token, and offline IndexedDB are real Adapters. Grant Adapter cannot construct owner route requests. Until Stage 9, offline Adapter is read-only except local vault save/remove and returns typed unavailable errors for server mutations.
- [ ] **4.3 Make commands capability-driven.** Menus and shortcuts derive from Resource capabilities; remove `isShare`, provider-name, hard-coded virtual path, and scattered read-only branching.
- [ ] **4.4 Migrate main Library.** Preserve mobile list/grid, media launch, drag/drop, KB affordances, URL state, and offline save.
- [ ] **4.5 Migrate Workspace browser pane.** Preserve tabs, split/floating/map open intents, cross-window drag/drop, search, and pane-local history.
- [ ] **4.6 Migrate shared browser.** Use same model and primitives with Grant Adapter. Preserve strict route isolation and capability-specific menus.
- [ ] **4.7 Migrate Offline view.** Offline catalog becomes another presenter/Adapter, not a special hard navigation to root FileBrowser. Map ResourceId to legacy cache keys with dual lookup so existing saved media is not redownloaded or orphaned.
- [ ] **4.8 Isolate compatibility explorer.** Default presenters use ExplorerModel after parity tests. Freeze legacy orchestration behind dynamically imported rollback switch; do not statically bundle both paths. Final deletion waits for Stage 12 compatibility retirement.

### Likely code areas

- New `lib/explorer-model.ts`, `src/explorer/`, `src/lib/resource-adapters/`
- `src/FileBrowser.tsx`, `src/ShareFolderBrowser.tsx`, `src/workspace/WorkspaceBrowserPane.tsx`
- Existing shared file list/grid/breadcrumb/context-menu primitives
- `src/lib/offline-files.ts`, `src/OfflineStatus.tsx`

### Tests to add

- Pure ExplorerModel transition tests including stale request cancellation and optimistic rollback.
- Adapter conformance suite executed against owner, Grant, and offline fixtures.
- One parity scenario matrix reused by Library, pane, and shared presenters.
- Keyboard, touch, virtualization, drag/drop, and back/forward regression coverage.
- Phone media flow and bundle gate from Stage 1 remain mandatory.
- Existing path-keyed offline entries resolve by ResourceRef without redownload; offline mutation returns typed read-only/unavailable outcome.

### Exit gates

- A behaviour fix in ExplorerModel applies to all four presenters.
- Shared presenter cannot issue owner request even when given crafted UI state.
- Legacy explorer implementations no longer own server mutations or navigation state machines.
- Default Library, pane, share, and offline presenters contain presentation only; frozen legacy orchestration has no default call sites and adds no eager bytes.

### Rollback

- Presenter-level switch can select legacy explorer during migration.
- Do not delete legacy orchestration until all four presenters pass shared parity suite.

### Non-goals

- No Space layout merge yet.
- No unified full-text search yet.

---

## Stage 5 - Media continuity and one PlaybackSession

### Outcome

Audio/video ownership no longer belongs to a route or presentation. One scoped PlaybackSession preserves queue, item identity, position, and chrome across Library, Explorer pane, legacy Workspace/Canvas, and later Space navigation without changing media byte delivery.

### Required Interface

```ts
type PlaybackScope = { kind: 'owner' } | { kind: 'grantSession'; id: string }

interface PlaybackSession {
  getSnapshot(): PlaybackSnapshot
  subscribe(listener: () => void): () => void
  dispatch(command: PlaybackCommand): PlaybackOutcome
}
```

Session stores ResourceRef/opaque version and resolves playable URL through current authorized Adapter. Grant tokens/passcodes never enter ResourceRef or persisted playback state.

### Work packages

- [ ] **5.1 Characterize media semantics.** Lock current audio queue, video/native-control, audio-only switching, Range, share, resume, and offline behaviour with fixtures and numeric startup budgets.
- [ ] **5.2 Define playback state machine.** Explicit states and commands cover load, play/pause, seek, queue, next/previous, error/retry, source refresh, offline fallback, and teardown. Specify event ordering and stale media/version behaviour.
- [ ] **5.3 Move ownership above routes.** Shell owns one owner PlaybackSession. Grant shell owns separate scoped session. Crossing security scope stops or explicitly transfers playback after authorization; it never leaks Grant media into owner history.
- [ ] **5.4 Adapt every presenter.** Library player hook, workspace audio store, Canvas panes, shared audio/video, and offline player become thin presenters/Adapters. One visible chrome owns audio; video fullscreen/native controls remain appropriate to device.
- [ ] **5.5 Persist safe continuity.** Save queue refs and progress without credentials. Missing, moved, revoked, or version-changed Resources produce explicit recoverable state. Resource move keeps playback identity.
- [ ] **5.6 Preserve offline playback.** ResourceId-to-legacy-cache-key mapping and dual lookup keep installed media usable without redownload. Online/offline switch does not duplicate queue entries or reset position.
- [ ] **5.7 Cut over behind switch.** `unified_playback` selects new dynamically imported implementation. Keep old player path for compatibility epoch; never run both owners simultaneously.

### Likely code areas

- New `lib/playback-session.ts`, `src/media/playback/`
- Current Library media-player hook and `lib/workspace-audio-store.ts`
- `src/FileBrowser.tsx`, Workspace/Canvas media panes, share players
- `src/lib/offline-files.ts`, media URL builders
- Audio/video/mobile/share/offline end-to-end specs

### Tests to add

- Pure PlaybackSession transition and event-order tests.
- Owner versus Grant scope isolation, revoked Grant, refreshed URL, missing Resource, and version change.
- Library -> folder -> Space/legacy Workspace -> Library with uninterrupted audio and one chrome.
- Legacy Workspace/Canvas navigation leaves queue and position intact before Stage 7 cutover.
- Video fullscreen, native controls, audio-only switch, background audio, reload resume, Range, and offline replay.
- Production route/bundle and startup budgets remain within Stage 1 limits.

### Exit gates

- Exactly one playback owner exists per authorized scope; default code no longer reads competing global player stores.
- Navigation and later presentation changes cannot remount away durable playback state.
- Phone golden journey, shared media, offline media, and byte-range suites pass unchanged.
- `/api/media/*`, share media routes, Range semantics, and offline bytes remain unchanged.

### Rollback

- `unified_playback` selects old implementation before session construction.
- Persisted format retains legacy media key alongside ResourceRef during compatibility period.
- Rollback never leaves both old and new sessions playing.

### Non-goals

- No recommendation engine, transcoding redesign, or server queue.
- No Activity/Continue aggregation yet; Stage 8 consumes PlaybackSession progress.

---

## Stage 6 - Durable, versioned SpaceEngine

### Outcome

Canvases and explicitly saved/imported Workspace sessions persist as one Space model with stable IDs and revisions. Unsaved `?ws=` sessions stay browser-local scratch; named layouts remain templates. Existing Workspace and Canvas UIs remain usable while storage converges underneath them.

### Required model

```ts
type Space = {
  id: string
  name: string
  revision: number
  panes: Record<string, PaneContent>
  arrangements: {
    tiled?: TiledPlacement
    spatial?: SpatialPlacement
  }
}
```

Focused pane, camera, scroll, transient selection, and playback controls are device-local SessionState. Reusable layout templates and taskbar/user preferences are separate from Spaces. Storage Adapter may preserve unknown legacy fields in opaque migration envelope, but unbounded extensions are not part of Space Interface.

### Work packages

- [ ] **6.1 Specify Space commands and invariants.** Create/rename/delete/duplicate Space; add/remove/update Pane; apply arrangement; restore revision. Pane identity and content state do not change when presentation changes.
- [ ] **6.2 Add typed schema and history.** Store current head, immutable revision snapshots with retention, arrangements, tombstones, and migration markers in SQLite. Expected-revision compare/update and snapshot append occur in one SQLite transaction. Storage Adapter round-trips unknown legacy fields without exposing plugin-shaped extension map.
- [ ] **6.3 Build SpaceEngine.** Small typed-result Interface: list, load, apply command with expected revision. Hide validation, migrations, history retention, tombstones, and merge/recovery policy.
- [ ] **6.4 Add optimistic client Adapter.** Local changes apply immediately, save through versioned commands, show saved/saving/offline/conflict/failed state, and create named recovered copy for irreconcilable conflict. No CRDT.
- [ ] **6.5 Import Canvas state and define compatibility projection.** Deterministic, idempotent conversion preserves Canvas IDs, records, writer/timestamp semantics, and tombstones. Space Store becomes canonical. During one compatibility epoch, accepted legacy-representable revisions transactionally update legacy Canvas projection; migration records high-water version so writes made by rolled-back old binary are detected and reconciled on re-upgrade.
- [ ] **6.6 Import Workspace state explicitly.** On first open/save, offer deterministic conversion of current local `?ws=` session into Space. Do not enumerate or upload every browser-local session. Named layouts stay templates; taskbar settings stay preferences. Ask before unexpected/corrupt state and never silently discard it.
- [ ] **6.7 Put old screens on correct mode.** `/canvas` resolves migrated durable Space through SpaceEngine. `/workspace?ws=` remains legacy-local scratch until user imports/saves; converted `/spaces/:id` uses SpaceEngine. Old routes stay compatibility entry points.
- [ ] **6.8 Add revision recovery UI.** User can inspect retained versions and restore/duplicate after conflict or accidental layout loss. Define tombstone restoration and expired-history behaviour.

### Likely code areas

- New `server/spaces/`, `lib/space.ts`, `lib/space-client.ts`
- `server/state_db.rs`, `server/canvas_persistence.rs`, `server/workspace_persistence.rs`
- `lib/use-workspace.ts`, `lib/infinite-canvas.ts`
- `src/CanvasPage.tsx`, `src/WorkspacePage.tsx`, workspace persistence hooks

### Tests to add

- Pure Space command/validation tests through SpaceEngine Interface.
- Legacy Canvas/workspace fixtures, unknown-field round trips, corrupt-state quarantine, repeated import, rollback write/re-upgrade reconciliation, and restart idempotency.
- Two-client expected-revision conflict and recovered-copy behaviour.
- Pane content survives switching arrangements and server restart.
- Cross-device load with device-local focus/camera not leaking.
- Existing Workspace and Canvas end-to-end suites remain green before visual convergence.

### Exit gates

- Every Canvas and explicitly saved/imported Workspace session has durable Space ID. Named layouts remain templates; unsaved `?ws=` sessions remain local.
- Reload or second browser restores Space content; device-local state remains local.
- Legacy data stays readable and exportable.
- No whole-record last-writer-wins save can silently discard a concurrent accepted revision.
- Rename/move through ContentCommands preserves durable Space ResourceRefs.

### Rollback

- Space tables are additive and canonical. Lossless legacy projection exists only for representable Canvas fields during documented compatibility epoch.
- Legacy Canvas records/localStorage are retained unchanged and exportable; new-only Space fields may be invisible after binary downgrade but are never deleted.
- `space_engine` switch selects legacy presenter backed by compatibility projection; it does not send new writes to stale legacy state.

### Non-goals

- No real-time multiplayer or CRDT.
- No final combined Space chrome; Stage 7 owns presentation convergence.

---

## Stage 7 - One Space experience: Focus, Tiled, Map

### Outcome

User opens stable Space URL and switches presentation without losing work. Standalone Workspace and Canvas become compatibility routes, not separate products. `/` remains Library.

### Work packages

- [ ] **7.1 Add stable Space routes.** `/spaces`, `/spaces/:id`, and explicit `/spaces/:id/focus|tiled|map`. Bare Space route selects device-local presentation without importing Tiled/Map first. Copied explicit presentation stays explicit across devices. Old `/canvas` and already imported/saved Workspace IDs redirect to durable Space. Unsaved local `?ws=` stays local scratch and offers explicit import; never silently uploads or redirects it.
- [ ] **7.2 Build one Space shell.** Space picker, name, sync state, undo/redo, add Resource, existing Resource-share action, and presentation switcher live in common chrome. Space sharing waits for Stage 9.
- [ ] **7.3 Build shared PaneHost/runtime.** One runtime keyed by Pane ID owns browser/viewer/editor/reader/player/assistant state. ViewerRegistry selects dynamic implementation; presenters own geometry. Presenter remount is allowed only when externally held state and Pane identity survive.
- [ ] **7.4 Implement Focus presentation.** One active Pane with tab switcher. Default narrow-screen presentation and accessible fallback for every Space.
- [ ] **7.5 Adapt Tiled presentation.** Reuse current Workspace tiling, splits, snapping, taskbar, and keyboard behaviour against Space arrangements.
- [ ] **7.6 Adapt Map presentation.** Reuse current Canvas pan/zoom, semantic zoom, minimap, and placement against same Pane IDs.
- [ ] **7.7 Preserve state across presentation changes.** Reader position, editor draft, browser history, assistant draft, PlaybackSession, and Pane identity survive Focus/Tiled/Map switch.
- [ ] **7.8 Isolate legacy shells.** Default Space route uses unified runtime. Keep old Workspace/Canvas presenters dynamically available for rollback and old routes through compatibility epoch; Stage 12 owns deletion.

### Likely code areas

- New `src/spaces/`
- `src/CanvasPage.tsx`, `src/WorkspacePage.tsx`, `src/workspace/`
- `lib/use-workspace.ts`, `lib/infinite-canvas.ts`
- `src/App.tsx`, route Module from Stage 1

### Tests to add

- Same Space/Panes rendered sequentially in Focus, Tiled, and Map with state preserved.
- Stable deep link, reload, history, duplicate, rename, restore, and delete flows.
- Narrow phone Space uses Focus without loading Tiled/Map chunks until requested.
- Desktop layout, canvas, cross-drag, viewer, reader, editor, and Hermes parity suites.
- Accessibility: keyboard-only presentation switch and focused Pane navigation.

### Exit gates

- Canvas and Workspace no longer appear as separate product destinations.
- Switching presentation never duplicates runtime, closes Pane, resets externally held content state, or creates second playback owner.
- Phone can open any Space in Focus and play media without desktop geometry code.
- Old Canvas/imported-Workspace bookmarks resolve to migrated Space; unsaved local Workspace bookmark still opens local scratch or explicit import prompt.

### Rollback

- `unified_spaces` selects new or legacy presenter without changing `/` Library start.
- Old routes remain compatibility aliases for at least two releases.
- Rollback changes presenter only; SpaceEngine data remains intact.

### Non-goals

- No shared Space Grants yet; Stage 9 owns them.
- No new search index or AI workflow.

---

## Stage 8 - Find, continue, and observe work

### Outcome

One Discovery surface finds Resources, content, Spaces, and Hermes session metadata. Home resumes meaningful Activity. Background work and progress survive navigation and reconnects.

### Work packages

- [ ] **8.1 Add durable typed EventFeed.** SQLite sequence/outbox stores frozen Stage 3 envelopes, visibility scope, and retention watermark. Interface subscribes by scope and optional cursor. SSE supports `Last-Event-ID`; retention/broadcast gaps emit `resync-required`. Filter Grant visibility before serialization. Keep legacy event Adapter.
- [ ] **8.2 Deepen Discovery.** Existing file index becomes implementation behind one typed query Interface. Index filename/path, supported text/Markdown, Collection membership, Space title, and Hermes session metadata. Transcript/body indexing is opt-in. Check in fixed-corpus search p95/ranking budgets before cutover.
- [ ] **8.3 Add background extraction/rebuild.** Visible status, cancellation/retry, stale-index indication, and bounded read-through fallback during initial rebuild. Routes never perform synchronous recursive walks.
- [ ] **8.4 Add scoped ActivityHub.** Typed query/update Interface records opens, playback/reading progress, recent Resources/Spaces, command jobs, index work, previews, and offline jobs. Server SQLite owns durable server facts; command journal owns command state; IndexedDB Adapter owns client-only offline jobs. ActivityHub projects them without duplicating sources of truth. Raw Hermes events remain outside until Stage 10.
- [ ] **8.5 Connect continuity.** PlaybackSession and reader state publish progress through ActivityHub. Recent becomes query-backed Collection. Home uses same data across devices while local-only activity stays identified as local.
- [ ] **8.6 Ship universal palette.** Search current Space, Library, content, Spaces, open Panes, and Hermes session metadata. Commands use capabilities: open, split, pin, play, keep offline, and share existing Resource. Assistant action waits for Stage 10.
- [ ] **8.7 Upgrade Home and Activity center.** Continue reading/listening/watching, recent Spaces/documents, active/failed jobs, retry/dismiss actions, and index/sync health. Assistant needs-input state waits for ConversationHub.
- [ ] **8.8 Ship Trash and undo.** Add explicit trash commands on top of proven ContentCommands. Define per-Source trash location, same-volume staging, cross-volume verified fallback, quota accounting, retention, restore collision, permanent-delete confirmation, and rollback/export behaviour. Activity center exposes pending/failing cleanup.

### Likely code areas

- New `server/events/`, `server/discovery/`, `server/activity/`
- `server/file_search/`, `server/routes/search.rs`, `server/routes/share_search.rs`, `server/routes/sse.rs`, `server/html.rs`
- `src/discovery/`, `src/activity/`, Canvas search palette, Workspace taskbar search
- PlaybackSession, reader state, ContentCommands, and offline job observer

### Tests to add

- Event ordering, reconnect replay, lag/gap resync, scope filtering, and legacy SSE compatibility.
- Discovery ranking/filter fixtures across filenames, Markdown body, Spaces, and Hermes metadata.
- Access filtering proves Grant cannot infer inaccessible indexed content.
- Index rebuild/restart/cancellation and stale-result signalling.
- Palette keyboard/touch behaviour and action capability matrix.
- Home Continue ordering and cross-device progress.
- Activity source ownership prevents duplicate jobs/progress when server and IndexedDB reconnect.
- Trash/restore collision, cross-volume failure, retention, quota, permanent deletion, and old-version recovery.

### Exit gates

- One search/palette replaces Library, KB, taskbar, and Canvas search concepts.
- SSE lag cannot silently leave client permanently stale.
- Phone PlaybackSession progress appears on Home without changing media delivery/startup budgets.
- Background failures are visible and retryable; no transient presenter-local-only job state.
- Search and first-page browse remain inside checked p95/byte budgets.

### Rollback

- `typed_event_feed`, `unified_discovery`, `activity_center`, and `trash` switches can fall back independently.
- Legacy SSE and search response Adapters remain until replay, ranking, and access parity are proven.

### Non-goals

- No semantic/vector search by default.
- No automation recipe engine.
- No raw Hermes protocol/event ingestion; Stage 10 owns ConversationHub.

---

## Stage 9 - Space Grants and read-only offline continuity

### Outcome

User can share curated Resource, Collection, or Space and keep owner Space available offline for reading/playback. Same Resource/Space presenters run through strictly scoped Grant and offline Adapters. Offline server mutations remain out of scope.

### Work packages

- [ ] **9.1 Generalize Grant model.** Target Resource, Collection, or Space. Capabilities cover view, stream, download, edit, upload, delete, presentation access, keep-offline, expiry, and quota—no recipient re-sharing. Directory membership stays live over descendants. Query-backed Collection Grant defaults to captured membership; explicit live mode warns that newly matching Resources become exposed. Migrate existing booleans/tokens with targeted GrantStore updates.
- [ ] **9.2 Add rollback-safe installation Grant secret lifecycle.** Generate durable independent secret with restricted file permissions, key version, backup/restore guidance, legacy verifier/decrypt fallback, and compatible session-cookie expiry. Store versioned new ciphertext beside legacy admin-password-derived ciphertext and dual-write both through compatibility epoch; never overwrite only copy old binary can decrypt. Transactional migration records key version. Never derive new key from admin password; Stage 12 alone may retire legacy ciphertext.
- [ ] **9.3 Share Spaces.** Shared route loads Space through Grant context, renders Focus by default, optionally allows Tiled/Map when granted, and exposes only authorized Resources/commands. Presence of ResourceRef in layout grants nothing; every query, media request, command, search result, and event reauthorizes it.
- [ ] **9.4 Add live versus snapshot-manifest choice.** Live share follows allowed Space revisions. Snapshot manifest pins Space revision, membership, and expected Resource versions—not historical bytes. Changed/missing Resources render explicit state; unchanged underlying bytes remain served from filesystem.
- [ ] **9.5 Build Offline Vault.** Durable catalog of saved Resources, versions, storage use, failures, and eviction controls. Map ResourceId to existing object-store keys with dual lookup so upgrades do not redownload/orphan media.
- [ ] **9.6 Add Keep Space Offline.** Atomically save owner Space manifest, selected/referenced Resources, and required renderer/worker chunks; estimate storage, show partial availability, and permit exclusions. Grant offline save is disabled unless owner explicitly grants irreversible offline-download capability and UI warns revocation cannot claw back disconnected bytes. Grant cache is identity-scoped and purged when revocation is observed.
- [ ] **9.7 Keep offline mode read-only.** Offline Space may browse/read/play and retain device-local view/progress state, but edit/upload/delete/Space commands return explicit offline-unavailable result. Durable mutation outbox/conflict sync is a later separately approved roadmap.
- [ ] **9.8 Apply responsive shared UX.** Phone shared Space opens Focus/media path; desktop may use richer presentation. No owner shell or routes leak into shared bundle.

### Likely code areas

- `server/shares.rs`, `server/routes/share_access.rs`, `server/routes/share_media.rs`, `server/state_db.rs`
- `src/ShareRoute.tsx`, `src/ShareWorkspacePage.tsx`, shared resource Adapter from Stage 4
- `src/lib/offline-files.ts`, `src/OfflineStatus.tsx`, `public/service-worker.js`
- SpaceEngine and AccessPolicy Modules

### Tests to add

- Migration fixtures for every old restriction/passcode/share shape.
- New-version protected-Grant write -> old-binary decrypt/verify -> re-upgrade preserves both ciphertext versions and session compatibility.
- Resource/Collection/Space x capability matrix through shared UI and transport.
- Live Collection, captured Collection, live Space, and snapshot-manifest semantics; changed/missing versions; revoked/expired Grant behaviour.
- Crafted shared client cannot read owner routes, hidden Space panes, search hits, events, or cached content.
- Offline Space install/update/partial failure/quota/eviction/restart, legacy-key reuse, and atomic renderer-dependency tests.
- Phone share-to-play and installed-PWA offline replay.
- Revocation blocks future access but test/document that already downloaded bytes cannot be clawed back while device is disconnected.

### Exit gates

- One Grant model powers all sharing without weakening separate transport surface.
- Shared Space shows only authorized panes and actions even under direct crafted requests.
- “Keep Space Offline” remains usable after browser/server restart and reports incomplete content honestly.
- Existing share URLs and sessions migrate without administrator recreating links.

### Rollback

- `space_grants` disables new creation without affecting file/folder Grants; already-issued Space links retain read-only fallback presenter so rollback is not externally breaking.
- `offline_spaces` hides Space-pack creation while existing packs remain inspectable/exportable.
- Revocation and expiry always remain enforced even when new shared presenter is disabled.
- Binary downgrade continues verifying protected Grants through retained legacy ciphertext; installation-secret ciphertext remains untouched for re-upgrade.

### Non-goals

- No multi-owner collaboration or live co-editing.
- No server-side duplication of historical media blobs for snapshot manifests.
- No offline content/Space mutation queue or conflict synchronization.

---

## Stage 10 - ConversationHub and contextual assistant

### Outcome

Existing Hermes behaviour sits behind one deep ConversationHub. Assistant becomes explicit workbench capability with typed Resource/selection/Space context, provenance, and confirmed writes. Raw chat remains usable if contextual workflow is disabled.

### Required Interface

```rust
impl ConversationHub {
    async fn query(&self, context: &RequestContext, query: ConversationQuery)
        -> Result<ConversationView, ConversationError>;
    async fn execute(&self, context: &RequestContext, command: ConversationCommand)
        -> Result<ConversationReceipt, ConversationError>;
    async fn subscribe(&self, context: &RequestContext, cursor: Option<EventId>)
        -> Result<ConversationStream, ConversationError>;
}
```

Production Hermes and deterministic fake Hermes are real Adapters at external seam.

### Work packages

- [ ] **10.1 Characterize existing Hermes behaviour.** Lock session/project listing, create/resume/takeover, retry, branch/rewind/steer, attachments, voice, decisions, drafts, runtime/durable IDs, disconnect, and restart behaviour.
- [ ] **10.2 Extract ConversationHub.** Hide raw HTTP/RPC paths, method strings, query tuples, retries, ID mapping, takeover, connection lifecycle, and typed errors behind query/command/subscribe Interface.
- [ ] **10.3 Migrate routes and client store.** Existing Hermes routes become transport Adapters. Client session store consumes typed queries/commands/events. Conversation events enter EventFeed through scoped Adapter; Discovery/Activity no longer import raw Hermes payloads.
- [ ] **10.4 Complete Hermes Resource Adapter.** Stage 2 read provider gains ConversationHub-backed operations; AccessPolicy maps them to effective capabilities. Remove default dependencies on `Hermes Sessions/...`; keep fake-path resolver only for old links/state until Stage 12.
- [ ] **10.5 Add explicit assistant context.** “Ask this Resource/selection/Space” passes typed refs and opaque versions, displays attached-resource chips, and checks AccessPolicy before resolving each ref. Selected content is untrusted data, never instructions.
- [ ] **10.6 Preserve provenance and control writes.** Citations open exact Resource/version/selection or explicit changed/missing state. Answer may become note or pin into Space only after target preview and confirmation. No implicit file writes.
- [ ] **10.7 Connect surfaces.** Add assistant action to palette, Resource menu, Reader selection, and Space. Home/Activity shows streaming, failed, retrying, and needs-input turns.
- [ ] **10.8 Protect drafts and offline failure.** Unsent draft survives presenter switch/reload. Offline/disconnect gives recoverable local draft; sending requires authorized online execution unless later sync roadmap exists.

### Likely code areas

- New `server/conversations/`
- `server/hermes.rs`, `server/routes/hermes_chat.rs`, `server/virtual_directory.rs`
- `lib/hermes-session-store.ts`, `lib/virtual-directory.ts`, `src/workspace/HermesChatPane.tsx`
- Reader AI, Resource menus, Space Pane runtime, Discovery, ActivityHub, EventFeed

### Tests to add

- ConversationHub state machine with deterministic fake Adapter for every characterized operation and failure.
- Access checks for Resource, selection, and Space contexts in owner and Grant scopes.
- Prompt-injection fixture proves selected content stays data and cannot bypass confirmation/policy.
- Citation/provenance survives rename, Space revision, reload, changed version, and missing Resource.
- Draft/retry/takeover/session resume across Focus/Tiled/Map and disconnect.
- Raw Hermes chat parity when `contextual_assistant` is disabled.

### Exit gates

- Existing chat features pass through ConversationHub without regression.
- User can ask with explicit context, inspect sources, save confirmed answer as note, and pin result/session into Space.
- Raw Hermes protocol details do not leak outside production Adapter and compatibility resolver.
- Every assistant read/write is scoped by AccessPolicy and version-aware.

### Rollback

- `contextual_assistant` disables new context workflow while raw typed ConversationHub chat remains usable.
- Temporary `conversation_hub` rollback uses old Hermes transport path; both paths are dynamically exclusive.
- Notes, Spaces, and sessions already created remain ordinary durable Resources.

### Non-goals

- No autonomous background agents, workflow builder, implicit writes, or whole-library RAG.
- No AI inside public Grants unless explicitly designed after owner workflow proves safe.

---

## Stage 11 - First-class Knowledge Spaces

### Outcome

Current path-configured knowledge bases become durable Knowledge Space records without losing Markdown, recent/search, image paste/embed, sharing, Reader, assistant, or offline behaviour.

### Work packages

- [ ] **11.1 Define Knowledge Space model.** Stable ID, title, one or more Collection/root refs, optional home document, saved Discovery queries, attached conversation refs, default Space ref, and offline policy. Do not create generic plugin metadata.
- [ ] **11.2 Add typed KnowledgeStore and migration.** Import existing KB path settings through Resource legacy locators. Dual-read during compatibility; ambiguous/missing roots surface recovery instead of silently disappearing.
- [ ] **11.3 Consolidate knowledge queries.** Discovery owns content search/recent. ResourceCatalog owns roots/listing. ContentCommands owns Markdown/image mutations. Remove synchronous route/SSR walks after parity.
- [ ] **11.4 Ship Knowledge Space UX.** Create/manage/open from Library and Spaces; show home document, recent notes, saved queries, related assistant sessions, and explicit offline/share state.
- [ ] **11.5 Integrate assistant deliberately.** “Ask Knowledge Space” resolves explicit selected Collections/query results with limits and provenance. No implicit whole-library context.
- [ ] **11.6 Preserve share/offline behaviour.** Grant and Offline Adapters use same Knowledge Space presenter and reauthorize every Resource. Existing KB folder shares remain valid.

### Likely code areas

- New `server/knowledge/`, `src/knowledge/`
- Settings/typed state, ResourceCatalog, Discovery, ContentCommands
- Markdown editor/image handling, Reader, ConversationHub, Grant and Offline Adapters
- Existing knowledge-base and share-browser tests

### Tests to add

- Migration from current single/multiple KB paths, renamed root, missing root, corrupt state, skipped release, rollback/re-upgrade.
- Markdown search/recent, edit, image paste/embed, Reader, share, and offline parity.
- Knowledge Space Resource move/rename and stable deep link.
- Explicit assistant context limits, provenance, and Grant filtering.

### Exit gates

- Every configured legacy KB is imported or shown with actionable recovery; none silently vanish.
- Full collect -> search/read/edit -> ask -> arrange -> share/offline workflow uses existing deep Modules.
- No request path performs unbounded recursive KB scan.

### Rollback

- `knowledge_spaces` restores legacy KB entry UI while Knowledge records remain exportable.
- Legacy path settings remain written during compatibility epoch; no automatic deletion.

### Non-goals

- No backlinks/graph, task system, Notion/Obsidian clone, or semantic embeddings in initial migration.

---

## Stage 12 - Compatibility retirement and operational consolidation

### Outcome

After documented compatibility epoch, remove transitional implementations, finish typed state ownership and composition, then separately decide operational package/binary rename. No new product capability lands here.

### Work packages

- [ ] **12.1 Audit compatibility inventory.** List every old route, payload field, state shape, fake path, dual key/write, feature switch, presenter, and store with owner, introduced release, observed parity, downgrade procedure, and removal condition. Normally require two stable releases plus direct old-to-current migration tests.
- [ ] **12.2 Finish typed state Modules.** Library/Source registry, GrantStore, SpaceStore, ActivityStore, KnowledgeStore, and Conversation state already belong to owning stages. Replace remaining generic settings/JSON-path access with typed Modules; preserve unknown data in migration Adapter. No generic `Repository<T>`.
- [ ] **12.3 Consolidate composition root.** Replace public `AppState` fields with private Module handles for resources, access, commands, spaces, discovery, activity, conversations, jobs, and events. `server::run` constructs/lifecycles them. Use internal test harness; do not publish AppRuntime Interface without second real Adapter.
- [ ] **12.4 Thin transport and SSR Adapters.** Axum handlers map typed requests/results/errors only. SSR uses same application query Modules. Remove route-to-route imports, duplicate rate limiter, raw state reads, manual events, and domain errors containing HTTP concerns.
- [ ] **12.5 Retire proven legacy implementations.** Remove frozen explorers, old Workspace/Canvas shells and persistence, fake Hermes paths, old player stores, generic `store.rs`, and completed dual writes one item at a time. Keep permanent URL aliases where cheap/user-visible.
- [ ] **12.6 Run full migration/security/performance audit.** Directly test current production and every retained schema to final release, including writes made after binary rollback. Verify owner/Grant isolation, media/mobile budgets, cache upgrades, search privacy, and recovery exports.
- [ ] **12.7 Decide operational rename in separate checkpoint.** UI already says Derp Desk. Rename Cargo package/binary/config/cache identifiers only with executable/config aliases, deployment instructions, backup, downgrade plan, and explicit user approval. Keeping `derp-media-server` internals is acceptable.
- [ ] **12.8 Rewrite product documentation.** README explains Library, Spaces, phone media path, sharing, offline limits, assistant safety, backup/restore, upgrade/downgrade, and compatibility guarantees.

### Likely code areas

- Typed state Modules, `server/app.rs`, `server/server.rs`, `server/html.rs`, `server/routes/`
- Frozen legacy frontend implementations and compatibility persistence
- `README.md`, `package.json`, `Cargo.toml`, service/config/deployment documentation

### Tests to add

- Final compatibility matrix from pre-Derp Desk URLs/state and every retained schema to current release.
- Old binary write -> current binary re-upgrade reconciliation fixtures.
- Clean startup/shutdown, background worker failure, corrupt state quarantine, and backup/restore.
- Static architecture checks: no non-route Module imports `server/routes`; no default UI imports frozen presenters; SSR/HTTP golden query parity.
- Final phone media, owner/Grant security, PWA upgrade/offline, Space, Discovery, and assistant suites.

### Exit gates

- Generic JSON-path store and public lock/map/database state no longer form application Interfaces.
- Default code has one explorer, one playback owner, one Space runtime, one event model, and one query/command path per behaviour.
- Every deleted compatibility path passed its documented epoch and downgrade/migration gate.
- README describes one coherent product while phone media remains first-class.

### Rollback

- Compatibility deletion and operational rename are separate reviewed releases, never hidden inside feature-flag rollout.
- Take verified backup/export before destructive schema cleanup; prefer leaving unused additive columns/tables over unsafe drop.
- Binary/config rename retains aliases for documented period and has tested downgrade instructions.

### Non-goals

- No new provider, collaboration model, workflow engine, or product surface.

## Completion record template

Copy under completed stage and update overview status.

```md
### Completion record

- Completed:
- Commit/release:
- Data migrations:
- Compatibility Adapters retained:
- Targeted tests:
- Full validation:
- Manual desktop smoke:
- Manual phone smoke:
- Known follow-ups explicitly deferred:
```

## Product-level finish line

Roadmap succeeds when:

- Phone remains excellent simple media player.
- Desktop presents one coherent Space workflow rather than Library/Workspace/Canvas silos.
- Same Resource identity, capabilities, opener, progress, and commands work everywhere.
- Owner, Grant, and offline behaviours vary through explicit Adapters at real seams.
- User can collect -> consume/edit -> understand with assistant -> arrange -> share/offline without switching products.
- Complexity concentrates behind ResourceCatalog, ContentCommands, SpaceEngine, Discovery, ActivityHub, EventFeed, and ConversationHub Interfaces.
