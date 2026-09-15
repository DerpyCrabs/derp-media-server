use std::{
    collections::HashMap,
    future::Future,
    path::{Path, PathBuf},
    sync::{
        Arc, LazyLock, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::sync::{Notify, Semaphore};

static GATES: LazyLock<Mutex<HashMap<PathBuf, Arc<GateState>>>> = LazyLock::new(Mutex::default);

struct GateState {
    starts: AtomicUsize,
    started: Notify,
    permits: Semaphore,
}

pub struct Gate {
    path: PathBuf,
    state: Arc<GateState>,
}

impl Gate {
    pub fn new(path: PathBuf) -> Self {
        let state = Arc::new(GateState {
            starts: AtomicUsize::new(0),
            started: Notify::new(),
            permits: Semaphore::new(0),
        });
        assert!(
            GATES
                .lock()
                .unwrap()
                .insert(path.clone(), state.clone())
                .is_none()
        );
        Self { path, state }
    }

    pub fn starts(&self) -> usize {
        self.state.starts.load(Ordering::SeqCst)
    }

    pub async fn started(&self) {
        until(async {
            loop {
                let notified = self.state.started.notified();
                if self.starts() > 0 {
                    return;
                }
                notified.await;
            }
        })
        .await;
    }

    pub fn release(&self) {
        self.state.permits.add_permits(1);
    }
}

impl Drop for Gate {
    fn drop(&mut self) {
        GATES.lock().unwrap().remove(&self.path);
        self.state.permits.close();
    }
}

pub async fn before_generation(cache: &Path) {
    let state = GATES.lock().unwrap().get(cache).cloned();
    if let Some(state) = state {
        state.starts.fetch_add(1, Ordering::SeqCst);
        state.started.notify_one();
        if let Ok(permit) = state.permits.acquire().await {
            permit.forget();
        }
    }
}

pub async fn until<T>(future: impl Future<Output = T>) -> T {
    tokio::time::timeout(Duration::from_secs(5), future)
        .await
        .expect("queue stopped making progress")
}
