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
    path::Path,
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
pub fn read(config: &Config, runtime: &[MediaRoot]) -> Vec<Share> {
    let mut list = raw(config).unwrap_or_default();
    let all = roots(config, runtime);
    for share in &mut list {
        if let (Some(id), Some(rel)) = (&share.root_id, &share.root_relative_path) {
            if let Some(root) = all.iter().find(|r| &r.id == id) {
                share.path = if all.len() > 1 {
                    if rel.is_empty() {
                        root.name.clone()
                    } else {
                        format!("{}/{}", root.name, rel)
                    }
                } else {
                    rel.clone()
                };
                share.unavailable = Some(false)
            } else {
                share.unavailable = Some(true)
            }
        }
        if let Some(p) = share.passcode.clone()
            && let Some(plain) = decrypt(config, &p)
        {
            share.passcode = Some(plain)
        }
    }
    list
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
