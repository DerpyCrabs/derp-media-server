# E2E coverage gap matrix (React ↔ Solid)

Use this checklist to track **user-visible** behavior that should eventually have **both** a React e2e (`tests/e2e/`) and a Solid e2e (`tests/e2e-solid/`). Add rows as you discover gaps; point each row at the spec file that should own the test.

**Automation:** `bun run e2e:diff-specs` lists React-only and Solid-only spec basenames (exit code 1 if any React spec has no Solid twin—excluding intentional Solid-only files like `smoke`).

## File browser (admin home)

| Affordance                                     | React (`components/file-list.tsx`) | Solid (`solid/src/FileBrowser.tsx`) | Covered in e2e                                                |
| ---------------------------------------------- | ---------------------------------- | ----------------------------------- | ------------------------------------------------------------- |
| List/grid toggle                               | Yes                                | Yes                                 | `navigation.spec`                                             |
| Breadcrumbs, `..`, virtual folders             | Yes                                | Yes                                 | `navigation.spec`                                             |
| Favorites / Most Played                        | Yes                                | Yes                                 | `navigation.spec`                                             |
| Create folder/file, rename, delete, move, copy | Yes                                | Yes                                 | `editable-folders.spec`                                       |
| Context share / KB / icon                      | Yes                                | Yes                                 | `shares-manage`, `knowledge-base`                             |
| Upload menu (files)                            | Yes                                | Yes                                 | `upload.spec`                                                 |
| Upload menu (folder)                           | Yes                                | Yes                                 | `file-browser-misc.spec`                                      |
| Upload drop zone on listing                    | Yes                                | Yes                                 | `file-browser-misc.spec`                                      |
| Clipboard paste                                | Yes                                | Not in Solid UI yet                 | `file-browser-misc.spec` (React + `clipboard paste` describe) |
| Theme switcher (light/dark/system)             | Yes                                | Not in Solid UI yet                 | `file-browser-misc.spec` (React only)                         |

## Workspace / share

Follow existing `workspace-*.spec.ts` and `share-*.spec.ts`. **Share dialog:** Escape dismisses dialog — `file-browser-misc.spec` (admin file list). **SSE:** React and Solid `sse-live-updates.spec` use the same pattern (unique `SharedContent` filenames per run, `gotoWithSSE` stream/console race, share create-file via placeholder locators, delete via `alertdialog`). Re-scan after UI changes; add rows here when a new control ships without a test.

## Maintenance

- After adding a React spec, copy or adapt to `tests/e2e-solid/` and add the basename to `tests/run-batches-solid.ts` (≤6 batches).
- Update this table when a row becomes fully covered or when new affordances appear.
