use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;

/// Managed SQLite state. The connection is guarded by a Mutex because rusqlite's
/// `Connection` is not `Sync`. The backend is deliberately thin (brief §2.1), so a
/// single serialized connection is more than enough for a personal desktop app.
pub struct Db(pub Mutex<Connection>);

/// Ordered migrations. Each entry is (version, sql). The runner applies every
/// migration whose version is greater than the database's current `user_version`,
/// inside a transaction, then bumps `user_version`. Add new tuples to extend.
const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../migrations/0001_init.sql")),
    (2, include_str!("../migrations/0002_isochrone_cache.sql")),
    (3, include_str!("../migrations/0003_njdoe_schools.sql")),
    (4, include_str!("../migrations/0004_parcels.sql")),
];

/// Open (creating if needed) the SQLite database at the given path and run any
/// outstanding migrations. The parent directory is created if it does not exist.
/// Each shell (desktop / server) decides where the database file lives.
pub fn open_at(db_path: &Path) -> Result<Connection, String> {
    if let Some(dir) = db_path.parent() {
        if !dir.as_os_str().is_empty() {
            std::fs::create_dir_all(dir)
                .map_err(|e| format!("could not create data dir {dir:?}: {e}"))?;
        }
    }

    let conn = Connection::open(db_path)
        .map_err(|e| format!("could not open database {db_path:?}: {e}"))?;

    // Per-connection pragmas: enforce foreign keys and use WAL for better
    // concurrent read behavior.
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
        .map_err(|e| format!("failed to set pragmas: {e}"))?;

    run_migrations(&conn)?;
    Ok(conn)
}

fn run_migrations(conn: &Connection) -> Result<(), String> {
    let current: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| format!("failed to read schema version: {e}"))?;

    for (version, sql) in MIGRATIONS {
        if *version > current {
            conn.execute_batch(sql)
                .map_err(|e| format!("migration {version} failed: {e}"))?;
            // PRAGMA user_version does not accept bound parameters.
            conn.execute_batch(&format!("PRAGMA user_version = {version};"))
                .map_err(|e| format!("failed to set schema version {version}: {e}"))?;
        }
    }
    Ok(())
}
