use super::*;
use crate::{
    config::{AuthConfig, Config, FileSearchConfig, ImageOptimizationConfig},
    shares,
};
use axum::{http::StatusCode, response::IntoResponse};
use serde_json::{Value, json};
use std::{fs, path::PathBuf};

struct Fixture {
    base: PathBuf,
    config: Config,
    engine: SpaceEngine,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}

fn config_for(base: &std::path::Path) -> Config {
    let data_path = base.join("data");
    fs::create_dir_all(&data_path).unwrap();
    Config {
        port: 0,
        roots: Vec::new(),
        library_key: "library".into(),
        share_link_domain: None,
        auth: AuthConfig::default(),
        file_search: FileSearchConfig {
            enabled: false,
            index_path: data_path.join("search.sqlite"),
            watch_mode: "off".into(),
            max_recursive_watchers: 0,
            max_fs_concurrency: 1,
            reconcile_directories_per_second: 1,
        },
        image_optimization: ImageOptimizationConfig::default(),
        data_path,
        tls: None,
        hermes: None,
    }
}

fn fixture(name: &str) -> Fixture {
    let base = std::env::temp_dir().join(format!("derp-spaces-{name}-{}", uuid::Uuid::new_v4()));
    let config = config_for(&base);
    state_db::initialize(&config).unwrap();
    let engine = initialize(&config).unwrap();
    Fixture {
        base,
        config,
        engine,
    }
}

fn apply(engine: &SpaceEngine, body: Value) -> Result<Space, SpaceError> {
    engine.apply(serde_json::from_value(body).unwrap())
}

fn pane(path: &str) -> Value {
    json!({
        "kind":"viewer",
        "state":{
            "source":{"kind":"local"},
            "title":"Durable pane",
            "resourceTarget":{
                "ref":{"libraryId":"library","resourceId":"resource-1"},
                "legacyLocator":path,
            },
        },
    })
}

fn create_body(space_id: &str, pane_id: &str) -> Value {
    json!({
        "spaceId":space_id,
        "expectedRevision":0,
        "command":{
            "type":"create",
            "name":"Original",
            "origin":"workspace",
            "panes":{pane_id:pane("Documents/item.md")},
            "arrangements":{
                "tiled":{
                    "placements":{pane_id:{"layout":{"mode":"free"}}},
                    "tabGroups":{"group-not-a-pane":[pane_id]},
                    "splits":{"group-not-a-pane":{"leftPaneId":pane_id,"leftPaneFraction":0.4}},
                },
            },
        },
    })
}

fn canvas_record(id: &str, pane_id: &str, updated_at: u64) -> Value {
    json!({
        "id":id,
        "name":"Imported Canvas",
        "updatedAt":updated_at,
        "writerId":"browser-one",
        "deleted":false,
        "state":{
            "version":1,
            "windows":[{
                "id":pane_id,
                "definition":{
                    "id":pane_id,
                    "type":"viewer",
                    "source":{"kind":"local"},
                    "title":"Movie",
                    "resourceTarget":{
                        "ref":{"libraryId":"library","resourceId":"resource-movie"},
                        "legacyLocator":"Movies/clip.mp4",
                    },
                    "layout":{"deviceOnly":true},
                    "tabGroupId":"device-only",
                },
                "bounds":{"x":-32.5,"y":64.25,"width":640.0,"height":480.0},
                "zIndex":9,
            }],
            "camera":{"x":120,"y":80,"zoom":0.5},
            "maximizedWindowId":pane_id,
            "focusedWindowId":pane_id,
            "windowSizeByType":{"viewer":{"width":704,"height":512}},
            "nextItemId":99,
            "nextZIndex":77,
        },
    })
}

