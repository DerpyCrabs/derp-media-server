use crate::{
    config::Config,
    error::{AppError, AppResult},
    logical_path,
    store::DocumentStore,
};
use rusqlite::Transaction;
use serde_json::{Value, json};
use std::collections::HashSet;

const KIND: &str = "settings";

fn defaults() -> Value {
    json!({
        "viewModes": {},
        "sortOrders": {},
        "fileColumns": {
            "media": {"createdDate": false, "size": true, "favorite": true, "views": true},
            "workspace": {"createdDate": false, "size": true, "favorite": false, "views": false}
        },
        "favorites": [],
        "knowledgeBases": [],
        "customIcons": {},
        "autoSave": {},
        "workspaceTaskbarPins": [],
        "workspaceTransition": "fade"
    })
}

pub(crate) fn canonical_document(mut value: Value) -> AppResult<Value> {
    let default = defaults();
    let object = value
        .as_object_mut()
        .ok_or_else(|| AppError::internal("Invalid settings document"))?;
    for (key, field_default) in default.as_object().into_iter().flatten() {
        object
            .entry(key.clone())
            .or_insert_with(|| field_default.clone());
    }
    let columns = object
        .get("fileColumns")
        .and_then(Value::as_object)
        .ok_or_else(|| AppError::internal("Invalid settings field: fileColumns"))?;
    let legacy_columns = columns.get("size").and_then(Value::as_bool).is_some();
    if legacy_columns {
        let created_date = columns
            .get("createdDate")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let size = columns.get("size").and_then(Value::as_bool).unwrap_or(true);
        object["fileColumns"] = json!({
            "media": {"createdDate": created_date, "size": size, "favorite": true, "views": true},
            "workspace": {"createdDate": created_date, "size": size, "favorite": false, "views": false}
        });
    } else {
        let columns = object["fileColumns"]
            .as_object_mut()
            .ok_or_else(|| AppError::internal("Invalid settings field: fileColumns"))?;
        for scope in ["media", "workspace"] {
            let scope_default = default["fileColumns"][scope].clone();
            let scope_columns = columns
                .entry(scope)
                .or_insert(scope_default.clone())
                .as_object_mut()
                .ok_or_else(|| AppError::internal("Invalid settings field: fileColumns"))?;
            for (key, field_default) in scope_default.as_object().into_iter().flatten() {
                scope_columns
                    .entry(key.clone())
                    .or_insert_with(|| field_default.clone());
            }
        }
    }
    Ok(value)
}

#[derive(Clone, Debug)]
pub(crate) struct SettingsRepository {
    store: DocumentStore,
}

#[derive(Clone, Debug)]
pub(crate) enum SettingsCommand {
    SetViewMode {
        path: String,
        view_mode: String,
    },
    SetSortOrder {
        path: String,
        field: String,
        direction: String,
    },
    SetFileColumns {
        scope: String,
        created_date: bool,
        size: bool,
        favorite: bool,
        views: bool,
    },
    ToggleFavorite {
        path: String,
    },
    ToggleKnowledgeBase {
        path: String,
    },
    SetIcon {
        path: String,
        icon: String,
    },
    RemoveIcon {
        path: Option<String>,
    },
    SetAutoSave {
        path: String,
        enabled: bool,
        read_only: Option<bool>,
    },
    UpsertTaskbarPin {
        candidate: Value,
    },
    RemoveTaskbarPin {
        id: String,
    },
    ReorderTaskbarPins {
        ids: Vec<String>,
    },
    SetWorkspaceTransition {
        transition: String,
    },
}

impl SettingsRepository {
    pub fn from_config(config: &Config) -> Self {
        Self {
            store: DocumentStore::from_config(config),
        }
    }

    #[cfg(test)]
    pub(crate) fn from_store(store: DocumentStore) -> Self {
        Self { store }
    }

    pub fn read(&self) -> AppResult<Value> {
        canonical_document(self.store.read(KIND, defaults())?)
    }

