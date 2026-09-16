use crate::error::AppResult;
use std::{collections::HashSet, sync::Mutex};

#[derive(Default)]
pub(crate) struct Claims(Mutex<HashSet<String>>);

pub(crate) struct Reservation<'a> {
    claims: &'a Claims,
    paths: Vec<String>,
}

impl Claims {
    pub(crate) fn select<T>(
        &self,
        select: impl FnOnce(&str) -> AppResult<Vec<T>>,
        path: impl Fn(&T) -> String,
    ) -> AppResult<(Vec<T>, Reservation<'_>)> {
        let mut claimed = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let items = select(&serde_json::json!(*claimed).to_string())?;
        let paths: Vec<_> = items.iter().map(path).collect();
        claimed.extend(paths.iter().cloned());
        Ok((
            items,
            Reservation {
                claims: self,
                paths,
            },
        ))
    }
}

impl Drop for Reservation<'_> {
    fn drop(&mut self) {
        let mut claimed = self.claims.0.lock().unwrap_or_else(|e| e.into_inner());
        for path in &self.paths {
            claimed.remove(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cancellation_releases_only_its_own_files() {
        let claims = std::sync::Arc::new(Claims::default());
        let task_claims = claims.clone();
        let (ready, waiting) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            let (_, _reservation) = task_claims
                .select(|_| Ok(vec!["first".to_string()]), String::clone)
                .unwrap();
            ready.send(()).unwrap();
            std::future::pending::<()>().await;
        });
        waiting.await.unwrap();
        let (_, second) = claims
            .select(
                |excluded| {
                    assert_eq!(
                        serde_json::from_str::<Vec<String>>(excluded).unwrap(),
                        ["first"]
                    );
                    Ok(vec!["second".to_string()])
                },
                String::clone,
            )
            .unwrap();
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        assert_eq!(*claims.0.lock().unwrap(), HashSet::from(["second".into()]));
        drop(second);
        assert!(claims.0.lock().unwrap().is_empty());
    }
}
