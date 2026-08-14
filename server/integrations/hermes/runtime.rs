use super::{config::HermesConfig, process::ManagedHermes, transport::HermesTransport};
use crate::integrations::registry::ShutdownCapability;
use futures_util::future::BoxFuture;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};
use tokio::sync::Mutex;

pub(crate) struct HermesRuntime {
    pub(crate) config: HermesConfig,
    pub(crate) transport: Arc<dyn HermesTransport>,
    pub(crate) events: tokio::sync::broadcast::Sender<Value>,
    pub(crate) project_operations: Mutex<()>,
    pub(crate) runtime_ids: Mutex<HashMap<String, String>>,
    pub(crate) active_ids: Mutex<HashSet<String>>,
    managed: Mutex<Option<ManagedHermes>>,
}

impl HermesRuntime {
    pub(crate) fn new(
        config: HermesConfig,
        transport: Arc<dyn HermesTransport>,
        events: tokio::sync::broadcast::Sender<Value>,
        managed: Option<ManagedHermes>,
    ) -> Arc<Self> {
        Arc::new(Self {
            config,
            transport,
            events,
            project_operations: Mutex::new(()),
            runtime_ids: Mutex::new(HashMap::new()),
            active_ids: Mutex::new(HashSet::new()),
            managed: Mutex::new(managed),
        })
    }
}

impl ShutdownCapability for HermesRuntime {
    fn shutdown<'a>(&'a self) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            if let Some(child) = self
                .managed
                .lock()
                .await
                .as_mut()
                .and_then(|managed| managed.child.as_mut())
            {
                let _ = child.kill().await;
            }
        })
    }
}