#[test]
fn command_interface_preserves_identity_history_and_conflict_snapshot() {
    let fixture = fixture("commands");
    let space_id = "space/with\\separators";
    let pane_id = "pane/with\\separators";
    let created = apply(&fixture.engine, create_body(space_id, pane_id)).unwrap();
    assert_eq!(created.revision, 1);
    assert_eq!(created.id, space_id);
    assert_eq!(created.panes[pane_id].state["title"], "Durable pane");

    let renamed = apply(
        &fixture.engine,
        json!({
            "spaceId":space_id,
            "expectedRevision":1,
            "command":{"type":"rename","name":"Renamed"},
        }),
    )
    .unwrap();
    assert_eq!((renamed.revision, renamed.name.as_str()), (2, "Renamed"));

    let conflict = apply(
        &fixture.engine,
        json!({
            "spaceId":space_id,
            "expectedRevision":1,
            "command":{"type":"rename","name":"Lost update"},
        }),
    )
    .unwrap_err();
    assert!(matches!(conflict.kind, SpaceErrorKind::Conflict));
    assert_eq!(conflict.expected_revision, Some(1));
    assert_eq!(conflict.current.as_deref().unwrap(), &renamed);
    assert_eq!(
        conflict.clone().into_response().status(),
        StatusCode::CONFLICT
    );
    assert_eq!(fixture.engine.history(space_id).unwrap().len(), 2);

    let control_id = apply(
        &fixture.engine,
        json!({
            "command":{
                "type":"create",
                "id":"control\u{0000}id",
                "name":"Rejected",
                "origin":"canvas",
            }
        }),
    )
    .unwrap_err();
    assert!(matches!(control_id.kind, SpaceErrorKind::Invalid));

    let arranged = apply(
        &fixture.engine,
        json!({
            "spaceId":space_id,
            "expectedRevision":2,
            "command":{
                "type":"applyArrangement",
                "presentation":"spatial",
                "arrangement":{"placements":{
                    pane_id:{"bounds":{"x":1,"y":2,"width":300,"height":200},"zIndex":4}
                }},
            },
        }),
    )
    .unwrap();
    assert_eq!(arranged.revision, 3);
    assert_eq!(arranged.panes[pane_id], created.panes[pane_id]);

    let duplicate = apply(
        &fixture.engine,
        json!({
            "spaceId":space_id,
            "expectedRevision":3,
            "command":{
                "type":"duplicate",
                "sourceRevision":1,
                "newId":"recovered/copy\\one",
                "name":"Recovered",
            },
        }),
    )
    .unwrap();
    assert_eq!(
        (duplicate.revision, duplicate.name.as_str()),
        (1, "Recovered")
    );
    assert!(duplicate.arrangements.spatial.is_none());
    assert!(duplicate.arrangements.tiled.is_some());

    let deleted = apply(
        &fixture.engine,
        json!({
            "spaceId":duplicate.id,
            "expectedRevision":1,
            "command":{"type":"delete"},
        }),
    )
    .unwrap();
    assert!(deleted.deleted_at.is_some());
    let restored = apply(
        &fixture.engine,
        json!({
            "spaceId":deleted.id,
            "expectedRevision":2,
            "command":{"type":"restoreRevision","revision":1},
        }),
    )
    .unwrap();
    assert_eq!(restored.revision, 3);
    assert_eq!(restored.deleted_at, None);

    let restarted = SpaceEngine::for_test(
        fixture.engine.database.clone(),
        fixture.engine.library_id.clone(),
        HISTORY_RETENTION,
    );
    assert_eq!(restarted.load(space_id).unwrap(), arranged);
    assert_eq!(
        restarted
            .history(space_id)
            .unwrap()
            .into_iter()
            .map(|entry| (entry.revision, entry.command_type))
            .collect::<Vec<_>>(),
        vec![
            (3, "applyArrangement".into()),
            (2, "rename".into()),
            (1, "create".into()),
        ]
    );
}

#[test]
fn retained_history_expires_old_revisions_without_touching_head() {
    let fixture = fixture("retention");
    let engine = SpaceEngine::for_test(
        fixture.engine.database.clone(),
        fixture.engine.library_id.clone(),
        3,
    );
    apply(&engine, create_body("retained", "pane")).unwrap();
    for expected in 1..=5 {
        apply(
            &engine,
            json!({
                "spaceId":"retained",
                "expectedRevision":expected,
                "command":{"type":"rename","name":format!("Revision {}", expected + 1)},
            }),
        )
        .unwrap();
    }
    assert_eq!(
        engine
            .history("retained")
            .unwrap()
            .into_iter()
            .map(|entry| entry.revision)
            .collect::<Vec<_>>(),
        vec![6, 5, 4]
    );
    let expired = engine.revision("retained", 1).unwrap_err();
    assert!(matches!(expired.kind, SpaceErrorKind::HistoryExpired));
    assert_eq!(expired.oldest_retained_revision, Some(4));
    assert_eq!(expired.into_response().status(), StatusCode::GONE);
    assert_eq!(engine.load("retained").unwrap().revision, 6);
}

