use super::{
    routes::session_export_url,
    runtime::HermesRuntime,
    transport::{HermesTransport, session_api_path, validate_opaque_id},
};
use crate::{
    error::{AppError, AppResult},
    integrations::{
        contracts::{
            BrowseRequest, INTEGRATION_SCHEMA_VERSION, IntegrationActionOutcomeDto,
            IntegrationActionRequestDto, IntegrationOpenTargetDto, IntegrationSearchRequest,
            IntegrationSearchResultDto, ResourceAppearanceDto, ResourceKeyDto, ResourcePageDto,
            ResourceSummaryDto,
        },
        registry::{
            ActionCapability, BrowseCapability, InspectCapability, SearchCapability,
            SearchContribution,
        },
    },
};
use futures_util::future::BoxFuture;
use serde_json::{Value, json};
use std::collections::HashSet;

const HERMES_DISPLAY_NAME: &str = "Hermes Sessions";
const KEY_PREFIX: &str = "v1:";

#[derive(Clone, Debug, Eq, PartialEq)]
enum HermesResourceAddress {
    Root,
    Archived,
    Project(String),
    Session(String),
}

impl HermesResourceAddress {
    fn kind(&self) -> &'static str {
        match self {
            Self::Root => "root",
            Self::Archived => "archived",
            Self::Project(_) => "project",
            Self::Session(_) => "session",
        }
    }

    fn opaque_id(&self) -> Option<&str> {
        match self {
            Self::Project(id) | Self::Session(id) => Some(id),
            Self::Root | Self::Archived => None,
        }
    }

    fn parts(&self) -> Option<(&'static str, &str)> {
        match self {
            Self::Project(id) => Some(("project", id)),
            Self::Session(id) => Some(("session", id)),
            Self::Root | Self::Archived => None,
        }
    }
}

fn encode_key(address: &HermesResourceAddress) -> ResourceKeyDto {
    let kind = address.kind();
    ResourceKeyDto::new(
        super::PROVIDER_ID,
        format!(
            "{KEY_PREFIX}{}:{kind}{}",
            kind.len(),
            address.opaque_id().unwrap_or_default()
        ),
    )
}

fn decode_key(key: &ResourceKeyDto) -> AppResult<HermesResourceAddress> {
    if key.provider != super::PROVIDER_ID {
        return Err(AppError::bad("Hermes resource provider is invalid"));
    }
    let encoded = key
        .id
        .strip_prefix(KEY_PREFIX)
        .ok_or_else(|| AppError::bad("Hermes resource id is invalid"))?;
    let (kind_length, value) = encoded
        .split_once(':')
        .ok_or_else(|| AppError::bad("Hermes resource id is invalid"))?;
    let kind_length = kind_length
        .parse::<usize>()
        .map_err(|_| AppError::bad("Hermes resource id is invalid"))?;
    if kind_length == 0 || kind_length > value.len() || !value.is_char_boundary(kind_length) {
        return Err(AppError::bad("Hermes resource id is invalid"));
    }
    let (kind, id) = value.split_at(kind_length);
    match (kind, id) {
        ("root", "") => Ok(HermesResourceAddress::Root),
        ("archived", "") => Ok(HermesResourceAddress::Archived),
        ("project", id) => Ok(HermesResourceAddress::Project(
            validate_opaque_id(id)?.into(),
        )),
        ("session", id) => Ok(HermesResourceAddress::Session(
            validate_opaque_id(id)?.into(),
        )),
        _ => Err(AppError::bad("Hermes resource id is invalid")),
    }
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

fn metadata(value: &Value) -> Option<std::collections::HashMap<String, Value>> {
    value
        .as_object()
        .cloned()
        .map(|object| object.into_iter().collect())
}

pub(crate) fn root_summary() -> ResourceSummaryDto {
    ResourceSummaryDto {
        key: encode_key(&HermesResourceAddress::Root),
        name: HERMES_DISPLAY_NAME.into(),
        kind: "hermes-root".into(),
        mime: None,
        capabilities: vec![
            "browse".into(),
            "hermes.createFile".into(),
            "hermes.createFolder".into(),
        ],
        presentation: Some("browse".into()),
        appearance: Some(ResourceAppearanceDto {
            icon: Some("agent-directory".into()),
            tone: Some("violet".into()),
            color: None,
        }),
        size: None,
        metadata: None,
    }
}

fn archived_summary() -> ResourceSummaryDto {
    ResourceSummaryDto {
        key: encode_key(&HermesResourceAddress::Archived),
        name: "Archived".into(),
        kind: "hermes-archived".into(),
        mime: None,
        capabilities: vec!["browse".into()],
        presentation: Some("browse".into()),
        appearance: Some(ResourceAppearanceDto {
            icon: Some("archive".into()),
            tone: Some("muted".into()),
            color: None,
        }),
        size: None,
        metadata: None,
    }
}

fn project_summary(value: &Value) -> AppResult<ResourceSummaryDto> {
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::internal("Hermes project omitted its id"))?;
    validate_opaque_id(id)
        .map_err(|_| AppError::internal("Hermes returned an invalid project id"))?;
    let name = value
        .get("name")
        .or_else(|| value.get("label"))
        .and_then(Value::as_str)
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("Untitled project")
        .to_string();
    Ok(ResourceSummaryDto {
        key: encode_key(&HermesResourceAddress::Project(id.into())),
        name,
        kind: "hermes-project".into(),
        mime: None,
        capabilities: [
            "browse",
            "hermes.createFile",
            "hermes.rename",
            "hermes.deleteProject",
            "hermes.addProjectFolder",
            "hermes.removeProjectFolder",
            "hermes.setPrimaryFolder",
            "hermes.setAppearance",
        ]
        .into_iter()
        .map(str::to_string)
        .collect(),
        presentation: Some("browse".into()),
        appearance: Some(ResourceAppearanceDto {
            icon: Some(
                value
                    .get("icon")
                    .and_then(Value::as_str)
                    .unwrap_or("project")
                    .into(),
            ),
            tone: Some("indigo".into()),
            color: value
                .get("color")
                .and_then(Value::as_str)
                .map(str::to_string),
        }),
        size: None,
        metadata: metadata(value),
    })
}