    pub fn admin_view(&self) -> AppResult<Value> {
        let value = self.read()?;
        let mut result = serde_json::Map::new();
        for key in [
            "viewModes",
            "sortOrders",
            "fileColumns",
            "favorites",
            "knowledgeBases",
            "customIcons",
            "autoSave",
            "workspaceTransition",
        ] {
            result.insert(key.into(), value[key].clone());
        }
        result.insert(
            "workspaceTaskbarPins".into(),
            value["workspaceTaskbarPins"].clone(),
        );
        Ok(Value::Object(result))
    }

    pub fn favorites(&self) -> AppResult<Vec<String>> {
        string_list(&self.read()?["favorites"], "favorites")
    }

    pub fn knowledge_bases(&self) -> AppResult<Vec<String>> {
        string_list(&self.read()?["knowledgeBases"], "knowledgeBases")
    }

    pub fn execute(&self, command: SettingsCommand) -> AppResult<Value> {
        self.update(|settings| apply_command(settings, command))
    }

    pub fn move_paths_in_transaction(
        &self,
        transaction: &Transaction<'_>,
        old_path: &str,
        new_path: &str,
    ) -> AppResult<()> {
        self.update_in_transaction(transaction, |settings| {
            move_settings_paths(settings, old_path, new_path);
            Ok(())
        })
    }

    pub fn remove_paths_in_transaction(
        &self,
        transaction: &Transaction<'_>,
        path: &str,
    ) -> AppResult<()> {
        self.update_in_transaction(transaction, |settings| {
            remove_settings_paths(settings, path);
            Ok(())
        })
    }

    fn update<T>(&self, update: impl FnOnce(&mut Value) -> AppResult<T>) -> AppResult<T> {
        self.store.update(KIND, defaults(), |value| {
            *value = canonical_document(value.take())?;
            let result = update(value)?;
            Ok(result)
        })
    }

    fn update_in_transaction<T>(
        &self,
        transaction: &Transaction<'_>,
        update: impl FnOnce(&mut Value) -> AppResult<T>,
    ) -> AppResult<T> {
        self.store
            .update_in_transaction(transaction, KIND, defaults(), |value| {
                *value = canonical_document(value.take())?;
                let result = update(value)?;
                Ok(result)
            })
    }
}

fn string_list(value: &Value, field: &str) -> AppResult<Vec<String>> {
    value
        .as_array()
        .ok_or_else(|| AppError::internal(format!("Invalid settings field: {field}")))?
        .iter()
        .map(|item| {
            item.as_str()
                .map(str::to_owned)
                .ok_or_else(|| AppError::internal(format!("Invalid settings field: {field}")))
        })
        .collect()
}

