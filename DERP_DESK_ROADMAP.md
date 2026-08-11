# Derp Desk Roadmap

Status: active; Stage 2 complete
Initiative branch: `derp-desk`
Last updated: 2026-08-11

This document guides evolution of Derp Media Server into Derp Desk through small releasable stages. Product serves two trusted users, so roadmap favors a clear system and fast delivery over enterprise-scale process.

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
- Preserve media playback, Range requests, current share links, and user files while replacing architecture.
- Support current stored state and a direct upgrade from the immediately previous release. Keep a backup before schema changes; long-lived old-version support is out of scope.
- No generic plugin/iframe runtime, CRDT collaboration, provider marketplace, or default whole-library embeddings.
- Add a Seam only where behaviour really varies. Filesystem/Hermes, owner/grant, online/offline, and server/local optimistic state are real Adapter seams. SQLite does not need a public generic repository Interface.
- New Modules must be deep: small Interface, high Leverage, tests through that Interface. Replace old shallow paths after callers move; do not leave permanent parallel abstractions.

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

Stage exit means new path is default-on, deployable, and observable. Temporary switches are allowed only while a replacement is being verified; remove them promptly.

For every AI session:

1. Read `AGENTS.md` and this roadmap completely.
2. State current stage and work package. Do not implement later-stage ideas opportunistically.
3. Inspect current code and tests before proposing files. Roadmap names likely locations, not mandatory structure.
4. Preserve unrelated user changes. Check `git status --short --branch` before and after work.
5. Write or update tests at Module Interface before deleting old implementation paths.
6. Move callers through one deep Interface, verify behavior, then delete replaced paths.
7. Record commands, failures, data changes, and remaining work in stage completion record.
8. Do not push or delete user data unless explicitly authorized.
9. Prefer backup/restore and small reversible commits over permanent dual implementations.

Suggested stage prompt:

