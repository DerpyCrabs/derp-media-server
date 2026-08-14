use crate::contracts::{ApiErrorBody, ApiErrorCode, ReconciliationDetails};
use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
#[derive(Debug)]
pub struct AppError(
    pub StatusCode,
    pub String,
    pub Option<ReconciliationDetails>,
);
pub type AppResult<T> = Result<T, AppError>;
impl AppError {
    pub fn bad(s: impl Into<String>) -> Self {
        Self(StatusCode::BAD_REQUEST, s.into(), None)
    }
    pub fn forbidden(s: impl Into<String>) -> Self {
        Self(StatusCode::FORBIDDEN, s.into(), None)
    }
    pub fn not_found(s: impl Into<String>) -> Self {
        Self(StatusCode::NOT_FOUND, s.into(), None)
    }
    pub fn conflict(s: impl Into<String>) -> Self {
        Self(StatusCode::CONFLICT, s.into(), None)
    }
    pub fn internal(s: impl Into<String>) -> Self {
        Self(StatusCode::INTERNAL_SERVER_ERROR, s.into(), None)
    }
    pub fn with_status(status: StatusCode, s: impl Into<String>) -> Self {
        Self(status, s.into(), None)
    }
    pub fn needs_reconciliation(
        operation: impl Into<String>,
        path: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            message.into(),
            Some(ReconciliationDetails {
                operation: operation.into(),
                path: path.into(),
            }),
        )
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
        let code = if self.2.is_some() {
            ApiErrorCode::NeedsReconciliation
        } else {
            match self.0 {
                StatusCode::BAD_REQUEST => ApiErrorCode::BadRequest,
                StatusCode::FORBIDDEN => ApiErrorCode::Forbidden,
                StatusCode::NOT_FOUND => ApiErrorCode::NotFound,
                StatusCode::CONFLICT => ApiErrorCode::Conflict,
                StatusCode::RANGE_NOT_SATISFIABLE => ApiErrorCode::RangeNotSatisfiable,
                StatusCode::PAYLOAD_TOO_LARGE => ApiErrorCode::PayloadTooLarge,
                StatusCode::SERVICE_UNAVAILABLE => ApiErrorCode::ServiceUnavailable,
                _ => ApiErrorCode::InternalServerError,
            }
        };
        (
            self.0,
            Json(ApiErrorBody {
                code,
                message: self.1,
                details: self.2,
            }),
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use http_body_util::BodyExt;

    #[tokio::test]
    async fn errors_have_tagged_json_bodies() {
        let response = AppError::not_found("missing").into_response();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&bytes).unwrap(),
            serde_json::json!({"code":"notFound","message":"missing"})
        );
    }
}