#[test]
fn pane_commands_validate_references_and_prune_both_presentations() {
    let fixture = fixture("pane-commands");
    let created = apply(
        &fixture.engine,
        json!({
            "spaceId":"pane-commands",
            "expectedRevision":0,
            "command":{
                "type":"create",
                "name":"Pane commands",
                "origin":"workspace",
                "arrangements":{},
            },
        }),
    )
    .unwrap();
    assert!(created.panes.is_empty());

    let added = apply(
        &fixture.engine,
        json!({
            "spaceId":"pane-commands",
            "expectedRevision":1,
            "command":{"type":"addPane","paneId":"pane/one","pane":pane("Docs/one.md")},
        }),
    )
    .unwrap();
    assert_eq!(added.panes["pane/one"].state["title"], "Durable pane");
    let updated = apply(
        &fixture.engine,
        json!({
            "spaceId":"pane-commands",
            "expectedRevision":2,
            "command":{
                "type":"updatePane",
                "paneId":"pane/one",
                "pane":{"kind":"assistant","state":{"hermes":{"sessionId":"session-1"}}},
            },
        }),
    )
    .unwrap();
    assert_eq!(updated.panes["pane/one"].kind, PaneKind::Assistant);

    let tiled = apply(
        &fixture.engine,
        json!({
            "spaceId":"pane-commands",
            "expectedRevision":3,
            "command":{
                "type":"applyArrangement",
                "presentation":"tiled",
                "arrangement":{
                    "placements":{"pane/one":{"layout":{"bounds":{"x":0,"y":0}}}},
                    "paneOrder":["pane/one"],
                    "tabGroups":{"group/one":["pane/one"]},
                    "splits":{"group/one":{"leftPaneId":"pane/one","leftPaneFraction":0.5}},
                },
            },
        }),
    )
    .unwrap();
    let spatial = apply(
        &fixture.engine,
        json!({
            "spaceId":"pane-commands",
            "expectedRevision":4,
            "command":{
                "type":"applyArrangement",
                "presentation":"spatial",
                "arrangement":{"placements":{
                    "pane/one":{"bounds":{"x":0,"y":0,"width":100,"height":100},"zIndex":1}
                }},
            },
        }),
    )
    .unwrap();
    assert_eq!(spatial.panes, tiled.panes);
    assert_eq!(
        spatial.arrangements.tiled.as_ref().unwrap()["paneOrder"],
        json!(["pane/one"])
    );

    let duplicate_order = apply(
        &fixture.engine,
        json!({
            "spaceId":"pane-commands",
            "expectedRevision":5,
            "command":{
                "type":"applyArrangement",
                "presentation":"tiled",
                "arrangement":{
                    "placements":{"pane/one":{"layout":{}}},
                    "paneOrder":["pane/one","pane/one"],
                },
            },
        }),
    )
    .unwrap_err();
    assert!(matches!(duplicate_order.kind, SpaceErrorKind::Invalid));

    let invalid = apply(
        &fixture.engine,
        json!({
            "spaceId":"pane-commands",
            "expectedRevision":5,
            "command":{
                "type":"applyArrangement",
                "presentation":"spatial",
                "arrangement":{"placements":{
                    "missing":{"bounds":{"x":0,"y":0,"width":100,"height":100},"zIndex":1}
                }},
            },
        }),
    )
    .unwrap_err();
    assert!(matches!(invalid.kind, SpaceErrorKind::Invalid));
    assert_eq!(fixture.engine.load("pane-commands").unwrap().revision, 5);
    assert_eq!(fixture.engine.history("pane-commands").unwrap().len(), 5);

    let removed = apply(
        &fixture.engine,
        json!({
            "spaceId":"pane-commands",
            "expectedRevision":5,
            "command":{"type":"removePane","paneId":"pane/one"},
        }),
    )
    .unwrap();
    assert!(removed.panes.is_empty());
    assert_eq!(
        removed.arrangements.spatial.as_ref().unwrap()["placements"],
        json!({})
    );
    let tiled = removed.arrangements.tiled.as_ref().unwrap();
    assert_eq!(tiled["placements"], json!({}));
    assert_eq!(tiled["paneOrder"], json!([]));
    assert_eq!(tiled["tabGroups"], json!({}));
    assert_eq!(tiled["splits"], json!({}));

    let cleared = apply(
        &fixture.engine,
        json!({
            "spaceId":"pane-commands",
            "expectedRevision":6,
            "command":{
                "type":"applyArrangement",
                "presentation":"spatial",
                "arrangement":null,
            },
        }),
    )
    .unwrap();
    assert!(cleared.arrangements.spatial.is_none());
}

