const test = require("node:test");
const assert = require("node:assert/strict");
const { createDatabase } = require("../src/db");

test("crea el esquema SQLite y confirma transacciones", () => {
  const db = createDatabase(":memory:");
  db.transaction(() => {
    db.prepare("INSERT INTO products (code, name, category, unit_price, unit) VALUES (?, ?, ?, ?, ?)")
      .run("R-01", "Lomo", "RES", 25000, "KG");
  })();
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM products").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory").get().count, 0);
  db.close();
});

test("revierte transacciones SQLite ante errores", () => {
  const db = createDatabase(":memory:");
  assert.throws(() => db.transaction(() => {
    db.prepare("INSERT INTO products (code, name, category, unit_price, unit) VALUES (?, ?, ?, ?, ?)")
      .run("R-02", "Costilla", "RES", 18000, "KG");
    throw new Error("forzar rollback");
  })(), /forzar rollback/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM products").get().count, 0);
  db.close();
});