fn session_summary(value: &Value, archived: bool) -> AppResult<ResourceSummaryDto> {
    let id =
        session_id(value).ok_or_else(|| AppError::internal("Hermes session omitted its id"))?;
    validate_opaque_id(id)
        .map_err(|_| AppError::internal("Hermes returned an invalid session id"))?;
    let busy = value
        .get("is_active")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || value
            .get("pending_approval")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        || value
            .get("queued_prompt_count")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            > 0;
    let actions = if archived {
        vec!["restore", "deletePermanently", "download", "copyId"]
    } else if busy {
        vec!["rename", "download", "copyId"]
    } else {
        vec![
            "rename",
            "archive",
            "download",
            "copyId",
            "branch",
            "moveToProject",
        ]
    };
    let mut capabilities = vec!["read".into(), "hermes.open".into()];
    capabilities.extend(actions.into_iter().map(|action| format!("hermes.{action}")));
    let mut metadata = metadata(value).unwrap_or_default();
    metadata.insert("archived".into(), Value::Bool(archived));
    Ok(ResourceSummaryDto {
        key: encode_key(&HermesResourceAddress::Session(id.into())),
        name: session_title(value),
        kind: "hermes-session".into(),
        mime: None,
        capabilities,
        presentation: Some("hermes-session".into()),
        appearance: Some(ResourceAppearanceDto {
            icon: Some("agent-session".into()),
            tone: Some("violet".into()),
            color: None,
        }),
        size: None,
        metadata: Some(metadata),
    })
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

async fn load_session(hub: &dyn HermesTransport, id: &str) -> AppResult<Value> {
    let path = session_api_path(id, "")?;
    let mut query = Vec::new();
    if let Some(profile) = hub.profile() {
        query.push(("profile", profile.to_string()));
    }
    hub.get(&path, &query).await
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

async fn browse_typed(
    runtime: &HermesRuntime,
    request: BrowseRequest,
) -> AppResult<ResourcePageDto> {
    let address = decode_key(&request.key)?;
    let offset = request
        .cursor
        .as_deref()
        .unwrap_or("0")
        .parse::<usize>()
        .map_err(|_| AppError::bad("Browse cursor is invalid"))?;
    let limit = request.limit.clamp(1, 500);
    let hub = runtime.transport.as_ref();
    let root = root_summary();
    let (location_summary, breadcrumbs, items, total, next_cursor) = match address.clone() {
        HermesResourceAddress::Root => {
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
            let mut project_items = projects
                .iter()
                .map(project_summary)
                .collect::<AppResult<Vec<_>>>()?;
            project_items
                .sort_by(|left, right| natord::compare_ignore_case(&left.name, &right.name));
            project_items.push(archived_summary());
            let fixed_count = project_items.len();
            let sessions = flat_sessions(hub, false)
                .await?
                .into_iter()
                .filter(|session| session_id(session).is_some_and(|id| !assigned.contains(id)))
                .collect::<Vec<_>>();
            let total_sessions = sessions.len();
            for session in sessions.into_iter().skip(offset).take(limit) {
                project_items.push(session_summary(&session, false)?);
            }
            (
                root.clone(),
                Vec::new(),
                project_items,
                fixed_count + total_sessions,
                browse_next_cursor(offset, limit, total_sessions),
            )
        }
        HermesResourceAddress::Archived => {
            let sessions = flat_sessions(hub, true).await?;
            let total = sessions.len();
            let items = sessions
                .into_iter()
                .skip(offset)
                .take(limit)
                .map(|session| session_summary(&session, true))
                .collect::<AppResult<Vec<_>>>()?;
            (
                archived_summary(),
                vec![root.clone()],
                items,
                total,
                browse_next_cursor(offset, limit, total),
            )
        }
        HermesResourceAddress::Project(id) => {
            let project = projects(hub)
                .await?
                .into_iter()
                .find(|project| project.get("id").and_then(Value::as_str) == Some(&id))
                .ok_or_else(|| AppError::not_found("Hermes project not found"))?;
            let summary = project_summary(&project)?;
            let sessions = project_sessions(hub, &id).await?;
            let total = sessions.len();
            let items = sessions
                .into_iter()
                .skip(offset)
                .take(limit)
                .map(|session| session_summary(&session, false))
                .collect::<AppResult<Vec<_>>>()?;
            (
                summary,
                vec![root.clone()],
                items,
                total,
                browse_next_cursor(offset, limit, total),
            )
        }
        HermesResourceAddress::Session(_) => {
            return Err(AppError::bad("Hermes sessions are not browseable"));
        }
    };
    Ok(ResourcePageDto {
        schema_version: INTEGRATION_SCHEMA_VERSION,
        location: encode_key(&address),
        location_summary: Some(location_summary),
        breadcrumbs,
        items,
        recent_items: Vec::new(),
        next_cursor,
        total,
    })
}

fn browse_next_cursor(offset: usize, limit: usize, total: usize) -> Option<String> {
    offset
        .checked_add(limit)
        .filter(|next| *next < total)
        .map(|next| next.to_string())
}

impl BrowseCapability for HermesRuntime {
    fn browse<'a>(&'a self, request: BrowseRequest) -> BoxFuture<'a, AppResult<ResourcePageDto>> {
        Box::pin(browse_typed(self, request))
    }
}