#[test]
fn canvas_import_is_exact_idempotent_and_quarantines_bad_or_conflicting_records() {
    let fixture = fixture("canvas-import");
    let canvas_id = "canvas/family\\phone";
    let pane_id = "pane/movie\\primary";
    let raw = canvas_record(canvas_id, pane_id, 1_700_000_000_000);
    let (spaces, imports) = fixture
        .engine
        .import_canvases(&json!([raw.clone()]))
        .unwrap();
    assert_eq!(imports[0].status, "imported");
    assert_eq!(imports[0].raw, raw);
    let imported = &spaces[0];
    assert_eq!((imported.id.as_str(), imported.revision), (canvas_id, 1));
    assert!(imported.panes.contains_key(pane_id));
    assert_eq!(
        imported.panes[pane_id].state["resourceTarget"]["ref"]["resourceId"],
        "resource-movie"
    );
    assert_eq!(
        imported.arrangements.spatial.as_ref().unwrap()["placements"][pane_id],
        json!({"bounds":{"x":-32.5,"y":64.25,"width":640.0,"height":480.0},"zIndex":9})
    );
    let durable_json = serde_json::to_string(imported).unwrap();
    for transient in [
        "camera",
        "maximizedWindowId",
        "focusedWindowId",
        "windowSizeByType",
        "nextItemId",
        "nextZIndex",
        "tabGroupId",
        "layout",
    ] {
        assert!(!durable_json.contains(transient), "leaked {transient}");
    }

    let (again, repeated) = fixture
        .engine
        .import_canvases(&json!([raw.clone()]))
        .unwrap();
    assert_eq!(again[0].revision, 1);
    assert_eq!(repeated[0], imports[0]);
    let restarted = initialize(&fixture.config).unwrap();
    assert_eq!(restarted.load(canvas_id).unwrap().revision, 1);
    assert_eq!(restarted.import_export().unwrap()[0].raw, raw);

    let mut newer = raw.clone();
    newer["updatedAt"] = json!(1_700_000_000_001_u64);
    newer["name"] = json!("Canvas from phone");
    let (updated, update_records) = restarted.import_canvases(&json!([newer.clone()])).unwrap();
    assert_eq!(update_records[0].status, "updated");
    assert_eq!(
        (updated[0].revision, updated[0].name.as_str()),
        (2, "Canvas from phone")
    );

    apply(
        &restarted,
        json!({
            "spaceId":canvas_id,
            "expectedRevision":2,
            "command":{"type":"rename","name":"Edited as Space"},
        }),
    )
    .unwrap();
    let mut conflicting = newer;
    conflicting["updatedAt"] = json!(1_700_000_000_002_u64);
    conflicting["name"] = json!("Late Canvas client");
    let (conflict_spaces, conflict_records) = restarted
        .import_canvases(&json!([conflicting.clone()]))
        .unwrap();
    assert!(conflict_spaces.is_empty());
    assert_eq!(conflict_records[0].status, "quarantined");
    assert_eq!(conflict_records[0].raw, conflicting);
    assert_eq!(restarted.load(canvas_id).unwrap().name, "Edited as Space");

    let invalid = json!({"id":"invalid","name":"Broken"});
    let (_, invalid_records) = restarted
        .import_canvases(&json!([invalid.clone()]))
        .unwrap();
    assert_eq!(invalid_records[0].status, "quarantined");
    assert_eq!(invalid_records[0].raw, invalid);
    assert!(invalid_records[0].space_id.is_none());
    assert!(
        restarted
            .import_export()
            .unwrap()
            .iter()
            .any(|entry| entry.raw == invalid)
    );

    let mut oversized = canvas_record("oversized", "oversized-pane", 1_700_000_000_003);
    oversized["state"]["windows"][0]["definition"]["title"] = json!("x".repeat(257 * 1024));
    let (oversized_spaces, oversized_records) = restarted
        .import_canvases(&json!([oversized.clone()]))
        .unwrap();
    assert!(oversized_spaces.is_empty());
    assert_eq!(oversized_records[0].status, "quarantined");
    assert_eq!(oversized_records[0].raw, oversized);
}

