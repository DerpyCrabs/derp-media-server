# Hermes Agent Sessions Integration

## Status

Confirmed product and architecture specification. Stages 1, 2, and 3 implemented and verified.

This feature connects derp-media-server to one configured Hermes Agent gateway. It exposes Hermes sessions as a virtual directory inside workspace and canvas file-browser windows, and opens sessions in native Solid.js chat windows.

Implementation is split into three independently testable stages. Later stages deepen behavior without changing virtual paths or persisted window identity established in Stage 1.

## Goals

- Browse unarchived and archived Hermes sessions through file-browser metaphors.
- Group sessions using real, named Hermes projects.
- Create detached sessions and project-bound sessions through existing New File and New Folder controls.
- Open a Hermes session as a first-class workspace or canvas window.
- Match gateway-backed Hermes Desktop chat behavior while retaining derp window chrome and layout behavior.
- Support local and remote gateways without exposing gateway credentials to browsers.
- Keep Hermes-specific behavior behind deep modules instead of scattering `isHermes` branches through file-browser, workspace, and canvas code.

## Non-goals

- Launching or managing a Hermes gateway process.
- Embedding Hermes Desktop, using an iframe, or adding React islands.
- Reproducing Hermes Desktop shell, project sidebar, native terminal, filesystem/review rails, updater, or OS integrations.
- Showing Hermes sessions in classic media browser or any share flow.
- Showing auto-derived Git repository projects.
- Adding session search to file browser or global library search.
- Adding Hermes Pin/Unpin UI or a Pinned virtual folder.
- Inventing derp-owned session groups or cwd folders.
- Hot-reloading Hermes configuration.

## Configuration

Hermes integration is disabled when `hermes` is absent.

```jsonc
{
  "hermes": {
    "gatewayUrl": "http://127.0.0.1:PORT",
    "tokenEnv": "HERMES_GATEWAY_TOKEN",
    "profile": "default",
    "filesystemMode": "upload",
  },
}
```

Fields:

- `gatewayUrl`: Hermes HTTP base URL. Support HTTP and HTTPS; derive matching WS or WSS endpoint.
- `token` or `tokenEnv`: optional gateway credential. Reject configuration containing both.
- `profile`: optional single Hermes profile. Omission selects gateway default profile.
- `filesystemMode`: `upload` by default or `shared` when Hermes and derp share exact filesystem paths.

Configuration loads at server startup. Changes require restart. Invalid syntax fails configuration loading. An unreachable or incompatible gateway does not prevent media server startup.

Gateway token must never enter dehydrated HTML, browser responses, logs, errors, diagnostics, or client-side state.

## Access and security

- Rust backend owns gateway credentials and all gateway connections.
- Browsers communicate only with authenticated derp routes and WebSockets.
- Hermes integration is admin-only. When derp authentication is disabled, it follows existing admin exposure semantics.
- Hide `Hermes Sessions` from classic browser, share browser, shared workspace, and all share routes.
- Strip Hermes windows, taskbar pins, durable IDs, titles, and placeholder positions from serialized share layouts on server.
- Sanitize rendered Markdown and HTML. Tool output must never execute returned markup.
- Uploaded files have fixed 16 MiB raw-byte limit per file.
- In `shared` mode, canonicalize referenced derp paths and allow only paths within configured media roots.
- Browser-selected files always upload because browsers do not provide trustworthy reusable paths.

## Virtual directory model

`Hermes Sessions` exists only in workspace and canvas browser windows.

```text
Hermes Sessions/
  <unprojected session files>
  Project A/
    <project session files>
  Project B/
    <project session files>
  Archived/
    <archived session files>
```

Rules:

- Root shows unarchived sessions that do not belong to an active named Hermes project.
- Active named projects appear directly at root as folders. No `Projects/` wrapper.
- Project folders contain sessions directly, even when project has multiple folders or worktrees.
- `Archived/` is flat and read-only.
- Auto-derived Git repository projects are excluded.
- Archived projects are hidden. Their unarchived sessions appear at root as unprojected.
- Restoring an archived project externally makes its folder reappear and matching sessions move into it.
- Gateway project tree is authoritative for membership. derp does not derive or persist parallel grouping.

