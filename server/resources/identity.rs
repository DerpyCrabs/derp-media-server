use super::{LibraryId, ResourceId, SourceId};
use crate::{config::Config, error::AppError, state_db};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const SCHEMA_VERSION: i64 = 2;

#[derive(Clone, Debug)]
pub(crate) struct IdentityStore {
    database: PathBuf,
    library_id: LibraryId,
}

#[derive(Clone, Debug)]
pub(crate) struct ObservedResourceIdentity {
    pub(crate) provider_locator: String,
    pub(crate) legacy_locator: String,
    pub(crate) kind: String,
    pub(crate) platform_identity: Option<String>,
    pub(crate) fingerprint: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct StoredResourceIdentity {
    pub(crate) resource_id: ResourceId,
    pub(crate) source_id: SourceId,
    pub(crate) provider_locator: String,
    pub(crate) kind: String,
    pub(crate) status: String,
    pub(crate) legacy_locator: Option<String>,
}

#[derive(Clone, Debug)]
struct SourceRow {
    id: String,
    configured_id: Option<String>,
    canonical_locator: String,
    legacy_ids: HashSet<String>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn sql_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn canonical_locator(path: &Path) -> Result<String, String> {
    let absolute = std::fs::canonicalize(path)
        .or_else(|_| std::path::absolute(path))
        .map_err(|error| error.to_string())?;
    let value = absolute.to_string_lossy().replace('\\', "/");
    Ok(if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    })
}

fn explicit_configured_id(legacy_id: &str) -> Option<&str> {
    legacy_id.strip_prefix("configured:")
}

fn apply_schema(connection: &mut Connection) -> Result<(), String> {
    let version: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(sql_error)?;
    if version >= SCHEMA_VERSION {
        return Ok(());
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sql_error)?;
    transaction
        .execute_batch(
            "CREATE TABLE libraries (
               id TEXT PRIMARY KEY,
               created_at INTEGER NOT NULL
             );
             CREATE TABLE legacy_library_keys (
               library_id TEXT NOT NULL REFERENCES libraries(id),
               legacy_key TEXT NOT NULL UNIQUE,
               first_seen_at INTEGER NOT NULL,
               last_seen_at INTEGER NOT NULL,
               PRIMARY KEY(library_id, legacy_key)
             );
             CREATE TABLE sources (
               id TEXT PRIMARY KEY,
               library_id TEXT NOT NULL REFERENCES libraries(id),
               provider TEXT NOT NULL,
               source_class TEXT NOT NULL,
               configured_id TEXT,
               display_name TEXT NOT NULL,
               canonical_locator TEXT NOT NULL,
               root_resource_id TEXT NOT NULL UNIQUE,
               status TEXT NOT NULL,
               created_at INTEGER NOT NULL,
               last_seen_at INTEGER NOT NULL
             );
             CREATE UNIQUE INDEX sources_configured_id
               ON sources(library_id, configured_id)
               WHERE configured_id IS NOT NULL;
             CREATE INDEX sources_locator
               ON sources(library_id, provider, canonical_locator);
             CREATE TABLE source_legacy_keys (
               source_id TEXT NOT NULL REFERENCES sources(id),
               legacy_id TEXT NOT NULL,
               first_seen_at INTEGER NOT NULL,
               last_seen_at INTEGER NOT NULL,
               PRIMARY KEY(source_id, legacy_id)
             );
             CREATE INDEX source_legacy_id_lookup
               ON source_legacy_keys(legacy_id);
             CREATE TABLE resources (
               id TEXT PRIMARY KEY,
               library_id TEXT NOT NULL REFERENCES libraries(id),
               source_id TEXT NOT NULL REFERENCES sources(id),
               provider_locator TEXT NOT NULL,
               kind TEXT NOT NULL,
               platform_identity TEXT,
               fingerprint TEXT,
               status TEXT NOT NULL,
               first_seen_at INTEGER NOT NULL,
               last_seen_at INTEGER NOT NULL,
               missing_since INTEGER,
               UNIQUE(source_id, provider_locator)
             );
             CREATE INDEX resources_platform_identity
               ON resources(source_id, platform_identity)
               WHERE platform_identity IS NOT NULL;
             CREATE TABLE resource_legacy_locators (
               resource_id TEXT NOT NULL REFERENCES resources(id),
               legacy_locator TEXT NOT NULL,
               first_seen_at INTEGER NOT NULL,
               last_seen_at INTEGER NOT NULL,
               PRIMARY KEY(resource_id, legacy_locator)
             );
             CREATE INDEX resource_legacy_locator_lookup
               ON resource_legacy_locators(legacy_locator);
             CREATE TABLE legacy_change_clock (
               singleton INTEGER PRIMARY KEY CHECK(singleton=1),
               revision INTEGER NOT NULL
             );
             INSERT INTO legacy_change_clock(singleton,revision) VALUES(1,0);
             CREATE TABLE legacy_namespace_revisions (
               object_kind TEXT NOT NULL,
               legacy_key TEXT NOT NULL,
               revision INTEGER NOT NULL,
               PRIMARY KEY(object_kind,legacy_key)
             );
             CREATE TRIGGER resource_v2_documents_insert
             AFTER INSERT ON state_documents
             WHEN NOT EXISTS(SELECT 1 FROM libraries WHERE id=NEW.library_key)
             BEGIN
               UPDATE legacy_change_clock SET revision=revision+1 WHERE singleton=1;
               INSERT INTO legacy_namespace_revisions(object_kind,legacy_key,revision)
               VALUES(
                 'document:' || NEW.kind,
                 NEW.library_key,
                 (SELECT revision FROM legacy_change_clock WHERE singleton=1)
               )
               ON CONFLICT(object_kind,legacy_key) DO UPDATE SET revision=excluded.revision;
             END;
             CREATE TRIGGER resource_v2_documents_update
             AFTER UPDATE ON state_documents
             WHEN NOT EXISTS(SELECT 1 FROM libraries WHERE id=NEW.library_key)
             BEGIN
               UPDATE legacy_change_clock SET revision=revision+1 WHERE singleton=1;
               INSERT INTO legacy_namespace_revisions(object_kind,legacy_key,revision)
               VALUES(
                 'document:' || NEW.kind,
                 NEW.library_key,
                 (SELECT revision FROM legacy_change_clock WHERE singleton=1)
               )
               ON CONFLICT(object_kind,legacy_key) DO UPDATE SET revision=excluded.revision;
             END;
             CREATE TRIGGER resource_v2_documents_delete
             AFTER DELETE ON state_documents
             WHEN NOT EXISTS(SELECT 1 FROM libraries WHERE id=OLD.library_key)
             BEGIN
               UPDATE legacy_change_clock SET revision=revision+1 WHERE singleton=1;
               INSERT INTO legacy_namespace_revisions(object_kind,legacy_key,revision)
               VALUES(
                 'document:' || OLD.kind,
                 OLD.library_key,
                 (SELECT revision FROM legacy_change_clock WHERE singleton=1)
               )
               ON CONFLICT(object_kind,legacy_key) DO UPDATE SET revision=excluded.revision;
             END;
             CREATE TRIGGER resource_v2_shares_insert
             AFTER INSERT ON shares
             WHEN NOT EXISTS(SELECT 1 FROM libraries WHERE id=NEW.library_key)
             BEGIN
               UPDATE legacy_change_clock SET revision=revision+1 WHERE singleton=1;
               INSERT INTO legacy_namespace_revisions(object_kind,legacy_key,revision)
               VALUES(
                 'shares',NEW.library_key,
                 (SELECT revision FROM legacy_change_clock WHERE singleton=1)
               )
               ON CONFLICT(object_kind,legacy_key) DO UPDATE SET revision=excluded.revision;
             END;
             CREATE TRIGGER resource_v2_shares_delete
             AFTER DELETE ON shares
             WHEN NOT EXISTS(SELECT 1 FROM libraries WHERE id=OLD.library_key)
             BEGIN
               UPDATE legacy_change_clock SET revision=revision+1 WHERE singleton=1;
               INSERT INTO legacy_namespace_revisions(object_kind,legacy_key,revision)
               VALUES(
                 'shares',OLD.library_key,
                 (SELECT revision FROM legacy_change_clock WHERE singleton=1)
               )
               ON CONFLICT(object_kind,legacy_key) DO UPDATE SET revision=excluded.revision;
             END;",
        )
        .map_err(sql_error)?;
    transaction
        .execute(
            "INSERT INTO schema_migrations(version, applied_at) VALUES(?1, ?2)",
            params![SCHEMA_VERSION, now_ms()],
        )
        .map_err(sql_error)?;
    transaction.commit().map_err(sql_error)
}