#[test]
fn workspace_import_atomically_keeps_exact_source_and_is_idempotent() {
    let fixture = fixture("workspace-import");
    let raw = "{\n  \"windows\": [{\"id\":\"workspace-window-1\"}],\n  \"pinnedTaskbarItems\": [\"device-only\"]\n}";
    let request = json!({
        "sourceKey":"workspace-state-ws-family-desk",
        "raw":raw,
        "id":"workspace/family\\desk",
        "name":"Family desk",
        "panes":{
            "workspace-window-1":pane("Documents/item.md"),
        },
        "arrangements":{
            "tiled":{
                "placements":{"workspace-window-1":{"layout":{"mode":"free"}}},
                "paneOrder":["workspace-window-1"],
                "tabGroups":{"workspace-window-1":["workspace-window-1"]},
            },
        },
    });
    let (space, record) = fixture
        .engine
        .import_workspace(serde_json::from_value(request.clone()).unwrap())
        .unwrap();
    assert_eq!(
        (space.id.as_str(), space.revision),
        ("workspace/family\\desk", 1)
    );
    assert_eq!(record.source_kind, "workspace");
    assert_eq!(record.status, "imported");
    assert_eq!(record.raw, json!(raw));
    assert!(
        !serde_json::to_string(&space)
            .unwrap()
            .contains("device-only")
    );

    let (again, repeated) = fixture
        .engine
        .import_workspace(serde_json::from_value(request).unwrap())
        .unwrap();
    assert_eq!(again, space);
    assert_eq!(repeated, record);
    assert_eq!(fixture.engine.history(&space.id).unwrap().len(), 1);

    let restarted = initialize(&fixture.config).unwrap();
    assert_eq!(restarted.load(&space.id).unwrap(), space);
    let exported = restarted
        .import_export()
        .unwrap()
        .into_iter()
        .find(|entry| entry.source_kind == "workspace")
        .unwrap();
    assert_eq!(exported.raw, json!(raw));
}

#[test]
fn legacy_canvas_adapter_echo_is_a_no_op() {
    let fixture = fixture("canvas-adapter-noop");
    let mut raw = canvas_record("adapter-canvas", "canvas-window-41", 77);
    raw["state"]["windows"][0]["zIndex"] = json!(87);
    let first = fixture.engine.sync_legacy_canvases(&json!([raw])).unwrap();
    assert_eq!(first[0]["state"]["nextItemId"], 42);
    assert_eq!(first[0]["state"]["nextZIndex"], 88);
    assert_eq!(fixture.engine.load("adapter-canvas").unwrap().revision, 1);
    let echoed = fixture
        .engine
        .sync_legacy_canvases(&Value::Array(first.clone()))
        .unwrap();
    assert_eq!(echoed, first);
    assert_eq!(fixture.engine.load("adapter-canvas").unwrap().revision, 1);
    assert_eq!(fixture.engine.history("adapter-canvas").unwrap().len(), 1);
}

#[test]
fn newer_canvas_session_state_is_retained_without_a_durable_revision() {
    let fixture = fixture("canvas-session-only-sync");
    let raw = canvas_record("camera-only", "canvas-window-9", 100);
    fixture
        .engine
        .sync_legacy_canvases(&json!([raw.clone()]))
        .unwrap();

    let mut camera_only = raw;
    camera_only["updatedAt"] = json!(101);
    camera_only["writerId"] = json!("browser-two");
    camera_only["state"]["camera"] = json!({"x":900,"y":-450,"zoom":1.75});
    camera_only["state"]["maximizedWindowId"] = json!("canvas-window-9");
    camera_only["state"]["windowSizeByType"] = json!({"viewer":{"width":1024,"height":768}});
    camera_only["state"]["nextItemId"] = json!(500);
    camera_only["state"]["nextZIndex"] = json!(600);

    fixture
        .engine
        .sync_legacy_canvases(&json!([camera_only.clone()]))
        .unwrap();

    assert_eq!(fixture.engine.load("camera-only").unwrap().revision, 1);
    assert_eq!(fixture.engine.history("camera-only").unwrap().len(), 1);
    let record = fixture
        .engine
        .import_export()
        .unwrap()
        .into_iter()
        .find(|record| record.raw == camera_only)
        .unwrap();
    assert_eq!(record.status, "unchanged");
    assert_eq!(record.space_id.as_deref(), Some("camera-only"));
}