impl InspectCapability for HermesRuntime {
    fn inspect<'a>(&'a self, key: ResourceKeyDto) -> BoxFuture<'a, AppResult<ResourceSummaryDto>> {
        Box::pin(async move {
            match decode_key(&key)? {
                HermesResourceAddress::Root => Ok(root_summary()),
                HermesResourceAddress::Archived => Ok(archived_summary()),
                HermesResourceAddress::Project(id) => {
                    let project = projects(self.transport.as_ref())
                        .await?
                        .into_iter()
                        .find(|project| {
                            project.get("id").and_then(Value::as_str) == Some(id.as_str())
                        })
                        .ok_or_else(|| AppError::not_found("Hermes project not found"))?;
                    project_summary(&project)
                }
                HermesResourceAddress::Session(id) => {
                    let session = load_session(self.transport.as_ref(), &id).await?;
                    let archived = session
                        .get("archived")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    session_summary(&session, archived)
                }
            }
        })
    }
}

impl SearchCapability for HermesRuntime {
    fn search<'a>(
        &'a self,
        request: IntegrationSearchRequest,
    ) -> BoxFuture<'a, AppResult<SearchContribution>> {
        Box::pin(async move {
            let needle = request.query.to_lowercase();
            let mut sessions = flat_sessions(self.transport.as_ref(), false).await?;
            sessions.extend(flat_sessions(self.transport.as_ref(), true).await?);
            let total_matches = sessions
                .iter()
                .filter(|session| session_title(session).to_lowercase().contains(&needle))
                .count();
            let mut results = Vec::new();
            for (index, session) in sessions
                .into_iter()
                .filter(|session| session_title(session).to_lowercase().contains(&needle))
                .take(request.limit)
                .enumerate()
            {
                let archived = session
                    .get("archived")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let resource = session_summary(&session, archived)?;
                results.push(IntegrationSearchResultDto {
                    id: format!("hermes.sessions:{}", resource.key.id),
                    contributor: "hermes.sessions".into(),
                    title: resource.name.clone(),
                    detail: archived.then(|| "Archived Hermes session".into()),
                    snippet: None,
                    score: 1.0 / (index + 1) as f64,
                    action: Some("hermes.open".into()),
                    resource,
                });
            }
            Ok(SearchContribution {
                truncated: total_matches > request.limit,
                results,
            })
        })
    }
}

