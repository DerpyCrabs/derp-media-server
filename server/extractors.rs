use crate::error::{AppError, AppResult};
use axum::{
    Json,
    extract::{FromRequest, FromRequestParts, Multipart, Query, Request},
    http::{StatusCode, request::Parts},
};
use serde::de::DeserializeOwned;

pub(crate) struct ApiJson<T>(pub T);

fn request_rejection(status: StatusCode, message: String) -> AppError {
    if status == StatusCode::PAYLOAD_TOO_LARGE || status.is_server_error() {
        AppError::with_status(status, message)
    } else {
        AppError::bad(message)
    }
}

impl<T, S> FromRequest<S> for ApiJson<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request(request: Request, state: &S) -> AppResult<Self> {
        Json::<T>::from_request(request, state)
            .await
            .map(|Json(value)| Self(value))
            .map_err(|error| request_rejection(error.status(), error.body_text()))
    }
}

pub(crate) struct ApiMultipart(pub Multipart);

impl<S> FromRequest<S> for ApiMultipart
where
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request(request: Request, state: &S) -> AppResult<Self> {
        Multipart::from_request(request, state)
            .await
            .map(Self)
            .map_err(|error| request_rejection(error.status(), error.body_text()))
    }
}

pub(crate) struct ApiQuery<T>(pub T);

impl<T, S> FromRequestParts<S> for ApiQuery<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> AppResult<Self> {
        Query::<T>::from_request_parts(parts, state)
            .await
            .map(|Query(value)| Self(value))
            .map_err(|error| AppError::bad(error.body_text()))
    }
}