fn observed_library_keys(transaction: &Transaction<'_>) -> Result<Vec<String>, String> {
    let mut statement = transaction
        .prepare(
            "SELECT library_key FROM state_documents
             UNION
             SELECT library_key FROM shares
             ORDER BY library_key",
        )
        .map_err(sql_error)?;
    statement
        .query_map([], |row| row.get(0))
        .map_err(sql_error)?
        .map(|row| row.map_err(sql_error))
        .collect()
}

fn legacy_key_parts(key: &str) -> Vec<(Option<String>, String)> {
    if !key.contains('|') {
        return vec![(None, normalize_key_path(key))];
    }
    key.split('|')
        .filter_map(|part| {
            let (name, path) = part.split_once(':')?;
            Some((Some(name.trim().to_lowercase()), normalize_key_path(path)))
        })
        .collect()
}

fn normalize_key_path(path: &str) -> String {
    let value = path.trim().replace('\\', "/");
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

fn comparable_legacy_key(current: &str, candidate: &str) -> bool {
    if current == candidate {
        return true;
    }
    let current = legacy_key_parts(current);
    let candidate = legacy_key_parts(candidate);
    if current.len() != candidate.len() || current.is_empty() {
        return false;
    }
    let current_pairs = current.iter().cloned().collect::<BTreeSet<_>>();
    let candidate_pairs = candidate.iter().cloned().collect::<BTreeSet<_>>();
    if current_pairs == candidate_pairs {
        return true;
    }
    if current.len() == 1 || candidate.len() == 1 {
        return false;
    }
    let current_paths = current
        .iter()
        .map(|(_, path)| path.clone())
        .collect::<BTreeSet<_>>();
    let candidate_paths = candidate
        .iter()
        .map(|(_, path)| path.clone())
        .collect::<BTreeSet<_>>();
    let current_names = current
        .iter()
        .filter_map(|(name, _)| name.clone())
        .collect::<BTreeSet<_>>();
    let candidate_names = candidate
        .iter()
        .filter_map(|(name, _)| name.clone())
        .collect::<BTreeSet<_>>();
    current_paths == candidate_paths || current_names == candidate_names
}

fn select_initial_legacy_keys(current: &str, observed: &[String]) -> Result<Vec<String>, String> {
    if observed.is_empty() {
        return Ok(vec![current.to_string()]);
    }
    let candidates = observed
        .iter()
        .filter(|candidate| comparable_legacy_key(current, candidate))
        .cloned()
        .collect::<Vec<_>>();
    if candidates.is_empty() {
        return Err(format!(
            "Resource identity recovery required: configured root names and paths do not match retained application state. Restore prior root name or path, or add explicit mediaDirs ids. Current legacy key: {current}"
        ));
    }
    let exact = candidates.iter().any(|candidate| candidate == current);
    let non_exact = candidates
        .iter()
        .filter(|candidate| candidate.as_str() != current)
        .count();
    if !exact && candidates.len() > 1 || exact && non_exact > 1 {
        return Err(
            "Resource identity recovery required: multiple retained application-state namespaces match configured roots"
                .into(),
        );
    }
    let mut result = candidates;
    if !result.iter().any(|candidate| candidate == current) {
        result.push(current.to_string());
    }
    Ok(result)
}

fn load_sources(transaction: &Transaction<'_>, library_id: &str) -> Result<Vec<SourceRow>, String> {
    let mut statement = transaction
        .prepare(
            "SELECT id,configured_id,canonical_locator
             FROM sources
             WHERE library_id=?1 AND provider='filesystem' AND source_class='config'",
        )
        .map_err(sql_error)?;
    let base = statement
        .query_map([library_id], |row| {
            Ok(SourceRow {
                id: row.get(0)?,
                configured_id: row.get(1)?,
                canonical_locator: row.get(2)?,
                legacy_ids: HashSet::new(),
            })
        })
        .map_err(sql_error)?
        .map(|row| row.map_err(sql_error))
        .collect::<Result<Vec<_>, _>>()?;
    let mut by_id = base
        .into_iter()
        .map(|row| (row.id.clone(), row))
        .collect::<HashMap<_, _>>();
    let mut legacy = transaction
        .prepare(
            "SELECT source_id,legacy_id FROM source_legacy_keys
             WHERE source_id IN (
               SELECT id FROM sources
               WHERE library_id=?1 AND provider='filesystem' AND source_class='config'
             )",
        )
        .map_err(sql_error)?;
    for row in legacy
        .query_map([library_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(sql_error)?
    {
        let (source_id, legacy_id) = row.map_err(sql_error)?;
        if let Some(source) = by_id.get_mut(&source_id) {
            source.legacy_ids.insert(legacy_id);
        }
    }
    Ok(by_id.into_values().collect())
}

fn reconcile_config_sources(
    transaction: &Transaction<'_>,
    config: &Config,
    library_id: &str,
) -> Result<(), String> {
    let existing = load_sources(transaction, library_id)?;
    let mut used = HashSet::new();
    let mut matches = Vec::new();
    for root in &config.roots {
        let locator = canonical_locator(&root.path)?;
        let explicit = explicit_configured_id(&root.id);
        let candidates = existing
            .iter()
            .filter(|source| !used.contains(&source.id))
            .filter(|source| {
                explicit.is_some_and(|id| source.configured_id.as_deref() == Some(id))
                    || source.legacy_ids.contains(&root.id)
                    || source.canonical_locator == locator
            })
            .collect::<Vec<_>>();
        if candidates.len() > 1 {
            return Err(format!(
                "Resource identity recovery required: configured Source \"{}\" matches multiple retained Sources",
                root.name
            ));
        }
        let matched = candidates.first().map(|source| source.id.clone());
        if let Some(source_id) = &matched {
            used.insert(source_id.clone());
        }
        matches.push((root, locator, explicit.map(str::to_string), matched));
    }
    let unmatched_existing = existing
        .iter()
        .filter(|source| !used.contains(&source.id))
        .count();
    let unmatched_roots = matches
        .iter()
        .filter(|(_, _, _, source_id)| source_id.is_none())
        .count();
    if unmatched_existing > 0 && unmatched_roots > 0 {
        return Err(
            "Resource identity recovery required: a configured Source changed both display name and path without a matching explicit id. Restore one prior value or configure its retained id."
                .into(),
        );
    }

    transaction
        .execute(
            "UPDATE sources SET status='missing'
             WHERE library_id=?1 AND provider='filesystem' AND source_class='config'",
            [library_id],
        )
        .map_err(sql_error)?;
    let now = now_ms();
    for (root, locator, explicit, matched) in matches {
        let source_id = matched.unwrap_or_else(|| format!("source-{}", uuid::Uuid::new_v4()));
        if existing.iter().any(|source| source.id == source_id) {
            transaction
                .execute(
                    "UPDATE sources SET configured_id=COALESCE(?2,configured_id),
                       display_name=?3,canonical_locator=?4,status='present',last_seen_at=?5
                     WHERE id=?1",
                    params![source_id, explicit, root.name, locator, now],
                )
                .map_err(sql_error)?;
        } else {
            transaction
                .execute(
                    "INSERT INTO sources(
                       id,library_id,provider,source_class,configured_id,display_name,
                       canonical_locator,root_resource_id,status,created_at,last_seen_at
                     ) VALUES(?1,?2,'filesystem','config',?3,?4,?5,?6,'present',?7,?7)",
                    params![
                        source_id,
                        library_id,
                        explicit,
                        root.name,
                        locator,
                        format!("resource-{}", uuid::Uuid::new_v4()),
                        now
                    ],
                )
                .map_err(sql_error)?;
        }
        transaction
            .execute(
                "INSERT INTO source_legacy_keys(source_id,legacy_id,first_seen_at,last_seen_at)
                 VALUES(?1,?2,?3,?3)
                 ON CONFLICT(source_id,legacy_id) DO UPDATE SET last_seen_at=excluded.last_seen_at",
                params![source_id, root.id, now],
            )
            .map_err(sql_error)?;
    }
    Ok(())
}

fn ensure_virtual_source(
    transaction: &Transaction<'_>,
    library_id: &str,
    source_id: &str,
    provider: &str,
    display_name: &str,
) -> Result<(), String> {
    let now = now_ms();
    transaction
        .execute(
            "INSERT INTO sources(
               id,library_id,provider,source_class,configured_id,display_name,
               canonical_locator,root_resource_id,status,created_at,last_seen_at
             ) VALUES(?1,?2,?3,'builtin',NULL,?4,'',?5,'present',?6,?6)
             ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,
               status='present',last_seen_at=excluded.last_seen_at",
            params![
                source_id,
                library_id,
                provider,
                display_name,
                format!("resource-{source_id}-root"),
                now
            ],
        )
        .map_err(sql_error)?;
    Ok(())
}

pub(crate) fn initialize_identity(config: &mut Config) -> Result<IdentityStore, String> {
    let database = state_db::database(config);
    let legacy_key = config.library_key.clone();
    let mut connection = state_db::connection(&database).map_err(|error| error.1)?;
    apply_schema(&mut connection)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sql_error)?;
    let libraries = {
        let mut statement = transaction
            .prepare("SELECT id FROM libraries ORDER BY created_at,id")
            .map_err(sql_error)?;
        statement
            .query_map([], |row| row.get(0))
            .map_err(sql_error)?
            .map(|row| row.map_err(sql_error))
            .collect::<Result<Vec<String>, _>>()?
    };
    if libraries.len() > 1 {
        return Err(
            "Resource identity recovery required: installation contains multiple Library records"
                .into(),
        );
    }
    let library_id = libraries
        .first()
        .cloned()
        .unwrap_or_else(|| format!("library-{}", uuid::Uuid::new_v4()));
    if libraries.is_empty() {
        let keys = select_initial_legacy_keys(&legacy_key, &observed_library_keys(&transaction)?)?;
        transaction
            .execute(
                "INSERT INTO libraries(id,created_at) VALUES(?1,?2)",
                params![library_id, now_ms()],
            )
            .map_err(sql_error)?;
        for key in keys {
            transaction
                .execute(
                    "INSERT INTO legacy_library_keys(
                       library_id,legacy_key,first_seen_at,last_seen_at
                     ) VALUES(?1,?2,?3,?3)",
                    params![library_id, key, now_ms()],
                )
                .map_err(sql_error)?;
        }
    }

    reconcile_config_sources(&transaction, config, &library_id)?;
    ensure_virtual_source(
        &transaction,
        &library_id,
        "source-catalog",
        "catalog",
        "Library",
    )?;
    ensure_virtual_source(
        &transaction,
        &library_id,
        "source-hermes",
        "hermes",
        "Hermes Sessions",
    )?;
    transaction
        .execute(
            "INSERT INTO legacy_library_keys(
               library_id,legacy_key,first_seen_at,last_seen_at
             ) VALUES(?1,?2,?3,?3)
             ON CONFLICT(legacy_key) DO UPDATE SET last_seen_at=excluded.last_seen_at",
            params![library_id, legacy_key, now_ms()],
        )
        .map_err(sql_error)?;
    transaction.commit().map_err(sql_error)?;

    config.library_key = library_id.clone();
    Ok(IdentityStore {
        database,
        library_id: LibraryId::new(library_id),
    })
}