Ordering:

- Project folders sort alphabetically by display name.
- Sessions follow folders and sort by `last_active` descending.
- Project sessions sort by `last_active` descending.
- Archived sessions sort newest first.
- Working state does not reorder a row mid-turn; reorder after terminal event or refresh.
- Ignore Hermes Desktop machine-local manual sidebar ordering.

Identity and naming:

- Session display filename is title without fake extension.
- Duplicate session titles are allowed.
- Internal virtual paths use durable session identity, never title.
- Rename updates title without changing virtual identity.
- Compression continuations retain one virtual identity using lineage-root durable ID.
- Project names must be unique case-insensitively.
- Reserve `Archived` as project name case-insensitively.
- Internal project paths use project ID.

## Generic virtual-directory module

Create one deep virtual-directory module whose interface is shared by existing library virtual folders and Hermes. File-browser callers must not know Hermes rules.

Conceptual interface:

- List a virtual path with pagination.
- Create file using provider semantics.
- Create folder using provider-supplied creation metadata.
- Rename an entry.
- Remove an entry using provider semantics.
- Open an entry through an opaque open target.
- Return entry capabilities, metadata, pagination state, and display identity.

Adapters:

- Existing Favorites, Most Played, and Shares adapter.
- Hermes Sessions adapter.

File-browser UI renders declared capabilities and dispatches generic operations. It must not branch on Hermes path names. Hermes adapter owns gateway paths, project/session identity, lifecycle verbs, ordering, pagination, and open-target construction.

The module interface and its observable behavior are primary test surface. Gateway transport is injected behind internal seam so tests can use an in-memory fake.

## File operation semantics

### Root

- New File opens untitled detached Hermes chat draft immediately.
- New Folder opens native Hermes project form.
- Upload, Copy, Cut, Paste, and duplicate operations are unavailable.

### Project folder

- New File opens chat draft bound to project primary directory.
- New Folder is unavailable because Hermes projects do not nest.
- Project rename maps to Hermes project rename.
- Delete Project removes Hermes project metadata only. It never deletes gateway directories or sessions. Former members return to root as unprojected.

Project creation form contains:

- Unique project name.
- One required existing gateway directory as primary directory.
- Optional additional existing gateway directories.
- Optional icon and color can be edited after creation.

The directory picker browses gateway filesystem through authenticated server proxy. Project creation never creates filesystem directories.

### Session file

- Open creates or focuses chat window.
- Rename maps to Hermes session title.
- Delete command is replaced by Archive for unarchived sessions.
- Archive is available only while session is idle with no pending approval or queued prompt.
- Download exports Hermes-native transcript JSON.
- Copy, Cut, Paste, Upload, and duplicate operations are unavailable.
- Move between project folders by drag is unavailable because membership changes cwd.
- Explicit Move to Project action shows old and new paths, requires confirmation, and is disabled while busy.
- No Move to Root action.

### Archived session

- Opens read-only.
- Explicit Restore returns it to matching active project or root.
- Delete Permanently requires confirmation.
- No create operations exist in `Archived/`.

## Session creation and persistence

- Create sessions with `source: "derp-media-server"`, not `desktop`.
- New File opens an untitled draft without asking for filename.
- Hermes does not persist empty created sessions. No virtual file appears until first prompt persists session.
- Closing untouched draft discards it.
- Closing draft with unsent text asks for confirmation.
- Unsubmitted drafts do not restore after page reload.
- After first prompt persists session, virtual file appears and window persistence activates.
- Detached root session sends no explicit project cwd.
- Project session uses project primary gateway directory as explicit cwd.

## Window behavior