```text
Implement Stage N, work package N.M from DERP_DESK_ROADMAP.md.
Read AGENTS.md and entire stage first. Inspect current implementation and tests.
Stay inside package scope and preserve current product/mobile behavior.
Plan first, implement, add Interface-level and regression tests, run targeted checks,
then report changed files, data behavior, tests, and remaining stage work.
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
- Direct upgrade test from current production state when storage changes.
- Restart/idempotency test for storage changes.
- Basic owner and shared-link boundary test where applicable.
- Desktop Chromium and narrow phone viewport smoke tests.
- Phone flow: browse -> play -> seek -> reload -> resume -> offline replay.
- Production build smoke test with SSR-dehydrated state, not only Vite development mode.
- No new console errors, failed network requests, or owner-route calls from shared pages.
- Route-level inspection proving desktop-only chunks stay out of initial phone Library/player journey.
- Service-worker install inspection proving lazy desktop chunks are not eagerly precached.

## Stage overview

| Stage | Release outcome                                                | Depends on                | Status                |
| ----- | -------------------------------------------------------------- | ------------------------- | --------------------- |
| 1     | Cohesive shell with protected mobile media path                | Current `canvas` baseline | Complete (2026-08-11) |
| 2     | Stable Resource read plane and one opener                      | 1                         | Not started           |
| 3     | Recoverable content commands                                   | 2                         | Not started           |
| 4     | One ExplorerModel across owner, Grant, pane, and offline views | 3                         | Not started           |
| 5     | One playback session across routes and presentations           | 2-4                       | Not started           |
| 6     | Versioned SpaceEngine with one-time Canvas import              | 2-5                       | Not started           |
| 7     | One Space UX with Focus, Tiled, and Map presentations          | 6                         | Not started           |
| 8     | Typed events, unified discovery, Continue, and activity        | 2-7                       | Not started           |
| 9     | Shareable and read-only offline-capable Spaces                 | 3, 6-8                    | Not started           |
| 10    | ConversationHub and contextual assistant workflow              | 2-9                       | Not started           |
| 11    | First-class Knowledge Spaces                                   | 2-10                      | Not started           |
| 12    | Final cleanup and operational consolidation                    | 1-11                      | Not started           |

---

## Stage 1 - Product shell and mobile foundation

### Outcome

Current features become discoverable as one product. `/` opens Library today and `/home` adds cohesion. Later stages may refactor either route as long as phone browse, play, resume, and offline use remain excellent.

### Work packages

- [x] **1.1 Characterize core behavior.** Add regression coverage for phone browse/play/resume/offline, media Range responses, current routes, Workspace, and Canvas. Tests protect user outcomes, not internal structure.
- [x] **1.2 Introduce typed route Module.** Centralize parsing and generation for Home, Library, player/reader, Space, assistant, offline, and share routes. Keep `server/html.rs`, SPA fallback, service-worker navigation, and manifest start URL aligned through shared route-case fixtures. Replace direct history monkey-patching where possible while preserving useful current URLs. Unknown paths render real not-found UI instead of silently falling back to Library.
- [x] **1.3 Split major routes and keep PWA state scoped.** Lazy-load large desktop/editor surfaces. Cache generic shell assets without caching personalized owner/share HTML under one key. Keep renderer/worker assets required by current offline PDF/book flows available. Future refactors may change chunk boundaries when phone startup and offline use remain sound.
- [x] **1.4 Keep PWA upgrades understandable.** Version shell caches by build, preserve saved offline media, and present a reload flow when application code changes.
- [x] **1.5 Add responsive owner shell.** Desktop shows useful destinations; phone uses compact navigation suited to available space. Every destination wraps working UI. Shell respects player/fullscreen layout and keeps share/login views separate.
- [x] **1.6 Add opt-in useful Home.** `/home` uses existing stats/recent/progress data: Continue, recent Library locations, recent Canvas/Workspace entry points, active offline work. No empty placeholder destinations. Keep `/` and manifest `start_url` as Library.
- [x] **1.7 Apply UI branding.** Change visible title, manifest, icons, and description to Derp Desk. Keep Cargo package, executable name, environment names, cache/database identifiers, and old URLs unchanged.
- [x] **1.8 Prepare passcode-fragment rollout.** Accept and scrub fragment and existing query links; Stage 2 switches generated links to fragments.
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
- Phone Library starts without eagerly mounting desktop workbench surfaces.
- Fresh install -> save unopened PDF/book -> disconnect -> reload -> read succeeds before optional renderer precache is reduced.
- Owner -> share -> offline/root and share -> owner navigation tests prove cached HTML/state cannot cross authorization scope.
- At 320x568 and 390x844, Library has no horizontal overflow, touch targets remain usable, and navigation never covers global player.
- Back/forward, refresh, copied deep links, direct production navigation, offline navigation, PWA launch, and SSR dehydration work for current routes.

### Recovery

- Keep user files and offline state untouched by shell changes.
- Remove temporary shell switch after the new shell is accepted.
- Existing passcode links stay readable during rollout.

### Non-goals

- No Resource identity changes.
- No Workspace/Canvas merge.
- No new Activity, search, or assistant backend.

### Completion record

- Completed: 2026-08-11; all work packages 1.1–1.9 and Stage 1 exit gates verified.
- Commit/release: `f49dc2e`, `b09bce3`, `9c414a1`, `ab2b39c`, `041b619` on `derp-desk`; release not pushed.
- Data changes: none; user files and offline data stayed in place. Added recent-location local state.
- Core tests cover routes, media Range, phone browse/play/seek/reload/resume/offline, Home/shell at desktop and narrow phone sizes, offline PDF/EPUB, and Workspace/Canvas entry points.
- Full validation passed: Rust 42/42; Bun 409/409; E2E 537/537 plus static and format checks.
- Manual checks covered desktop navigation and phone layouts at 320x568 and 390x844.
- Stage 2 owns Resource read plane, unified opener, and fragment-only generated passcode links.

---

## Stage 2 - Resource read plane and unified opener

### Outcome

Every openable thing has typed identity, kind, presentation, and provider-supported operations. Library, Workspace, Canvas, SSR, and Hermes read through one deep ResourceCatalog Module. Effective owner/Grant capabilities arrive in Stage 3.

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

Path-based URLs stay behind a small Adapter, not permanent ResourceCatalog Interface.

Frontend opener:

```ts
openResource(ref: ResourceRef, intent: OpenIntent, context: OpenContext): OpenPlan
```

`OpenContext` contains current owner/Grant scope identifier, surface/Space, effective capabilities when available, and presentation constraints. It never contains a passcode/token secret. Function is pure; caller executes returned plan.

### Work packages

- [x] **2.1 Define serialization contract.** Define LibraryId, SourceId, global ResourceId, ResourceRef, mutable ResourceLocator, opaque ResourceVersion, ResourceSummary, ResourceKind, provider-supported operations, and typed errors in Rust and TypeScript. Add shared JSON fixtures so shapes cannot drift. Never infer version client-side from path or mtime.
- [x] **2.2 Add durable Library/Source identity.** Persist IDs independent of display name, absolute path, root count, or root order. Preserve identity across ordinary configuration edits and show recovery guidance when a match is genuinely ambiguous.
- [x] **2.3 Add Resource identity catalog.** Filesystem Resources receive durable IDs and mutable locators. In-app moves retain ID. External moves reconcile best-effort; unclear replacements become missing/new resources instead of being guessed. Backfill lazily from observed resources and saved state.
- [x] **2.4 Build ResourceCatalog.** Hide root mapping, basic path validation, exclusions, built-in Collections, pagination, preview metadata, and intrinsic provider operations.
- [x] **2.5 Add real provider Adapters.** Local filesystem and minimal read-only Hermes provider satisfy internal provider Interface. Favorites, Most Played, and Shared become Collection Resources. Recent waits for ActivityHub. Path-shaped Hermes data stays inside its Adapter.
- [x] **2.6 Unify application queries.** Axum handlers and `server/html.rs` call same typed query Modules. Remove route-to-route calls and independently assembled SSR JSON.
- [x] **2.7 Add narrow ViewerRegistry and one opener.** Registry maps Resource kind/MIME to built-in renderer/opener descriptors containing dynamic-import factories. Route generation, access, offline policy, and pane geometry stay in their owning Modules. Route existing Library, Workspace, Canvas, and share opens through pure `openResource` planning plus caller executor.
- [x] **2.8 Complete passcode-fragment rollout.** Generated links use fragment secret. Existing query links remain readable during rollout.

### Likely code areas

- New `server/resources/`, `server/application_queries/`, `lib/resource.ts`, `src/lib/open-resource.ts`, `src/lib/viewer-registry.ts`
- `server/media.rs`, `server/virtual_directory.rs`, `server/config.rs`, `server/state_db.rs`, `server/html.rs`
- `lib/types.ts`, `lib/virtual-directory.ts`
- `src/FileBrowser.tsx`, `src/WorkspacePage.tsx`, `src/CanvasPage.tsx`, `src/workspace/WorkspaceViewerPane.tsx`

### Tests to add

- Resource serialization and Rust/TypeScript golden-contract tests.
- Direct upgrade from current production state.
- Stable Source/Resource identity across ordinary root edits, app-mediated file rename, and restart.
- External rename and defined missing-resource behaviour.
- Provider conformance suite for filesystem and Hermes.
- Path validation, exclusion, Unicode, multiple-root, missing-resource, and stale-version cases.
- ViewerRegistry and `openResource` table tests for every supported MIME/kind, context, and intent; test imports stay lazy.
- SSR and client-query response parity.
- Large upgrade fixture proves registry reconciliation remains incremental.

### Exit gates

- Same ResourceRef produces same open plan and provider-supported operations from Library, Workspace, Canvas, and shared view. Existing authorization still controls actual action until Stage 3.
- New code outside path Adapter does not use provider path strings to infer identity, kind, or appearance.
- Ordinary configured-root edits preserve identity or show clear recovery guidance.
- Current path URLs continue to open while new state stores ResourceRefs.

### Recovery

- Back up application database before upgrade.
- `catalog_reads` can temporarily restore prior listing behavior while diagnosing a cutover issue.
- New fields are additive for this release; long-lived old-binary writes are not supported.

### Non-goals

- Resource mutations remain on existing routes until Stage 3.
- Media byte/range routes remain direct and unchanged; ResourceCatalog returns identity, metadata, capabilities, and existing playback URLs.
- No public provider/plugin interface.
- No whole-library content index.

### Completion record

- Completed: 2026-08-11; all work packages 2.1-2.8 and Stage 2 exit gates verified.
- Commit/release: `5262599` through `97d0639` on `derp-desk`; release not pushed.
- Data changes: additive Resource, Source, locator, and share-source records in SQLite; saved Workspace and Canvas targets now include ResourceRefs while retaining current path fields.
- Transitional Adapters retained: current path URLs, direct media byte routes, and `catalog_reads` diagnostic switch.
- Targeted tests: shared Rust/TypeScript contracts, identity/source edits and restarts, filesystem/Hermes provider conformance, owner/Grant query parity, opener/viewer matrices, saved-state backfill, fragment links, and share reconnect behavior.
- Full validation: Rust 125/125; Bun 479/479; all six E2E batches passed, plus type, lint, format, build-asset, and diff checks.
- Manual desktop smoke: production login and Library root load.
- Manual phone smoke: 320x568 and 390x844 Library browse/player, protected fragment share, secret scrubbing, scoped text viewer, and no horizontal overflow.
- Known follow-ups explicitly deferred: Resource mutations and effective capability policy remain Stage 3 work.

---

## Stage 3 - AccessPolicy and recoverable ContentCommands

### Outcome

One implementation owns file mutations for owner and shared-link callers. It validates allowed actions, reports failures clearly, and recovers interrupted multi-step work.

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

- [ ] **3.1 Stabilize Grant persistence.** Assign internal GrantId mapped to current share token. Replace full-list delete/reinsert persistence with targeted typed Grant reads/updates.
- [ ] **3.2 Establish RequestContext.** Authentication Adapters turn owner cookie or Grant token/session into Principal. AccessPolicy resolves Resource and Grant facts and returns effective capabilities.
- [ ] **3.3 Define command algebra.** Create file/folder and upload use destination parent ResourceRef plus validated child name. Replace uses target and expected ResourceVersion. Copy/move use source, destination parent, target name, expected versions, and idempotency key. Existing delete semantics stay unchanged in this stage.
- [ ] **3.4 Extract mutation implementation.** Move validation, quota, editable-root checks, path resolution, filesystem work, metadata relocation, image cleanup, search invalidation, and event creation out of route files.
- [ ] **3.5 Add small operation journal.** Journal uploads, moves, and other commands that cross filesystem/database steps. Store request identity, state, and result; use temp renames and retry unfinished work on startup.
- [ ] **3.6 Convert owner routes.** Existing endpoints become thin transport Adapters over ContentCommands.
- [ ] **3.7 Convert Grant routes.** Keep `/api/share/...` separate, but route through same commands and AccessPolicy. Preserve quotas and existing restrictions.
- [ ] **3.8 Define typed receipt/event envelope.** Successful commands produce command ID, resulting versions, affected refs, scope, and event. Stage 8 consumes this shape.

### Likely code areas

- New `server/access/`, `server/content_commands/`, command journal tables in `server/state_db.rs`
- `server/routes/files.rs`, `server/routes/share_access.rs`, `server/path_metadata.rs`
- `server/routes/auth.rs`, `server/shares.rs`, `server/routes/sse.rs`

### Tests to add

- Focused owner/shared command permission cases.
- Same command conformance tests through owner and Grant transport Adapters.
- Quota, read-only, editable-root, path validation, conflict, overwrite, and version mismatch cases.
- Repeated idempotency key with same digest returns stored receipt; different digest is rejected.
- Interrupted upload/move restart finishes or exposes a clear retry action.
- Rename/move preserves Resource ID, favorites, reader progress, Canvas/workspace references, and share roots.

### Exit gates

- No route handler directly mutates filesystem content.
- Owner and Grant behaviour differ only through AccessPolicy/capabilities, not duplicated mutation implementations.
- Injected failure never reports success for lost work. Uncompensatable external changes remain visible as `needs_reconciliation`, never silent or permanently hidden.
- Existing upload/edit/share behavior remains working.

### Recovery

- Convert and verify commands one at a time; delete each replaced implementation after its focused tests pass.
- Finish or retry pending journal entries before reverting application code.

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
- [ ] **4.4 Move main Library.** Preserve mobile list/grid, media launch, drag/drop, KB affordances, URL state, and offline save.
- [ ] **4.5 Move Workspace browser pane.** Preserve tabs, split/floating/map open intents, cross-window drag/drop, search, and pane-local history.
- [ ] **4.6 Move shared browser.** Use same model and primitives with Grant Adapter and capability-specific menus.
- [ ] **4.7 Move Offline view.** Offline catalog becomes another presenter/Adapter. Existing saved media keeps working through its current cache keys.
- [ ] **4.8 Complete cutover.** Make ExplorerModel default after parity tests, then remove replaced orchestration.

### Likely code areas

- New `lib/explorer-model.ts`, `src/explorer/`, `src/lib/resource-adapters/`
- `src/FileBrowser.tsx`, `src/ShareFolderBrowser.tsx`, `src/workspace/WorkspaceBrowserPane.tsx`
- Existing shared file list/grid/breadcrumb/context-menu primitives
- `src/lib/offline-files.ts`, `src/OfflineStatus.tsx`

### Tests to add

- Pure ExplorerModel transition tests including stale request cancellation and optimistic correction.
- Adapter conformance suite executed against owner, Grant, and offline fixtures.
- One parity scenario matrix reused by Library, pane, and shared presenters.
- Keyboard, touch, virtualization, drag/drop, and back/forward regression coverage.
- Phone media flow from Stage 1 remains mandatory.
- Existing path-keyed offline entries resolve by ResourceRef without redownload; offline mutation returns typed read-only/unavailable outcome.

### Exit gates

- A behaviour fix in ExplorerModel applies to all four presenters.
- Shared presenter cannot issue owner request even when given crafted UI state.
- Replaced explorer implementations no longer own server mutations or navigation state machines.
- Default Library, pane, share, and offline presenters contain presentation only.

### Recovery

- Keep changes in presenter-sized commits. Revert a presenter commit if its shared parity scenario fails.

### Non-goals

- No Space layout merge yet.
- No unified full-text search yet.

---

## Stage 5 - Media continuity and one PlaybackSession

### Outcome

Audio/video ownership no longer belongs to a route or presentation. One scoped PlaybackSession preserves queue, item identity, position, and chrome across Library, Explorer pane, Workspace/Canvas, and later Space navigation without changing media byte delivery.

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

- [ ] **5.1 Characterize media semantics.** Lock current audio queue, video/native-control, audio-only switching, Range, share, resume, and offline behaviour with fixtures.
- [ ] **5.2 Define playback state machine.** Explicit states and commands cover load, play/pause, seek, queue, next/previous, error/retry, source refresh, offline fallback, and teardown. Specify event ordering and stale media/version behaviour.
- [ ] **5.3 Move ownership above routes.** Shell owns one owner PlaybackSession. Shared view owns its own session; moving between them stops or explicitly transfers playback.
- [ ] **5.4 Adapt every presenter.** Library player hook, workspace audio store, Canvas panes, shared audio/video, and offline player become thin presenters/Adapters. One visible chrome owns audio; video fullscreen/native controls remain appropriate to device.
- [ ] **5.5 Persist safe continuity.** Save queue refs and progress without credentials. Missing, moved, revoked, or version-changed Resources produce explicit recoverable state. Resource move keeps playback identity.
- [ ] **5.6 Preserve offline playback.** Existing installed media stays usable without redownload. Online/offline switch does not duplicate queue entries or reset position.
- [ ] **5.7 Complete cutover.** Move all presenters to PlaybackSession, verify phone/shared/offline flows, then remove competing player ownership.

### Likely code areas

- New `lib/playback-session.ts`, `src/media/playback/`
- Current Library media-player hook and `lib/workspace-audio-store.ts`
- `src/FileBrowser.tsx`, Workspace/Canvas media panes, share players
- `src/lib/offline-files.ts`, media URL builders
- Audio/video/mobile/share/offline end-to-end specs

### Tests to add

- Pure PlaybackSession transition and event-order tests.
- Owner versus Grant scope isolation, revoked Grant, refreshed URL, missing Resource, and version change.
- Library -> folder -> Space/Workspace -> Library with uninterrupted audio and one chrome.
- Workspace/Canvas navigation leaves queue and position intact before Stage 7 cutover.
- Video fullscreen, native controls, audio-only switch, background audio, reload resume, Range, and offline replay.
- Production route and media behavior preserve Stage 1 user outcomes.

### Exit gates

- Exactly one playback owner exists per authorized scope; default code no longer reads competing global player stores.
- Navigation and later presentation changes cannot remount away durable playback state.
- Phone golden journey, shared media, offline media, and byte-range suites pass unchanged.
- `/api/media/*`, share media routes, Range semantics, and offline bytes remain unchanged.

### Recovery

- Persist playback state only after the new session restores it correctly. A revert must stop the active session before the prior player mounts.

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

Focused pane, camera, scroll, transient selection, and playback controls are device-local SessionState. Reusable layout templates and taskbar/user preferences are separate from Spaces.

### Work packages

- [ ] **6.1 Specify Space commands and invariants.** Create/rename/delete/duplicate Space; add/remove/update Pane; apply arrangement; restore revision. Pane identity and content state do not change when presentation changes.
- [ ] **6.2 Add typed schema and history.** Store current head, revision snapshots with retention, arrangements, tombstones, and schema version in SQLite. Expected-revision compare/update and snapshot append occur in one transaction.
- [ ] **6.3 Build SpaceEngine.** Small typed-result Interface: list, load, apply command with expected revision. Hide validation, storage, history retention, tombstones, and conflict recovery.
- [ ] **6.4 Add optimistic client Adapter.** Local changes apply immediately, save through versioned commands, show saved/saving/offline/conflict/failed state, and create named recovered copy for irreconcilable conflict. No CRDT.
- [ ] **6.5 Import current Canvas state once.** Deterministic, idempotent conversion preserves Canvas IDs, panes, layouts, and tombstones. Space Store becomes canonical after successful import; keep an export of original data.
- [ ] **6.6 Import Workspace state explicitly.** On first open/save, offer deterministic conversion of current local `?ws=` session into Space. Do not enumerate or upload every browser-local session. Named layouts stay templates; taskbar settings stay preferences. Ask before unexpected/corrupt state and never silently discard it.
- [ ] **6.7 Put current screens on correct mode.** `/canvas` resolves imported durable Space through SpaceEngine. `/workspace?ws=` remains local scratch until user imports/saves; converted `/spaces/:id` uses SpaceEngine.
- [ ] **6.8 Add revision recovery UI.** User can inspect retained versions and restore/duplicate after conflict or accidental layout loss. Define tombstone restoration and expired-history behaviour.

### Likely code areas

- New `server/spaces/`, `lib/space.ts`, `lib/space-client.ts`
- `server/state_db.rs`, `server/canvas_persistence.rs`, `server/workspace_persistence.rs`
- `lib/use-workspace.ts`, `lib/infinite-canvas.ts`
- `src/CanvasPage.tsx`, `src/WorkspacePage.tsx`, workspace persistence hooks

### Tests to add

- Pure Space command/validation tests through SpaceEngine Interface.
- Current Canvas/workspace fixtures, corrupt-state quarantine, repeated import, and restart idempotency.
- Two-client expected-revision conflict and recovered-copy behaviour.
- Pane content survives switching arrangements and server restart.
- Cross-device load with device-local focus/camera not leaking.
- Existing Workspace and Canvas end-to-end suites remain green before visual convergence.

### Exit gates

- Every Canvas and explicitly saved/imported Workspace session has durable Space ID. Named layouts remain templates; unsaved `?ws=` sessions remain local.
- Reload or second browser restores Space content; device-local state remains local.
- Imported source data stays exportable.
- No whole-record last-writer-wins save can silently discard a concurrent accepted revision.
- Rename/move through ContentCommands preserves durable Space ResourceRefs.

### Recovery

- Back up Canvas/workspace state before import and keep explicit export/restore actions.
- Space Store becomes canonical only after import verification succeeds.

### Non-goals

- No real-time multiplayer or CRDT.
- No final combined Space chrome; Stage 7 owns presentation convergence.

---

## Stage 7 - One Space experience: Focus, Tiled, Map

### Outcome

User opens stable Space URL and switches presentation without losing work. Standalone Workspace and Canvas become transition routes, not separate products. `/` remains Library.

### Work packages

- [ ] **7.1 Add stable Space routes.** `/spaces`, `/spaces/:id`, and explicit `/spaces/:id/focus|tiled|map`. Bare Space route selects device-local presentation without importing Tiled/Map first. Copied explicit presentation stays explicit across devices. Old `/canvas` and already imported/saved Workspace IDs redirect to durable Space. Unsaved local `?ws=` stays local scratch and offers explicit import; never silently uploads or redirects it.
- [ ] **7.2 Build one Space shell.** Space picker, name, sync state, undo/redo, add Resource, existing Resource-share action, and presentation switcher live in common chrome. Space sharing waits for Stage 9.
- [ ] **7.3 Build shared PaneHost/runtime.** One runtime keyed by Pane ID owns browser/viewer/editor/reader/player/assistant state. ViewerRegistry selects dynamic implementation; presenters own geometry. Presenter remount is allowed only when externally held state and Pane identity survive.
- [ ] **7.4 Implement Focus presentation.** One active Pane with tab switcher. Default narrow-screen presentation and accessible fallback for every Space.
- [ ] **7.5 Adapt Tiled presentation.** Reuse current Workspace tiling, splits, snapping, taskbar, and keyboard behaviour against Space arrangements.
- [ ] **7.6 Adapt Map presentation.** Reuse current Canvas pan/zoom, semantic zoom, minimap, and placement against same Pane IDs.
- [ ] **7.7 Preserve state across presentation changes.** Reader position, editor draft, browser history, assistant draft, PlaybackSession, and Pane identity survive Focus/Tiled/Map switch.
- [ ] **7.8 Complete shell cutover.** Default Space route uses unified runtime. After parity tests pass, remove replaced Workspace/Canvas presenters while keeping useful route redirects.

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
- Canvas/imported-Workspace bookmarks resolve to Space; unsaved local Workspace bookmark opens local scratch or explicit import prompt.

### Recovery

- SpaceEngine data and exports remain intact if a presenter commit is reverted.

### Non-goals

- No shared Space Grants yet; Stage 9 owns them.
- No new search index or AI workflow.

---

## Stage 8 - Find, continue, and observe work

### Outcome

One Discovery surface finds Resources, content, Spaces, and Hermes session metadata. Home resumes meaningful Activity. Background work and progress survive navigation and reconnects.

### Work packages

- [ ] **8.1 Add durable typed EventFeed.** SQLite sequence/outbox stores Stage 3 envelopes, visibility scope, and retention watermark. Interface subscribes by scope and optional cursor. SSE supports `Last-Event-ID`; gaps emit `resync-required`.
- [ ] **8.2 Deepen Discovery.** Existing file index becomes implementation behind one typed query Interface. Index filename/path, supported text/Markdown, Collection membership, Space title, and Hermes session metadata. Transcript/body indexing is opt-in. Check in fixed-corpus ranking fixtures before cutover.
- [ ] **8.3 Add background extraction/rebuild.** Visible status, cancellation/retry, stale-index indication, and bounded read-through fallback during initial rebuild. Routes never perform synchronous recursive walks.
- [ ] **8.4 Add scoped ActivityHub.** Typed query/update Interface records opens, playback/reading progress, recent Resources/Spaces, command jobs, index work, previews, and offline jobs. Server SQLite owns durable server facts; command journal owns command state; IndexedDB Adapter owns client-only offline jobs. ActivityHub projects them without duplicating sources of truth. Raw Hermes events remain outside until Stage 10.
- [ ] **8.5 Connect continuity.** PlaybackSession and reader state publish progress through ActivityHub. Recent becomes query-backed Collection. Home uses same data across devices while local-only activity stays identified as local.
- [ ] **8.6 Ship universal palette.** Search current Space, Library, content, Spaces, open Panes, and Hermes session metadata. Commands use capabilities: open, split, pin, play, keep offline, and share existing Resource. Assistant action waits for Stage 10.
- [ ] **8.7 Upgrade Home and Activity center.** Continue reading/listening/watching, recent Spaces/documents, active/failed jobs, retry/dismiss actions, and index/sync health. Assistant needs-input state waits for ConversationHub.
- [ ] **8.8 Ship Trash and undo.** Add explicit trash commands on top of proven ContentCommands. Define trash location, retention, restore collision, permanent-delete confirmation, and export behavior. Activity center exposes pending/failing cleanup.

### Likely code areas

- New `server/events/`, `server/discovery/`, `server/activity/`
- `server/file_search/`, `server/routes/search.rs`, `server/routes/share_search.rs`, `server/routes/sse.rs`, `server/html.rs`
- `src/discovery/`, `src/activity/`, Canvas search palette, Workspace taskbar search
- PlaybackSession, reader state, ContentCommands, and offline job observer

### Tests to add

- Event ordering, reconnect replay, lag/gap resync, and scope filtering.
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
- Phone PlaybackSession progress appears on Home without changing media delivery behavior.
- Background failures are visible and retryable; no transient presenter-local-only job state.

### Recovery

- Ship EventFeed, Discovery, Activity, and Trash in separate commits. Revert one surface without keeping parallel implementations.

### Non-goals

- No semantic/vector search by default.
- No automation recipe engine.
- No raw Hermes protocol/event ingestion; Stage 10 owns ConversationHub.

---

## Stage 9 - Space Grants and read-only offline continuity

### Outcome

User can share curated Resource, Collection, or Space and keep owner Space available offline for reading/playback. Same Resource/Space presenters run through strictly scoped Grant and offline Adapters. Offline server mutations remain out of scope.

### Work packages

- [ ] **9.1 Generalize Grant model.** Target Resource, Collection, or Space. Capabilities cover view, stream, download, edit, upload, presentation access, keep-offline, expiry, and quota. Update current share records through GrantStore.
- [ ] **9.2 Add installation Grant secret.** Generate one durable secret with restricted file permissions and backup/restore guidance. Rotating it signs out protected-share sessions. Old-binary decryption support is out of scope.
- [ ] **9.3 Share Spaces.** Shared route loads Space through Grant context, renders Focus by default, optionally allows Tiled/Map, and exposes only allowed Resources and commands.
- [ ] **9.4 Add live versus snapshot-manifest choice.** Live share follows allowed Space revisions. Snapshot manifest pins Space revision, membership, and expected Resource versions—not historical bytes. Changed/missing Resources render explicit state; unchanged underlying bytes remain served from filesystem.
- [ ] **9.5 Build Offline Vault.** Durable catalog of saved Resources, versions, storage use, failures, and eviction controls. Existing saved media remains usable.
- [ ] **9.6 Add Keep Space Offline.** Save owner Space manifest, selected Resources, and required renderer/worker chunks; show storage use and partial availability. Shared offline save requires explicit owner permission and a clear downloaded-copy warning.
- [ ] **9.7 Keep offline mode read-only.** Offline Space may browse/read/play and retain device-local view/progress state, but edit/upload/delete/Space commands return explicit offline-unavailable result. Durable mutation outbox/conflict sync is a later separately approved roadmap.
- [ ] **9.8 Apply responsive shared UX.** Phone shared Space opens Focus/media path; desktop may use richer presentation. No owner shell or routes leak into shared bundle.

### Likely code areas

- `server/shares.rs`, `server/routes/share_access.rs`, `server/routes/share_media.rs`, `server/state_db.rs`
- `src/ShareRoute.tsx`, `src/ShareWorkspacePage.tsx`, shared resource Adapter from Stage 4
- `src/lib/offline-files.ts`, `src/OfflineStatus.tsx`, `public/service-worker.js`
- SpaceEngine and AccessPolicy Modules

### Tests to add

- Direct upgrade fixture for current share records.
- Focused Resource/Collection/Space permission cases through shared UI and transport.
- Live Collection, captured Collection, live Space, and snapshot-manifest semantics; changed/missing versions; revoked/expired Grant behaviour.
- Shared view does not expose owner-only routes or hidden Space panes.
- Offline Space install/update/partial failure/quota/eviction/restart and renderer-dependency tests.
- Phone share-to-play and installed-PWA offline replay.
- Revocation blocks future access but test/document that already downloaded bytes cannot be clawed back while device is disconnected.

### Exit gates

- One Grant model powers all sharing without weakening separate transport surface.
- Shared Space shows only authorized panes and actions even under direct crafted requests.
- “Keep Space Offline” remains usable after browser/server restart and reports incomplete content honestly.
- Current share URLs continue working after upgrade.

### Recovery

- Back up Grant records before changing secret storage. Existing offline packs remain inspectable/exportable if UI work is reverted.

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

- [ ] **10.1 Characterize useful Hermes behaviour.** Cover session/project listing, create/resume, retry, branch/rewind/steer, attachments, voice, decisions, drafts, disconnect, and restart behavior. Tests protect outcomes, not transport internals.
- [ ] **10.2 Extract ConversationHub.** Hide raw HTTP/RPC paths, method strings, query tuples, retries, ID mapping, takeover, connection lifecycle, and typed errors behind query/command/subscribe Interface.
- [ ] **10.3 Move routes and client store.** Existing Hermes routes become transport Adapters. Client session store consumes typed queries/commands/events. Conversation events enter EventFeed through scoped Adapter; Discovery/Activity no longer import raw Hermes payloads.
- [ ] **10.4 Complete Hermes Resource Adapter.** Stage 2 read provider gains ConversationHub-backed operations. Remove fake-path dependencies after current saved links are converted.
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
- Selected-content fixture proves context stays data and writes still require confirmation.
- Citation/provenance survives rename, Space revision, reload, changed version, and missing Resource.
- Draft/retry/takeover/session resume across Focus/Tiled/Map and disconnect.
- Raw Hermes chat parity when `contextual_assistant` is disabled.

### Exit gates

- Existing chat features pass through ConversationHub without regression.
- User can ask with explicit context, inspect sources, save confirmed answer as note, and pin result/session into Space.
- Raw Hermes protocol details do not leak outside production Adapter.
- Every assistant read/write is scoped by AccessPolicy and version-aware.

### Recovery

- Context workflow can be hidden while typed ConversationHub chat remains usable. Notes, Spaces, and sessions remain ordinary Resources.

### Non-goals

- No autonomous background agents, workflow builder, implicit writes, or whole-library RAG.
- No AI inside public Grants unless explicitly designed after owner workflow proves safe.

---

## Stage 11 - First-class Knowledge Spaces

### Outcome

Current path-configured knowledge bases become durable Knowledge Space records without losing Markdown, recent/search, image paste/embed, sharing, Reader, assistant, or offline behaviour.

### Work packages

- [ ] **11.1 Define Knowledge Space model.** Stable ID, title, one or more Collection/root refs, optional home document, saved Discovery queries, attached conversation refs, default Space ref, and offline policy. Do not create generic plugin metadata.
- [ ] **11.2 Add typed KnowledgeStore and one-time import.** Import current KB path settings through Resource locators. Missing roots show a relink action instead of disappearing.
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

- Import from current single/multiple KB paths plus renamed, missing, and corrupt-root cases.
- Markdown search/recent, edit, image paste/embed, Reader, share, and offline parity.
- Knowledge Space Resource move/rename and stable deep link.
- Explicit assistant context limits, provenance, and Grant filtering.

### Exit gates

- Every configured KB is imported or shown with a relink action.
- Full collect -> search/read/edit -> ask -> arrange -> share/offline workflow uses existing deep Modules.
- No request path performs unbounded recursive KB scan.

### Recovery

- Keep an export of prior KB settings until imported Knowledge records are verified.

### Non-goals

- No backlinks/graph, task system, Notion/Obsidian clone, or semantic embeddings in initial release.

---

## Stage 12 - Final cleanup and operational consolidation

### Outcome

Remove transitional implementations, finish typed state ownership and composition, and document one coherent product. No new product capability lands here.

### Work packages

- [ ] **12.1 Remove transitional inventory.** List remaining switches, duplicate presenters, fake paths, old stores, and adapters. Delete each after its current-route test passes.
- [ ] **12.2 Finish typed state Modules.** Library/Source registry, GrantStore, SpaceStore, ActivityStore, KnowledgeStore, and Conversation state belong to their owning Modules. Replace remaining generic settings/JSON-path access. No generic `Repository<T>`.
- [ ] **12.3 Consolidate composition root.** Replace public `AppState` fields with private Module handles for resources, access, commands, spaces, discovery, activity, conversations, jobs, and events. `server::run` constructs/lifecycles them. Use internal test harness; do not publish AppRuntime Interface without second real Adapter.
- [ ] **12.4 Thin transport and SSR Adapters.** Axum handlers map typed requests/results/errors only. SSR uses same application query Modules. Remove route-to-route imports, duplicate rate limiter, raw state reads, manual events, and domain errors containing HTTP concerns.
- [ ] **12.5 Remove replaced implementations.** Delete replaced explorers, Workspace/Canvas shells, fake Hermes paths, player stores, generic `store.rs`, and unused switches. Keep only cheap user-visible URL redirects.
- [ ] **12.6 Run final product check.** Test current production data, owner/shared behavior, phone media, offline use, Spaces, Discovery, and assistant workflows.
- [ ] **12.7 Decide operational rename.** UI already says Derp Desk. Rename Cargo package/binary/config/cache identifiers only when deployment scripts are ready and both users agree. Keeping `derp-media-server` internals is acceptable.
- [ ] **12.8 Rewrite product documentation.** README explains Library, Spaces, phone media path, sharing, offline limits, assistant use, and backup/restore.

### Likely code areas

- Typed state Modules, `server/app.rs`, `server/server.rs`, `server/html.rs`, `server/routes/`
- Transitional frontend implementations and persistence
- `README.md`, `package.json`, `Cargo.toml`, service/config/deployment documentation

### Tests to add

- Direct upgrade from current production data.
- Clean startup/shutdown, background worker failure, corrupt state quarantine, and backup/restore.
- Static architecture checks: no non-route Module imports `server/routes`; no default UI imports frozen presenters; SSR/HTTP golden query parity.
- Final phone media, owner/shared, PWA offline, Space, Discovery, and assistant suites.

### Exit gates

- Generic JSON-path store and public lock/map/database state no longer form application Interfaces.
- Default code has one explorer, one playback owner, one Space runtime, one event model, and one query/command path per behaviour.
- Replaced paths are deleted after focused current-route tests pass.
- README describes one coherent product while phone media remains first-class.

### Recovery

- Take verified backup/export before schema cleanup.
- Keep operational rename separate from product cleanup so either commit can be reverted independently.

### Non-goals

- No new provider, collaboration model, workflow engine, or product surface.

## Completion record template

Copy under completed stage and update overview status.

```md
### Completion record

- Completed:
- Commit/release:
- Data changes:
- Transitional Adapters retained:
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
