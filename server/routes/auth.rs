use crate::{
    app::{Shared, all_roots, timestamp_ms},
    auth,
    config::Config,
    error::{AppError, AppResult},
};
use axum::{
    Json, Router,
    extract::{Request, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::{Value, json};
use std::collections::HashMap;
use tokio::sync::Mutex;

fn request_host(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-host")
        .or_else(|| headers.get(header::HOST))
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .unwrap_or("")
        .trim()
        .split(':')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn admin_domain_allowed(config: &Config, headers: &HeaderMap) -> bool {
    config
        .auth
        .admin_access_domains
        .as_ref()
        .is_none_or(|domains| {
            domains.is_empty()
                || domains
                    .iter()
                    .any(|domain| domain == &request_host(headers))
        })
}

async fn rate_limit(attempts: &Mutex<HashMap<String, (u32, u128)>>, key: String) -> bool {
    let now = timestamp_ms();
    let mut attempts = attempts.lock().await;
    let entry = attempts.entry(key).or_insert((0, now + 15 * 60 * 1000));
    if now > entry.1 {
        *entry = (1, now + 15 * 60 * 1000);
        return true;
    }
    if entry.0 >= 10 {
        return false;
    }
    entry.0 += 1;
    true
}

fn is_public_path(path: &str) -> bool {
    matches!(
        path,
        "/login"
            | "/login/"
            | "/share"
            | "/share/"
            | "/api/auth/config"
            | "/api/auth/login"
            | "/api/auth/logout"
    ) || path.starts_with("/share/")
        || path.starts_with("/api/share/")
}

pub async fn middleware(State(state): State<Shared>, request: Request, next: Next) -> Response {
    if !state.config.auth.enabled {
        return next.run(request).await;
    }
    let path = request.uri().path();
    let asset = path.starts_with("/@")
        || path.starts_with("/node_modules/")
        || path.starts_with("/src/")
        || path
            .rsplit('/')
            .next()
            .is_some_and(|name| name.contains('.') && !path.starts_with("/api/"));
    let public = asset || is_public_path(path);
    if public {
        return next.run(request).await;
    }
    let value = auth::cookie(request.headers(), auth::COOKIE);
    if auth::verify_session(&state.config, value.as_deref()) {
        if !admin_domain_allowed(&state.config, request.headers()) {
            return if path.starts_with("/api/") {
                (
                    StatusCode::FORBIDDEN,
                    Json(json!({"error":"Admin access not allowed from this domain"})),
                )
                    .into_response()
            } else {
                (StatusCode::FOUND, [(header::LOCATION, "/login")]).into_response()
            };
        }
        let mut response = next.run(request).await;
        if let Some(value) = auth::session(&state.config) {
            let secure = state.config.auth.secure_cookies.unwrap_or(!state.dev);
            let cookie = format!(
                "{}={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}{}",
                auth::COOKIE,
                value,
                state.config.auth.session_max_age_seconds.unwrap_or(604800),
                if secure { "; Secure" } else { "" }
            );
            if let Ok(value) = HeaderValue::from_str(&cookie) {
                response.headers_mut().append(header::SET_COOKIE, value);
            }
        }
        return response;
    }
    if path.starts_with("/api/") {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"Unauthorized"})),
        )
            .into_response()
    } else {
        (StatusCode::FOUND, [(header::LOCATION, "/login")]).into_response()
    }
}

async fn config(State(state): State<Shared>, headers: HeaderMap) -> AppResult<Json<Value>> {
    if state.config.auth.enabled
        && !auth::verify_session(
            &state.config,
            auth::cookie(&headers, auth::COOKIE).as_deref(),
        )
    {
        return Err(AppError(StatusCode::UNAUTHORIZED, "Unauthorized".into()));
    }
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
    Ok(Json(
        json!({"enabled":state.config.auth.enabled,"shareLinkDomain":state.config.share_link_domain,"editableFolders":editable,"mediaRoots":roots.iter().map(|root|json!({"id":root.id,"name":root.name,"editableFolders":root.editable_folders,"readOnly":root.read_only,"source":root.source})).collect::<Vec<_>>() }),
    ))
}

async fn login(
    State(state): State<Shared>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> AppResult<Response> {
    if !state.config.auth.enabled || state.config.auth.password.is_none() {
        return Err(AppError::bad("Auth not enabled"));
    }
    if !admin_domain_allowed(&state.config, &headers) {
        return Err(AppError::forbidden(
            "Admin access not allowed from this domain",
        ));
    }
    let ip = headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|value| value.to_str().ok())
        })
        .unwrap_or("unknown")
        .to_string();
    if !rate_limit(&state.login_attempts, ip).await {
        return Err(AppError(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many attempts. Try again in 15 minutes.".into(),
        ));
    }
    if !auth::verify_password(&state.config, body["password"].as_str().unwrap_or("")).await {
        return Err(AppError(
            StatusCode::UNAUTHORIZED,
            "Invalid password".into(),
        ));
    }
    let value = auth::session(&state.config).unwrap();
    let secure = state.config.auth.secure_cookies.unwrap_or(!state.dev);
    let cookie = format!(
        "{}={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}{}",
        auth::COOKIE,
        value,
        state.config.auth.session_max_age_seconds.unwrap_or(604800),
        if secure { "; Secure" } else { "" }
    );
    let mut response = Json(json!({"success":true})).into_response();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, HeaderValue::from_str(&cookie).unwrap());
    Ok(response)
}

async fn logout() -> Response {
    let mut response = Json(json!({"success":true})).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_static("auth_session=; Path=/; Max-Age=0"),
    );
    response
}

pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/auth/config", get(config))
        .route("/api/auth/login", post(login))
        .route("/api/auth/logout", post(logout))
}

#[cfg(test)]
mod tests {
    use super::is_public_path;

    #[test]
    fn public_routes_stop_at_namespace_boundaries() {
        for path in [
            "/login",
            "/login/",
            "/share",
            "/share/",
            "/share/token",
            "/share/token/workspace",
            "/api/auth/config",
            "/api/auth/login",
            "/api/auth/logout",
            "/api/share/token/info",
        ] {
            assert!(is_public_path(path), "expected public: {path}");
        }
        for path in [
            "/login/extra",
            "/shareevil",
            "/api/auth",
            "/api/auth/extra",
            "/api/share",
            "/api/shareevil/token",
        ] {
            assert!(!is_public_path(path), "expected protected: {path}");
        }
    }
}