#[test]
fn legacy_canvas_sync_cannot_overwrite_a_canonical_canvas_without_an_import_baseline() {
    let fixture = fixture("canonical-canvas-adapter-conflict");
    let created = apply(
        &fixture.engine,
        json!({
            "spaceId":"canonical-canvas",
            "expectedRevision":0,
            "command":{
                "type":"create",
                "name":"Canonical Canvas",
                "origin":"canvas",
                "panes":{"canvas-window-1":pane("Documents/original.md")},
                "arrangements":{"spatial":{"placements":{
                    "canvas-window-1":{
                        "bounds":{"x":0,"y":0,"width":640,"height":480},
                        "zIndex":1
                    }
                }}},
            },
        }),
    )
    .unwrap();
    let projected = fixture
        .engine
        .legacy_canvases()
        .unwrap()
        .into_iter()
        .find(|record| record["id"] == "canonical-canvas")
        .unwrap();
    let renamed = apply(
        &fixture.engine,
        json!({
            "spaceId":"canonical-canvas",
            "expectedRevision":created.revision,
            "command":{"type":"rename","name":"Accepted canonical edit"},
        }),
    )
    .unwrap();

    let mut stale_adapter_write = projected;
    stale_adapter_write["updatedAt"] = json!(renamed.updated_at + 1);
    stale_adapter_write["writerId"] = json!("legacy-browser");
    stale_adapter_write["name"] = json!("Stale legacy overwrite");
    stale_adapter_write["state"]["windows"][0]["definition"]["title"] = json!("Stale pane");
    let synced = fixture
        .engine
        .sync_legacy_canvases(&json!([stale_adapter_write.clone()]))
        .unwrap();

    let current = fixture.engine.load("canonical-canvas").unwrap();
    assert_eq!(current, renamed);
    assert_eq!(current.name, "Accepted canonical edit");
    assert_eq!(current.revision, 2);
    assert_eq!(synced[0]["name"], "Accepted canonical edit");
    let import = fixture
        .engine
        .import_export()
        .unwrap()
        .into_iter()
        .find(|record| record.raw == stale_adapter_write)
        .unwrap();
    assert_eq!(import.status, "quarantined");
    assert!(import.space_id.is_none());
}

#[test]
fn legacy_tombstone_import_preserves_identity_and_deletion() {
    let fixture = fixture("canvas-tombstone");
    let raw = json!({
        "id":"deleted/canvas\\id",
        "name":"Deleted Canvas",
        "updatedAt":42,
        "writerId":"browser",
        "deleted":true,
        "state":Value::Null,
    });
    let (spaces, imports) = fixture.engine.import_canvases(&json!([raw])).unwrap();
    assert_eq!(imports[0].status, "imported");
    assert_eq!(spaces[0].id, "deleted/canvas\\id");
    assert_eq!(spaces[0].deleted_at, Some(42));
    assert!(spaces[0].panes.is_empty());
    assert_eq!(fixture.engine.list().unwrap()[0].deleted_at, Some(42));
}