- Add native Solid.js Hermes chat window type usable by workspace and infinite canvas.
- derp owns window chrome, tabs, taskbar, placement, resizing, canvas transforms, and theme.
- Chat interior follows Hermes Desktop structure and density without nested Hermes titlebar/sidebar.
- Persist durable session ID only; never persist runtime ID.
- Within one workspace/canvas surface, opening same session focuses existing window.
- Across separate workspace and canvas browser surfaces, allow one instance per surface.
- All instances share gateway session state.
- Workspace browser respects existing new-tab versus new-window preference and alternate context actions.
- Split view works where existing window model supports it.
- Canvas click opens near viewport center; drag controls placement.
- Dragging session onto workspace/canvas creates window at drop position or adds tab when dropped on tab group.
- Duplicate drag focuses or moves existing instance.
- Project and Archived entries remain browser folders.

Taskbar and layouts:

- Allow derp-local taskbar pinning by provider entry and durable session ID.
- Hermes gateway pin metadata is preserved but not displayed or modified.
- Admin named layouts persist Hermes windows and pins.
- Applying layout reopens sessions by durable ID.
- Share serialization strips all Hermes state server-side.

External lifecycle changes:

- External archive changes open windows to read-only with Restore.
- Permanent external deletion leaves tombstone window with title, unavailable message, and Close.
- Never recreate missing sessions.
- Next layout save drops deleted tombstones.
- Deleted taskbar pins become disabled until removed.

## Gateway hub

Rust backend maintains one shared Hermes gateway connection and multiplexes browser clients.

Responsibilities:

- Keep token server-only.
- Route RPC request IDs.
- Track durable-to-runtime session mapping.
- Maintain one Hermes runtime session per durable session.
- Broadcast events to every subscribed chat instance.
- Resume by durable ID after gateway reconnect or runtime reap.
- Merge gateway truth into cached list/state without dropping live rows.
- Bound retries with backoff and expose manual Retry.
- Probe capabilities through behavior/method availability, not version string alone.

Core required capabilities:

- Session list, create, resume, and history.
- Prompt submit and event streaming.
- Session interrupt.
- Projects.
- Archive, restore, and permanent delete.

If core capability is missing, mark integration incompatible. Optional features disable individually when unsupported.

Closing or minimizing a chat does not interrupt its turn. Browser tab close also leaves turn running. Server shutdown disconnects without requesting interruption; later resume reconciles history and inflight state. Only explicit Stop sends interruption.

## Connection states

- Configured but unavailable integration remains visible in workspace/canvas browsers.
- Directory shows connection error and Retry instead of empty listing.
- Open chat keeps already-rendered transcript and becomes disconnected/read-only.
- Composer disables until reconnect.
- Do not persist Hermes transcript copies in derp storage.
- Authentication rejection is distinct from transient connectivity failure.
- Incompatible gateway reports missing core capability.

## Chat parity boundary

Implement gateway-backed Hermes chat surface:

- Full transcript and paged history.
- Streaming assistant output.
- Reasoning, tool activity, and tool results.
- Composer, attachments, slash commands, model/provider/reasoning/Fast controls.
- Stop, steer, and queued prompts.
- Clarifications and approvals.
- Retry, edit/rewind, branch, rename, archive, restore, and export.
- Live state across open windows.
- Push-to-talk gateway transcription.
- Optional browser reply playback.

Exclude:

- Hermes shell and sidebar.
- Native terminal.
- Filesystem/review rails.
- Pop-out OS windows and updater.
- Always-listening voice conversation mode.

Slash commands:

- Pass gateway-native commands unchanged.
- Port client commands affecting current chat: title, branch, export, reasoning/model/Fast, voice, and stop.
- Omit commands requiring absent Hermes shell surfaces/plugins.
- Completion list combines gateway capabilities with supported client commands.
- Unsupported pasted command fails explicitly instead of becoming ordinary prompt.

Tool rendering:

- Rich inline renderers for shell, files, search, diffs, todos, generated images, delegation, approvals, and clarifications.
- Unknown tools use safe generic collapsible card showing status, arguments, and result.
- Large outputs render bounded preview with expand/download.
- Renderer failure isolates to one card.

Attachments:

