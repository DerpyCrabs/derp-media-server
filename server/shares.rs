use crate::{
    config::{Config, MediaRoot},
    error::{AppError, AppResult},
    media, state_db,
};
use aes_gcm::{
    Aes256Gcm, KeyInit,
    aead::{Aead, Generate, Nonce},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use scrypt::{Params, scrypt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Restrictions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_delete: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_upload: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_edit: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_upload_bytes: Option<f64>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Share {
    pub token: String,
    pub path: String,
    pub is_directory: bool,
    pub editable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passcode: Option<String>,
    pub created_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_relative_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub restrictions: Option<Restrictions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_taskbar_pins: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_layout_presets: Option<Value>,
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn key(config: &Config) -> [u8; 32] {
    static KEY: OnceLock<[u8; 32]> = OnceLock::new();
    *KEY.get_or_init(|| {
        let mut out = [0; 32];
        let params = Params::new(14, 8, 1).unwrap();
        scrypt(
            config
                .auth
                .password
                .as_deref()
                .unwrap_or("derp-media-server-default")
                .as_bytes(),
            b"derp-media-server-passcode-v1",
            &params,
            &mut out,
        )
        .unwrap();
        out
    })
}
fn encrypt(config: &Config, text: &str) -> String {
    let cipher = Aes256Gcm::new_from_slice(&key(config)).unwrap();
    let nonce = Nonce::<Aes256Gcm>::generate();
    let mut sealed = cipher.encrypt(&nonce, text.as_bytes()).unwrap();
    let tag = sealed.split_off(sealed.len() - 16);
    let mut data = nonce.to_vec();
    data.extend(tag);
    data.extend(sealed);
    URL_SAFE_NO_PAD.encode(data)
}
fn decrypt(config: &Config, text: &str) -> Option<String> {
    let data = URL_SAFE_NO_PAD.decode(text).ok()?;
    if data.len() < 28 {
        return None;
    }
    let mut sealed = data[28..].to_vec();
    sealed.extend_from_slice(&data[12..28]);
    let cipher = Aes256Gcm::new_from_slice(&key(config)).ok()?;
    let nonce = <&Nonce<Aes256Gcm>>::try_from(&data[..12]).ok()?;
    String::from_utf8(cipher.decrypt(nonce, sealed.as_ref()).ok()?).ok()
}
fn roots(config: &Config, runtime: &[MediaRoot]) -> Vec<MediaRoot> {
    let mut r = config.roots.clone();
    r.extend_from_slice(runtime);
    r
}

fn logical_path(root_count: usize, root: &MediaRoot, relative: &str) -> String {
    if root_count > 1 {
        if relative.is_empty() {
            root.name.clone()
        } else {
            format!("{}/{}", root.name, relative)
        }
    } else {
        relative.to_string()
    }
}

fn rewritten_share_path(path: &str, old_root: &str, new_root: &str) -> Option<String> {
    let path = path.replace('\\', "/").trim_matches('/').to_string();
    let old_root = old_root.replace('\\', "/").trim_matches('/').to_string();
    let new_root = new_root.replace('\\', "/").trim_matches('/').to_string();
    if old_root.is_empty() {
        return Some(if new_root.is_empty() || path.is_empty() {
            format!("{new_root}{path}")
        } else {
            format!("{new_root}/{path}")
        });
    }
    if path == old_root {
        return Some(new_root);
    }
    path.strip_prefix(&(old_root + "/")).map(|suffix| {
        if new_root.is_empty() {
            suffix.to_string()
        } else {
            format!("{new_root}/{suffix}")
        }
    })
}

fn rewrite_path_field(value: &mut Value, key: &str, old_root: &str, new_root: &str) {
    let Some(path) = value.get(key).and_then(Value::as_str) else {
        return;
    };
    if let Some(rewritten) = rewritten_share_path(path, old_root, new_root) {
        value[key] = Value::String(rewritten);
    }
}

fn rewrite_resource_target(value: &mut Value, old_root: &str, new_root: &str) {
    if let Some(target) = value.get_mut("resourceTarget") {
        rewrite_path_field(target, "legacyLocator", old_root, new_root);
    }
}

fn rewrite_source(value: &mut Value, old_root: &str, new_root: &str) {
    if let Some(source) = value.get_mut("source") {
        rewrite_path_field(source, "sharePath", old_root, new_root);
        rewrite_path_field(source, "rootPath", old_root, new_root);
    }
}

fn rewrite_pin(value: &mut Value, old_root: &str, new_root: &str) {
    rewrite_path_field(value, "path", old_root, new_root);
    rewrite_resource_target(value, old_root, new_root);
    rewrite_source(value, old_root, new_root);
}

fn rewrite_workspace_paths(share: &mut Share, old_root: &str, new_root: &str) {
    if old_root == new_root {
        return;
    }
    if let Some(pins) = share
        .workspace_taskbar_pins
        .as_mut()
        .and_then(Value::as_array_mut)
    {
        for pin in pins {
            rewrite_pin(pin, old_root, new_root);
        }
    }
    let Some(presets) = share
        .workspace_layout_presets
        .as_mut()
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    for preset in presets {
        let Some(snapshot) = preset.get_mut("snapshot") else {
            continue;
        };
        if let Some(windows) = snapshot.get_mut("windows").and_then(Value::as_array_mut) {
            for window in windows {
                rewrite_path_field(window, "iconPath", old_root, new_root);
                rewrite_resource_target(window, old_root, new_root);
                rewrite_source(window, old_root, new_root);
                if let Some(initial) = window.get_mut("initialState") {
                    rewrite_path_field(initial, "dir", old_root, new_root);
                    rewrite_path_field(initial, "viewing", old_root, new_root);
                }
            }
        }
        if let Some(pins) = snapshot
            .get_mut("pinnedTaskbarItems")
            .and_then(Value::as_array_mut)
        {
            for pin in pins {
                rewrite_pin(pin, old_root, new_root);
            }
        }
    }
}

fn persisted_root(
    config: &Config,
    all: &[MediaRoot],
    share: &Share,
) -> Option<(String, MediaRoot)> {
    let binding = state_db::share_source_aliases(
        &state_db::database(config),
        &config.library_key,
        share.source_id.as_deref(),
        share.root_id.as_deref(),
    );
    match binding {
        Ok(Some(binding)) => {
            let mut current = all.iter().filter(|root| {
                binding.configured_id.as_deref().is_some_and(|configured| {
                    root.id.strip_prefix("configured:") == Some(configured)
                }) || canonical_root_locator(&root.path)
                    .is_some_and(|locator| locator == binding.canonical_locator)
            });
            let direct = current.next().cloned();
            if current.next().is_some() {
                return None;
            }
            if let Some(root) = direct {
                return Some((binding.source_id, root));
            }
            if share.source_id.is_some() {
                return None;
            }
            let mut matches = all
                .iter()
                .filter(|root| binding.legacy_ids.iter().any(|alias| alias == &root.id));
            let root = matches.next()?.clone();
            if matches.next().is_some() {
                return None;
            }
            Some((binding.source_id, root))
        }
        Ok(None) if share.source_id.is_none() => {
            let root_id = share.root_id.as_deref()?;
            let mut matches = all.iter().filter(|root| root.id == root_id);
            let root = matches.next()?.clone();
            if matches.next().is_some() {
                return None;
            }
            Some((String::new(), root))
        }
        Ok(None) | Err(_) => None,
    }
}

pub fn read(config: &Config, runtime: &[MediaRoot]) -> Vec<Share> {
    let mut list = raw(config).unwrap_or_default();
    let all = roots(config, runtime);
    let mut repairs = Vec::new();
    for share in &mut list {
        let resolved = if let Some(relative) = share.root_relative_path.clone() {
            persisted_root(config, &all, share).map(|(source_id, root)| (source_id, root, relative))
        } else {
            media::resolve(config, runtime, &share.path)
                .ok()
                .and_then(|resolved| {
                    state_db::share_source_aliases(
                        &state_db::database(config),
                        &config.library_key,
                        None,
                        Some(&resolved.root.id),
                    )
                    .ok()
                    .flatten()
                    .map(|binding| (binding.source_id, resolved.root, resolved.relative))
                })
        };
        if let Some((source_id, root, relative)) = resolved {
            let path = logical_path(all.len(), &root, &relative);
            let old_path = share.path.clone();
            rewrite_workspace_paths(share, &old_path, &path);
            if !source_id.is_empty()
                && (share.source_id.as_deref() != Some(&source_id)
                    || share.root_id.as_deref() != Some(&root.id)
                    || share.root_relative_path.as_deref() != Some(&relative)
                    || share.path != path)
            {
                repairs.push((
                    share.token.clone(),
                    source_id.clone(),
                    root.id.clone(),
                    relative.clone(),
                    path.clone(),
                    share.workspace_taskbar_pins.clone(),
                    share.workspace_layout_presets.clone(),
                ));
            }
            share.source_id = (!source_id.is_empty()).then_some(source_id);
            share.root_id = Some(root.id);
            share.root_relative_path = Some(relative);
            share.path = path;
            share.unavailable = Some(false);
        } else if share.source_id.is_some()
            || (share.root_id.is_some() && share.root_relative_path.is_some())
        {
            share.unavailable = Some(true);
        }
        if let Some(p) = share.passcode.clone()
            && let Some(plain) = decrypt(config, &p)
        {
            share.passcode = Some(plain)
        }
    }
    for (token, source_id, root_id, relative, path, pins, presets) in repairs {
        let _ = state_db::repair_share_source(
            &state_db::database(config),
            &config.library_key,
            &token,
            &source_id,
            &root_id,
            &relative,
            &path,
            &pins,
            &presets,
        );
    }
    list
}

fn canonical_root_locator(path: &Path) -> Option<String> {
    crate::resources::canonical_filesystem_locator(path).ok()
}
fn raw(config: &Config) -> AppResult<Vec<Share>> {
    state_db::shares(&state_db::database(config), &config.library_key)
}
pub fn create(
    config: &Config,
    runtime: &[MediaRoot],
    path: String,
    is_directory: bool,
    editable: bool,
    restrictions: Option<Restrictions>,
) -> AppResult<Share> {
    let resolved = media::resolve(config, runtime, &path)?;
    let source_id = state_db::share_source_aliases(
        &state_db::database(config),
        &config.library_key,
        None,
        Some(&resolved.root.id),
    )?
    .map(|binding| binding.source_id);
    let plain = if config.auth.enabled {
        Some(passcode())
    } else {
        None
    };
    let mut share = Share {
        token: token(),
        path: path.clone(),
        is_directory,
        editable,
        passcode: plain.as_ref().map(|p| encrypt(config, p)),
        created_at: now_ms(),
        root_id: Some(resolved.root.id),
        source_id,
        root_relative_path: Some(resolved.relative),
        unavailable: None,
        restrictions: if editable { restrictions } else { None },
        used_bytes: None,
        workspace_taskbar_pins: None,
        workspace_layout_presets: None,
    };
    state_db::mutate_shares(&state_db::database(config), &config.library_key, |list| {
        list.push(share.clone());
        Ok(())
    })?;
    share.passcode = plain;
    Ok(share)
}
pub fn delete(config: &Config, token: &str) -> AppResult<bool> {
    state_db::mutate_shares(&state_db::database(config), &config.library_key, |list| {
        let len = list.len();
        list.retain(|share| share.token != token);
        Ok(len != list.len())
    })
}
pub fn update(
    config: &Config,
    runtime: &[MediaRoot],
    token: &str,
    editable: Option<bool>,
    restrictions: Option<Restrictions>,
) -> AppResult<Option<Share>> {
    let changed =
        state_db::mutate_shares(&state_db::database(config), &config.library_key, |list| {
            let Some(share) = list.iter_mut().find(|share| share.token == token) else {
                return Ok(false);
            };
            if let Some(value) = editable {
                share.editable = value;
            }
            if restrictions.is_some() {
                share.restrictions = restrictions;
            }
            Ok(true)
        })?;
    if !changed {
        return Ok(None);
    }
    Ok(read(config, runtime).into_iter().find(|s| s.token == token))
}
pub fn update_workspace(
    config: &Config,
    runtime: &[MediaRoot],
    token: &str,
    pins: Option<Value>,
    presets: Option<Value>,
) -> AppResult<Option<Share>> {
    let changed =
        state_db::mutate_shares(&state_db::database(config), &config.library_key, |list| {
            let Some(share) = list.iter_mut().find(|share| share.token == token) else {
                return Ok(false);
            };
            if let Some(value) = pins {
                share.workspace_taskbar_pins = Some(value);
            }
            if let Some(value) = presets {
                share.workspace_layout_presets = Some(value);
            }
            Ok(true)
        })?;
    if !changed {
        return Ok(None);
    }
    Ok(read(config, runtime)
        .into_iter()
        .find(|share| share.token == token))
}
pub fn add_used_bytes(config: &Config, token: &str, delta: i64) -> AppResult<bool> {
    state_db::mutate_shares(&state_db::database(config), &config.library_key, |list| {
        let Some(share) = list.iter_mut().find(|share| share.token == token) else {
            return Ok(false);
        };
        let current = share.used_bytes.unwrap_or(0);
        share.used_bytes = Some(if delta >= 0 {
            current.saturating_add(delta as u64)
        } else {
            current.saturating_sub(delta.unsigned_abs())
        });
        Ok(true)
    })
}
fn token() -> String {
    let mut b = [0; 16];
    rand::fill(&mut b);
    URL_SAFE_NO_PAD.encode(b)
}
fn passcode() -> String {
    let chars = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let mut b = [0; 6];
    rand::fill(&mut b);
    b.iter()
        .map(|x| chars[*x as usize % chars.len()] as char)
        .collect()
}
pub fn effective(s: &Share) -> Restrictions {
    let r = s.restrictions.clone().unwrap_or_default();
    Restrictions {
        allow_delete: Some(r.allow_delete.unwrap_or(true)),
        allow_upload: Some(r.allow_upload.unwrap_or(true)),
        allow_edit: Some(r.allow_edit.unwrap_or(true)),
        max_upload_bytes: Some(r.max_upload_bytes.unwrap_or(2.0 * 1024.0 * 1024.0 * 1024.0)),
    }
}
pub fn resolve_subpath(s: &Share, sub: &str) -> AppResult<String> {
    if !s.is_directory {
        return if sub.is_empty() || sub == "." {
            Ok(s.path.clone())
        } else {
            Err(AppError::forbidden("Path outside share boundary"))
        };
    }
    if sub.split(&['/', '\\'][..]).any(|x| x == "..") {
        return Err(AppError::forbidden("Path outside share boundary"));
    }
    let clean = sub
        .replace('\\', "/")
        .split('/')
        .filter(|segment| !segment.is_empty() && *segment != ".")
        .collect::<Vec<_>>()
        .join("/");
    Ok(if clean.is_empty() {
        s.path.clone()
    } else {
        format!("{}/{}", s.path.trim_end_matches('/'), clean)
    })
}

#[derive(Debug)]
pub(crate) struct AuthorizedSharePath {
    pub(crate) logical: String,
    pub(crate) resolved: media::ResolvedPath,
}

fn canonical_existing_ancestor(path: &Path) -> AppResult<PathBuf> {
    let mut candidate = path;
    loop {
        match fs::canonicalize(candidate) {
            Ok(canonical) => return Ok(canonical),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                candidate = candidate
                    .parent()
                    .ok_or_else(|| AppError::forbidden("Path outside share boundary"))?;
            }
            Err(_) => return Err(AppError::forbidden("Path outside share boundary")),
        }
    }
}

pub(crate) fn authorize_resolved_grant_path(
    root: &media::ResolvedPath,
    candidate: &media::ResolvedPath,
) -> AppResult<()> {
    if root.root.id != candidate.root.id || root.root.path != candidate.root.path {
        return Err(AppError::forbidden("Path outside share boundary"));
    }
    let canonical_root = fs::canonicalize(&root.full)
        .map_err(|_| AppError::forbidden("Path outside share boundary"))?;
    let canonical_candidate = canonical_existing_ancestor(&candidate.full)?;
    if !canonical_candidate.starts_with(&canonical_root) {
        return Err(AppError::forbidden("Path outside share boundary"));
    }
    Ok(())
}

pub(crate) fn authorize_grant_logical_path(
    config: &Config,
    runtime_roots: &[MediaRoot],
    grant_root: &str,
    candidate: &str,
) -> AppResult<media::ResolvedPath> {
    let root = media::resolve(config, runtime_roots, grant_root)?;
    let resolved = media::resolve(config, runtime_roots, candidate)?;
    authorize_resolved_grant_path(&root, &resolved)?;
    Ok(resolved)
}

pub(crate) fn resolve_authorized_subpath(
    config: &Config,
    runtime_roots: &[MediaRoot],
    share: &Share,
    subpath: &str,
) -> AppResult<AuthorizedSharePath> {
    let logical = resolve_subpath(share, subpath)?;
    let resolved = authorize_grant_logical_path(config, runtime_roots, &share.path, &logical)?;
    Ok(AuthorizedSharePath { logical, resolved })
}

type HmacSha = Hmac<Sha256>;
fn session_sign(config: &Config, token: &str, payload: &str) -> String {
    let secret = format!(
        "{}{}",
        token,
        config.auth.password.as_deref().unwrap_or("share-secret")
    );
    let mut mac = <HmacSha as hmac::KeyInit>::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(payload.as_bytes());
    URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
}
pub fn cookie_name(token: &str) -> String {
    format!("share_{}", &token[..token.len().min(8)])
}
pub fn session(config: &Config, token: &str) -> String {
    let ts = (now_ms() / 1000).to_string();
    format!("{}.{}", ts, session_sign(config, token, &ts))
}
pub fn authorized(
    config: &Config,
    s: &Share,
    cookies: &std::collections::HashMap<String, String>,
) -> bool {
    if s.passcode.is_none() {
        return true;
    }
    let Some(value) = cookies.get(&cookie_name(&s.token)) else {
        return false;
    };
    let Some((ts, sig)) = value.split_once('.') else {
        return false;
    };
    let expected = session_sign(config, &s.token, ts);
    sig.len() == expected.len()
        && subtle::ConstantTimeEq::ct_eq(sig.as_bytes(), expected.as_bytes()).into()
        && ts
            .parse::<u64>()
            .map(|x| (now_ms() / 1000).saturating_sub(x) <= 604800)
            .unwrap_or(false)
}
pub fn name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AuthConfig, FileSearchConfig, ImageOptimizationConfig};
    use std::{fs, path::PathBuf};

    fn root(id: &str, name: &str, path: PathBuf) -> MediaRoot {
        MediaRoot {
            id: id.into(),
            name: name.into(),
            path,
            editable_folders: Vec::new(),
            read_only: false,
            source: "config".into(),
            created_at: None,
        }
    }

    fn config(data_path: PathBuf, roots: Vec<MediaRoot>, legacy_key: &str) -> Config {
        Config {
            port: 3000,
            roots,
            library_key: legacy_key.into(),
            share_link_domain: None,
            auth: AuthConfig::default(),
            data_path: data_path.clone(),
            file_search: FileSearchConfig {
                enabled: false,
                index_path: data_path.join("search.sqlite"),
                watch_mode: "off".into(),
                max_recursive_watchers: 0,
                max_fs_concurrency: 1,
                reconcile_directories_per_second: 1,
            },
            image_optimization: ImageOptimizationConfig::default(),
            tls: None,
            hermes: None,
        }
    }

    fn directory_share(path: impl Into<String>) -> Share {
        Share {
            token: "grant".into(),
            path: path.into(),
            is_directory: true,
            editable: true,
            passcode: None,
            created_at: 0,
            root_id: None,
            source_id: None,
            root_relative_path: None,
            unavailable: None,
            restrictions: None,
            used_bytes: None,
            workspace_taskbar_pins: None,
            workspace_layout_presets: None,
        }
    }

    fn symlink_directory(target: &Path, link: &Path) -> bool {
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(target, link).unwrap();
            true
        }
        #[cfg(windows)]
        {
            match std::os::windows::fs::symlink_dir(target, link) {
                Ok(()) => true,
                Err(error)
                    if error.kind() == std::io::ErrorKind::PermissionDenied
                        || error.raw_os_error() == Some(1314) =>
                {
                    eprintln!("skipping symlink characterization: {error}");
                    false
                }
                Err(error) => panic!("failed to create directory symlink: {error}"),
            }
        }
    }

    #[test]
    fn grant_path_authorization_blocks_physical_escape_and_allows_missing_descendants() {
        let base = std::env::temp_dir().join(format!(
            "derp-share-physical-scope-{}",
            uuid::Uuid::new_v4()
        ));
        let media = base.join("media");
        let grant = media.join("Grant");
        let private = media.join("Private");
        fs::create_dir_all(&grant).unwrap();
        fs::create_dir_all(&private).unwrap();
        fs::write(private.join("secret.txt"), b"secret").unwrap();
        if !symlink_directory(&private, &grant.join("link")) {
            fs::remove_dir_all(base).unwrap();
            return;
        }
        let config = config(
            base.join("data"),
            vec![root("config:media", "Media", media)],
            "legacy",
        );
        let share = directory_share("Grant");

        assert_eq!(
            resolve_subpath(&share, "link/secret.txt").unwrap(),
            "Grant/link/secret.txt"
        );
        for escaped in ["link/secret.txt", "link/new.txt"] {
            let error = resolve_authorized_subpath(&config, &[], &share, escaped).unwrap_err();
            assert_eq!(error.0, axum::http::StatusCode::FORBIDDEN);
            assert!(error.1.contains("share boundary"));
        }
        let missing = resolve_authorized_subpath(&config, &[], &share, "new/child.txt").unwrap();
        assert_eq!(missing.logical, "Grant/new/child.txt");
        assert_eq!(missing.resolved.full, grant.join("new").join("child.txt"));

        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn workspace_path_rewrite_handles_root_count_changes_without_leading_slashes() {
        assert_eq!(
            rewritten_share_path("child.md", "", "Media"),
            Some("Media/child.md".into())
        );
        assert_eq!(
            rewritten_share_path("Media/child.md", "Media", ""),
            Some("child.md".into())
        );
        assert_eq!(
            rewritten_share_path("Other/child.md", "Media", "Cinema"),
            None
        );
    }

    #[test]
    fn share_recovers_when_configured_root_appears_after_identity_startup() {
        let base = std::env::temp_dir().join(format!(
            "derp-share-root-reconnect-{}",
            uuid::Uuid::new_v4()
        ));
        let media = base.join("media");
        let data_path = base.join("data");
        let mut config = config(
            data_path,
            vec![root("config:media", "Media", media.clone())],
            "legacy",
        );
        state_db::initialize(&config).unwrap();
        crate::resources::initialize_identity(&mut config).unwrap();

        fs::create_dir_all(media.join("Shared")).unwrap();
        let created = create(&config, &[], "Shared".into(), true, false, None).unwrap();
        let loaded = read(&config, &[])
            .into_iter()
            .find(|share| share.token == created.token)
            .unwrap();

        assert_eq!(loaded.unavailable, Some(false));
        assert!(loaded.source_id.is_some());
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn configured_source_edits_keep_persisted_share_available() {
        let base =
            std::env::temp_dir().join(format!("derp-share-source-compat-{}", uuid::Uuid::new_v4()));
        let data_path = base.join("data");
        let movies = base.join("movies");
        let shows = base.join("shows");
        fs::create_dir_all(movies.join("nested")).unwrap();
        fs::create_dir_all(&shows).unwrap();

        let mut initial = config(
            data_path.clone(),
            vec![
                root("config:movies", "Movies", movies.clone()),
                root("config:shows", "Shows", shows.clone()),
            ],
            "legacy-initial",
        );
        state_db::initialize(&initial).unwrap();
        crate::resources::initialize_identity(&mut initial).unwrap();
        let created = create(&initial, &[], "Movies/nested".into(), true, false, None).unwrap();
        let stable_source_id = created.source_id.clone().unwrap();
        let pin = serde_json::json!({
            "id":"pin", "path":"Movies/nested/child.md", "isDirectory":false,
            "title":"Child", "source":{
                "kind":"share", "token":created.token, "sharePath":"Movies/nested"
            },
            "resourceTarget":{
                "ref":{"libraryId":"library","resourceId":"child"},
                "legacyLocator":"Movies/nested/child.md"
            }
        });
        state_db::mutate_shares(
            &state_db::database(&initial),
            &initial.library_key,
            |shares| {
                let share = shares
                    .iter_mut()
                    .find(|share| share.token == created.token)
                    .unwrap();
                share.workspace_taskbar_pins = Some(serde_json::json!([pin.clone()]));
                share.workspace_layout_presets = Some(serde_json::json!([{
                    "id":"preset", "name":"Saved", "scope":format!("share:{}", created.token),
                    "snapshot":{
                        "windows":[{
                            "source":{
                                "kind":"share", "token":created.token,
                                "sharePath":"Movies/nested"
                            },
                            "iconPath":"Movies/nested/child.md",
                            "initialState":{
                                "dir":"Movies/nested", "viewing":"Movies/nested/child.md"
                            },
                            "resourceTarget":{
                                "ref":{"libraryId":"library","resourceId":"child"},
                                "legacyLocator":"Movies/nested/child.md"
                            }
                        }],
                        "pinnedTaskbarItems":[pin]
                    }
                }]));
                Ok(())
            },
        )
        .unwrap();

        let mut renamed = config(
            data_path.clone(),
            vec![
                root("config:shows", "Shows", shows),
                root("configured:cinema", "Cinema", movies.clone()),
            ],
            "legacy-renamed",
        );
        state_db::initialize(&renamed).unwrap();
        crate::resources::initialize_identity(&mut renamed).unwrap();
        let after_rename = read(&renamed, &[])
            .into_iter()
            .find(|share| share.token == created.token)
            .unwrap();
        assert_eq!(after_rename.path, "Cinema/nested");
        assert_eq!(after_rename.root_id.as_deref(), Some("configured:cinema"));
        assert_eq!(
            after_rename.source_id.as_deref(),
            Some(stable_source_id.as_str())
        );
        assert_eq!(after_rename.unavailable, Some(false));
        assert_eq!(
            after_rename.workspace_taskbar_pins.as_ref().unwrap()[0]["path"],
            "Cinema/nested/child.md"
        );
        assert_eq!(
            after_rename.workspace_taskbar_pins.as_ref().unwrap()[0]["source"]["sharePath"],
            "Cinema/nested"
        );
        assert_eq!(
            after_rename.workspace_layout_presets.as_ref().unwrap()[0]["snapshot"]["windows"][0]["resourceTarget"]
                ["legacyLocator"],
            "Cinema/nested/child.md"
        );
        assert_eq!(
            crate::workspace_persistence::share_pins(
                after_rename.workspace_taskbar_pins.as_ref().unwrap(),
                &after_rename.path,
                &after_rename.token,
            )
            .as_array()
            .unwrap()
            .len(),
            1
        );
        assert_eq!(
            crate::workspace_persistence::presets(
                after_rename.workspace_layout_presets.as_ref().unwrap(),
                Some((&after_rename.path, &after_rename.token)),
            )
            .as_array()
            .unwrap()
            .len(),
            1
        );
        let persisted = state_db::shares(&state_db::database(&renamed), &renamed.library_key)
            .unwrap()
            .into_iter()
            .find(|share| share.token == created.token)
            .unwrap();
        assert_eq!(persisted.path, "Cinema/nested");
        assert_eq!(persisted.root_id.as_deref(), Some("configured:cinema"));
        assert_eq!(
            persisted.source_id.as_deref(),
            Some(stable_source_id.as_str())
        );
        assert_eq!(
            persisted.workspace_taskbar_pins.as_ref().unwrap()[0]["path"],
            "Cinema/nested/child.md"
        );

        state_db::mutate_shares(
            &state_db::database(&renamed),
            &renamed.library_key,
            |shares| {
                shares
                    .iter_mut()
                    .find(|share| share.token == created.token)
                    .unwrap()
                    .source_id = None;
                Ok(())
            },
        )
        .unwrap();

        let mut changed_id = config(
            data_path,
            vec![root("configured:films", "Films", movies)],
            "legacy-changed-id",
        );
        state_db::initialize(&changed_id).unwrap();
        crate::resources::initialize_identity(&mut changed_id).unwrap();
        let after_id_change = read(&changed_id, &[])
            .into_iter()
            .find(|share| share.token == created.token)
            .unwrap();
        assert_eq!(after_id_change.path, "nested");
        assert_eq!(after_id_change.root_id.as_deref(), Some("configured:films"));
        assert_eq!(
            after_id_change.source_id.as_deref(),
            Some(stable_source_id.as_str())
        );
        assert_eq!(after_id_change.unavailable, Some(false));

        state_db::mutate_shares(
            &state_db::database(&changed_id),
            &changed_id.library_key,
            |shares| {
                shares
                    .iter_mut()
                    .find(|share| share.token == created.token)
                    .unwrap()
                    .source_id = Some("missing-source".into());
                Ok(())
            },
        )
        .unwrap();
        let missing_binding = read(&changed_id, &[])
            .into_iter()
            .find(|share| share.token == created.token)
            .unwrap();
        assert_eq!(missing_binding.unavailable, Some(true));

        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn stable_source_share_prefers_current_binding_over_reused_historical_root_id() {
        let base = std::env::temp_dir().join(format!(
            "derp-share-reused-source-alias-{}",
            uuid::Uuid::new_v4()
        ));
        let original = base.join("original");
        let added = base.join("added");
        fs::create_dir_all(original.join("Shared")).unwrap();
        fs::create_dir_all(&added).unwrap();

        let mut initial = config(
            base.join("data"),
            vec![root("config:foo", "Foo", original.clone())],
            original.to_str().unwrap(),
        );
        state_db::initialize(&initial).unwrap();
        crate::resources::initialize_identity(&mut initial).unwrap();
        let created = create(&initial, &[], "Shared".into(), true, false, None).unwrap();
        let stable_source_id = created.source_id.clone().unwrap();

        let mut changed = config(
            base.join("data"),
            vec![
                root("config:foo", "Foo", added.clone()),
                root("configured:a", "Bar", original.clone()),
            ],
            "changed",
        );
        state_db::initialize(&changed).unwrap();
        crate::resources::initialize_identity(&mut changed).unwrap();

        let restored = read(&changed, &[])
            .into_iter()
            .find(|share| share.token == created.token)
            .unwrap();
        assert_eq!(
            restored.source_id.as_deref(),
            Some(stable_source_id.as_str())
        );
        assert_eq!(restored.root_id.as_deref(), Some("configured:a"));
        assert_eq!(restored.path, "Bar/Shared");
        assert_eq!(restored.unavailable, Some(false));

        let mut reused_only = config(
            base.join("data"),
            vec![root("config:foo", "Foo", added)],
            "reused-only",
        );
        state_db::initialize(&reused_only).unwrap();
        crate::resources::initialize_identity(&mut reused_only).unwrap();
        let unavailable = read(&reused_only, &[])
            .into_iter()
            .find(|share| share.token == created.token)
            .unwrap();
        assert_eq!(
            unavailable.source_id.as_deref(),
            Some(stable_source_id.as_str())
        );
        assert_eq!(unavailable.root_id.as_deref(), Some("configured:a"));
        assert_eq!(unavailable.path, "Bar/Shared");
        assert_eq!(unavailable.unavailable, Some(true));

        fs::remove_dir_all(base).unwrap();
    }
}
