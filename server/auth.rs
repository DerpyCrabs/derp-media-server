use crate::config::Config;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, KeyInit, Mac};
use scrypt::{Params, scrypt};
use sha2::Sha256;
use std::{
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};
use subtle::ConstantTimeEq;
type HmacSha256 = Hmac<Sha256>;
pub const COOKIE: &str = "auth_session";
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn sign(secret: &str, payload: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(payload.as_bytes());
    URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
}
pub fn verify_session(config: &Config, value: Option<&str>) -> bool {
    let Some(secret) = config.auth.password.as_deref() else {
        return false;
    };
    let Some(value) = value else { return false };
    let Some((payload, sig)) = value.split_once('.') else {
        return false;
    };
    let expected = sign(secret, payload);
    if sig.as_bytes().ct_eq(expected.as_bytes()).unwrap_u8() != 1 {
        return false;
    }
    payload
        .parse::<u64>()
        .map(|t| now().saturating_sub(t) <= config.auth.session_max_age_seconds.unwrap_or(604800))
        .unwrap_or(false)
}
pub fn session(config: &Config) -> Option<String> {
    let secret = config.auth.password.as_deref()?;
    let ts = now().to_string();
    Some(format!("{}.{}", ts, sign(secret, &ts)))
}
pub async fn verify_password(config: &Config, input: &str) -> bool {
    let Some(expected) = config.auth.password.clone() else {
        return false;
    };
    if input.is_empty() {
        return false;
    }
    let input = input.to_string();
    tokio::task::spawn_blocking(move || verify_password_blocking(&expected, &input))
        .await
        .unwrap_or(false)
}

fn verify_password_blocking(expected: &str, input: &str) -> bool {
    let params = Params::new(14, 8, 1).unwrap();
    let mut input_hash = [0_u8; 64];
    if scrypt(
        input.as_bytes(),
        b"derp-media-server",
        &params,
        &mut input_hash,
    )
    .is_err()
    {
        return false;
    }
    static EXPECTED: OnceLock<[u8; 64]> = OnceLock::new();
    let expected_hash = EXPECTED.get_or_init(|| {
        let mut output = [0_u8; 64];
        scrypt(
            expected.as_bytes(),
            b"derp-media-server",
            &params,
            &mut output,
        )
        .expect("valid scrypt parameters");
        output
    });
    input_hash.ct_eq(expected_hash).unwrap_u8() == 1
}
pub fn cookie(headers: &axum::http::HeaderMap, name: &str) -> Option<String> {
    headers
        .get(axum::http::header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|p| {
            let (k, v) = p.trim().split_once('=')?;
            (k == name).then(|| v.to_string())
        })
}
