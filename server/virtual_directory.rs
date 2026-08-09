use crate::{
    app::AppState,
    error::{AppError, AppResult},
    hermes::HermesTransport,
    media,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::collections::HashSet;

pub(crate) const HERMES_ROOT: &str = "Hermes Sessions";
const PAGE_SIZE: usize = 200;

pub(crate) fn is_builtin_path(path: &str) -> bool {
    matches!(path, "Favorites" | "Most Played" | "Shares")
}

pub(crate) fn list_builtin(
    state: &AppState,
    path: &str,
) -> Option<AppResult<Vec<media::FileItem>>> {
    crate::routes::files::legacy_virtual_items(state, path)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VirtualListing {
    pub files: Vec<media::FileItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub virtual_directory: Option<Value>,
    #[serde(skip_serializing_if = "Map::is_empty")]
    pub virtual_entries: Map<String, Value>,
}

fn item(name: String, path: String, folder: bool) -> media::FileItem {
    media::FileItem {
        name,
        path,
        media_type: if folder { "folder" } else { "other" }.into(),
        size: 0,
        extension: String::new(),
        is_directory: folder,
        is_virtual: Some(true),
        view_count: None,
        share_token: None,
        thumbnail_generated: None,
        version: None,
    }
}

fn hermes_path(kind: &str, id: &str) -> AppResult<String> {
    if id.is_empty() || id.contains(['/', '\\']) {
        return Err(AppError::internal("Hermes returned an invalid identifier"));
    }
    Ok(format!("{HERMES_ROOT}/{kind}/{id}"))
}

fn path_parts(path: &str) -> Option<(&str, &str)> {
    let rest = path.strip_prefix(&format!("{HERMES_ROOT}/"))?;
    rest.split_once('/')
}

pub(crate) fn session_id_from_path(path: &str) -> AppResult<&str> {
    match path_parts(path) {
        Some(("session", id)) => Ok(id),
        _ => Err(AppError::bad("Hermes session path is invalid")),
    }
}

pub(crate) async fn session_detail(state: &AppState, path: &str) -> AppResult<Value> {
    let id = session_id_from_path(path)?;
    let hub = state
        .hermes
        .as_ref()
        .ok_or_else(|| AppError::not_found("Hermes integration is disabled"))?;
    let mut profile_query = Vec::new();
    if let Some(profile) = hub.profile() {
        profile_query.push(("profile", profile.into()));
    }
    let session = hub
        .get(&format!("api/sessions/{id}"), &profile_query)
        .await?;
    let mut query = vec![
        ("limit", "200".into()),
        ("offset", "0".into()),
        ("order", "oldest".into()),
    ];
    query.extend(profile_query);
    let messages = hub
        .get(&format!("api/sessions/{id}/messages"), &query)
        .await?;
    Ok(json!({"session":session,"messages":messages}))
}

fn capabilities(values: &[&str]) -> Value {
    json!(values)
}

fn session_id(value: &Value) -> Option<&str> {
    value
        .get("_lineage_root_id")
        .or_else(|| value.get("lineage_root_id"))
        .or_else(|| value.get("lineageRootId"))
        .or_else(|| value.get("root_session_id"))
        .or_else(|| value.get("id"))
        .or_else(|| value.get("session_id"))
        .and_then(Value::as_str)
}

fn session_title(value: &Value) -> String {
    value
        .get("title")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or("Untitled session")
        .to_string()
}

fn session_time(value: &Value) -> f64 {
    value
        .get("last_active")
        .or_else(|| value.get("lastActive"))
        .and_then(Value::as_f64)
        .unwrap_or_default()
}

fn collect_tree_sessions(value: &Value, output: &mut Vec<Value>) {
    if let Some(sessions) = value.get("sessions").and_then(Value::as_array) {
        output.extend(sessions.iter().cloned());
    }
    if let Some(object) = value.as_object() {
        for (key, child) in object {
            if key != "sessions" {
                collect_tree_sessions(child, output);
            }
        }
    } else if let Some(array) = value.as_array() {
        for child in array {
            collect_tree_sessions(child, output);
        }
    }
}

async fn projects(hub: &dyn HermesTransport) -> AppResult<Vec<Value>> {
    let value = hub.rpc("projects.list", json!({})).await?;
    Ok(value
        .get("projects")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|project| {
            !project
                .get("archived")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                && !project
                    .get("is_auto")
                    .or_else(|| project.get("isAuto"))
                    .or_else(|| project.get("auto"))
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
        })
        .collect())
}

async fn project_sessions(hub: &dyn HermesTransport, id: &str) -> AppResult<Vec<Value>> {
    let value = hub
        .rpc(
            "projects.project_sessions",
            json!({"project_id":id,"session_limit":i32::MAX}),
        )
        .await?;
    let mut sessions = Vec::new();
    if let Some(project) = value.get("project") {
        collect_tree_sessions(project, &mut sessions);
    }
    sessions.sort_by(|a, b| session_time(b).total_cmp(&session_time(a)));
    sessions.dedup_by(|a, b| session_id(a) == session_id(b));
    Ok(sessions)
}

async fn flat_sessions(hub: &dyn HermesTransport, archived: bool) -> AppResult<Vec<Value>> {
    let mut sessions = Vec::new();
    let mut offset = 0usize;
    loop {
        let mut query = vec![
            ("limit", "100".into()),
            ("offset", offset.to_string()),
            ("min_messages", "1".into()),
            ("order", "recent".into()),
            ("archived", if archived { "only" } else { "exclude" }.into()),
            ("exclude_sources", "tool,kanban".into()),
        ];
        if let Some(profile) = hub.profile() {
            query.push(("profile", profile.into()));
        }
        let page = hub.get("api/sessions", &query).await?;
        let rows = page
            .get("sessions")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let count = rows.len();
        sessions.extend(rows);
        offset += count;
        let total = page
            .get("total")
            .and_then(Value::as_u64)
            .unwrap_or(offset as u64) as usize;
        if count == 0 || offset >= total {
            break;
        }
    }
    sessions.sort_by(|a, b| session_time(b).total_cmp(&session_time(a)));
    Ok(sessions)
}

fn add_sessions(
    files: &mut Vec<media::FileItem>,
    entries: &mut Map<String, Value>,
    sessions: impl IntoIterator<Item = Value>,
    archived: bool,
) -> AppResult<()> {
    for session in sessions {
        let Some(id) = session_id(&session) else {
            continue;
        };
        let path = hermes_path("session", id)?;
        files.push(item(session_title(&session), path.clone(), false));
        let busy = session
            .get("is_active")
            .and_then(Value::as_bool)
            .unwrap_or(false)
            || session
                .get("pending_approval")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            || session
                .get("queued_prompt_count")
                .and_then(Value::as_u64)
                .unwrap_or(0)
                > 0;
        let entry_capabilities = if archived {
            capabilities(&["open", "restore", "deletePermanently", "download", "copyId"])
        } else if busy {
            capabilities(&["open", "rename", "download", "copyId"])
        } else {
            capabilities(&[
                "open",
                "rename",
                "archive",
                "download",
                "copyId",
                "branch",
                "moveToProject",
            ])
        };
        entries.insert(
            path,
            json!({
                "provider":"hermes", "kind":"session", "id":id, "archived":archived,
                "capabilities":entry_capabilities,
                "openTarget":{"type":"hermesSession","sessionId":id,"readOnly":archived},
                "metadata":session,
                "appearance":{"icon":"agent-session","tone":"violet"},
            }),
        );
    }
    Ok(())
}

pub(crate) async fn list_hermes(
    state: &AppState,
    path: &str,
    offset: usize,
) -> AppResult<VirtualListing> {
    let hub = state
        .hermes
        .as_ref()
        .ok_or_else(|| AppError::not_found("Hermes integration is disabled"))?;
    list_hermes_with(hub.as_ref(), path, offset).await
}

async fn list_hermes_with(
    hub: &dyn HermesTransport,
    path: &str,
    offset: usize,
) -> AppResult<VirtualListing> {
    let mut files = Vec::new();
    let mut entries = Map::new();
    let (kind, total, create_caps) = if path == HERMES_ROOT {
        let projects = projects(hub).await?;
        let mut assigned = HashSet::new();
        for project in &projects {
            if let Some(id) = project.get("id").and_then(Value::as_str) {
                for session in project_sessions(hub, id).await? {
                    if let Some(id) = session_id(&session) {
                        assigned.insert(id.to_string());
                    }
                }
            }
        }
        let mut named = projects
            .into_iter()
            .filter_map(|project| {
                let id = project.get("id")?.as_str()?.to_string();
                let name = project
                    .get("name")
                    .or_else(|| project.get("label"))?
                    .as_str()?
                    .to_string();
                Some((name, id, project))
            })
            .collect::<Vec<_>>();
        named.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
        for (name, id, project) in named {
            let path = hermes_path("project", &id)?;
            files.push(item(name, path.clone(), true));
            entries.insert(
                path,
                json!({"provider":"hermes","kind":"project","id":id,
                "capabilities":["open","rename","deleteProject","addProjectFolder","removeProjectFolder","setPrimaryFolder","setAppearance"],"metadata":project,
                "appearance":{"icon":project.get("icon").and_then(Value::as_str).unwrap_or("project"),"tone":"indigo","color":project.get("color")}}),
            );
        }
        let archived_path = format!("{HERMES_ROOT}/archived");
        files.push(item("Archived".into(), archived_path.clone(), true));
        entries.insert(
            archived_path,
            json!({"provider":"hermes","kind":"archived","capabilities":["open"],
                "appearance":{"icon":"archive","tone":"muted"}}),
        );
        let sessions = flat_sessions(hub, false)
            .await?
            .into_iter()
            .filter(|session| session_id(session).is_some_and(|id| !assigned.contains(id)))
            .collect::<Vec<_>>();
        let total = sessions.len();
        add_sessions(
            &mut files,
            &mut entries,
            sessions.into_iter().skip(offset).take(PAGE_SIZE),
            false,
        )?;
        ("root", total, capabilities(&["createFile", "createFolder"]))
    } else if path == format!("{HERMES_ROOT}/archived") {
        let sessions = flat_sessions(hub, true).await?;
        let total = sessions.len();
        add_sessions(
            &mut files,
            &mut entries,
            sessions.into_iter().skip(offset).take(PAGE_SIZE),
            true,
        )?;
        ("archived", total, capabilities(&[]))
    } else if let Some(("project", id)) = path_parts(path) {
        let projects = projects(hub).await?;
        let project = projects
            .into_iter()
            .find(|value| value.get("id").and_then(Value::as_str) == Some(id))
            .ok_or_else(|| AppError::not_found("Hermes project not found"))?;
        let sessions = project_sessions(hub, id).await?;
        let total = sessions.len();
        add_sessions(
            &mut files,
            &mut entries,
            sessions.into_iter().skip(offset).take(PAGE_SIZE),
            false,
        )?;
        entries.insert(
            path.into(),
            json!({"provider":"hermes","kind":"project","id":id,"metadata":project}),
        );
        ("project", total, capabilities(&["createFile"]))
    } else {
        return Err(AppError::not_found("Virtual directory not found"));
    };
    let next_offset = (offset + PAGE_SIZE < total).then_some(offset + PAGE_SIZE);
    Ok(VirtualListing {
        files,
        virtual_entries: entries,
        virtual_directory: Some(json!({
            "provider":"hermes", "kind":kind, "path":path, "capabilities":create_caps,
            "offset":offset, "pageSize":PAGE_SIZE, "total":total, "nextOffset":next_offset,
        })),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActionBody {
    pub action: String,
    pub path: String,
    pub name: Option<String>,
    pub metadata: Option<Value>,
}

pub(crate) async fn action(state: &AppState, body: ActionBody) -> AppResult<Value> {
    let hub = state
        .hermes
        .as_ref()
        .ok_or_else(|| AppError::not_found("Hermes integration is disabled"))?;
    match (body.action.as_str(), path_parts(&body.path)) {
        ("createFile", _) => {
            let cwd = if let Some(("project", id)) = path_parts(&body.path) {
                Some(
                    projects(hub.as_ref())
                        .await?
                        .into_iter()
                        .find(|project| project.get("id").and_then(Value::as_str) == Some(id))
                        .and_then(|project| {
                            project
                                .get("primary_path")
                                .or_else(|| project.get("primaryPath"))
                                .cloned()
                        })
                        .ok_or_else(|| AppError::not_found("Hermes project not found"))?,
                )
            } else if body.path == HERMES_ROOT {
                None
            } else {
                return Err(AppError::bad(
                    "Sessions cannot be created in this directory",
                ));
            };
            Ok(json!({"openTarget":{"type":"hermesDraft","projectPath":cwd,"readOnly":false}}))
        }
        ("createFolder", _) => {
            let _operation = state.hermes_project_operations.lock().await;
            if body.path != HERMES_ROOT {
                return Err(AppError::bad("Hermes projects can only be created at root"));
            }
            let name = body
                .name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AppError::bad("Project name is required"))?;
            if name.eq_ignore_ascii_case("Archived") {
                return Err(AppError::conflict("Archived is a reserved project name"));
            }
            if projects(hub.as_ref()).await?.iter().any(|project| {
                project
                    .get("name")
                    .or_else(|| project.get("label"))
                    .and_then(Value::as_str)
                    .is_some_and(|value| value.eq_ignore_ascii_case(name))
            }) {
                return Err(AppError::conflict(
                    "A project with this name already exists",
                ));
            }
            let metadata = body.metadata.unwrap_or(Value::Null);
            let primary = metadata
                .get("primaryPath")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AppError::bad("Primary directory is required"))?;
            let mut folders = metadata
                .get("folders")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_else(|| vec![Value::String(primary.into())]);
            if !folders
                .iter()
                .any(|folder| folder.as_str() == Some(primary))
            {
                folders.insert(0, Value::String(primary.into()));
            }
            if folders.len() > 32
                || folders
                    .iter()
                    .any(|folder| folder.as_str().is_none_or(str::is_empty))
            {
                return Err(AppError::bad("Project directories are invalid"));
            }
            for folder in &folders {
                let path = folder.as_str().expect("validated folder path");
                let result = hub
                    .get("api/fs/list", &[("path", path.to_string())])
                    .await?;
                if result.get("error").is_some() {
                    return Err(AppError::bad(format!(
                        "Gateway directory does not exist or is not readable: {path}"
                    )));
                }
            }
            hub.rpc(
                "projects.create",
                json!({"name":name,"primary_path":primary,"folders":folders}),
            )
            .await
        }
        ("rename", Some(("session", id))) => {
            let name = body
                .name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AppError::bad("Session title is required"))?;
            hub.patch(
                &format!("api/sessions/{id}"),
                json!({"title":name,"profile":hub.profile()}),
            )
            .await
        }
        ("rename", Some(("project", id))) => {
            let _operation = state.hermes_project_operations.lock().await;
            let name = body
                .name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AppError::bad("Project name is required"))?;
            if name.eq_ignore_ascii_case("Archived") {
                return Err(AppError::conflict("Archived is a reserved project name"));
            }
            if projects(hub.as_ref()).await?.iter().any(|project| {
                project.get("id").and_then(Value::as_str) != Some(id)
                    && project
                        .get("name")
                        .or_else(|| project.get("label"))
                        .and_then(Value::as_str)
                        .is_some_and(|value| value.eq_ignore_ascii_case(name))
            }) {
                return Err(AppError::conflict(
                    "A project with this name already exists",
                ));
            }
            hub.rpc("projects.update", json!({"id":id,"name":name}))
                .await
        }
        ("branch", Some(("session", id))) => {
            let title = body
                .name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let result = hub
                .post(
                    &format!("api/sessions/{id}/fork"),
                    json!({"title":title,"profile":hub.profile()}),
                )
                .await?;
            let session = result.get("session").unwrap_or(&result);
            let fork_id = session
                .get("id")
                .or_else(|| session.get("session_id"))
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::internal("Hermes fork omitted session id"))?;
            Ok(json!({"openTarget":{"type":"hermesSession","sessionId":fork_id,"readOnly":false}}))
        }
        ("moveToProject", Some(("session", id))) => {
            let project_name = body
                .name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AppError::bad("Destination project name is required"))?;
            let project = projects(hub.as_ref())
                .await?
                .into_iter()
                .find(|project| {
                    project
                        .get("name")
                        .or_else(|| project.get("label"))
                        .and_then(Value::as_str)
                        .is_some_and(|value| value.eq_ignore_ascii_case(project_name))
                })
                .ok_or_else(|| AppError::not_found("Hermes project not found"))?;
            let cwd = project
                .get("primary_path")
                .or_else(|| project.get("primaryPath"))
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::bad("Hermes project has no primary directory"))?;
            hub.rpc(
                "session.workspace.move",
                json!({"session_key":id,"cwd":cwd,"profile":hub.profile()}),
            )
            .await
        }
        ("addProjectFolder", Some(("project", id))) => {
            let folder = body
                .name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AppError::bad("Gateway directory is required"))?;
            hub.rpc(
                "projects.add_folder",
                json!({"id":id,"path":folder,"is_primary":false}),
            )
            .await
        }
        ("removeProjectFolder", Some(("project", id))) => {
            let folder = body
                .name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AppError::bad("Gateway directory is required"))?;
            hub.rpc("projects.remove_folder", json!({"id":id,"path":folder}))
                .await
        }
        ("setPrimaryFolder", Some(("project", id))) => {
            let folder = body
                .name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AppError::bad("Gateway directory is required"))?;
            hub.rpc("projects.set_primary", json!({"id":id,"path":folder}))
                .await
        }
        ("setAppearance", Some(("project", id))) => {
            let metadata = body.metadata.unwrap_or(Value::Null);
            let icon = metadata.get("icon").and_then(Value::as_str).unwrap_or("");
            let color = metadata.get("color").and_then(Value::as_str).unwrap_or("");
            hub.rpc(
                "projects.update",
                json!({"id":id,"icon":icon,"color":color}),
            )
            .await
        }
        ("archive", Some(("session", id))) => {
            let session = flat_sessions(hub.as_ref(), false)
                .await?
                .into_iter()
                .find(|value| session_id(value) == Some(id))
                .ok_or_else(|| AppError::not_found("Hermes session not found"))?;
            if session
                .get("is_active")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                || session
                    .get("pending_approval")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                || session
                    .get("queued_prompt_count")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
                    > 0
            {
                return Err(AppError::conflict(
                    "Busy Hermes sessions cannot be archived",
                ));
            }
            hub.patch(
                &format!("api/sessions/{id}"),
                json!({"archived":true,"profile":hub.profile()}),
            )
            .await
        }
        ("restore", Some(("session", id))) => {
            if !flat_sessions(hub.as_ref(), true)
                .await?
                .iter()
                .any(|value| session_id(value) == Some(id))
            {
                return Err(AppError::conflict(
                    "Only archived Hermes sessions can be restored",
                ));
            }
            hub.patch(
                &format!("api/sessions/{id}"),
                json!({"archived":false,"profile":hub.profile()}),
            )
            .await
        }
        ("deletePermanently", Some(("session", id))) => {
            if !flat_sessions(hub.as_ref(), true)
                .await?
                .iter()
                .any(|value| session_id(value) == Some(id))
            {
                return Err(AppError::conflict(
                    "Only archived Hermes sessions can be permanently deleted",
                ));
            }
            hub.delete(&format!("api/sessions/{id}")).await?;
            Ok(json!({"ok":true}))
        }
        ("deleteProject", Some(("project", id))) => {
            let _operation = state.hermes_project_operations.lock().await;
            hub.rpc("projects.delete", json!({"id":id})).await
        }
        _ => Err(AppError::bad("Unsupported virtual-directory operation")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::future::BoxFuture;
    use std::{collections::VecDeque, sync::Mutex};

    struct FakeTransport {
        gets: Mutex<VecDeque<Value>>,
        rpcs: Mutex<VecDeque<Value>>,
        queries: Mutex<Vec<Vec<(String, String)>>>,
    }

    impl HermesTransport for FakeTransport {
        fn profile(&self) -> Option<&str> {
            Some("test")
        }
        fn get<'a>(
            &'a self,
            _path: &'a str,
            query: &'a [(&'a str, String)],
        ) -> BoxFuture<'a, AppResult<Value>> {
            Box::pin(async move {
                self.queries.lock().unwrap().push(
                    query
                        .iter()
                        .map(|(key, value)| ((*key).into(), value.clone()))
                        .collect(),
                );
                self.gets
                    .lock()
                    .unwrap()
                    .pop_front()
                    .ok_or_else(|| AppError::internal("fake exhausted"))
            })
        }
        fn patch<'a>(&'a self, _path: &'a str, _body: Value) -> BoxFuture<'a, AppResult<Value>> {
            Box::pin(async { Err(AppError::internal("unexpected patch")) })
        }
        fn post<'a>(&'a self, _path: &'a str, _body: Value) -> BoxFuture<'a, AppResult<Value>> {
            Box::pin(async { Err(AppError::internal("unexpected post")) })
        }
        fn delete<'a>(&'a self, _path: &'a str) -> BoxFuture<'a, AppResult<()>> {
            Box::pin(async { Err(AppError::internal("unexpected delete")) })
        }
        fn ensure_events<'a>(&'a self) -> BoxFuture<'a, AppResult<()>> {
            Box::pin(async { Ok(()) })
        }
        fn rpc<'a>(&'a self, _method: &'a str, _params: Value) -> BoxFuture<'a, AppResult<Value>> {
            Box::pin(async move {
                self.rpcs
                    .lock()
                    .unwrap()
                    .pop_front()
                    .ok_or_else(|| AppError::internal("unexpected rpc"))
            })
        }
    }

    #[test]
    fn opaque_paths_do_not_use_titles() {
        assert_eq!(
            hermes_path("session", "abc-123").unwrap(),
            "Hermes Sessions/session/abc-123"
        );
        assert!(hermes_path("session", "bad/id").is_err());
    }

    #[test]
    fn tree_session_collection_flattens_and_dedupes_at_boundary() {
        let value = json!({"repos":[{"groups":[{"sessions":[{"id":"one"},{"id":"two"}]}]}]});
        let mut rows = Vec::new();
        collect_tree_sessions(&value, &mut rows);
        assert_eq!(rows.len(), 2);
    }

    #[tokio::test]
    async fn flat_session_transport_pages_past_two_hundred_and_filters_workers() {
        let page = |start: usize, count: usize| {
            json!({
                "sessions": (start..start + count).map(|id| json!({"id":id.to_string(),"last_active":id})).collect::<Vec<_>>(),
                "total": 250,
            })
        };
        let fake = FakeTransport {
            gets: Mutex::new(VecDeque::from([
                page(0, 100),
                page(100, 100),
                page(200, 50),
            ])),
            rpcs: Mutex::new(VecDeque::new()),
            queries: Mutex::new(Vec::new()),
        };
        let sessions = flat_sessions(&fake, false).await.unwrap();
        assert_eq!(sessions.len(), 250);
        assert_eq!(session_id(&sessions[0]), Some("249"));
        let queries = fake.queries.lock().unwrap();
        assert_eq!(queries.len(), 3);
        assert!(queries[0].contains(&("exclude_sources".into(), "tool,kanban".into())));
        assert!(queries[0].contains(&("profile".into(), "test".into())));
    }

    #[tokio::test]
    async fn root_uses_authoritative_project_membership_and_keeps_auto_sessions_unprojected() {
        let fake = FakeTransport {
            gets: Mutex::new(VecDeque::from([json!({
                "sessions":[
                    {"id":"project-session","title":"Inside","last_active":3},
                    {"id":"auto-session","title":"Auto repo session","last_active":2},
                    {"id":"root-session","title":"Detached","last_active":1}
                ],
                "total":3
            })])),
            rpcs: Mutex::new(VecDeque::from([
                json!({"projects":[
                    {"id":"project-a","name":"Alpha","primary_path":"/work/alpha"},
                    {"id":"auto-project","name":"Generated repo","primary_path":"/work/repo","is_auto":true}
                ]}),
                json!({"project":{"repos":[{"groups":[{"sessions":[{"id":"project-session"}]}]}]}}),
            ])),
            queries: Mutex::new(Vec::new()),
        };
        let listing = list_hermes_with(&fake, HERMES_ROOT, 0).await.unwrap();
        let names = listing
            .files
            .iter()
            .map(|file| file.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            ["Alpha", "Archived", "Auto repo session", "Detached"]
        );
        assert!(!names.contains(&"Inside"));
        assert!(!names.contains(&"Generated repo"));
        assert_eq!(listing.virtual_directory.unwrap()["total"], 2);
    }
}
