const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function createDatabase(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.transaction = callback => (...args) => {
    db.exec("BEGIN");
    try {
      const result = callback(...args);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'operator' CHECK(role IN ('admin', 'operator')),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
      session_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      unit_price INTEGER NOT NULL CHECK(unit_price >= 0),
      unit TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS inventory (
      product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
      baseline REAL NOT NULL DEFAULT 0 CHECK(baseline >= 0),
      added REAL NOT NULL DEFAULT 0 CHECK(added >= 0),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS inventory_runs (
      id INTEGER PRIMARY KEY,
      saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS inventory_run_items (
      run_id INTEGER NOT NULL REFERENCES inventory_runs(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL,
      product_code TEXT NOT NULL,
      product_name TEXT NOT NULL,
      unit TEXT NOT NULL,
      quantity REAL NOT NULL,
      PRIMARY KEY(run_id, product_id)
    );
    CREATE TABLE IF NOT EXISTS workers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      identification TEXT NOT NULL DEFAULT '',
      position TEXT NOT NULL,
      monthly_salary INTEGER NOT NULL CHECK(monthly_salary >= 0),
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS workers_phone_unique ON workers(phone);
    CREATE UNIQUE INDEX IF NOT EXISTS workers_email_unique ON workers(email);
    CREATE TABLE IF NOT EXISTS payroll_entries (
      period_key TEXT NOT NULL,
      worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
      overtime INTEGER NOT NULL DEFAULT 0 CHECK(overtime >= 0),
      bonuses INTEGER NOT NULL DEFAULT 0 CHECK(bonuses >= 0),
      deductions INTEGER NOT NULL DEFAULT 0 CHECK(deductions >= 0),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(period_key, worker_id)
    );
    CREATE TABLE IF NOT EXISTS payroll_closures (
      period_key TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS payroll_receipts (
      period_key TEXT NOT NULL,
      worker_id INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      pdf BLOB NOT NULL,
      delivery_status TEXT NOT NULL DEFAULT 'pending',
      delivery_error TEXT,
      sent_at TEXT,
      PRIMARY KEY(period_key, worker_id),
      FOREIGN KEY(worker_id) REFERENCES workers(id) ON DELETE RESTRICT
    );
  `);
  const userColumns = new Set(db.prepare("PRAGMA table_info(users)").all().map(column => column.name));
  const legacyUsers = !userColumns.has("role");
  if (!userColumns.has("name")) {
    db.exec("ALTER TABLE users ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  }
  if (!userColumns.has("role")) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'operator' CHECK(role IN ('admin', 'operator'))");
  }
  if (!userColumns.has("active")) {
    db.exec("ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1))");
  }
  if (!userColumns.has("session_version")) {
    db.exec("ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_module_permissions (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      module TEXT NOT NULL CHECK(module IN ('cash', 'products', 'inventory', 'workers', 'payroll')),
      PRIMARY KEY(user_id, module)
    );
    CREATE INDEX IF NOT EXISTS users_role_active_idx ON users(role, active);
  `);
  db.prepare("UPDATE users SET name = username WHERE TRIM(name) = ''").run();
  const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  if (userCount > 0 && legacyUsers) {
    const activeAdmin = db.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1").get();
    if (!activeAdmin) {
      const firstUser = db.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get();
      db.prepare("UPDATE users SET role = 'admin', active = 1 WHERE id = ?").run(firstUser.id);
    }
  }
  if (legacyUsers) {
    const operators = db.prepare("SELECT id FROM users WHERE role = 'operator' AND active = 1").all();
    const grantAll = db.prepare("INSERT OR IGNORE INTO user_module_permissions (user_id, module) VALUES (?, ?)");
    const legacyModules = ["cash", "products", "inventory", "workers", "payroll"];
    db.transaction(() => {
      for (const user of operators) {
        for (const module of legacyModules) grantAll.run(user.id, module);
      }
    })();
  }
  return db;
}

module.exports = { createDatabase };
