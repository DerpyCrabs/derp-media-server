use crate::{
    app::{AppState, timestamp_ms},
    error::AppResult,
    reader_state,
};
use rusqlite::Transaction;

pub fn moved_in_transaction(
    state: &AppState,
    transaction: &Transaction<'_>,
    old_path: &str,
    new_path: &str,
) -> AppResult<()> {
    let changed_at = timestamp_ms();
    state
        .settings
        .move_paths_in_transaction(transaction, old_path, new_path)?;
    state
        .workspaces
        .move_paths_in_transaction(transaction, old_path, new_path, changed_at)?;
    state
        .stats
        .move_paths_in_transaction(transaction, old_path, new_path)?;
    reader_state::move_prefix_in_transaction(transaction, old_path, new_path)
}

pub fn removed_in_transaction(
    state: &AppState,
    transaction: &Transaction<'_>,
    path: &str,
) -> AppResult<()> {
    let changed_at = timestamp_ms();
    state
        .settings
        .remove_paths_in_transaction(transaction, path)?;
    state
        .workspaces
        .remove_paths_in_transaction(transaction, path, changed_at)?;
    state.stats.remove_paths_in_transaction(transaction, path)?;
    reader_state::remove_prefix_in_transaction(transaction, None, path)
}

pub fn content_replaced_in_transaction(transaction: &Transaction<'_>, path: &str) -> AppResult<()> {
    reader_state::remove_exact_all_in_transaction(transaction, path)
}

#[cfg(test)]
mod tests {
    use crate::workspace_persistence;
    use serde_json::{Value, json};

    #[test]
    fn workspace_paths_follow_renames() {
        let mut snapshot = json!({
            "windows":[{"id":"reader","type":"viewer","source":{"kind":"local"},"iconPath":"Books/Old/chapter.pdf","initialState":{"dir":"Books/Old","viewing":"Books/Old/chapter.pdf"}}],
            "activeWindowId":"reader","activeTabMap":{"reader":"reader"}
        });

        workspace_persistence::rewrite_snapshot_paths(&mut snapshot, "Books/Old", "Books/New");

        assert_eq!(snapshot["windows"][0]["initialState"]["dir"], "Books/New");
        assert_eq!(
            snapshot["windows"][0]["initialState"]["viewing"],
            "Books/New/chapter.pdf"
        );
    }

    #[test]
    fn workspace_deletes_prune_references_and_repair_focus() {
        let mut snapshot = json!({
            "windows":[
                {"id":"removed","type":"viewer","source":{"kind":"local"},"iconPath":"Books/Old/chapter.pdf","initialState":{}},
                {"id":"kept","type":"viewer","source":{"kind":"local"},"iconPath":"Keep/file.pdf","initialState":{}}
            ],
            "activeWindowId":"removed","activeTabMap":{"group":"removed"},
            "tabGroupSplits":{"group":{"leftTabId":"removed","leftPaneFraction":0.5}}
        });

        workspace_persistence::remove_snapshot_paths(&mut snapshot, "Books/Old");

        assert_eq!(snapshot["windows"].as_array().unwrap().len(), 1);
        assert_eq!(snapshot["activeWindowId"], "kept");
        assert_eq!(snapshot["activeTabMap"], json!({}));
        assert_eq!(snapshot["tabGroupSplits"], json!({}));
    }

    #[test]
    fn workspace_delete_keeps_viewer_that_navigated_away_from_stale_icon() {
        let mut snapshot = json!({
            "windows":[{
                "id":"reader",
                "type":"viewer",
                "source":{"kind":"local"},
                "iconPath":"Books/Old.pdf",
                "initialState":{"viewing":"Books/Current.pdf"}
            }],
            "activeWindowId":"reader"
        });

        workspace_persistence::remove_snapshot_paths(&mut snapshot, "Books/Old.pdf");

        let window = &snapshot["windows"][0];
        assert_eq!(window["initialState"]["viewing"], "Books/Current.pdf");
        assert_eq!(window["iconPath"], Value::Null);
    }

    #[test]
    fn workspace_delete_preserves_empty_workspace_metadata() {
        let mut snapshot = json!({
            "workspaceType":"canvas",
            "windows":[{
                "id":"reader",
                "type":"viewer",
                "source":{"kind":"local"},
                "iconPath":"Books/Only.pdf",
                "initialState":{"viewing":"Books/Only.pdf"}
            }],
            "activeWindowId":"reader",
            "activeTabMap":{},
            "canvas":{"camera":{"x":120,"y":80,"zoom":0.5}}
        });

        workspace_persistence::remove_snapshot_paths(&mut snapshot, "Books/Only.pdf");

        assert_eq!(snapshot["windows"], json!([]));
        assert_eq!(snapshot["activeWindowId"], Value::Null);
        assert_eq!(snapshot["workspaceType"], "canvas");
        assert_eq!(snapshot["canvas"]["camera"]["zoom"], 0.5);
    }
}