fn apply_command(settings: &mut Value, command: SettingsCommand) -> AppResult<Value> {
    match command {
        SettingsCommand::SetViewMode { path, view_mode } => {
            if !["list", "grid"].contains(&view_mode.as_str()) {
                return Err(AppError::bad("Invalid view mode"));
            }
            settings["viewModes"][path] = json!(view_mode);
            Ok(json!({"success":true}))
        }
        SettingsCommand::SetSortOrder {
            path,
            field,
            direction,
        } => {
            if !["name", "createdDate", "size", "favorite", "views"].contains(&field.as_str()) {
                return Err(AppError::bad("Invalid sort field"));
            }
            if !["asc", "desc"].contains(&direction.as_str()) {
                return Err(AppError::bad("Invalid sort direction"));
            }
            settings["sortOrders"][path] = json!({"field":field,"direction":direction});
            Ok(json!({"success":true}))
        }
        SettingsCommand::SetFileColumns {
            scope,
            created_date,
            size,
            favorite,
            views,
        } => {
            if !["media", "workspace"].contains(&scope.as_str()) {
                return Err(AppError::bad("Invalid file column scope"));
            }
            settings["fileColumns"][scope] = json!({
                "createdDate":created_date,
                "size":size,
                "favorite":favorite,
                "views":views
            });
            Ok(json!({"success":true}))
        }
        SettingsCommand::ToggleFavorite { path } => {
            let (added, items) = toggle_string(&mut settings["favorites"], &path, "favorites")?;
            Ok(json!({"success":true,"isFavorite":added,"favorites":items}))
        }
        SettingsCommand::ToggleKnowledgeBase { path } => {
            let (added, items) =
                toggle_string(&mut settings["knowledgeBases"], &path, "knowledgeBases")?;
            Ok(json!({"success":true,"isKnowledgeBase":added,"knowledgeBases":items}))
        }
        SettingsCommand::SetIcon { path, icon } => {
            if icon.is_empty() {
                return Err(AppError::bad("Valid icon name is required"));
            }
            settings["customIcons"][path] = json!(icon);
            Ok(json!({"success":true,"customIcons":settings["customIcons"]}))
        }
        SettingsCommand::RemoveIcon { path } => {
            if let (Some(items), Some(path)) = (settings["customIcons"].as_object_mut(), path) {
                items.remove(&path);
            }
            Ok(json!({"success":true,"customIcons":settings["customIcons"]}))
        }
        SettingsCommand::SetAutoSave {
            path,
            enabled,
            read_only,
        } => {
            if path.is_empty() {
                return Err(AppError::bad("File path is required"));
            }
            let mut setting = json!({"enabled":enabled});
            if let Some(read_only) = read_only {
                setting["readOnly"] = json!(read_only);
            }
            settings["autoSave"][path] = setting;
            Ok(json!({"success":true,"autoSave":settings["autoSave"]}))
        }
        SettingsCommand::UpsertTaskbarPin { candidate } => {
            validate_taskbar_pin(&candidate)?;
            let pin = candidate;
            let pins = upsert_taskbar_pin(settings, pin)?;
            Ok(json!({"success":true,"workspaceTaskbarPins":pins}))
        }
        SettingsCommand::RemoveTaskbarPin { id } => {
            let pins = remove_taskbar_pin(settings, &id)?;
            Ok(json!({"success":true,"workspaceTaskbarPins":pins}))
        }
        SettingsCommand::ReorderTaskbarPins { ids } => {
            let pins = reorder_taskbar_pins(settings, &ids)?;
            Ok(json!({"success":true,"workspaceTaskbarPins":pins}))
        }
        SettingsCommand::SetWorkspaceTransition { transition } => {
            if !["instant", "fade"].contains(&transition.as_str()) {
                return Err(AppError::bad("Invalid workspace transition"));
            }
            settings["workspaceTransition"] = Value::String(transition.clone());
            Ok(json!({"success":true,"workspaceTransition":transition}))
        }
    }
}

fn toggle_string(value: &mut Value, path: &str, field: &str) -> AppResult<(bool, Value)> {
    let items = value
        .as_array_mut()
        .ok_or_else(|| AppError::internal(format!("Invalid settings field: {field}")))?;
    let index = items.iter().position(|item| item == path);
    if let Some(index) = index {
        items.remove(index);
    } else {
        items.push(json!(path));
    }
    Ok((index.is_none(), Value::Array(items.clone())))
}

fn validate_taskbar_pin(pin: &Value) -> AppResult<()> {
    let valid = pin["id"].as_str().is_some_and(|value| !value.is_empty())
        && pin["path"].as_str().is_some_and(|value| !value.is_empty())
        && pin["isDirectory"].is_boolean()
        && pin["title"].is_string()
        && pin["source"]["kind"].as_str() == Some("local")
        && (pin["source"]["rootPath"].is_null() || pin["source"]["rootPath"].is_string());
    if valid {
        Ok(())
    } else {
        Err(AppError::bad("Invalid taskbar pin"))
    }
}

fn taskbar_pins_mut(value: &mut Value) -> AppResult<&mut Vec<Value>> {
    value["workspaceTaskbarPins"]
        .as_array_mut()
        .ok_or_else(|| AppError::internal("Invalid workspace taskbar pins settings"))
}

fn upsert_taskbar_pin(value: &mut Value, mut pin: Value) -> AppResult<Value> {
    let id = pin["id"]
        .as_str()
        .ok_or_else(|| AppError::bad("Taskbar pin id is required"))?;
    let pins = taskbar_pins_mut(value)?;
    if let Some(index) = pins.iter().position(|item| item["id"] == id) {
        pin["id"] = pins[index]["id"].clone();
        pins[index] = pin;
    } else {
        pins.push(pin);
    }
    Ok(Value::Array(pins.clone()))
}

