use super::{LibraryId, ResourceId, SourceId};
use crate::{config::Config, error::AppError, state_db};
use rusqlite::{
    Connection, OptionalExtension, ToSql, Transaction, TransactionBehavior, params,
    params_from_iter,
};
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const SCHEMA_VERSION: i64 = 3;

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

struct IdentityMatch {
    resource_id: String,
    provider_locator: String,
    status: String,
    provider: String,
    canonical_locator: String,
    kind: String,
    fingerprint: Option<String>,
}

const EXACT_OBSERVATION_LOOKUP_CHUNK: usize = 400;
const OBSERVATION_WRITE_CHUNK: usize = 100;

struct ExactObservedIdentity {
    resource_id: String,
    platform_identity: Option<String>,
    kind: String,
    fingerprint: Option<String>,
    current_legacy_locator: Option<String>,
    status: String,
    has_current_legacy_locator: bool,
}

struct PendingIdentityWrite<'a> {
    resource_id: String,
    observed: &'a ObservedResourceIdentity,
}

fn exact_observed_identities(
    transaction: &Transaction<'_>,
    source_id: &SourceId,
    observed: &[ObservedResourceIdentity],
) -> Result<HashMap<String, ExactObservedIdentity>, AppError> {
    let mut exact = HashMap::with_capacity(observed.len());
    for chunk in observed.chunks(EXACT_OBSERVATION_LOOKUP_CHUNK) {
        let placeholders = std::iter::repeat_n("?", chunk.len())
            .collect::<Vec<_>>()
            .join(",");
        let query = format!(
            "SELECT r.provider_locator,r.id,r.platform_identity,r.kind,r.fingerprint,
               r.current_legacy_locator,r.status,
               EXISTS(
                 SELECT 1 FROM resource_legacy_locators l
                 WHERE l.resource_id=r.id AND l.legacy_locator=r.current_legacy_locator
               )
             FROM resources r
             WHERE r.source_id=? AND r.provider_locator IN ({placeholders})"
        );
        let mut statement = transaction
            .prepare(&query)
            .map_err(|error| AppError::internal(error.to_string()))?;
        let rows = statement
            .query_map(
                params_from_iter(
                    std::iter::once(source_id.as_str())
                        .chain(chunk.iter().map(|item| item.provider_locator.as_str())),
                ),
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        ExactObservedIdentity {
                            resource_id: row.get(1)?,
                            platform_identity: row.get(2)?,
                            kind: row.get(3)?,
                            fingerprint: row.get(4)?,
                            current_legacy_locator: row.get(5)?,
                            status: row.get(6)?,
                            has_current_legacy_locator: row.get(7)?,
                        },
                    ))
                },
            )
            .map_err(|error| AppError::internal(error.to_string()))?;
        for row in rows {
            let (provider_locator, identity) =
                row.map_err(|error| AppError::internal(error.to_string()))?;
            exact.insert(provider_locator, identity);
        }
    }
    Ok(exact)
}

fn identity_matches_by_key(
    transaction: &Transaction<'_>,
    source_id: &SourceId,
    column: &'static str,
    keys: &[&str],
) -> Result<HashMap<String, Vec<IdentityMatch>>, AppError> {
    debug_assert!(matches!(column, "platform_identity" | "fingerprint"));
    let mut matches = HashMap::<String, Vec<IdentityMatch>>::new();
    for chunk in keys.chunks(EXACT_OBSERVATION_LOOKUP_CHUNK) {
        let placeholders = std::iter::repeat_n("?", chunk.len())
            .collect::<Vec<_>>()
            .join(",");
        let query = format!(
            "SELECT r.{column},r.id,r.provider_locator,r.status,s.provider,
               s.canonical_locator,r.kind,r.fingerprint
             FROM resources r
             JOIN sources s ON s.id=r.source_id
             WHERE r.source_id=? AND r.{column} IN ({placeholders})"
        );
        let mut statement = transaction
            .prepare(&query)
            .map_err(|error| AppError::internal(error.to_string()))?;
        let rows = statement
            .query_map(
                params_from_iter(std::iter::once(source_id.as_str()).chain(chunk.iter().copied())),
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        IdentityMatch {
                            resource_id: row.get(1)?,
                            provider_locator: row.get(2)?,
                            status: row.get(3)?,
                            provider: row.get(4)?,
                            canonical_locator: row.get(5)?,
                            kind: row.get(6)?,
                            fingerprint: row.get(7)?,
                        },
                    ))
                },
            )
            .map_err(|error| AppError::internal(error.to_string()))?;
        for row in rows {
            let (key, identity) = row.map_err(|error| AppError::internal(error.to_string()))?;
            matches.entry(key).or_default().push(identity);
        }
    }
    Ok(matches)
}

fn write_observed_identities(
    transaction: &Transaction<'_>,
    library_id: &LibraryId,
    source_id: &SourceId,
    writes: &[PendingIdentityWrite<'_>],
    now: i64,
) -> Result<(), AppError> {
    let library_id = library_id.as_str().to_string();
    let source_id = source_id.as_str().to_string();
    for chunk in writes.chunks(OBSERVATION_WRITE_CHUNK) {
        let rows = std::iter::repeat_n("(?,?,?,?,?,?,?,?,'present',?,?,NULL)", chunk.len())
            .collect::<Vec<_>>()
            .join(",");
        let query = format!(
            "INSERT INTO resources(
               id,library_id,source_id,provider_locator,kind,platform_identity,
               fingerprint,current_legacy_locator,status,first_seen_at,last_seen_at,
               missing_since
             ) VALUES {rows}
             ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,
               platform_identity=COALESCE(excluded.platform_identity,resources.platform_identity),
               fingerprint=excluded.fingerprint,
               current_legacy_locator=excluded.current_legacy_locator,
               status='present',missing_since=NULL,last_seen_at=excluded.last_seen_at"
        );
        let mut values = Vec::<&dyn ToSql>::with_capacity(chunk.len() * 10);
        for write in chunk {
            values.extend([
                &write.resource_id as &dyn ToSql,
                &library_id,
                &source_id,
                &write.observed.provider_locator,
                &write.observed.kind,
                &write.observed.platform_identity,
                &write.observed.fingerprint,
                &write.observed.legacy_locator,
                &now,
                &now,
            ]);
        }
        transaction
            .execute(&query, params_from_iter(values))
            .map_err(|error| AppError::internal(error.to_string()))?;
    }
    for chunk in writes.chunks(OBSERVATION_WRITE_CHUNK) {
        let rows = std::iter::repeat_n("(?,?,?,?)", chunk.len())
            .collect::<Vec<_>>()
            .join(",");
        let query = format!(
            "INSERT INTO resource_legacy_locators(
               resource_id,legacy_locator,first_seen_at,last_seen_at
             ) VALUES {rows}
             ON CONFLICT(resource_id,legacy_locator) DO UPDATE
               SET last_seen_at=excluded.last_seen_at"
        );
        let mut values = Vec::<&dyn ToSql>::with_capacity(chunk.len() * 4);
        for write in chunk {
            values.extend([
                &write.resource_id as &dyn ToSql,
                &write.observed.legacy_locator,
                &now,
                &now,
            ]);
        }
        transaction
            .execute(&query, params_from_iter(values))
            .map_err(|error| AppError::internal(error.to_string()))?;
    }
    Ok(())
}

fn stable_exact_identity<'a>(
    exact: &'a ExactObservedIdentity,
    observed: &ObservedResourceIdentity,
) -> Option<&'a str> {
    let platform_unchanged = observed
        .platform_identity
        .as_ref()
        .is_none_or(|identity| exact.platform_identity.as_ref() == Some(identity));
    (exact.status == "present"
        && exact.kind == observed.kind
        && platform_unchanged
        && exact.fingerprint == observed.fingerprint
        && exact.current_legacy_locator.as_deref() == Some(&observed.legacy_locator)
        && exact.has_current_legacy_locator)
        .then_some(exact.resource_id.as_str())
}