impl IdentityStore {
    pub(crate) fn library_id(&self) -> &LibraryId {
        &self.library_id
    }

    pub(crate) fn database(&self) -> &Path {
        &self.database
    }

    pub(crate) fn source_for_root(
        &self,
        legacy_id: &str,
        path: &Path,
    ) -> Result<(SourceId, ResourceId), AppError> {
        let locator = canonical_locator(path).map_err(AppError::internal)?;
        let connection = state_db::connection(&self.database)?;
        connection
            .query_row(
                "SELECT s.id,s.root_resource_id
                 FROM sources s
                 LEFT JOIN source_legacy_keys k ON k.source_id=s.id
                 WHERE s.library_id=?1 AND s.provider='filesystem'
                   AND (k.legacy_id=?2 OR s.canonical_locator=?3)
                 ORDER BY CASE WHEN k.legacy_id=?2 THEN 0 ELSE 1 END
                 LIMIT 1",
                params![self.library_id.as_str(), legacy_id, locator],
                |row| {
                    Ok((
                        SourceId::new(row.get::<_, String>(0)?),
                        ResourceId::new(row.get::<_, String>(1)?),
                    ))
                },
            )
            .optional()
            .map_err(|error| AppError::internal(error.to_string()))?
            .ok_or_else(|| AppError::internal("Configured Source identity is unavailable"))
    }