struct ActionInput {
    action: String,
    name: Option<String>,
    metadata: Option<Value>,
}

fn action_data(data: Value) -> IntegrationActionOutcomeDto {
    IntegrationActionOutcomeDto {
        success: true,
        resource: None,
        open_target: None,
        data: Some(data),
    }
}

fn action_open_target(open_target: IntegrationOpenTargetDto) -> IntegrationActionOutcomeDto {
    IntegrationActionOutcomeDto {
        success: true,
        resource: None,
        open_target: Some(open_target),
        data: None,
    }
}

fn session_open_target(id: &str, read_only: bool) -> IntegrationActionOutcomeDto {
    action_open_target(IntegrationOpenTargetDto {
        kind: "hermes-session".into(),
        resource: Some(encode_key(&HermesResourceAddress::Session(id.into()))),
        read_only,
        payload: None,
    })
}

async fn action_target(
    runtime: &HermesRuntime,
    target: &HermesResourceAddress,
    body: ActionInput,
) -> AppResult<IntegrationActionOutcomeDto> {
    let hub = &runtime.transport;
    match (body.action.as_str(), target.parts()) {
        ("open", Some(("session", id))) => {
            let session = load_session(hub.as_ref(), id).await?;
            let archived = session
                .get("archived")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            Ok(session_open_target(id, archived))
        }
        ("download", Some(("session", id))) => {
            Ok(action_data(json!({"url":session_export_url(id)?})))
        }
        ("copyId", Some((_, id))) => Ok(action_data(json!({"text":id}))),
        ("createFile", _) => {
            let cwd = if let Some(("project", id)) = target.parts() {
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
            } else if matches!(target, HermesResourceAddress::Root) {
                None
            } else {
                return Err(AppError::bad(
                    "Sessions cannot be created in this directory",
                ));
            };
            Ok(action_open_target(IntegrationOpenTargetDto {
                kind: "hermes-draft".into(),
                resource: None,
                read_only: false,
                payload: Some(json!({"projectPath":cwd})),
            }))
        }
        ("createFolder", _) => {
            let _operation = runtime.project_operations.lock().await;
            if !matches!(target, HermesResourceAddress::Root) {
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
            Ok(action_data(
                hub.rpc(
                    "projects.create",
                    json!({"name":name,"primary_path":primary,"folders":folders}),
                )
                .await?,
            ))
        }
        ("rename", Some(("session", id))) => {
            let name = body
                .name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AppError::bad("Session title is required"))?;
            let path = session_api_path(id, "")?;
            Ok(action_data(
                hub.patch(&path, json!({"title":name,"profile":hub.profile()}))
                    .await?,
            ))
        }
        ("rename", Some(("project", id))) => {
            let _operation = runtime.project_operations.lock().await;
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
            Ok(action_data(
                hub.rpc("projects.update", json!({"id":id,"name":name}))
                    .await?,
            ))
        }
        ("branch", Some(("session", id))) => {
            let title = body
                .name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let path = session_api_path(id, "/fork")?;
            let result = hub
                .post(&path, json!({"title":title,"profile":hub.profile()}))
                .await?;
            let session = result.get("session").unwrap_or(&result);
            let fork_id = session
                .get("id")
                .or_else(|| session.get("session_id"))
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::internal("Hermes fork omitted session id"))?;
            validate_opaque_id(fork_id)
                .map_err(|_| AppError::internal("Hermes returned an invalid session id"))?;
            Ok(session_open_target(fork_id, false))
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
            Ok(action_data(
                hub.rpc(
                    "session.workspace.move",
                    json!({"session_key":id,"cwd":cwd,"profile":hub.profile()}),
                )
                .await?,
            ))
        }
        ("addProjectFolder", Some(("project", id))) => {
            let folder = body
                .name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AppError::bad("Gateway directory is required"))?;
            Ok(action_data(
                hub.rpc(
                    "projects.add_folder",
                    json!({"id":id,"path":folder,"is_primary":false}),
                )
                .await?,
            ))
        }
        ("removeProjectFolder", Some(("project", id))) => {
            let folder = body
                .name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AppError::bad("Gateway directory is required"))?;
            Ok(action_data(
                hub.rpc("projects.remove_folder", json!({"id":id,"path":folder}))
                    .await?,
            ))
        }
        ("setPrimaryFolder", Some(("project", id))) => {
            let folder = body
                .name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AppError::bad("Gateway directory is required"))?;
            Ok(action_data(
                hub.rpc("projects.set_primary", json!({"id":id,"path":folder}))
                    .await?,
            ))
        }
        ("setAppearance", Some(("project", id))) => {
            let metadata = body.metadata.unwrap_or(Value::Null);
            let icon = metadata.get("icon").and_then(Value::as_str).unwrap_or("");
            let color = metadata.get("color").and_then(Value::as_str).unwrap_or("");
            Ok(action_data(
                hub.rpc(
                    "projects.update",
                    json!({"id":id,"icon":icon,"color":color}),
                )
                .await?,
            ))
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
            let path = session_api_path(id, "")?;
            Ok(action_data(
                hub.patch(&path, json!({"archived":true,"profile":hub.profile()}))
                    .await?,
            ))
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
            let path = session_api_path(id, "")?;
            Ok(action_data(
                hub.patch(&path, json!({"archived":false,"profile":hub.profile()}))
                    .await?,
            ))
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
            let path = session_api_path(id, "")?;
            hub.delete(&path).await?;
            Ok(action_data(json!({"ok":true})))
        }
        ("deleteProject", Some(("project", id))) => {
            let _operation = runtime.project_operations.lock().await;
            Ok(action_data(
                hub.rpc("projects.delete", json!({"id":id})).await?,
            ))
        }
        _ => Err(AppError::bad("Unsupported Hermes action")),
    }
}

