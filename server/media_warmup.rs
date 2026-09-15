use std::sync::{
    Arc, LazyLock,
    atomic::{AtomicUsize, Ordering},
};
use tokio::sync::{Notify, OwnedSemaphorePermit, Semaphore};

static BACKGROUND: LazyLock<Arc<Semaphore>> = LazyLock::new(|| Arc::new(Semaphore::new(1)));
static FOREGROUND: AtomicUsize = AtomicUsize::new(0);
static IDLE: Notify = Notify::const_new();

pub struct Foreground;

pub fn foreground() -> Foreground {
    FOREGROUND.fetch_add(1, Ordering::SeqCst);
    Foreground
}

impl Drop for Foreground {
    fn drop(&mut self) {
        if FOREGROUND.fetch_sub(1, Ordering::SeqCst) == 1 {
            IDLE.notify_waiters();
        }
    }
}

pub async fn acquire() -> OwnedSemaphorePermit {
    loop {
        let idle = IDLE.notified();
        tokio::pin!(idle);
        idle.as_mut().enable();
        if FOREGROUND.load(Ordering::SeqCst) != 0 {
            idle.await;
            continue;
        }
        let permit = BACKGROUND.clone().acquire_owned().await.unwrap();
        if FOREGROUND.load(Ordering::SeqCst) == 0 {
            return permit;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::queue_test_support::until;
    use futures_util::poll;

    #[tokio::test]
    async fn background_is_serial_cancellation_safe_and_yields_to_foreground() {
        let visible = foreground();
        let mut blocked = Box::pin(acquire());
        assert!(poll!(blocked.as_mut()).is_pending());
        drop(visible);
        let first = until(blocked).await;

        let mut cancelled = Box::pin(acquire());
        assert!(poll!(cancelled.as_mut()).is_pending());
        drop(cancelled);

        let mut following = Box::pin(acquire());
        assert!(poll!(following.as_mut()).is_pending());
        let visible = foreground();
        drop(first);
        assert!(poll!(following.as_mut()).is_pending());
        drop(visible);
        let next = until(following).await;
        drop(next);
    }
}