#[test]
fn production_migration_order_backup_and_restart_preserve_legacy_data() {
    let base = std::env::temp_dir().join(format!("derp-spaces-migration-{}", uuid::Uuid::new_v4()));
    let mut config = config_for(&base);
    state_db::initialize(&config).unwrap();
    let legacy = canvas_record("legacy/canvas", "legacy/pane", 900);
    state_db::update_document(
        &state_db::database(&config),
        "canvases",
        &config.library_key,
        json!([]),
        |value| {
            *value = json!([legacy.clone()]);
            Ok(())
        },
    )
    .unwrap();

    crate::resources::initialize_identity(&mut config).unwrap();
    shares::initialize(&config).unwrap();
    let engine = initialize(&config).unwrap();
    assert_eq!(engine.load("legacy/canvas").unwrap().revision, 1);
    let database = state_db::database(&config);
    let connection = state_db::connection(&database).unwrap();
    let versions = connection
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .unwrap()
        .query_map([], |row| row.get::<_, i64>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(versions, vec![1, 3, 4, 5]);
    for table in ["spaces", "space_revisions", "space_imports"] {
        assert!(table_exists(&connection, table).unwrap());
    }
    drop(connection);

    let backup = config
        .data_path
        .join("schema-backups")
        .join("app-before-spaces-v5.sqlite3");
    assert!(backup.is_file());
    let backup_bytes = fs::read(&backup).unwrap();
    let backup_db = state_db::connection(&backup).unwrap();
    assert!(!table_exists(&backup_db, "spaces").unwrap());
    let backed_up =
        state_db::document(&backup, "canvases", &config.library_key, json!([])).unwrap();
    assert_eq!(backed_up, json!([legacy]));
    drop(backup_db);

    let restarted = initialize(&config).unwrap();
    assert_eq!(restarted.load("legacy/canvas").unwrap().revision, 1);
    assert_eq!(restarted.import_export().unwrap().len(), 1);
    assert_eq!(fs::read(&backup).unwrap(), backup_bytes);
    let connection = state_db::connection(&database).unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version=5",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        1
    );
    drop(connection);
    fs::remove_dir_all(base).unwrap();
}

#[test]
fn resource_reconciliation_preserves_stable_refs_and_is_replay_safe() {
    let fixture = fixture("resource-reconcile");
    let stable_ref = json!({"libraryId":"library","resourceId":"stable-resource"});
    let created = apply(
        &fixture.engine,
        json!({
            "spaceId":"resources",
            "expectedRevision":0,
            "command":{
                "type":"create",
                "name":"Resources",
                "origin":"workspace",
                "panes":{
                    "stable":{
                        "kind":"viewer",
                        "state":{
                            "resourceTarget":{"ref":stable_ref,"legacyLocator":"Old/file.md"},
                            "initialState":{"viewing":"Old/file.md"},
                        },
                    },
                    "legacy":{
                        "kind":"browser",
                        "state":{"initialState":{"dir":"Old/folder"}},
                    },
                },
                "arrangements":{
                    "spatial":{"placements":{
                        "stable":{"bounds":{"x":0,"y":0,"width":400,"height":300},"zIndex":1},
                        "legacy":{"bounds":{"x":10,"y":10,"width":400,"height":300},"zIndex":2}
                    }}
                },
            },
        }),
    )
    .unwrap();
    assert_eq!(created.revision, 1);

    fixture.engine.reconcile_move("Old", "New").unwrap();
    let moved = fixture.engine.load("resources").unwrap();
    assert_eq!(moved.revision, 2);
    assert_eq!(
        moved.panes["stable"].state["resourceTarget"]["ref"],
        stable_ref
    );
    assert_eq!(
        moved.panes["stable"].state["resourceTarget"]["legacyLocator"],
        "New/file.md"
    );
    assert_eq!(
        moved.panes["legacy"].state["initialState"]["dir"],
        "New/folder"
    );
    fixture.engine.reconcile_move("Old", "New").unwrap();
    assert_eq!(fixture.engine.load("resources").unwrap().revision, 2);

    fixture.engine.reconcile_remove("New").unwrap();
    let removed = fixture.engine.load("resources").unwrap();
    assert_eq!(removed.revision, 3);
    assert!(removed.panes.contains_key("stable"));
    assert_eq!(
        removed.panes["stable"].state["resourceTarget"]["ref"],
        stable_ref
    );
    assert_eq!(
        removed.panes["stable"].state["resourceTarget"]["availability"],
        "missing"
    );
    assert!(!removed.panes.contains_key("legacy"));
    assert!(
        removed.arrangements.spatial.as_ref().unwrap()["placements"]
            .get("legacy")
            .is_none()
    );
    fixture.engine.reconcile_remove("New").unwrap();
    assert_eq!(fixture.engine.load("resources").unwrap().revision, 3);

    let restarted = SpaceEngine::for_test(
        fixture.engine.database.clone(),
        fixture.engine.library_id.clone(),
        HISTORY_RETENTION,
    );
    assert_eq!(restarted.load("resources").unwrap(), removed);
}