impl HermesRuntime {
    async fn perform_action(
        &self,
        request: IntegrationActionRequestDto,
    ) -> AppResult<IntegrationActionOutcomeDto> {
        let target = decode_key(&request.key)?;
        let action = request
            .action
            .strip_prefix("hermes.")
            .filter(|action| !action.is_empty() && !action.contains('.'))
            .ok_or_else(|| AppError::bad("Hermes action id must use the hermes namespace"))?
            .to_string();
        action_target(
            self,
            &target,
            ActionInput {
                action,
                name: request.name,
                metadata: request.metadata,
            },
        )
        .await
    }
}

impl ActionCapability for HermesRuntime {
    fn perform<'a>(
        &'a self,
        request: IntegrationActionRequestDto,
        _state: &'a crate::app::AppState,
    ) -> BoxFuture<'a, AppResult<IntegrationActionOutcomeDto>> {
        Box::pin(self.perform_action(request))
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

    fn fake_runtime() -> std::sync::Arc<HermesRuntime> {
        let transport: std::sync::Arc<dyn HermesTransport> = std::sync::Arc::new(FakeTransport {
            gets: Mutex::new(VecDeque::from([
                json!({"id":"session-1","archived":false}),
                json!({"id":"archived-1","archived":true}),
            ])),
            rpcs: Mutex::new(VecDeque::new()),
            queries: Mutex::new(Vec::new()),
        });
        HermesRuntime::new(
            crate::integrations::hermes::config::HermesConfig {
                gateway_url: url::Url::parse("http://127.0.0.1:4000/").unwrap(),
                token: None,
                profile: Some("test".into()),
                filesystem_mode: crate::integrations::hermes::config::HermesFilesystemMode::Upload,
                auto_start: false,
                home: None,
            },
            transport,
            tokio::sync::broadcast::channel(8).0,
            None,
        )
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
    fn typed_keys_are_opaque_and_upstream_ids_are_normalized() {
        let key = encode_key(&HermesResourceAddress::Session("abc-123".into()));
        assert_eq!(key.id, "v1:7:sessionabc-123");
        assert_eq!(
            decode_key(&key).unwrap(),
            HermesResourceAddress::Session("abc-123".into())
        );
        assert!(!key.id.contains(HERMES_DISPLAY_NAME));
        assert!(session_summary(&json!({"id":"bad/id"}), false).is_err());
        assert!(project_summary(&json!({"id":"bad/id","name":"Bad"})).is_err());
    }

    #[test]
    fn browse_cursor_overflow_has_no_next_page() {
        assert_eq!(browse_next_cursor(usize::MAX, 500, usize::MAX), None);
        assert_eq!(browse_next_cursor(20, 10, 31), Some("30".into()));
    }

    #[test]
    fn tree_session_collection_flattens_and_dedupes_at_boundary() {
        let value = json!({"repos":[{"groups":[{"sessions":[{"id":"one"},{"id":"two"}]}]}]});
        let mut rows = Vec::new();
        collect_tree_sessions(&value, &mut rows);
        assert_eq!(rows.len(), 2);
    }

    #[tokio::test]
    async fn typed_action_returns_open_target_and_rejects_unsupported_action() {
        let runtime = fake_runtime();
        let outcome = runtime
            .perform_action(IntegrationActionRequestDto {
                key: encode_key(&HermesResourceAddress::Root),
                action: "hermes.createFile".into(),
                name: None,
                metadata: None,
            })
            .await
            .unwrap();
        assert!(outcome.success);
        assert!(outcome.data.is_none());
        let target = outcome.open_target.unwrap();
        assert_eq!(target.kind, "hermes-draft");
        assert_eq!(target.payload, Some(json!({"projectPath":null})));

        let outcome = runtime
            .perform_action(IntegrationActionRequestDto {
                key: encode_key(&HermesResourceAddress::Session("session-1".into())),
                action: "hermes.open".into(),
                name: None,
                metadata: None,
            })
            .await
            .unwrap();
        assert!(outcome.data.is_none());
        let target = outcome.open_target.unwrap();
        assert_eq!(target.kind, "hermes-session");
        assert!(!target.read_only);
        assert_eq!(
            target.resource,
            Some(encode_key(&HermesResourceAddress::Session(
                "session-1".into()
            )))
        );

        let outcome = runtime
            .perform_action(IntegrationActionRequestDto {
                key: encode_key(&HermesResourceAddress::Session("archived-1".into())),
                action: "hermes.open".into(),
                name: None,
                metadata: None,
            })
            .await
            .unwrap();
        let target = outcome.open_target.unwrap();
        assert_eq!(target.kind, "hermes-session");
        assert!(target.read_only);

        let outcome = runtime
            .perform_action(IntegrationActionRequestDto {
                key: encode_key(&HermesResourceAddress::Session("session-1".into())),
                action: "hermes.download".into(),
                name: None,
                metadata: None,
            })
            .await
            .unwrap();
        assert!(outcome.open_target.is_none());
        assert_eq!(
            outcome.data,
            Some(json!({"url":session_export_url("session-1").unwrap()}))
        );

        let error = runtime
            .perform_action(IntegrationActionRequestDto {
                key: encode_key(&HermesResourceAddress::Root),
                action: "hermes.unsupported".into(),
                name: None,
                metadata: None,
            })
            .await
            .unwrap_err();
        assert_eq!(error.0, axum::http::StatusCode::BAD_REQUEST);

        for action in ["createFile", "open", "filesystem.createFile"] {
            let error = runtime
                .perform_action(IntegrationActionRequestDto {
                    key: encode_key(&HermesResourceAddress::Root),
                    action: action.into(),
                    name: None,
                    metadata: None,
                })
                .await
                .unwrap_err();
            assert_eq!(error.0, axum::http::StatusCode::BAD_REQUEST);
        }
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
        let transport: std::sync::Arc<dyn HermesTransport> = std::sync::Arc::new(FakeTransport {
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
        });
        let runtime = HermesRuntime::new(
            crate::integrations::hermes::config::HermesConfig {
                gateway_url: url::Url::parse("http://127.0.0.1:4000/").unwrap(),
                token: None,
                profile: Some("test".into()),
                filesystem_mode: crate::integrations::hermes::config::HermesFilesystemMode::Upload,
                auto_start: false,
                home: None,
            },
            transport,
            tokio::sync::broadcast::channel(8).0,
            None,
        );
        let listing = browse_typed(
            &runtime,
            BrowseRequest {
                key: encode_key(&HermesResourceAddress::Root),
                cursor: None,
                limit: 200,
            },
        )
        .await
        .unwrap();
        let names = listing
            .items
            .iter()
            .map(|resource| resource.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            ["Alpha", "Archived", "Auto repo session", "Detached"]
        );
        assert!(!names.contains(&"Inside"));
        assert!(!names.contains(&"Generated repo"));
        assert_eq!(listing.total, 4);
    }
}