    pub(crate) fn sync_runtime_sources(
        &self,
        roots: &[crate::config::MediaRoot],
    ) -> Result<(), AppError> {
        let mut connection = state_db::connection(&self.database)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| AppError::internal(error.to_string()))?;
        transaction
            .execute(
                "UPDATE sources SET status='missing'
                 WHERE library_id=?1 AND provider='filesystem' AND source_class='mount'",
                [self.library_id.as_str()],
            )
            .map_err(|error| AppError::internal(error.to_string()))?;
        let now = now_ms();
        for root in roots {
            let locator = canonical_locator(&root.path).map_err(AppError::internal)?;
            let source_id = format!("source-mount-{}", root.id);
            transaction
                .execute(
                    "INSERT INTO sources(
                       id,library_id,provider,source_class,configured_id,display_name,
                       canonical_locator,root_resource_id,status,created_at,last_seen_at
                     ) VALUES(?1,?2,'filesystem','mount',?3,?4,?5,?6,?7,?8,?8)
                     ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,
                       canonical_locator=excluded.canonical_locator,status=excluded.status,
                       last_seen_at=excluded.last_seen_at",
                    params![
                        source_id,
                        self.library_id.as_str(),
                        root.id,
                        root.name,
                        locator,
                        format!("resource-{source_id}-root"),
                        if root.path.is_dir() {
                            "present"
                        } else {
                            "missing"
                        },
                        now
                    ],
                )
                .map_err(|error| AppError::internal(error.to_string()))?;
            transaction
                .execute(
                    "INSERT INTO source_legacy_keys(
                       source_id,legacy_id,first_seen_at,last_seen_at
                     ) VALUES(?1,?2,?3,?3)
                     ON CONFLICT(source_id,legacy_id) DO UPDATE SET last_seen_at=excluded.last_seen_at",
                    params![source_id, root.id, now],
                )
                .map_err(|error| AppError::internal(error.to_string()))?;
        }
        transaction
            .commit()
            .map_err(|error| AppError::internal(error.to_string()))
    }

    pub(crate) fn observe(
        &self,
        source_id: &SourceId,
        observed: &[ObservedResourceIdentity],
    ) -> Result<Vec<ResourceId>, AppError> {
        let mut connection = state_db::connection(&self.database)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| AppError::internal(error.to_string()))?;
        let mut result = Vec::with_capacity(observed.len());
        let now = now_ms();
        for item in observed {
            let exact: Option<String> = transaction
                .query_row(
                    "SELECT id FROM resources WHERE source_id=?1 AND provider_locator=?2",
                    params![source_id.as_str(), item.provider_locator],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| AppError::internal(error.to_string()))?;
            let resource_id = if let Some(resource_id) = exact {
                resource_id
            } else {
                let mut matches = if let Some(platform_identity) = &item.platform_identity {
                    let mut statement = transaction
                        .prepare(
                            "SELECT id FROM resources
                             WHERE source_id=?1 AND platform_identity=?2",
                        )
                        .map_err(|error| AppError::internal(error.to_string()))?;
                    statement
                        .query_map(params![source_id.as_str(), platform_identity], |row| {
                            row.get::<_, String>(0)
                        })
                        .map_err(|error| AppError::internal(error.to_string()))?
                        .collect::<Result<Vec<_>, _>>()
                        .map_err(|error| AppError::internal(error.to_string()))?
                } else {
                    Vec::new()
                };
                if matches.is_empty()
                    && let Some(fingerprint) = &item.fingerprint
                {
                    let mut statement = transaction
                        .prepare(
                            "SELECT id FROM resources
                             WHERE source_id=?1 AND fingerprint=?2",
                        )
                        .map_err(|error| AppError::internal(error.to_string()))?;
                    matches = statement
                        .query_map(params![source_id.as_str(), fingerprint], |row| {
                            row.get::<_, String>(0)
                        })
                        .map_err(|error| AppError::internal(error.to_string()))?
                        .collect::<Result<Vec<_>, _>>()
                        .map_err(|error| AppError::internal(error.to_string()))?;
                }
                if matches.len() == 1 {
                    transaction
                        .execute(
                            "UPDATE resources SET provider_locator=?2,status='present',
                               missing_since=NULL,last_seen_at=?3,kind=?4,fingerprint=?5
                             WHERE id=?1",
                            params![
                                matches[0],
                                item.provider_locator,
                                now,
                                item.kind,
                                item.fingerprint
                            ],
                        )
                        .map_err(|error| AppError::internal(error.to_string()))?;
                    matches[0].clone()
                } else {
                    format!("resource-{}", uuid::Uuid::new_v4())
                }
            };
            transaction
                .execute(
                    "INSERT INTO resources(
                       id,library_id,source_id,provider_locator,kind,platform_identity,
                       fingerprint,status,first_seen_at,last_seen_at,missing_since
                     ) VALUES(?1,?2,?3,?4,?5,?6,?7,'present',?8,?8,NULL)
                     ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,
                       platform_identity=COALESCE(excluded.platform_identity,resources.platform_identity),
                       fingerprint=excluded.fingerprint,status='present',missing_since=NULL,
                       last_seen_at=excluded.last_seen_at",
                    params![
                        resource_id,
                        self.library_id.as_str(),
                        source_id.as_str(),
                        item.provider_locator,
                        item.kind,
                        item.platform_identity,
                        item.fingerprint,
                        now
                    ],
                )
                .map_err(|error| AppError::internal(error.to_string()))?;
            transaction
                .execute(
                    "INSERT INTO resource_legacy_locators(
                       resource_id,legacy_locator,first_seen_at,last_seen_at
                     ) VALUES(?1,?2,?3,?3)
                     ON CONFLICT(resource_id,legacy_locator) DO UPDATE
                       SET last_seen_at=excluded.last_seen_at",
                    params![resource_id, item.legacy_locator, now],
                )
                .map_err(|error| AppError::internal(error.to_string()))?;
            result.push(ResourceId::new(resource_id));
        }
        transaction
            .commit()
            .map_err(|error| AppError::internal(error.to_string()))?;
        Ok(result)
    }

    pub(crate) fn stored(
        &self,
        resource_id: &ResourceId,
    ) -> Result<Option<StoredResourceIdentity>, AppError> {
        let connection = state_db::connection(&self.database)?;
        connection
            .query_row(
                "SELECT id,source_id,provider_locator,kind,status,
                   (SELECT legacy_locator FROM resource_legacy_locators
                    WHERE resource_id=resources.id ORDER BY last_seen_at DESC LIMIT 1)
                 FROM resources WHERE library_id=?1 AND id=?2",
                params![self.library_id.as_str(), resource_id.as_str()],
                |row| {
                    Ok(StoredResourceIdentity {
                        resource_id: ResourceId::new(row.get::<_, String>(0)?),
                        source_id: SourceId::new(row.get::<_, String>(1)?),
                        provider_locator: row.get(2)?,
                        kind: row.get(3)?,
                        status: row.get(4)?,
                        legacy_locator: row.get(5)?,
                    })
                },
            )
            .optional()
            .map_err(|error| AppError::internal(error.to_string()))
    }

    pub(crate) fn mark_missing(&self, resource_id: &ResourceId) -> Result<(), AppError> {
        let connection = state_db::connection(&self.database)?;
        connection
            .execute(
                "UPDATE resources SET status='missing',missing_since=COALESCE(missing_since,?3),
                   last_seen_at=?3
                 WHERE library_id=?1 AND id=?2",
                params![self.library_id.as_str(), resource_id.as_str(), now_ms()],
            )
            .map_err(|error| AppError::internal(error.to_string()))?;
        Ok(())
    }

    pub(crate) fn by_legacy_locator(
        &self,
        legacy_locator: &str,
    ) -> Result<Option<StoredResourceIdentity>, AppError> {
        let connection = state_db::connection(&self.database)?;
        connection
            .query_row(
                "SELECT r.id,r.source_id,r.provider_locator,r.kind,r.status,
                   (SELECT legacy_locator FROM resource_legacy_locators
                    WHERE resource_id=r.id ORDER BY last_seen_at DESC LIMIT 1)
                 FROM resource_legacy_locators l
                 JOIN resources r ON r.id=l.resource_id
                 WHERE r.library_id=?1 AND l.legacy_locator=?2
                 ORDER BY l.last_seen_at DESC LIMIT 1",
                params![self.library_id.as_str(), legacy_locator],
                |row| {
                    Ok(StoredResourceIdentity {
                        resource_id: ResourceId::new(row.get::<_, String>(0)?),
                        source_id: SourceId::new(row.get::<_, String>(1)?),
                        provider_locator: row.get(2)?,
                        kind: row.get(3)?,
                        status: row.get(4)?,
                        legacy_locator: row.get(5)?,
                    })
                },
            )
            .optional()
            .map_err(|error| AppError::internal(error.to_string()))
    }

    pub(crate) fn relocate(
        &self,
        source_id: &SourceId,
        old_locator: &str,
        new_locator: &str,
        new_legacy_locator: &str,
    ) -> Result<(), AppError> {
        self.relocate_to(
            source_id,
            old_locator,
            source_id,
            new_locator,
            new_legacy_locator,
        )
    }

    pub(crate) fn relocate_to(
        &self,
        source_id: &SourceId,
        old_locator: &str,
        destination_source_id: &SourceId,
        new_locator: &str,
        new_legacy_locator: &str,
    ) -> Result<(), AppError> {
        let mut connection = state_db::connection(&self.database)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| AppError::internal(error.to_string()))?;
        let resources = {
            let mut statement = transaction
                .prepare(
                    "SELECT id,provider_locator FROM resources
                     WHERE source_id=?1 AND (
                       provider_locator=?2 OR
                       substr(provider_locator,1,length(?2)+1)=?2 || '/'
                     )
                     ORDER BY length(provider_locator)",
                )
                .map_err(|error| AppError::internal(error.to_string()))?;
            statement
                .query_map(params![source_id.as_str(), old_locator], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|error| AppError::internal(error.to_string()))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| AppError::internal(error.to_string()))?
        };
        let now = now_ms();
        for (resource_id, old_resource_locator) in resources {
            let suffix = old_resource_locator
                .strip_prefix(old_locator)
                .unwrap_or_default();
            let relocated = format!("{new_locator}{suffix}");
            let legacy = format!("{new_legacy_locator}{suffix}");
            transaction
                .execute(
                    "UPDATE resources SET source_id=?2,provider_locator=?3,last_seen_at=?4
                     WHERE id=?1",
                    params![resource_id, destination_source_id.as_str(), relocated, now],
                )
                .map_err(|error| AppError::internal(error.to_string()))?;
            transaction
                .execute(
                    "INSERT INTO resource_legacy_locators(
                       resource_id,legacy_locator,first_seen_at,last_seen_at
                     ) VALUES(?1,?2,?3,?3)
                     ON CONFLICT(resource_id,legacy_locator) DO UPDATE
                       SET last_seen_at=excluded.last_seen_at",
                    params![resource_id, legacy, now],
                )
                .map_err(|error| AppError::internal(error.to_string()))?;
        }
        transaction
            .commit()
            .map_err(|error| AppError::internal(error.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AuthConfig, FileSearchConfig, ImageOptimizationConfig, MediaRoot};

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

    fn config(base: &Path, roots: Vec<MediaRoot>, key: &str) -> Config {
        Config {
            port: 3000,
            roots,
            library_key: key.into(),
            share_link_domain: None,
            auth: AuthConfig::default(),
            data_path: base.join("data"),
            file_search: FileSearchConfig {
                enabled: false,
                index_path: base.join("search.sqlite"),
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

    fn fixture(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("derp-identity-{name}-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn source_identity_survives_display_rename_root_reorder_and_restart() {
        let base = fixture("stable");
        let one = base.join("one");
        let two = base.join("two");
        std::fs::create_dir_all(&one).unwrap();
        std::fs::create_dir_all(&two).unwrap();
        let old_key = format!("One:{}|Two:{}", one.display(), two.display());
        let mut initial = config(
            &base,
            vec![
                root("config:one", "One", one.clone()),
                root("config:two", "Two", two.clone()),
            ],
            &old_key,
        );
        state_db::initialize(&initial).unwrap();
        let first = initialize_identity(&mut initial).unwrap();
        let one_id = first.source_for_root("config:one", &one).unwrap().0;
        let two_id = first.source_for_root("config:two", &two).unwrap().0;

        let new_key = format!("Two:{}|Renamed:{}", two.display(), one.display());
        let mut reordered = config(
            &base,
            vec![
                root("config:two", "Two", two.clone()),
                root("config:renamed", "Renamed", one.clone()),
            ],
            &new_key,
        );
        state_db::initialize(&reordered).unwrap();
        let second = initialize_identity(&mut reordered).unwrap();

        assert_eq!(second.library_id(), first.library_id());
        assert_eq!(
            second.source_for_root("config:renamed", &one).unwrap().0,
            one_id
        );
        assert_eq!(
            second.source_for_root("config:two", &two).unwrap().0,
            two_id
        );
        assert_eq!(reordered.library_key, first.library_id().as_str());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn simultaneous_name_and_path_change_without_id_requires_recovery() {
        let base = fixture("ambiguous");
        let original = base.join("original");
        let replacement = base.join("replacement");
        std::fs::create_dir_all(&original).unwrap();
        std::fs::create_dir_all(&replacement).unwrap();
        let mut initial = config(
            &base,
            vec![root("config:original", "Original", original.clone())],
            original.to_str().unwrap(),
        );
        state_db::initialize(&initial).unwrap();
        initialize_identity(&mut initial).unwrap();

        let mut changed = config(
            &base,
            vec![root(
                "config:replacement",
                "Replacement",
                replacement.clone(),
            )],
            replacement.to_str().unwrap(),
        );
        state_db::initialize(&changed).unwrap();
        let error = initialize_identity(&mut changed).unwrap_err();
        assert!(error.contains("changed both display name and path"));
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn migration_is_additive_and_restart_idempotent() {
        let base = fixture("restart");
        let media = base.join("media");
        std::fs::create_dir_all(&media).unwrap();
        let mut config = config(
            &base,
            vec![root("config:primary", "Media", media.clone())],
            media.to_str().unwrap(),
        );
        state_db::initialize(&config).unwrap();
        let first = initialize_identity(&mut config).unwrap();
        let source = first.source_for_root("config:primary", &media).unwrap();

        let mut restarted = self::config(
            &base,
            vec![root("config:primary", "Media", media.clone())],
            media.to_str().unwrap(),
        );
        state_db::initialize(&restarted).unwrap();
        let second = initialize_identity(&mut restarted).unwrap();
        assert_eq!(second.library_id(), first.library_id());
        assert_eq!(
            second.source_for_root("config:primary", &media).unwrap(),
            source
        );
        let connection = state_db::connection(second.database()).unwrap();
        let versions: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version=2",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(versions, 1);
        drop(connection);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn observed_resource_identity_survives_app_and_unique_external_moves() {
        let base = fixture("resource-moves");
        let media = base.join("media");
        std::fs::create_dir_all(&media).unwrap();
        let mut config = config(
            &base,
            vec![root("config:primary", "Media", media.clone())],
            media.to_str().unwrap(),
        );
        state_db::initialize(&config).unwrap();
        let identity = initialize_identity(&mut config).unwrap();
        let source = identity
            .source_for_root("config:primary", &media)
            .unwrap()
            .0;
        let observed = |locator: &str| ObservedResourceIdentity {
            provider_locator: locator.into(),
            legacy_locator: locator.into(),
            kind: "file".into(),
            platform_identity: Some("volume:file-index".into()),
            fingerprint: Some("metadata".into()),
        };

        let first = identity.observe(&source, &[observed("old.txt")]).unwrap()[0].clone();
        identity
            .relocate(&source, "old.txt", "app.txt", "app.txt")
            .unwrap();
        assert_eq!(
            identity.stored(&first).unwrap().unwrap().provider_locator,
            "app.txt"
        );
        let moved = identity
            .observe(&source, &[observed("external.txt")])
            .unwrap();
        assert_eq!(moved, [first.clone()]);
        assert_eq!(
            identity.stored(&first).unwrap().unwrap().provider_locator,
            "external.txt"
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn ambiguous_external_identity_never_rebinds() {
        let base = fixture("resource-ambiguous");
        let media = base.join("media");
        std::fs::create_dir_all(&media).unwrap();
        let mut config = config(
            &base,
            vec![root("config:primary", "Media", media.clone())],
            media.to_str().unwrap(),
        );
        state_db::initialize(&config).unwrap();
        let identity = initialize_identity(&mut config).unwrap();
        let source = identity
            .source_for_root("config:primary", &media)
            .unwrap()
            .0;
        let first = identity
            .observe(
                &source,
                &[ObservedResourceIdentity {
                    provider_locator: "first.txt".into(),
                    legacy_locator: "first.txt".into(),
                    kind: "file".into(),
                    platform_identity: Some("collision".into()),
                    fingerprint: None,
                }],
            )
            .unwrap()[0]
            .clone();
        let connection = state_db::connection(identity.database()).unwrap();
        connection
            .execute(
                "INSERT INTO resources(
                   id,library_id,source_id,provider_locator,kind,platform_identity,
                   fingerprint,status,first_seen_at,last_seen_at,missing_since
                 ) VALUES('resource-collision',?1,?2,'second.txt','file','collision',
                   NULL,'present',1,1,NULL)",
                params![identity.library_id().as_str(), source.as_str()],
            )
            .unwrap();
        drop(connection);

        let observed = identity
            .observe(
                &source,
                &[ObservedResourceIdentity {
                    provider_locator: "third.txt".into(),
                    legacy_locator: "third.txt".into(),
                    kind: "file".into(),
                    platform_identity: Some("collision".into()),
                    fingerprint: None,
                }],
            )
            .unwrap()[0]
            .clone();
        assert_ne!(observed, first);
        assert_ne!(observed.as_str(), "resource-collision");
        assert_eq!(
            identity.stored(&first).unwrap().unwrap().provider_locator,
            "first.txt"
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn rollback_namespace_write_wins_then_dual_writes_on_reupgrade() {
        let base = fixture("rollback-write");
        let media = base.join("media");
        std::fs::create_dir_all(&media).unwrap();
        let legacy_key = media.to_string_lossy().to_string();
        let mut config = config(
            &base,
            vec![root("config:primary", "Media", media.clone())],
            &legacy_key,
        );
        state_db::initialize(&config).unwrap();
        state_db::update_document(
            &state_db::database(&config),
            "settings",
            &legacy_key,
            serde_json::json!({}),
            |value| {
                value["marker"] = serde_json::json!("production");
                Ok(())
            },
        )
        .unwrap();
        let identity = initialize_identity(&mut config).unwrap();
        let canonical = identity.library_id().as_str();
        assert_eq!(
            state_db::document(
                identity.database(),
                "settings",
                canonical,
                serde_json::Value::Null
            )
            .unwrap()["marker"],
            "production"
        );
        state_db::update_document(
            identity.database(),
            "settings",
            canonical,
            serde_json::json!({}),
            |value| {
                value["marker"] = serde_json::json!("stage2");
                Ok(())
            },
        )
        .unwrap();

        let connection = state_db::connection(identity.database()).unwrap();
        connection
            .execute(
                "UPDATE state_documents SET value_json=?1,updated_at=updated_at+1
                 WHERE kind='settings' AND library_key=?2",
                params![r#"{"marker":"rollback"}"#, legacy_key],
            )
            .unwrap();
        drop(connection);
        assert_eq!(
            state_db::document(
                identity.database(),
                "settings",
                canonical,
                serde_json::Value::Null
            )
            .unwrap()["marker"],
            "rollback"
        );
        state_db::update_document(
            identity.database(),
            "settings",
            canonical,
            serde_json::json!({}),
            |value| {
                value["reupgraded"] = serde_json::json!(true);
                Ok(())
            },
        )
        .unwrap();
        let connection = state_db::connection(identity.database()).unwrap();
        let legacy: String = connection
            .query_row(
                "SELECT value_json FROM state_documents
                 WHERE kind='settings' AND library_key=?1",
                [&legacy_key],
                |row| row.get(0),
            )
            .unwrap();
        let legacy: serde_json::Value = serde_json::from_str(&legacy).unwrap();
        assert_eq!(legacy["marker"], "rollback");
        assert_eq!(legacy["reupgraded"], true);
        drop(connection);
        std::fs::remove_dir_all(base).unwrap();
    }
}
