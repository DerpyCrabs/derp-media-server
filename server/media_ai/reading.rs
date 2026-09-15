use crate::{activity::sql_error, app::Shared, error::AppResult};
use axum::{Json, extract::State};
use serde_json::{Value, json};

pub(super) fn items(state: &Shared) -> AppResult<Vec<Value>> {
    let c = state.database.connection()?;
    let mut statement = c.prepare("SELECT path,state_json,updated_at,fingerprint FROM reader_state WHERE scope='admin' ORDER BY updated_at DESC LIMIT 256").map_err(sql_error)?;
    let saved = statement
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    let mut items = Vec::new();
    let recent = crate::app::timestamp_ms() as i64 - 30 * 86_400_000;
    for (path, raw, last_read, fingerprint) in saved {
        let Ok(position) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        let Ok(resolved) = crate::media::resolve(&state.config, &path) else {
            continue;
        };
        let kind = crate::media::media_type(&crate::media::extension(&resolved.full));
        if !["book", "pdf"].contains(&kind) {
            continue;
        }
        let Ok(metadata) = std::fs::metadata(&resolved.full) else {
            continue;
        };
        if !metadata.is_file()
            || crate::routes::reader_state::fingerprint(state, &path)
                .ok()
                .as_deref()
                != Some(&fingerprint)
        {
            continue;
        }
        let progress = position["progress"]
            .as_f64()
            .map(|value| value.clamp(0.0, 1.0));
        let started = progress.is_some_and(|value| value > 0.0)
            || position["chapterProgress"].as_f64().unwrap_or(0.0) > 0.0
            || position["pageIndex"].as_u64().unwrap_or(0) > 0
            || position["scrollTop"].as_f64().unwrap_or(0.0) > 0.0;
        if !started && last_read < recent {
            continue;
        }
        if super::catalog::hidden(&c, &path)? {
            continue;
        }
        items.push(json!({"path":path,"name":resolved.full.file_name().unwrap_or_default().to_string_lossy(),"type":kind,"size":metadata.len(),"isDirectory":false,"readingProgress":progress,"lastRead":last_read,"pageIndex":position["pageIndex"],"started":started,"previewKind":"text"}));
    }
    items.sort_by(|a, b| {
        let priority = |v: &Value| {
            (v["lastRead"].as_i64().unwrap_or(0) >= recent
                || v["started"] == true && v["readingProgress"].as_f64().unwrap_or(0.0) < 1.0)
                as u8
        };
        priority(b)
            .cmp(&priority(a))
            .then_with(|| b["lastRead"].as_i64().cmp(&a["lastRead"].as_i64()))
    });
    Ok(items)
}

pub(super) async fn home(State(state): State<Shared>) -> AppResult<Json<Value>> {
    let items = tokio::task::spawn_blocking(move || items(&state))
        .await
        .map_err(sql_error)??;
    Ok(Json(
        json!({"items":items.into_iter().take(12).collect::<Vec<_>>()}),
    ))
}

pub(super) async fn recommendations(State(state): State<Shared>) -> AppResult<Json<Value>> {
    let result = tokio::task::spawn_blocking(move || -> AppResult<Value> {
        let reading = items(&state)?;
        let mut picks = Vec::new();
        if state.config.media_ai.enabled {
            let c = state.database.connection()?;
            let mut st = c.prepare("SELECT item_json FROM media_rankings WHERE library_key=?1 AND score>=50 AND json_extract(item_json,'$.type') IN ('book','pdf') ORDER BY score DESC LIMIT 100").map_err(sql_error)?;
            let raw = st.query_map([&state.config.library_key], |r|r.get::<_,String>(0)).map_err(sql_error)?;
            for item in raw {
                if let Ok(value) = serde_json::from_str::<Value>(&item.map_err(sql_error)?) { picks.push(value); }
            }
        }
        let mut response = json!({"rows":[{"items":picks}]});
        super::catalog::filter_response(&state, &mut response)?;
        let mut picks = response["rows"][0]["items"].as_array().cloned().unwrap_or_default();
        for saved in reading.into_iter().rev() {
            let mut item = if let Some(index) = picks.iter().position(|v| v["path"] == saved["path"]) { picks.remove(index) } else { json!({}) };
            for (key,value) in saved.as_object().unwrap() { item[key] = value.clone(); }
            picks.insert(0,item);
        }
        picks.truncate(12);
        Ok(json!({"items":picks}))
    }).await.map_err(sql_error)??;
    Ok(Json(result))
}