fn remove_taskbar_pin(value: &mut Value, id: &str) -> AppResult<Value> {
    if id.is_empty() {
        return Err(AppError::bad("Taskbar pin id is required"));
    }
    let pins = taskbar_pins_mut(value)?;
    pins.retain(|pin| pin["id"].as_str() != Some(id));
    Ok(Value::Array(pins.clone()))
}

fn reorder_taskbar_pins(value: &mut Value, ids: &[String]) -> AppResult<Value> {
    let requested: HashSet<&str> = ids.iter().map(String::as_str).collect();
    if requested.len() != ids.len() {
        return Err(AppError::bad("Taskbar pin order contains duplicate ids"));
    }
    let pins = taskbar_pins_mut(value)?;
    let mut remaining = std::mem::take(pins);
    for id in ids {
        if let Some(index) = remaining
            .iter()
            .position(|pin| pin["id"].as_str() == Some(id))
        {
            pins.push(remaining.remove(index));
        }
    }
    pins.extend(remaining);
    Ok(Value::Array(pins.clone()))
}

fn move_map(value: &mut Value, old_path: &str, new_path: &str) {
    if let Some(map) = value.as_object_mut() {
        logical_path::move_map_keys(map, old_path, new_path);
    }
}

fn remove_map(value: &mut Value, path: &str) {
    if let Some(map) = value.as_object_mut() {
        map.retain(|key, _| !logical_path::matches(key, path));
    }
}

fn move_list(value: &mut Value, old_path: &str, new_path: &str) {
    if let Some(items) = value.as_array_mut() {
        for item in items {
            logical_path::rewrite_value(item, old_path, new_path);
        }
    }
}

fn remove_list(value: &mut Value, path: &str) {
    if let Some(items) = value.as_array_mut() {
        items.retain(|item| {
            !item
                .as_str()
                .is_some_and(|item| logical_path::matches(item, path))
        });
    }
}

fn move_taskbar_pins(value: &mut Value, old_path: &str, new_path: &str) {
    if let Some(pins) = value.as_array_mut() {
        for pin in pins {
            if let Some(path) = pin.get_mut("path") {
                logical_path::rewrite_value(path, old_path, new_path);
            }
            if pin["source"]["kind"] == "local"
                && let Some(root_path) = pin
                    .get_mut("source")
                    .and_then(Value::as_object_mut)
                    .and_then(|source| source.get_mut("rootPath"))
            {
                logical_path::rewrite_value(root_path, old_path, new_path);
            }
        }
    }
}

fn remove_taskbar_paths(value: &mut Value, path: &str) {
    if let Some(pins) = value.as_array_mut() {
        pins.retain_mut(|pin| {
            if pin["path"]
                .as_str()
                .is_some_and(|value| logical_path::matches(value, path))
            {
                return false;
            }
            if pin["source"]["kind"] == "local"
                && pin["source"]["rootPath"]
                    .as_str()
                    .is_some_and(|value| logical_path::matches(value, path))
            {
                pin["source"]["rootPath"] = Value::Null;
            }
            true
        });
    }
}

fn move_settings_paths(settings: &mut Value, old_path: &str, new_path: &str) {
    for key in ["viewModes", "sortOrders", "customIcons", "autoSave"] {
        move_map(&mut settings[key], old_path, new_path);
    }
    for key in ["favorites", "knowledgeBases"] {
        move_list(&mut settings[key], old_path, new_path);
    }
    move_taskbar_pins(&mut settings["workspaceTaskbarPins"], old_path, new_path);
}