- Browser upload, paste, and drop use `file.attach` or `image.attach_bytes` through Rust proxy.
- Dragging derp files into composer uploads bytes in `upload` mode.
- In `shared` mode, derp files and folders may become canonical absolute Hermes path references when inside configured media roots.
- Browser-selected files still upload in `shared` mode.
- Folder references require `shared` mode.
- Gateway `@file` and `@folder` references use gateway workspace completion.
- Fixed upload limit is 16 MiB per file.

Voice:

- Push-to-talk recording uses browser microphone and gateway transcription.
- Reply playback uses browser audio when TTS capability exists.
- Hide unavailable controls when gateway or browser lacks capability/permission.

## Synchronization and ownership

- Only one active turn per Hermes session.
- Busy secondary composers expose gateway steer/queue behavior.
- Session-scoped drafts synchronize across windows with single-editor ownership.
- Focused composer owns editing; other windows show read-only draft plus Take Over Editing.
- Submission and clearing update all windows.
- Draft is not sent to Hermes before submit.
- Clarification/approval appears in every mirrored window.
- First response accepted by gateway wins; stale responses reject and refresh.
- Clarification/approval state is not persisted by derp.

Sessions active in another Hermes client:

- Open in read-only observer state.
- Show active source and Take Over Session.
- Resume/handoff occurs only after explicit takeover.
- Never reclaim CLI, Desktop, ACP, or messaging session merely by opening its file.

Background attention:

- Session entry and open window/taskbar show working, needs-input, failed, and unread-complete states.
- Background events never steal focus.
- Clicking attention indicator focuses or opens session.
- No OS/browser notifications in initial scope.
- Reading latest result clears derp-local unread state.

## Session inclusion

- Include all user-facing session sources returned by gateway: Desktop, CLI/TUI, derp, ACP, and messaging handoffs.
- Exclude gateway-designated internal tool and kanban worker sessions.
- Show source as secondary metadata.
- Resuming through derp may change live client ownership but must retain durable origin metadata.

## Pagination and refresh

- Fetch 200 sessions per page.
- Load next page automatically near list end.
- Root, each project, and archive page independently.
- No arbitrary latest-200 cutoff.
- Preserve current rows while refreshing.
- Merge by durable identity and retain reference identity on no-op updates.
- No Hermes session search UI and no integration with library search.

## Stage 1: Virtual directory and gateway foundation

Deliver browsable, lifecycle-correct Hermes data without interactive chat.

### Work

- Add Hermes config parsing, validation, token environment lookup, profile selection, and filesystem mode.
- Add authenticated Rust gateway hub with shared connection, reconnect states, capability probing, request routing, and test transport adapter.
- Create generic virtual-directory module and migrate Favorites, Most Played, and Shares.
- Implement Hermes adapter for root, active named project folders, and flat Archived folder.
- Implement pagination, deterministic sorting, stable opaque identity, metadata, unavailable/incompatible states, and live refresh.
- Map New Folder, rename project, delete project, archive, restore, permanent delete, rename session, and transcript export.
- Implement gateway directory picker and project creation form with primary/additional folders.
- Hide Hermes integration outside workspace/canvas admin browsers.
- Add share serialization sanitization before any Hermes window work lands.
- Add read-only session detail placeholder/open target sufficient to prove stable routing and archived history access.

### Acceptance

- Missing config produces no Hermes UI.
- Unreachable gateway does not prevent server startup.
- Token never reaches browser or logs.
- Root contains only unprojected sessions plus active named projects and Archived.
- Auto and archived projects follow specified behavior.
- Generic File Browser has no Hermes path-name checks.
- New Folder creates native project from selected gateway directory.
- Delete on unarchived session is labeled and executed as Archive.
- Archived session is read-only and supports Restore/Delete Permanently.
- Paging loads beyond 200 rows.
- Classic and share browsers never expose Hermes data.

### Verification

- Rust unit tests for config, auth redaction, gateway state machine, capability negotiation, pagination merge, and share sanitization.
- TypeScript unit tests at virtual-directory module interface using built-in and Hermes adapters.
- E2E tests for root/project/archive hierarchy, CRUD semantics, pagination, unavailable gateway, and visibility restrictions.
- Run `bun run tsgo` and `bun run lint-errors`.