fn exact_identity_conflicts(
    exact: &ExactObservedIdentity,
    observed: &ObservedResourceIdentity,
) -> bool {
    let platform_conflict = observed.platform_identity.as_ref().is_some_and(|identity| {
        exact
            .platform_identity
            .as_ref()
            .is_some_and(|stored| stored != identity)
    });
    let weak_fingerprint_conflict = exact.platform_identity.is_none()
        && observed.platform_identity.is_none()
        && exact
            .fingerprint
            .as_ref()
            .zip(observed.fingerprint.as_ref())
            .is_some_and(|(stored, identity)| stored != identity);
    exact.kind != observed.kind || platform_conflict || weak_fingerprint_conflict
}

fn prior_locator_is_absent(candidate: &IdentityMatch) -> bool {
    if candidate.status == "missing" {
        return true;
    }
    if candidate.provider != "filesystem" {
        return false;
    }
    let relative = Path::new(&candidate.provider_locator);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_) | Component::CurDir))
    {
        return false;
    }
    !Path::new(&candidate.canonical_locator)
        .join(relative)
        .exists()
}

fn can_relocate_identity(candidate: &IdentityMatch, observed: &ObservedResourceIdentity) -> bool {
    let fingerprints_compatible = match (&candidate.fingerprint, &observed.fingerprint) {
        (Some(stored), Some(observed)) => stored == observed,
        _ => true,
    };
    candidate.kind == observed.kind && fingerprints_compatible && prior_locator_is_absent(candidate)
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct StoredSourceIdentity {
    pub(crate) source_id: SourceId,
    pub(crate) root_resource_id: ResourceId,
    pub(crate) display_name: String,
}

#[derive(Clone, Debug)]
struct SourceRow {
    id: String,
    configured_id: Option<String>,
    canonical_locator: String,
    status: String,
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

pub(crate) fn canonical_filesystem_locator(path: &Path) -> Result<String, String> {
    let absolute = std::fs::canonicalize(path)
        .or_else(|_| std::path::absolute(path))
        .map_err(|error| error.to_string())?;
    let value = absolute.to_string_lossy().replace('\\', "/");
    #[cfg(windows)]
    {
        let value = value.to_lowercase();
        if let Some(network) = value.strip_prefix("//?/unc/") {
            return Ok(format!("//{network}"));
        }
        return Ok(value.strip_prefix("//?/").unwrap_or(&value).to_string());
    }
    #[cfg(not(windows))]
    Ok(value)
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
    if version == 2 {
        transaction
            .execute_batch(
                "ALTER TABLE resources
                   ADD COLUMN current_legacy_locator TEXT NOT NULL DEFAULT '';
                 UPDATE resources
                 SET current_legacy_locator=COALESCE(
                   (SELECT legacy_locator FROM resource_legacy_locators
                    WHERE resource_id=resources.id
                    ORDER BY last_seen_at DESC,legacy_locator
                    LIMIT 1),
                   provider_locator
                 );",
            )
            .map_err(sql_error)?;
        transaction
            .execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES(?1, ?2)",
                params![SCHEMA_VERSION, now_ms()],
            )
            .map_err(sql_error)?;
        return transaction.commit().map_err(sql_error);
    }
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
               current_legacy_locator TEXT NOT NULL,
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
    if current.is_empty() || candidate.is_empty() {
        return false;
    }
    if current.len() != candidate.len() {
        let (smaller, larger) = if current.len() < candidate.len() {
            (&current, &candidate)
        } else {
            (&candidate, &current)
        };
        let unique_smaller_paths = smaller
            .iter()
            .map(|(_, path)| path)
            .collect::<BTreeSet<_>>();
        let unique_larger_paths = larger.iter().map(|(_, path)| path).collect::<BTreeSet<_>>();
        if unique_smaller_paths.len() != smaller.len() || unique_larger_paths.len() != larger.len()
        {
            return false;
        }
        return unique_smaller_paths.is_subset(&unique_larger_paths);
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
            "Resource identity recovery required: configured root names and paths do not match retained application state. Restore a prior root name or path and start once; then assign a stable mediaDirs id before changing the remaining value. Current legacy key: {current}"
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
            "SELECT id,configured_id,canonical_locator,status
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
                status: row.get(3)?,
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
    let mut matches = Vec::new();
    let mut configured_paths = HashMap::<String, &str>::new();
    for root in &config.roots {
        let locator = canonical_filesystem_locator(&root.path)?;
        if let Some(existing_name) = configured_paths.insert(locator.clone(), &root.name) {
            return Err(format!(
                "Resource identity recovery required: configured Sources \"{existing_name}\" and \"{}\" use the same canonical filesystem path",
                root.name
            ));
        }
        let explicit = explicit_configured_id(&root.id);
        matches.push((root, locator, explicit.map(str::to_string), None));
    }

    let mut strong_claims = HashMap::<String, usize>::new();
    let mut strong_proposals = Vec::new();
    for (index, (root, locator, explicit, _)) in matches.iter().enumerate() {
        let candidates = existing
            .iter()
            .filter(|source| {
                explicit
                    .as_deref()
                    .is_some_and(|id| source.configured_id.as_deref() == Some(id))
                    || source.canonical_locator == *locator
            })
            .collect::<Vec<_>>();
        if candidates.len() > 1 {
            return Err(format!(
                "Resource identity recovery required: configured Source \"{}\" matches multiple retained Sources",
                root.name
            ));
        }
        if let Some(source) = candidates.first() {
            if let Some(other_index) = strong_claims.insert(source.id.clone(), index) {
                return Err(format!(
                    "Resource identity recovery required: configured Sources \"{}\" and \"{}\" match the same retained Source",
                    matches[other_index].0.name, root.name
                ));
            }
            strong_proposals.push((index, source.id.clone()));
        }
    }
    for (index, source_id) in strong_proposals {
        matches[index].3 = Some(source_id);
    }

    let mut used = strong_claims.into_keys().collect::<HashSet<_>>();
    let mut legacy_claims = HashMap::<String, usize>::new();
    let mut legacy_proposals = Vec::new();
    for (index, (root, _, _, matched)) in matches.iter().enumerate() {
        if matched.is_some() {
            continue;
        }
        let candidates = existing
            .iter()
            .filter(|source| !used.contains(&source.id))
            .filter(|source| source.legacy_ids.contains(&root.id))
            .collect::<Vec<_>>();
        if candidates.len() > 1 {
            return Err(format!(
                "Resource identity recovery required: configured Source \"{}\" matches multiple retained Sources",
                root.name
            ));
        }
        if let Some(source) = candidates.first() {
            if let Some(other_index) = legacy_claims.insert(source.id.clone(), index) {
                return Err(format!(
                    "Resource identity recovery required: configured Sources \"{}\" and \"{}\" match the same retained Source only through historical aliases",
                    matches[other_index].0.name, root.name
                ));
            }
            legacy_proposals.push((index, source.id.clone()));
        }
    }
    for (index, source_id) in legacy_proposals {
        used.insert(source_id.clone());
        matches[index].3 = Some(source_id);
    }
    let unmatched_existing = existing
        .iter()
        .filter(|source| !used.contains(&source.id))
        .filter(|source| source.status == "present")
        .count();
    let unmatched_roots = matches
        .iter()
        .filter(|(_, _, _, source_id)| source_id.is_none())
        .count();
    if unmatched_existing > 0 && unmatched_roots > 0 {
        return Err(
            "Resource identity recovery required: a configured Source changed both display name and path without a retained explicit id. Restore either the old display name or old path and start once; then assign a stable id before changing the remaining value."
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
    state_db::synchronize_library_namespaces(&transaction, &library_id).map_err(|error| error.1)?;
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
        let locator = canonical_filesystem_locator(path).map_err(AppError::internal)?;
        let connection = state_db::connection(&self.database)?;
        connection
            .query_row(
                "SELECT s.id,s.root_resource_id
                 FROM sources s
                 LEFT JOIN source_legacy_keys k ON k.source_id=s.id
                 WHERE s.library_id=?1 AND s.provider='filesystem'
                   AND (k.legacy_id=?2 OR s.canonical_locator=?3)
                 ORDER BY CASE WHEN s.canonical_locator=?3 THEN 0 ELSE 1 END,s.id
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

    pub(crate) fn source_by_root_resource(
        &self,
        resource_id: &ResourceId,
    ) -> Result<Option<StoredSourceIdentity>, AppError> {
        let connection = state_db::connection(&self.database)?;
        connection
            .query_row(
                "SELECT id,root_resource_id,display_name FROM sources
                 WHERE library_id=?1 AND provider='filesystem' AND root_resource_id=?2",
                params![self.library_id.as_str(), resource_id.as_str()],
                |row| {
                    Ok(StoredSourceIdentity {
                        source_id: SourceId::new(row.get::<_, String>(0)?),
                        root_resource_id: ResourceId::new(row.get::<_, String>(1)?),
                        display_name: row.get(2)?,
                    })
                },
            )
            .optional()
            .map_err(|error| AppError::internal(error.to_string()))
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
            let locator = canonical_filesystem_locator(&root.path).map_err(AppError::internal)?;
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
        let exact_observed = exact_observed_identities(&transaction, source_id, observed)?;
        let mut platform_counts = HashMap::<String, usize>::new();
        let mut fingerprint_counts = HashMap::<String, usize>::new();
        for item in observed {
            if let Some(identity) = &item.platform_identity {
                *platform_counts.entry(identity.clone()).or_default() += 1;
            }
            if let Some(fingerprint) = &item.fingerprint {
                *fingerprint_counts.entry(fingerprint.clone()).or_default() += 1;
            }
        }
        let needs_identity_match = |item: &ObservedResourceIdentity| {
            exact_observed
                .get(&item.provider_locator)
                .is_none_or(|exact| exact_identity_conflicts(exact, item))
        };
        let platform_keys = observed
            .iter()
            .filter(|item| needs_identity_match(item))
            .filter_map(|item| item.platform_identity.as_deref())
            .filter(|identity| platform_counts.get(*identity) == Some(&1))
            .collect::<HashSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let fingerprint_keys = observed
            .iter()
            .filter(|item| needs_identity_match(item))
            .filter(|item| item.platform_identity.is_none())
            .filter_map(|item| item.fingerprint.as_deref())
            .filter(|fingerprint| fingerprint_counts.get(*fingerprint) == Some(&1))
            .collect::<HashSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let platform_matches =
            identity_matches_by_key(&transaction, source_id, "platform_identity", &platform_keys)?;
        let fingerprint_matches =
            identity_matches_by_key(&transaction, source_id, "fingerprint", &fingerprint_keys)?;
        let mut pending_writes = Vec::with_capacity(observed.len());
        {
            let mut mark_missing = transaction
                .prepare(
                    "UPDATE resources SET provider_locator=?2,status='missing',
                       missing_since=COALESCE(missing_since,?3),last_seen_at=?3
                     WHERE id=?1",
                )
                .map_err(|error| AppError::internal(error.to_string()))?;
            let mut relocate = transaction
                .prepare(
                    "UPDATE resources SET provider_locator=?2,status='present',
                       missing_since=NULL,last_seen_at=?3,kind=?4,fingerprint=?5,
                       current_legacy_locator=?6
                     WHERE id=?1",
                )
                .map_err(|error| AppError::internal(error.to_string()))?;

            for item in observed {
                if let Some(resource_id) = exact_observed
                    .get(&item.provider_locator)
                    .and_then(|exact| stable_exact_identity(exact, item))
                {
                    result.push(ResourceId::new(resource_id));
                    continue;
                }
                let exact = if let Some(exact) = exact_observed.get(&item.provider_locator) {
                    if exact_identity_conflicts(exact, item) {
                        mark_missing
                            .execute(params![
                                exact.resource_id,
                                format!("missing:{}:{}", exact.resource_id, uuid::Uuid::new_v4()),
                                now
                            ])
                            .map_err(|error| AppError::internal(error.to_string()))?;
                        None
                    } else {
                        Some(exact.resource_id.clone())
                    }
                } else {
                    None
                };
                let resource_id = if let Some(resource_id) = exact {
                    resource_id
                } else {
                    let no_matches: &[IdentityMatch] = &[];
                    let matches = item
                        .platform_identity
                        .as_ref()
                        .filter(|identity| platform_counts.get(*identity) == Some(&1))
                        .and_then(|identity| platform_matches.get(identity))
                        .map(Vec::as_slice)
                        .unwrap_or(no_matches);
                    let matches = if item.platform_identity.is_none() && matches.is_empty() {
                        item.fingerprint
                            .as_ref()
                            .filter(|fingerprint| fingerprint_counts.get(*fingerprint) == Some(&1))
                            .and_then(|fingerprint| fingerprint_matches.get(fingerprint))
                            .map(Vec::as_slice)
                            .unwrap_or(matches)
                    } else {
                        matches
                    };
                    if matches.len() == 1 && can_relocate_identity(&matches[0], item) {
                        relocate
                            .execute(params![
                                matches[0].resource_id,
                                item.provider_locator,
                                now,
                                item.kind,
                                item.fingerprint,
                                item.legacy_locator
                            ])
                            .map_err(|error| AppError::internal(error.to_string()))?;
                        matches[0].resource_id.clone()
                    } else {
                        format!("resource-{}", uuid::Uuid::new_v4())
                    }
                };
                result.push(ResourceId::new(resource_id.clone()));
                pending_writes.push(PendingIdentityWrite {
                    resource_id,
                    observed: item,
                });
            }
        }
        write_observed_identities(
            &transaction,
            &self.library_id,
            source_id,
            &pending_writes,
            now,
        )?;
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
                "SELECT id,source_id,provider_locator,kind,status,current_legacy_locator
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

    pub(crate) fn matches_physical_observation(
        &self,
        resource_id: &ResourceId,
        source_id: &SourceId,
        observed: &ObservedResourceIdentity,
    ) -> Result<bool, AppError> {
        let connection = state_db::connection(&self.database)?;
        let expected = connection
            .query_row(
                "SELECT source_id,kind,platform_identity FROM resources
                 WHERE library_id=?1 AND id=?2",
                params![self.library_id.as_str(), resource_id.as_str()],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| AppError::internal(error.to_string()))?;
        let Some((expected_source, expected_kind, Some(expected_platform))) = expected else {
            return Ok(false);
        };
        Ok(expected_source == source_id.as_str()
            && expected_kind == observed.kind
            && observed.platform_identity.as_deref() == Some(expected_platform.as_str()))
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

    pub(crate) fn mark_prefix_missing(
        &self,
        source_id: &SourceId,
        locator: &str,
    ) -> Result<Vec<ResourceId>, AppError> {
        let mut connection = state_db::connection(&self.database)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| AppError::internal(error.to_string()))?;
        let ids = {
            let mut statement = transaction
                .prepare(
                    "SELECT id FROM resources WHERE source_id=?1 AND (
                       provider_locator=?2 OR
                       substr(provider_locator,1,length(?2)+1)=?2 || '/'
                     ) ORDER BY length(provider_locator),id",
                )
                .map_err(|error| AppError::internal(error.to_string()))?;
            statement
                .query_map(params![source_id.as_str(), locator], |row| {
                    row.get::<_, String>(0).map(ResourceId::new)
                })
                .map_err(|error| AppError::internal(error.to_string()))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| AppError::internal(error.to_string()))?
        };
        transaction
            .execute(
                "UPDATE resources SET status='missing',missing_since=COALESCE(missing_since,?3),
                   last_seen_at=?3
                 WHERE source_id=?1 AND (
                   provider_locator=?2 OR
                   substr(provider_locator,1,length(?2)+1)=?2 || '/'
                 )",
                params![source_id.as_str(), locator, now_ms()],
            )
            .map_err(|error| AppError::internal(error.to_string()))?;
        transaction
            .commit()
            .map_err(|error| AppError::internal(error.to_string()))?;
        Ok(ids)
    }

    pub(crate) fn rebind_after_command(
        &self,
        resource_id: &ResourceId,
        source_id: &SourceId,
        observed: &ObservedResourceIdentity,
    ) -> Result<(), AppError> {
        let mut connection = state_db::connection(&self.database)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| AppError::internal(error.to_string()))?;
        let exists: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM resources WHERE library_id=?1 AND id=?2)",
                params![self.library_id.as_str(), resource_id.as_str()],
                |row| row.get(0),
            )
            .map_err(|error| AppError::internal(error.to_string()))?;
        if !exists {
            return Err(AppError::not_found("Resource identity is unavailable"));
        }
        let now = now_ms();
        transaction
            .execute(
                "UPDATE resources SET provider_locator='missing:' || id || ':' || ?4,
                   status='missing',missing_since=COALESCE(missing_since,?5),last_seen_at=?5
                 WHERE source_id=?1 AND provider_locator=?2 AND id<>?3",
                params![
                    source_id.as_str(),
                    observed.provider_locator,
                    resource_id.as_str(),
                    uuid::Uuid::new_v4().to_string(),
                    now
                ],
            )
            .map_err(|error| AppError::internal(error.to_string()))?;
        transaction
            .execute(
                "UPDATE resources SET source_id=?2,provider_locator=?3,kind=?4,
                   platform_identity=?5,fingerprint=?6,current_legacy_locator=?7,
                   status='present',missing_since=NULL,last_seen_at=?8 WHERE id=?1",
                params![
                    resource_id.as_str(),
                    source_id.as_str(),
                    observed.provider_locator,
                    observed.kind,
                    observed.platform_identity,
                    observed.fingerprint,
                    observed.legacy_locator,
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
                params![resource_id.as_str(), observed.legacy_locator, now],
            )
            .map_err(|error| AppError::internal(error.to_string()))?;
        transaction
            .commit()
            .map_err(|error| AppError::internal(error.to_string()))
    }

    pub(crate) fn by_legacy_locator(
        &self,
        legacy_locator: &str,
    ) -> Result<Vec<StoredResourceIdentity>, AppError> {
        let connection = state_db::connection(&self.database)?;
        let mut statement = connection
            .prepare(
                "SELECT r.id,r.source_id,r.provider_locator,r.kind,r.status,
                   r.current_legacy_locator
                 FROM resource_legacy_locators l
                 JOIN resources r ON r.id=l.resource_id
                 WHERE r.library_id=?1 AND l.legacy_locator=?2
                 ORDER BY l.last_seen_at DESC,r.id",
            )
            .map_err(|error| AppError::internal(error.to_string()))?;
        statement
            .query_map(params![self.library_id.as_str(), legacy_locator], |row| {
                Ok(StoredResourceIdentity {
                    resource_id: ResourceId::new(row.get::<_, String>(0)?),
                    source_id: SourceId::new(row.get::<_, String>(1)?),
                    provider_locator: row.get(2)?,
                    kind: row.get(3)?,
                    status: row.get(4)?,
                    legacy_locator: row.get(5)?,
                })
            })
            .map_err(|error| AppError::internal(error.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| AppError::internal(error.to_string()))
    }

    pub(crate) fn relocate(
        &self,
        source_id: &SourceId,
        old_locator: &str,
        new_locator: &str,
        new_legacy_locator: &str,
    ) -> Result<Vec<ResourceId>, AppError> {
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
    ) -> Result<Vec<ResourceId>, AppError> {
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
        let mut relocated_ids = Vec::with_capacity(resources.len());
        for (resource_id, old_resource_locator) in resources {
            let suffix = old_resource_locator
                .strip_prefix(old_locator)
                .unwrap_or_default();
            let relocated = format!("{new_locator}{suffix}");
            let legacy = format!("{new_legacy_locator}{suffix}");
            transaction
                .execute(
                    "UPDATE resources SET
                       provider_locator='missing:' || id || ':' || ?4,
                       status='missing',missing_since=COALESCE(missing_since,?5),
                       last_seen_at=?5
                     WHERE source_id=?1 AND provider_locator=?2 AND id<>?3",
                    params![
                        destination_source_id.as_str(),
                        relocated,
                        resource_id,
                        uuid::Uuid::new_v4().to_string(),
                        now
                    ],
                )
                .map_err(|error| AppError::internal(error.to_string()))?;
            transaction
                .execute(
                    "UPDATE resources SET source_id=?2,provider_locator=?3,
                       current_legacy_locator=?4,
                       platform_identity=CASE WHEN ?6=?2 THEN platform_identity ELSE NULL END,
                       fingerprint=CASE WHEN ?6=?2 THEN fingerprint ELSE NULL END,
                       status='present',missing_since=NULL,last_seen_at=?5
                     WHERE id=?1",
                    params![
                        resource_id,
                        destination_source_id.as_str(),
                        relocated,
                        legacy,
                        now,
                        source_id.as_str(),
                    ],
                )
                .map_err(|error| AppError::internal(error.to_string()))?;
            relocated_ids.push(ResourceId::new(resource_id.clone()));
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
            .map_err(|error| AppError::internal(error.to_string()))?;
        Ok(relocated_ids)
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
    fn historical_display_alias_cannot_steal_path_claim_across_root_reorder() {
        let base = fixture("source-old-name-reuse");
        let original = base.join("original");
        let added = base.join("added");
        std::fs::create_dir_all(&original).unwrap();
        std::fs::create_dir_all(&added).unwrap();
        let mut initial = config(
            &base,
            vec![root("config:foo", "Foo", original.clone())],
            original.to_str().unwrap(),
        );
        state_db::initialize(&initial).unwrap();
        let first = initialize_identity(&mut initial).unwrap();
        let original_source = first.source_for_root("config:foo", &original).unwrap().0;

        let mut reused_name_first = config(
            &base,
            vec![
                root("config:foo", "Foo", added.clone()),
                root("configured:a", "Bar", original.clone()),
            ],
            &format!("Foo:{}|Bar:{}", added.display(), original.display()),
        );
        state_db::initialize(&reused_name_first).unwrap();
        let second = initialize_identity(&mut reused_name_first).unwrap();
        let retained = second.source_for_root("configured:a", &original).unwrap().0;
        let added_source = second.source_for_root("config:foo", &added).unwrap().0;

        assert_eq!(retained, original_source);
        assert_ne!(added_source, original_source);

        let mut reordered = config(
            &base,
            vec![
                root("configured:a", "Bar", original.clone()),
                root("config:foo", "Foo", added.clone()),
            ],
            &format!("Bar:{}|Foo:{}", original.display(), added.display()),
        );
        state_db::initialize(&reordered).unwrap();
        let third = initialize_identity(&mut reordered).unwrap();
        assert_eq!(
            third.source_for_root("configured:a", &original).unwrap().0,
            original_source
        );
        assert_eq!(
            third.source_for_root("config:foo", &added).unwrap().0,
            added_source
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn duplicate_canonical_configured_root_paths_require_recovery() {
        let base = fixture("source-duplicate-canonical-path");
        let media = base.join("media");
        std::fs::create_dir_all(&media).unwrap();
        let mut config = config(
            &base,
            vec![
                root("configured:one", "One", media.clone()),
                root("configured:two", "Two", media.clone()),
            ],
            &format!("One:{}|Two:{}", media.display(), media.display()),
        );
        state_db::initialize(&config).unwrap();

        let error = initialize_identity(&mut config).unwrap_err();

        assert!(error.contains("same canonical filesystem path"));
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn duplicate_historical_source_alias_without_path_match_requires_recovery() {
        let base = fixture("source-duplicate-historical-alias");
        let one = base.join("one");
        let two = base.join("two");
        let replacement = base.join("replacement");
        std::fs::create_dir_all(&one).unwrap();
        std::fs::create_dir_all(&two).unwrap();
        std::fs::create_dir_all(&replacement).unwrap();
        let mut initial = config(
            &base,
            vec![
                root("config:foo", "Foo", one.clone()),
                root("config:bar", "Bar", two.clone()),
            ],
            &format!("Foo:{}|Bar:{}", one.display(), two.display()),
        );
        state_db::initialize(&initial).unwrap();
        let identity = initialize_identity(&mut initial).unwrap();
        let second_source = identity.source_for_root("config:bar", &two).unwrap().0;
        let connection = state_db::connection(identity.database()).unwrap();
        connection
            .execute(
                "INSERT INTO source_legacy_keys(source_id,legacy_id,first_seen_at,last_seen_at)
                 VALUES(?1,'config:foo',1,1)",
                [second_source.as_str()],
            )
            .unwrap();
        drop(connection);

        let mut ambiguous = config(
            &base,
            vec![root("config:foo", "Foo", replacement.clone())],
            replacement.to_str().unwrap(),
        );
        state_db::initialize(&ambiguous).unwrap();
        let error = initialize_identity(&mut ambiguous).unwrap_err();

        assert!(error.contains("matches multiple retained Sources"));
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
    fn explicit_source_id_allows_simultaneous_name_and_path_change() {
        let base = fixture("explicit-id");
        let original = base.join("original");
        let replacement = base.join("replacement");
        std::fs::create_dir_all(&original).unwrap();
        std::fs::create_dir_all(&replacement).unwrap();
        let mut initial = config(
            &base,
            vec![root(
                "configured:stable-media",
                "Original",
                original.clone(),
            )],
            original.to_str().unwrap(),
        );
        state_db::initialize(&initial).unwrap();
        let first = initialize_identity(&mut initial).unwrap();
        let source = first
            .source_for_root("configured:stable-media", &original)
            .unwrap();

        let mut changed = config(
            &base,
            vec![root(
                "configured:stable-media",
                "Replacement",
                replacement.clone(),
            )],
            replacement.to_str().unwrap(),
        );
        state_db::initialize(&changed).unwrap();
        let second = initialize_identity(&mut changed).unwrap();

        assert_eq!(second.library_id(), first.library_id());
        assert_eq!(
            second
                .source_for_root("configured:stable-media", &replacement)
                .unwrap(),
            source
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn removed_source_does_not_block_adding_a_different_source_after_restart() {
        let base = fixture("remove-restart-add");
        let retained = base.join("retained");
        let removed = base.join("removed");
        let added = base.join("added");
        std::fs::create_dir_all(&retained).unwrap();
        std::fs::create_dir_all(&removed).unwrap();
        std::fs::create_dir_all(&added).unwrap();
        let mut initial = config(
            &base,
            vec![
                root("config:retained", "Retained", retained.clone()),
                root("config:removed", "Removed", removed.clone()),
            ],
            &format!(
                "Retained:{}|Removed:{}",
                retained.display(),
                removed.display()
            ),
        );
        state_db::initialize(&initial).unwrap();
        let first = initialize_identity(&mut initial).unwrap();
        let retained_source = first
            .source_for_root("config:retained", &retained)
            .unwrap()
            .0;

        let mut after_removal = config(
            &base,
            vec![root("config:retained", "Retained", retained.clone())],
            retained.to_str().unwrap(),
        );
        state_db::initialize(&after_removal).unwrap();
        initialize_identity(&mut after_removal).unwrap();

        let mut after_addition = config(
            &base,
            vec![
                root("config:retained", "Retained", retained.clone()),
                root("config:added", "Added", added.clone()),
            ],
            &format!("Retained:{}|Added:{}", retained.display(), added.display()),
        );
        state_db::initialize(&after_addition).unwrap();
        let third = initialize_identity(&mut after_addition).unwrap();

        assert_eq!(
            third
                .source_for_root("config:retained", &retained)
                .unwrap()
                .0,
            retained_source
        );
        assert_ne!(
            third.source_for_root("config:added", &added).unwrap().0,
            retained_source
        );
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
                "SELECT COUNT(*) FROM schema_migrations WHERE version=3",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(versions, 1);
        drop(connection);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn first_stage2_upgrade_accepts_one_to_two_root_namespace_change() {
        let base = fixture("first-upgrade-one-to-two-roots");
        let retained = base.join("retained");
        let added = base.join("added");
        std::fs::create_dir_all(&retained).unwrap();
        std::fs::create_dir_all(&added).unwrap();
        let old_key = retained.to_string_lossy().to_string();
        let current_key = format!("Cinema:{}|Added:{}", retained.display(), added.display());
        let mut config = config(
            &base,
            vec![
                root("config:retained", "Cinema", retained.clone()),
                root("config:added", "Added", added.clone()),
            ],
            &current_key,
        );
        state_db::initialize(&config).unwrap();
        state_db::update_document(
            &state_db::database(&config),
            "settings",
            &old_key,
            serde_json::json!({}),
            |value| {
                value["marker"] = serde_json::json!("production-one-root");
                Ok(())
            },
        )
        .unwrap();

        let identity = initialize_identity(&mut config).unwrap();

        assert_eq!(
            state_db::document(
                identity.database(),
                "settings",
                identity.library_id().as_str(),
                serde_json::Value::Null,
            )
            .unwrap()["marker"],
            "production-one-root"
        );
        let connection = state_db::connection(identity.database()).unwrap();
        let retained_keys: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM legacy_library_keys
                 WHERE library_id=?1 AND legacy_key IN (?2,?3)",
                params![identity.library_id().as_str(), old_key, current_key],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(retained_keys, 2);
        drop(connection);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn first_stage2_upgrade_accepts_two_to_one_root_namespace_change() {
        let base = fixture("first-upgrade-two-to-one-roots");
        let retained = base.join("retained");
        let removed = base.join("removed");
        std::fs::create_dir_all(&retained).unwrap();
        std::fs::create_dir_all(&removed).unwrap();
        let old_key = format!(
            "Movies:{}|Removed:{}",
            retained.display(),
            removed.display()
        );
        let current_key = retained.to_string_lossy().to_string();
        let mut config = config(
            &base,
            vec![root("config:retained", "Cinema", retained.clone())],
            &current_key,
        );
        state_db::initialize(&config).unwrap();
        state_db::update_document(
            &state_db::database(&config),
            "settings",
            &old_key,
            serde_json::json!({}),
            |value| {
                value["marker"] = serde_json::json!("production-two-roots");
                Ok(())
            },
        )
        .unwrap();

        let identity = initialize_identity(&mut config).unwrap();

        assert_eq!(
            state_db::document(
                identity.database(),
                "settings",
                identity.library_id().as_str(),
                serde_json::Value::Null,
            )
            .unwrap()["marker"],
            "production-two-roots"
        );
        let connection = state_db::connection(identity.database()).unwrap();
        let retained_keys: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM legacy_library_keys
                 WHERE library_id=?1 AND legacy_key IN (?2,?3)",
                params![identity.library_id().as_str(), old_key, current_key],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(retained_keys, 2);
        drop(connection);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn first_stage2_upgrade_halts_for_ambiguous_root_count_namespaces() {
        let base = fixture("first-upgrade-ambiguous-root-count");
        let one = base.join("one");
        let two = base.join("two");
        std::fs::create_dir_all(&one).unwrap();
        std::fs::create_dir_all(&two).unwrap();
        let current_key = format!("One:{}|Two:{}", one.display(), two.display());
        let mut config = config(
            &base,
            vec![
                root("config:one", "One", one.clone()),
                root("config:two", "Two", two.clone()),
            ],
            &current_key,
        );
        state_db::initialize(&config).unwrap();
        for legacy_key in [one.to_string_lossy(), two.to_string_lossy()] {
            state_db::update_document(
                &state_db::database(&config),
                "settings",
                &legacy_key,
                serde_json::json!({}),
                |value| {
                    value["marker"] = serde_json::json!(legacy_key);
                    Ok(())
                },
            )
            .unwrap();
        }

        let error = initialize_identity(&mut config).unwrap_err();

        assert!(error.contains("multiple retained application-state namespaces"));
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn unequal_root_count_namespace_comparison_ignores_display_renames() {
        let retained_one = normalize_key_path("/library/one");
        let retained_two = normalize_key_path("/library/two");
        let added = normalize_key_path("/library/added");
        let old_key = format!("Movies:{retained_one}|Books:{retained_two}");
        let current_key = format!("Cinema:{retained_one}|Reading:{retained_two}|Added:{added}");

        assert_eq!(
            select_initial_legacy_keys(&current_key, std::slice::from_ref(&old_key)).unwrap(),
            [old_key, current_key]
        );
    }

    #[test]
    fn skipped_legacy_json_upgrade_imports_directly_through_resource_schema() {
        let base = fixture("skipped-json");
        let media = base.join("media");
        let data = base.join("data");
        std::fs::create_dir_all(&media).unwrap();
        std::fs::create_dir_all(&data).unwrap();
        let legacy_key = media.to_string_lossy().to_string();
        std::fs::write(
            data.join("settings.json"),
            serde_json::to_vec(&serde_json::json!({
                legacy_key.clone(): {"favorites":["one.jpg"],"future":true}
            }))
            .unwrap(),
        )
        .unwrap();
        let mut config = config(
            &base,
            vec![root("config:primary", "Media", media)],
            &legacy_key,
        );

        state_db::initialize(&config).unwrap();
        let identity = initialize_identity(&mut config).unwrap();

        let settings = state_db::document(
            identity.database(),
            "settings",
            identity.library_id().as_str(),
            serde_json::Value::Null,
        )
        .unwrap();
        assert_eq!(settings["favorites"], serde_json::json!(["one.jpg"]));
        assert_eq!(settings["future"], true);
        let connection = state_db::connection(identity.database()).unwrap();
        let versions = connection
            .prepare("SELECT version FROM schema_migrations ORDER BY version")
            .unwrap()
            .query_map([], |row| row.get::<_, i64>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(versions, [1, 3]);
        drop(connection);
        assert!(data.join("legacy-json-backup").is_dir());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn intermediate_resource_schema_upgrades_without_rebinding_legacy_locator() {
        let base = fixture("resource-v2-upgrade");
        let media = base.join("media");
        std::fs::create_dir_all(&media).unwrap();
        let mut initial = config(
            &base,
            vec![root("config:primary", "Media", media.clone())],
            media.to_str().unwrap(),
        );
        state_db::initialize(&initial).unwrap();
        let identity = initialize_identity(&mut initial).unwrap();
        let (source_id, _) = identity.source_for_root("config:primary", &media).unwrap();
        let connection = state_db::connection(identity.database()).unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys=OFF;
                 DROP TABLE resource_legacy_locators;
                 DROP TABLE resources;
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
                 DELETE FROM schema_migrations WHERE version=3;
                 INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(2,1);
                 PRAGMA foreign_keys=ON;",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO resources(
                   id,library_id,source_id,provider_locator,kind,platform_identity,
                   fingerprint,status,first_seen_at,last_seen_at,missing_since
                 ) VALUES('resource-old',?1,?2,'moved/file.txt','file',NULL,NULL,'present',1,1,NULL)",
                params![identity.library_id().as_str(), source_id.as_str()],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO resource_legacy_locators(resource_id,legacy_locator,first_seen_at,last_seen_at)
                 VALUES('resource-old','Media/moved/file.txt',1,2)",
                [],
            )
            .unwrap();
        drop(connection);

        let mut restarted = config(
            &base,
            vec![root("config:primary", "Media", media.clone())],
            media.to_str().unwrap(),
        );
        state_db::initialize(&restarted).unwrap();
        let upgraded = initialize_identity(&mut restarted).unwrap();
        let stored = upgraded
            .stored(&ResourceId::new("resource-old"))
            .unwrap()
            .unwrap();
        assert_eq!(
            stored.legacy_locator.as_deref(),
            Some("Media/moved/file.txt")
        );
        let connection = state_db::connection(upgraded.database()).unwrap();
        let versions = connection
            .prepare("SELECT version FROM schema_migrations ORDER BY version")
            .unwrap()
            .query_map([], |row| row.get::<_, i64>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(versions, [1, 2, 3]);
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
    fn sequential_platform_collision_keeps_present_resource_at_its_locator() {
        let base = fixture("resource-sequential-collision");
        let media = base.join("media");
        std::fs::create_dir_all(&media).unwrap();
        std::fs::write(media.join("first.txt"), "first").unwrap();
        std::fs::write(media.join("second.txt"), "second").unwrap();
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
            platform_identity: Some("platform:shared".into()),
            fingerprint: None,
        };

        let first = identity.observe(&source, &[observed("first.txt")]).unwrap()[0].clone();
        let second = identity
            .observe(&source, &[observed("second.txt")])
            .unwrap()[0]
            .clone();

        assert_ne!(second, first);
        assert_eq!(
            identity.stored(&first).unwrap().unwrap().provider_locator,
            "first.txt"
        );
        assert_eq!(
            identity.stored(&second).unwrap().unwrap().provider_locator,
            "second.txt"
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn reused_platform_identity_never_rebinds_across_resource_kinds() {
        let base = fixture("resource-platform-kind-collision");
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
        let project = ObservedResourceIdentity {
            provider_locator: "projects/shared".into(),
            legacy_locator: "projects/shared".into(),
            kind: "folder".into(),
            platform_identity: Some("hermes:shared".into()),
            fingerprint: Some("project".into()),
        };
        let session = ObservedResourceIdentity {
            provider_locator: "sessions/shared".into(),
            legacy_locator: "sessions/shared".into(),
            kind: "file".into(),
            platform_identity: Some("hermes:shared".into()),
            fingerprint: Some("session".into()),
        };

        let project_id = identity.observe(&source, &[project]).unwrap()[0].clone();
        let session_id = identity.observe(&source, &[session]).unwrap()[0].clone();

        assert_ne!(session_id, project_id);
        assert_eq!(
            identity
                .stored(&project_id)
                .unwrap()
                .unwrap()
                .provider_locator,
            "projects/shared"
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn same_locator_folder_to_file_replacement_gets_new_identity() {
        let base = fixture("resource-same-locator-kind-replacement");
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
        let folder = ObservedResourceIdentity {
            provider_locator: "entry".into(),
            legacy_locator: "entry".into(),
            kind: "folder".into(),
            platform_identity: Some("platform:reused".into()),
            fingerprint: Some("folder-metadata".into()),
        };
        let file = ObservedResourceIdentity {
            provider_locator: "entry".into(),
            legacy_locator: "entry".into(),
            kind: "file".into(),
            platform_identity: Some("platform:reused".into()),
            fingerprint: Some("file-metadata".into()),
        };

        let folder_id = identity.observe(&source, &[folder]).unwrap()[0].clone();
        let file_id = identity.observe(&source, &[file]).unwrap()[0].clone();

        assert_ne!(file_id, folder_id);
        assert_eq!(
            identity.stored(&folder_id).unwrap().unwrap().status,
            "missing"
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn same_locator_directory_fingerprint_conflict_without_platform_identity_gets_new_identity() {
        let base = fixture("resource-same-locator-directory-replacement");
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
        let observed = |fingerprint: &str| ObservedResourceIdentity {
            provider_locator: "folder".into(),
            legacy_locator: "folder".into(),
            kind: "folder".into(),
            platform_identity: None,
            fingerprint: Some(fingerprint.into()),
        };

        let original = identity
            .observe(&source, &[observed("folder-metadata:old")])
            .unwrap()[0]
            .clone();
        let replacement = identity
            .observe(&source, &[observed("folder-metadata:new")])
            .unwrap()[0]
            .clone();

        assert_ne!(replacement, original);
        assert_eq!(
            identity.stored(&original).unwrap().unwrap().status,
            "missing"
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn same_locator_file_edit_with_stable_weak_identity_preserves_identity() {
        let base = fixture("resource-same-locator-file-edit");
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
        let observed = ObservedResourceIdentity {
            provider_locator: "note.txt".into(),
            legacy_locator: "note.txt".into(),
            kind: "file".into(),
            platform_identity: None,
            fingerprint: Some("created:stable:file".into()),
        };

        let original = identity
            .observe(&source, std::slice::from_ref(&observed))
            .unwrap()[0]
            .clone();
        let edited = identity.observe(&source, &[observed]).unwrap()[0].clone();

        assert_eq!(edited, original);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn same_locator_file_replacement_with_changed_weak_identity_gets_new_identity() {
        let base = fixture("resource-same-locator-file-weak-replacement");
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
        let observed = |fingerprint: &str| ObservedResourceIdentity {
            provider_locator: "note.txt".into(),
            legacy_locator: "note.txt".into(),
            kind: "file".into(),
            platform_identity: None,
            fingerprint: Some(fingerprint.into()),
        };

        let original = identity
            .observe(&source, &[observed("created:old:file")])
            .unwrap()[0]
            .clone();
        let replacement = identity
            .observe(&source, &[observed("created:new:file")])
            .unwrap()[0]
            .clone();

        assert_ne!(replacement, original);
        assert_eq!(
            identity.stored(&original).unwrap().unwrap().status,
            "missing"
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn missing_identity_requires_matching_fingerprint_before_rebinding() {
        let base = fixture("resource-missing-platform-reuse");
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
        let old = ObservedResourceIdentity {
            provider_locator: "old.txt".into(),
            legacy_locator: "old.txt".into(),
            kind: "file".into(),
            platform_identity: Some("platform:reused".into()),
            fingerprint: Some("fingerprint:old".into()),
        };
        let replacement = ObservedResourceIdentity {
            provider_locator: "replacement.txt".into(),
            legacy_locator: "replacement.txt".into(),
            kind: "file".into(),
            platform_identity: Some("platform:reused".into()),
            fingerprint: Some("fingerprint:new".into()),
        };

        let old_id = identity.observe(&source, &[old]).unwrap()[0].clone();
        identity.mark_missing(&old_id).unwrap();
        let replacement_id = identity.observe(&source, &[replacement]).unwrap()[0].clone();

        assert_ne!(replacement_id, old_id);
        assert_eq!(
            identity.stored(&old_id).unwrap().unwrap().provider_locator,
            "old.txt"
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn present_external_move_with_unchanged_fingerprint_preserves_identity() {
        let base = fixture("resource-present-external-move-stable-fingerprint");
        let media = base.join("media");
        std::fs::create_dir_all(&media).unwrap();
        std::fs::write(media.join("old.txt"), "old").unwrap();
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
            platform_identity: Some("platform:moved".into()),
            fingerprint: Some("fingerprint:stable".into()),
        };

        let old_id = identity.observe(&source, &[observed("old.txt")]).unwrap()[0].clone();
        std::fs::rename(media.join("old.txt"), media.join("new.txt")).unwrap();
        let moved_id = identity.observe(&source, &[observed("new.txt")]).unwrap()[0].clone();

        assert_eq!(moved_id, old_id);
        assert_eq!(
            identity.stored(&old_id).unwrap().unwrap().provider_locator,
            "new.txt"
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn present_external_move_with_changed_fingerprint_gets_new_identity() {
        let base = fixture("resource-present-external-move-fingerprint");
        let media = base.join("media");
        std::fs::create_dir_all(&media).unwrap();
        std::fs::write(media.join("old.txt"), "old").unwrap();
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
        let observed = |locator: &str, fingerprint: &str| ObservedResourceIdentity {
            provider_locator: locator.into(),
            legacy_locator: locator.into(),
            kind: "file".into(),
            platform_identity: Some("platform:moved".into()),
            fingerprint: Some(fingerprint.into()),
        };

        let old_id = identity
            .observe(&source, &[observed("old.txt", "fingerprint:old")])
            .unwrap()[0]
            .clone();
        std::fs::rename(media.join("old.txt"), media.join("new.txt")).unwrap();
        let moved_id = identity
            .observe(&source, &[observed("new.txt", "fingerprint:new")])
            .unwrap()[0]
            .clone();

        assert_ne!(moved_id, old_id);
        assert_eq!(
            identity.stored(&old_id).unwrap().unwrap().provider_locator,
            "old.txt"
        );
        assert_eq!(
            identity
                .stored(&moved_id)
                .unwrap()
                .unwrap()
                .provider_locator,
            "new.txt"
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn stable_observation_reuses_identity_without_rewriting_rows() {
        let base = fixture("resource-stable-observation");
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
        let observed = ObservedResourceIdentity {
            provider_locator: "stable.txt".into(),
            legacy_locator: "stable.txt".into(),
            kind: "file".into(),
            platform_identity: Some("platform:stable".into()),
            fingerprint: Some("fingerprint:stable".into()),
        };
        let first = identity
            .observe(&source, std::slice::from_ref(&observed))
            .unwrap()[0]
            .clone();
        let connection = state_db::connection(identity.database()).unwrap();
        connection
            .execute(
                "UPDATE resources SET last_seen_at=1 WHERE id=?1",
                [first.as_str()],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE resource_legacy_locators SET last_seen_at=1 WHERE resource_id=?1",
                [first.as_str()],
            )
            .unwrap();
        drop(connection);

        let second = identity.observe(&source, &[observed]).unwrap()[0].clone();
        assert_eq!(second, first);
        let connection = state_db::connection(identity.database()).unwrap();
        let resource_seen = connection
            .query_row(
                "SELECT last_seen_at FROM resources WHERE id=?1",
                [first.as_str()],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();
        let legacy_seen = connection
            .query_row(
                "SELECT last_seen_at FROM resource_legacy_locators WHERE resource_id=?1",
                [first.as_str()],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();
        assert_eq!((resource_seen, legacy_seen), (1, 1));
        drop(connection);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn stable_observation_batch_reuses_identities_without_rewriting_rows() {
        const OBSERVATION_COUNT: usize = 1_000;

        let base = fixture("resource-stable-observation-batch");
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
        let observed = (0..OBSERVATION_COUNT)
            .map(|index| ObservedResourceIdentity {
                provider_locator: format!("item-{index:04}.txt"),
                legacy_locator: format!("item-{index:04}.txt"),
                kind: "file".into(),
                platform_identity: Some(format!("platform:{index}")),
                fingerprint: Some(format!("fingerprint:{index}")),
            })
            .collect::<Vec<_>>();
        let first = identity.observe(&source, &observed).unwrap();
        let connection = state_db::connection(identity.database()).unwrap();
        connection
            .execute("UPDATE resources SET last_seen_at=1", [])
            .unwrap();
        connection
            .execute("UPDATE resource_legacy_locators SET last_seen_at=1", [])
            .unwrap();
        drop(connection);

        let second = identity.observe(&source, &observed).unwrap();
        assert_eq!(second, first);
        let connection = state_db::connection(identity.database()).unwrap();
        let rewritten_resources: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM resources WHERE last_seen_at<>1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let rewritten_locators: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM resource_legacy_locators WHERE last_seen_at<>1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!((rewritten_resources, rewritten_locators), (0, 0));
        drop(connection);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn cold_observation_batch_writes_each_identity_and_legacy_locator_once() {
        const OBSERVATION_COUNT: usize = 1_000;

        let base = fixture("resource-cold-observation-batch-writes");
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
        let connection = state_db::connection(identity.database()).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE observation_write_audit(
                   table_name TEXT NOT NULL,
                   operation TEXT NOT NULL
                 );
                 CREATE TRIGGER audit_resources_insert AFTER INSERT ON resources BEGIN
                   INSERT INTO observation_write_audit VALUES('resources','insert');
                 END;
                 CREATE TRIGGER audit_resources_update AFTER UPDATE ON resources BEGIN
                   INSERT INTO observation_write_audit VALUES('resources','update');
                 END;
                 CREATE TRIGGER audit_legacy_insert AFTER INSERT ON resource_legacy_locators BEGIN
                   INSERT INTO observation_write_audit VALUES('resource_legacy_locators','insert');
                 END;
                 CREATE TRIGGER audit_legacy_update AFTER UPDATE ON resource_legacy_locators BEGIN
                   INSERT INTO observation_write_audit VALUES('resource_legacy_locators','update');
                 END;",
            )
            .unwrap();
        drop(connection);
        let observed = (0..OBSERVATION_COUNT)
            .map(|index| ObservedResourceIdentity {
                provider_locator: format!("item-{index:04}.txt"),
                legacy_locator: format!("item-{index:04}.txt"),
                kind: "file".into(),
                platform_identity: Some(format!("platform:{index}")),
                fingerprint: Some(format!("fingerprint:{index}")),
            })
            .collect::<Vec<_>>();

        let ids = identity.observe(&source, &observed).unwrap();

        assert_eq!(ids.len(), OBSERVATION_COUNT);
        assert_eq!(ids.iter().collect::<HashSet<_>>().len(), OBSERVATION_COUNT);
        let connection = state_db::connection(identity.database()).unwrap();
        let writes = |table_name: &str, operation: &str| -> i64 {
            connection
                .query_row(
                    "SELECT COUNT(*) FROM observation_write_audit
                     WHERE table_name=?1 AND operation=?2",
                    params![table_name, operation],
                    |row| row.get(0),
                )
                .unwrap()
        };
        assert_eq!(writes("resources", "insert"), OBSERVATION_COUNT as i64);
        assert_eq!(writes("resources", "update"), 0);
        assert_eq!(
            writes("resource_legacy_locators", "insert"),
            OBSERVATION_COUNT as i64
        );
        assert_eq!(writes("resource_legacy_locators", "update"), 0);
        drop(connection);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn app_move_displaces_stale_destination_and_preserves_source_identity() {
        let base = fixture("resource-move-stale-destination");
        let source_root = base.join("source");
        let destination_root = base.join("destination");
        std::fs::create_dir_all(&source_root).unwrap();
        std::fs::create_dir_all(&destination_root).unwrap();
        let mut config = config(
            &base,
            vec![
                root("config:source", "Source", source_root.clone()),
                root(
                    "config:destination",
                    "Destination",
                    destination_root.clone(),
                ),
            ],
            &format!(
                "Source:{}|Destination:{}",
                source_root.display(),
                destination_root.display()
            ),
        );
        state_db::initialize(&config).unwrap();
        let identity = initialize_identity(&mut config).unwrap();
        let source = identity
            .source_for_root("config:source", &source_root)
            .unwrap()
            .0;
        let destination = identity
            .source_for_root("config:destination", &destination_root)
            .unwrap()
            .0;
        let observed = |locator: &str, platform_identity: &str| ObservedResourceIdentity {
            provider_locator: locator.into(),
            legacy_locator: locator.into(),
            kind: "file".into(),
            platform_identity: Some(platform_identity.into()),
            fingerprint: None,
        };
        let moving = identity
            .observe(&source, &[observed("from.txt", "platform:moving")])
            .unwrap()[0]
            .clone();
        let stale = identity
            .observe(&destination, &[observed("to.txt", "platform:stale")])
            .unwrap()[0]
            .clone();
        identity.mark_missing(&stale).unwrap();

        identity
            .relocate_to(&source, "from.txt", &destination, "to.txt", "to.txt")
            .unwrap();

        let moved = identity.stored(&moving).unwrap().unwrap();
        assert_eq!(moved.source_id, destination);
        assert_eq!(moved.provider_locator, "to.txt");
        assert_eq!(moved.status, "present");
        let displaced = identity.stored(&stale).unwrap().unwrap();
        assert_eq!(displaced.status, "missing");
        assert!(displaced.provider_locator.starts_with("missing:"));
        assert_ne!(displaced.provider_locator, "to.txt");
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
                   fingerprint,current_legacy_locator,status,first_seen_at,last_seen_at,
                   missing_since
                 ) VALUES('resource-collision',?1,?2,'second.txt','file','collision',
                   NULL,'second.txt','present',1,1,NULL)",
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
    fn replacement_at_same_locator_gets_new_identity() {
        let base = fixture("resource-replacement");
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
        let item = |platform: &str| ObservedResourceIdentity {
            provider_locator: "same.txt".into(),
            legacy_locator: "same.txt".into(),
            kind: "file".into(),
            platform_identity: Some(platform.into()),
            fingerprint: Some("same-metadata".into()),
        };
        let original = identity.observe(&source, &[item("platform:old")]).unwrap()[0].clone();
        let replacement = identity.observe(&source, &[item("platform:new")]).unwrap()[0].clone();

        assert_ne!(replacement, original);
        assert_eq!(
            identity.stored(&original).unwrap().unwrap().status,
            "missing"
        );
        assert_eq!(
            identity
                .stored(&replacement)
                .unwrap()
                .unwrap()
                .provider_locator,
            "same.txt"
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn same_batch_identity_collisions_never_silently_rebind() {
        let base = fixture("resource-batch-collision");
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
        let item = |locator: &str| ObservedResourceIdentity {
            provider_locator: locator.into(),
            legacy_locator: locator.into(),
            kind: "file".into(),
            platform_identity: Some("shared-platform".into()),
            fingerprint: Some("shared-fingerprint".into()),
        };
        let first = identity
            .observe(&source, &[item("one.txt"), item("two.txt")])
            .unwrap();
        assert_ne!(first[0], first[1]);
        let restarted = identity
            .observe(&source, &[item("one.txt"), item("two.txt")])
            .unwrap();
        assert_eq!(restarted, first);

        let strong_miss = identity
            .observe(
                &source,
                &[ObservedResourceIdentity {
                    provider_locator: "three.txt".into(),
                    legacy_locator: "three.txt".into(),
                    kind: "file".into(),
                    platform_identity: Some("different-platform".into()),
                    fingerprint: Some("shared-fingerprint".into()),
                }],
            )
            .unwrap();
        assert_ne!(strong_miss[0], first[0]);
        assert_ne!(strong_miss[0], first[1]);
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

    #[test]
    fn root_edit_seeds_new_legacy_namespace_before_downgrade_write() {
        let base = fixture("root-edit-rollback");
        let original = base.join("original");
        let renamed = base.join("renamed");
        std::fs::create_dir_all(&original).unwrap();
        let old_key = original.to_string_lossy().to_string();
        let mut initial = config(
            &base,
            vec![root(
                "configured:stable-media",
                "Original",
                original.clone(),
            )],
            &old_key,
        );
        state_db::initialize(&initial).unwrap();
        let identity = initialize_identity(&mut initial).unwrap();
        state_db::update_document(
            identity.database(),
            "settings",
            identity.library_id().as_str(),
            serde_json::json!({}),
            |value| {
                value["marker"] = serde_json::json!("before-root-edit");
                Ok(())
            },
        )
        .unwrap();
        let connection = state_db::connection(identity.database()).unwrap();
        connection
            .execute(
                "INSERT INTO shares(
                   library_key,token,path,is_directory,editable,passcode,created_at
                 ) VALUES(?1,'rollback-share','file.txt',0,0,NULL,1)",
                [identity.library_id().as_str()],
            )
            .unwrap();
        drop(connection);

        std::fs::rename(&original, &renamed).unwrap();
        let new_key = renamed.to_string_lossy().to_string();
        let mut edited = config(
            &base,
            vec![root("configured:stable-media", "Renamed", renamed.clone())],
            &new_key,
        );
        state_db::initialize(&edited).unwrap();
        initialize_identity(&mut edited).unwrap();

        let connection = state_db::connection(&state_db::database(&edited)).unwrap();
        let document: String = connection
            .query_row(
                "SELECT value_json FROM state_documents
                 WHERE kind='settings' AND library_key=?1",
                [&new_key],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&document).unwrap()["marker"],
            "before-root-edit"
        );
        let share_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM shares
                 WHERE library_key=?1 AND token='rollback-share'",
                [&new_key],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(share_count, 1);
        drop(connection);
        std::fs::remove_dir_all(base).unwrap();
    }
}