fn remove_settings_paths(settings: &mut Value, path: &str) {
    for key in ["viewModes", "sortOrders", "customIcons", "autoSave"] {
        remove_map(&mut settings[key], path);
    }
    for key in ["favorites", "knowledgeBases"] {
        remove_list(&mut settings[key], path);
    }
    remove_taskbar_paths(&mut settings["workspaceTaskbarPins"], path);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pin(id: &str) -> Value {
        json!({
            "id": id,
            "path": format!("Documents/{id}.txt"),
            "isDirectory": false,
            "title": id,
            "source": {"kind": "local"}
        })
    }

    #[test]
    fn canonical_settings_fill_missing_fields() {
        let completed = canonical_document(json!({
            "viewModes": {},
            "fileColumns": {"size": false},
        }))
        .unwrap();
        assert_eq!(completed["sortOrders"], json!({}));
        assert_eq!(
            completed["fileColumns"],
            json!({
                "media": {"createdDate":false,"size":false,"favorite":true,"views":true},
                "workspace": {"createdDate":false,"size":false,"favorite":false,"views":false}
            })
        );
    }

    #[test]
    fn file_columns_are_scoped_between_media_and_workspace() {
        let mut settings = defaults();
        let original_media = settings["fileColumns"]["media"].clone();
        apply_command(
            &mut settings,
            SettingsCommand::SetFileColumns {
                scope: "workspace".into(),
                created_date: true,
                size: false,
                favorite: true,
                views: true,
            },
        )
        .unwrap();

        assert_eq!(settings["fileColumns"]["media"], original_media);
        assert_eq!(
            settings["fileColumns"]["workspace"],
            json!({"createdDate":true,"size":false,"favorite":true,"views":true})
        );
    }

    #[test]
    fn taskbar_pin_commands_compose_without_replacing_concurrent_changes() {
        let mut settings = defaults();
        apply_command(
            &mut settings,
            SettingsCommand::UpsertTaskbarPin {
                candidate: pin("first"),
            },
        )
        .unwrap();
        apply_command(
            &mut settings,
            SettingsCommand::UpsertTaskbarPin {
                candidate: pin("second"),
            },
        )
        .unwrap();
        apply_command(
            &mut settings,
            SettingsCommand::RemoveTaskbarPin { id: "first".into() },
        )
        .unwrap();
        assert_eq!(settings["workspaceTaskbarPins"], json!([pin("second")]));
    }

    #[test]
    fn taskbar_pin_reorder_preserves_unmentioned_concurrent_pins() {
        let mut settings = defaults();
        settings["workspaceTaskbarPins"] = json!([pin("first"), pin("second"), pin("third")]);
        apply_command(
            &mut settings,
            SettingsCommand::ReorderTaskbarPins {
                ids: vec!["second".into(), "first".into()],
            },
        )
        .unwrap();
        assert_eq!(
            settings["workspaceTaskbarPins"],
            json!([pin("second"), pin("first"), pin("third")])
        );
    }

    #[test]
    fn stable_id_is_the_only_taskbar_pin_identity() {
        let mut settings = defaults();
        apply_command(
            &mut settings,
            SettingsCommand::UpsertTaskbarPin {
                candidate: pin("first"),
            },
        )
        .unwrap();
        let mut duplicate = pin("second");
        duplicate["path"] = settings["workspaceTaskbarPins"][0]["path"].clone();
        apply_command(
            &mut settings,
            SettingsCommand::UpsertTaskbarPin {
                candidate: duplicate.clone(),
            },
        )
        .unwrap();
        assert_eq!(
            settings["workspaceTaskbarPins"],
            json!([pin("first"), duplicate])
        );
    }

    #[test]
    fn path_commands_rewrite_all_settings_paths_with_shared_semantics() {
        let mut settings = defaults();
        settings["favorites"] = json!(["Books/Old/note.md"]);
        settings["knowledgeBases"] = json!(["Books/Old"]);
        settings["sortOrders"]["Books/Old"] = json!({"field":"name"});
        settings["workspaceTaskbarPins"] = json!([{
            "id":"pin",
            "path":"Books/Old/note.md",
            "isDirectory":false,
            "title":"Note",
            "source":{"kind":"local","rootPath":"Books/Old"}
        }]);

        move_settings_paths(&mut settings, "Books\\Old", "Books/New/");

        assert_eq!(settings["favorites"], json!(["Books/New/note.md"]));
        assert_eq!(settings["knowledgeBases"], json!(["Books/New"]));
        assert!(settings["sortOrders"].get("Books/New").is_some());
        assert_eq!(
            settings["workspaceTaskbarPins"][0]["path"],
            "Books/New/note.md"
        );
        assert_eq!(
            settings["workspaceTaskbarPins"][0]["source"]["rootPath"],
            "Books/New"
        );

        remove_settings_paths(&mut settings, "Books/New");
        assert!(settings["favorites"].as_array().unwrap().is_empty());
        assert!(
            settings["workspaceTaskbarPins"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }
}