## Stage 2: Interactive workspace and canvas chat

Deliver reliable chat windows, live turns, persistence, and multi-window synchronization.

### Work

- Add Hermes chat window definition and persistence using durable session/lineage identity.
- Integrate workspace open preference, tabs, split view, singleton focus, drag/drop, taskbar pins, and named layouts.
- Integrate canvas placement, drag/drop, singleton focus, and persisted canvas windows.
- Build Solid transcript, paged history, composer, streaming, reasoning/activity status, Stop, reconnect, and observer/takeover states.
- Implement lazy new-session drafts, first-prompt persistence, close confirmation, and no reload restoration before persistence.
- Implement shared session store over gateway hub, runtime resume/reap reconciliation, and background continuation.
- Implement synchronized single-editor drafts and first-response-wins approval/clarification behavior.
- Add archive transition, external deletion tombstones, disabled pins, and layout cleanup.
- Add in-app working/needs-input/failed/unread badges.

### Acceptance

- Same surface never shows duplicate session window.
- Workspace and canvas instances mirror transcript and live state.
- Runtime IDs never persist.
- Closing window/tab does not stop turn.
- Explicit Stop interrupts exactly one session turn.
- Opening externally active session does not reclaim it without confirmation.
- Archived chats cannot send.
- Share layouts contain no Hermes state.
- New detached and project sessions use correct cwd semantics.
- Draft ownership prevents concurrent silent overwrites.

### Verification

- Unit tests for identity/lineage mapping, window singleton resolution, draft ownership, event merging, stale responses, and lifecycle transitions.
- Gateway-hub integration tests with fake Hermes transport for reconnect, resumed runtime, background completion, and concurrent subscribers.
- Independent e2e files for workspace open targets, canvas placement, tabs/splits, persistence, takeover, archive/read-only, and share stripping.
- Run `bun run tsgo`, `bun run lint-errors`, and relevant Rust tests.

## Stage 3: Hermes chat parity and polish

Complete accepted gateway-backed chat parity.

### Work

- Add file/image byte uploads, derp drag/drop, shared-path references, gateway path completions, upload progress/errors, and fixed 16 MiB enforcement.
- Add rich known tool renderers and safe generic fallback.
- Add queued prompts, steer, retry, edit/rewind, branch, rename, export, model/provider/reasoning/Fast controls.
- Preserve lineage identity across compression and place branches beside source.
- Add filtered slash-command completion and explicit unsupported-command errors.
- Add push-to-talk transcription and optional reply playback with capability/permission gating.
- Tune transcript virtualization, large-output expansion/download, responsive layout, accessibility, and error isolation.
- Finish capability-specific degradation and diagnostics.

### Acceptance

- All accepted chat-parity behaviors work against supported gateway.
- Optional missing capabilities disable only affected controls.
- Unknown tool events remain readable and cannot crash chat.
- Upload and shared-path modes follow exact security rules.
- Branch appears in same project and opens beside source.
- Voice controls accurately reflect gateway/browser availability.
- Long transcripts and high-frequency streams remain responsive.

### Verification

- Unit tests for attachment routing, path canonicalization, upload cap, slash-command filtering, tool fallbacks, branches, edit/rewind, queue/steer, and voice capability gates.
- Rust tests for upload proxy limits and shared-root containment.
- E2E tests for attachments, rich/generic tools, advanced session actions, branching, approvals, voice permission states, reconnect degradation, and long transcripts.
- Run `bun run tsgo`, `bun run lint-errors`, then `bun run test:batch`.
- Keep total e2e batches at six or fewer and all new spec files parallel-independent.

## Final completion criteria

- All three stages complete.
- No Hermes credential or data leaks into share paths.
- No Hermes-specific branching exists in generic file-browser callers.
- Gateway remains sole authority for sessions, projects, transcripts, and live turns.
- derp persists only its own presentation state, durable references, taskbar pins, layouts, drafts, and unread markers.
- Workspace and canvas deliver same chat behavior through one shared Solid implementation.
- Required TypeScript, lint, Rust, and e2e checks pass.
