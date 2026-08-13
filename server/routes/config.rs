use crate::app::{Shared, all_roots};
use axum::{Json, Router, extract::State, routing::get};
use serde_json::{Value, json};

async fn config(State(state): State<Shared>) -> Json<Value> {
    let roots = all_roots(&state);
    let editable = if roots.len() == 1 {
        roots[0].editable_folders.clone()
    } else {
        let mut values = state.config.roots[0].editable_folders.clone();
        values.extend(roots.iter().flat_map(|root| {
            root.editable_folders
                .iter()
                .map(move |folder| format!("{}/{}", root.name, folder.replace('\\', "/")))
        }));
        values
    };
    Json(json!({
        "editableFolders": editable,
        "mediaRoots": roots.iter().map(|root| json!({
            "id": root.id,
            "name": root.name,
            "editableFolders": root.editable_folders,
            "readOnly": root.read_only,
            "source": root.source,
        })).collect::<Vec<_>>(),
    }))
}

pub fn router() -> Router<Shared> {
    Router::new().route("/api/config", get(config))
}
