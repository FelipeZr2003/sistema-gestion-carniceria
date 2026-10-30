const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createDatabase } = require("../src/db");
const { createAdminRouter } = require("../src/admin-routes");
const { readUser } = require("../src/rbac");

test("gestiona usuarios, permisos y protección del último administrador", async t => {
  const db = createDatabase(":memory:");
  const adminId = Number(db.prepare(`
    INSERT INTO users (name, username, password_hash, role, active)
    VALUES ('Administradora', 'admin', 'hash', 'admin', 1)
  `).run().lastInsertRowid);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.currentUser = readUser(db, adminId);
    next();
  });
  app.use("/users", createAdminRouter(db));
  app.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({ error: error.message });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => {
    server.close();
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/users`;

  const create = await fetch(base, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Lucía Operadora",
      username: "lucia",
      password: "Operadora-Prueba-123",
      role: "operator",
      active: true,
      permissions: ["products", "inventory"]
    })
  });
  assert.equal(create.status, 201);
  const operator = await create.json();
  assert.deepEqual(operator.permissions, ["products", "inventory"]);

  const list = await (await fetch(base)).json();
  assert.equal(list.length, 2);
  assert.equal(Object.hasOwn(list[0], "password_hash"), false);

  const lastAdmin = await fetch(`${base}/${adminId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Administradora",
      username: "admin",
      role: "operator",
      active: true,
      permissions: []
    })
  });
  assert.equal(lastAdmin.status, 409);

  const update = await fetch(`${base}/${operator.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Lucía",
      username: "lucia",
      role: "operator",
      active: false,
      permissions: ["payroll"],
      password: "Lucia-Updated-Password-123"
    })
  });
  assert.equal(update.status, 200);
  assert.equal((await update.json()).active, false);
  assert.equal(db.prepare("SELECT session_version FROM users WHERE id = ?").get(operator.id).session_version, 1);

  const invalidPermissions = await fetch(`${base}/${operator.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Lucía",
      username: "lucia",
      role: "operator",
      active: true,
      permissions: ["users"]
    })
  });
  assert.equal(invalidPermissions.status, 400);
});
