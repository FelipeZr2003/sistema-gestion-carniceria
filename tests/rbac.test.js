const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { createDatabase } = require("../src/db");
const {
  requireAdmin,
  requireAuth,
  requireCsrf,
  requireModule,
  readUser,
  sessionMatches
} = require("../src/rbac");

test("migra usuarios y conserva credenciales y datos anteriores", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cse-rbac-"));
  const file = path.join(directory, "legacy.sqlite");
  const oldDb = new DatabaseSync(file);
  oldDb.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users (username, password_hash) VALUES ('owner', 'existing-hash');
    INSERT INTO users (username, password_hash) VALUES ('staff', 'staff-hash');
    CREATE TABLE products (
      id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      category TEXT NOT NULL, unit_price INTEGER NOT NULL, unit TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO products (code, name, category, unit_price, unit)
      VALUES ('R-01', 'Lomo', 'RES', 25000, 'KG');
  `);
  oldDb.close();

  let db;
  try {
    db = createDatabase(file);
    const owner = db.prepare("SELECT * FROM users WHERE username = 'owner'").get();
    const staff = db.prepare("SELECT * FROM users WHERE username = 'staff'").get();
    assert.equal(owner.role, "admin");
    assert.equal(owner.active, 1);
    assert.equal(owner.name, "owner");
    assert.equal(owner.password_hash, "existing-hash");
    assert.equal(staff.role, "operator");
    assert.deepEqual(
      db.prepare("SELECT module FROM user_module_permissions WHERE user_id = ? ORDER BY module")
        .all(staff.id).map(row => row.module),
      ["cash", "inventory", "payroll", "products", "workers"]
    );
    assert.equal(db.prepare("SELECT name FROM products WHERE code = 'R-01'").get().name, "Lomo");
  } finally {
    if (db) db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("aplica permisos actuales por usuario y no permite rutas manipuladas", () => {
  const db = createDatabase(":memory:");
  const adminId = Number(db.prepare(
    "INSERT INTO users (username, password_hash, name, role) VALUES ('admin', 'hash', 'Admin', 'admin')"
  ).run().lastInsertRowid);
  const operatorId = Number(db.prepare(
    "INSERT INTO users (username, password_hash, name, role) VALUES ('operator', 'hash', 'Operator', 'operator')"
  ).run().lastInsertRowid);
  db.prepare("INSERT INTO user_module_permissions (user_id, module) VALUES (?, 'products')").run(operatorId);
  const errors = [];
  const operatorRequest = {
    session: { user: { id: operatorId, sessionVersion: 0 }, destroy() {} },
    get currentUser() { return this._currentUser; },
    set currentUser(value) { this._currentUser = value; }
  };
  requireAuth(db)(operatorRequest, {}, error => { if (error) errors.push(error); });
  assert.equal(errors.length, 0);
  assert.deepEqual(operatorRequest.currentUser.permissions, ["products"]);

  let allowed = false;
  requireModule("products")(operatorRequest, {}, error => { if (!error) allowed = true; });
  assert.equal(allowed, true);
  requireModule("payroll")(operatorRequest, {}, error => { if (error) errors.push(error); });
  assert.equal(errors.at(-1).status, 403);
  requireAdmin(operatorRequest, {}, error => { if (error) errors.push(error); });
  assert.equal(errors.at(-1).status, 403);

  const adminRequest = { session: { user: { id: adminId, sessionVersion: 0 }, destroy() {} } };
  requireAuth(db)(adminRequest, {}, error => { if (error) errors.push(error); });
  requireModule("payroll")(adminRequest, {}, error => { if (error) errors.push(error); });
  requireAdmin(adminRequest, {}, error => { if (error) errors.push(error); });
  assert.equal(errors.length, 2);

  assert.equal(sessionMatches(db, operatorRequest.session.user), true);
  db.prepare("UPDATE users SET session_version = session_version + 1 WHERE id = ?").run(operatorId);
  assert.equal(sessionMatches(db, operatorRequest.session.user), false);

  db.prepare("UPDATE users SET active = 0 WHERE id = ?").run(operatorId);
  requireAuth(db)(operatorRequest, {}, error => { if (error) errors.push(error); });
  assert.equal(errors.at(-1).status, 401);
  assert.equal(readUser(db, operatorId), null);
  db.close();
});

test("requiere token CSRF en cambios y valida la cuenta en cada petición", () => {
  const denied = [];
  requireCsrf(
    { method: "POST", session: { csrfToken: "secret" }, get: () => "wrong" },
    {},
    error => denied.push(error)
  );
  assert.equal(denied[0].status, 403);

  let passed = false;
  requireCsrf(
    { method: "POST", session: { csrfToken: "secret" }, get: () => "secret" },
    {},
    error => { if (!error) passed = true; }
  );
  assert.equal(passed, true);
});
