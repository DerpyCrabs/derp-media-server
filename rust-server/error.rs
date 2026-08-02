use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;
#[derive(Debug)]
pub struct AppError(pub StatusCode, pub String);
pub type AppResult<T> = Result<T, AppError>;
impl AppError {
    pub fn bad(s: impl Into<String>) -> Self {
        Self(StatusCode::BAD_REQUEST, s.into())
    }
    pub fn forbidden(s: impl Into<String>) -> Self {
        Self(StatusCode::FORBIDDEN, s.into())
    }
    pub fn not_found(s: impl Into<String>) -> Self {
        Self(StatusCode::NOT_FOUND, s.into())
    }
    pub fn conflict(s: impl Into<String>) -> Self {
        Self(StatusCode::CONFLICT, s.into())
    }
    pub fn internal(s: impl Into<String>) -> Self {
        Self(StatusCode::INTERNAL_SERVER_ERROR, s.into())
    }
    pub fn io(e: std::io::Error) -> Self {
        match e.kind() {
            std::io::ErrorKind::NotFound => Self::not_found(e.to_string()),
            std::io::ErrorKind::PermissionDenied => Self::forbidden(e.to_string()),
            _ => Self::internal(e.to_string()),
        }
    }
}
impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error":self.1}))).into_response()
    }
}
