const express = require("express");
const bcrypt = require("bcryptjs");
const {
  MODULES,
  httpError,
  listPermissions,
  parsePermissions,
  requireAdmin
} = require("./rbac");

function text(value, label, maxLength) {
  const result = String(value || "").trim();
  if (!result || result.length > maxLength) {
    throw httpError(400, `${label} es obligatorio y debe tener máximo ${maxLength} caracteres.`);
  }
  return result;
}

function parseRole(value) {
  const role = String(value || "").trim();
  if (!["admin", "operator"].includes(role)) {
    throw httpError(400, "El rol seleccionado no es válido.");
  }
  return role;
}

function parseActive(value) {
  if (typeof value !== "boolean") {
    throw httpError(400, "Selecciona si el usuario está activo o inactivo.");
  }
  return value ? 1 : 0;
}

function parsePassword(value, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) throw httpError(400, "La contraseña es obligatoria.");
    return null;
  }
  const password = String(value);
  if (password.length < 12 || password.length > 200) {
    throw httpError(400, "La contraseña debe tener entre 12 y 200 caracteres.");
  }
  return password;
}

function createAdminRouter(db) {
  const router = express.Router();
  router.use(requireAdmin);

  router.get("/", (_req, res) => {
    const users = db.prepare(`
      SELECT id, name, username, role, active, created_at FROM users ORDER BY name COLLATE NOCASE
    `).all().map(user => ({
      ...user,
      active: Boolean(user.active),
      permissions: user.role === "admin"
        ? [...MODULES]
        : listPermissions(db, user.id)
    }));
    res.json(users);
  });

  router.post("/", async (req, res, next) => {
    try {
      const name = text(req.body.name, "El nombre", 120);
      const username = text(req.body.username, "El usuario", 40).toLowerCase();
      if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
        throw httpError(400, "El usuario debe tener entre 3 y 40 caracteres alfanuméricos, puntos, guiones o guiones bajos.");
      }
      const password = parsePassword(req.body.password, true);
      const role = parseRole(req.body.role);
      const active = parseActive(req.body.active);
      const permissions = parsePermissions(req.body.permissions, role);
      const passwordHash = await bcrypt.hash(password, 12);
      const user = db.transaction(() => {
        const inserted = db.prepare(`
          INSERT INTO users (name, username, password_hash, role, active)
          VALUES (?, ?, ?, ?, ?)
        `).run(name, username, passwordHash, role, active);
        const id = Number(inserted.lastInsertRowid);
        const insertPermission = db.prepare(
          "INSERT INTO user_module_permissions (user_id, module) VALUES (?, ?)"
        );
        for (const module of permissions) insertPermission.run(id, module);
        return db.prepare("SELECT id, name, username, role, active, created_at FROM users WHERE id = ?").get(id);
      })();
      res.status(201).json({
        ...user,
        active: Boolean(user.active),
        permissions: role === "admin" ? [...MODULES] : permissions
      });
    } catch (error) {
      if (Number(error.errcode) === 2067) return next(httpError(409, "Ese nombre de usuario ya está registrado."));
      next(error);
    }
  });

  router.put("/:id", async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) throw httpError(400, "Usuario no válido.");
      const current = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
      if (!current) throw httpError(404, "El usuario no existe.");
      const name = text(req.body.name, "El nombre", 120);
      const username = text(req.body.username, "El usuario", 40).toLowerCase();
      if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
        throw httpError(400, "El usuario debe tener entre 3 y 40 caracteres alfanuméricos, puntos, guiones o guiones bajos.");
      }
      const role = parseRole(req.body.role);
      const active = parseActive(req.body.active);
      const permissions = parsePermissions(req.body.permissions, role);
      const password = parsePassword(req.body.password);
      if (id === req.currentUser.id && !active) {
        throw httpError(409, "No puedes desactivar tu propia cuenta mientras tienes una sesión abierta.");
      }
      const passwordHash = password ? await bcrypt.hash(password, 12) : current.password_hash;
      db.transaction(() => {
        if (current.role === "admin" && current.active && (role !== "admin" || !active)) {
          const activeAdmins = db.prepare(
            "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1"
          ).get().count;
          if (activeAdmins <= 1) {
            throw httpError(409, "No se puede desactivar ni cambiar el rol del último Administrador activo.");
          }
        }
        db.prepare(`
          UPDATE users SET name = ?, username = ?, password_hash = ?, role = ?, active = ?,
            session_version = session_version + ?
          WHERE id = ?
        `).run(name, username, passwordHash, role, active, password ? 1 : 0, id);
        db.prepare("DELETE FROM user_module_permissions WHERE user_id = ?").run(id);
        const insertPermission = db.prepare(
          "INSERT INTO user_module_permissions (user_id, module) VALUES (?, ?)"
        );
        for (const module of permissions) insertPermission.run(id, module);
      })();
      const user = db.prepare(
        "SELECT id, name, username, role, active, created_at FROM users WHERE id = ?"
      ).get(id);
      res.json({
        ...user,
        active: Boolean(user.active),
        permissions: role === "admin" ? [...MODULES] : permissions
      });
    } catch (error) {
      if (Number(error.errcode) === 2067) return next(httpError(409, "Ese nombre de usuario ya está registrado."));
      next(error);
    }
  });

  router.delete("/:id", (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) throw httpError(400, "Usuario no válido.");
      const target = db.prepare("SELECT id, role, active FROM users WHERE id = ?").get(id);
      if (!target) throw httpError(404, "El usuario no existe.");
      if (id === req.currentUser.id) {
        throw httpError(409, "No puedes eliminar tu propia cuenta mientras tienes una sesión abierta.");
      }
      if (target.role === "admin" && target.active) {
        const activeAdmins = db.prepare(
          "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1"
        ).get().count;
        if (activeAdmins <= 1) throw httpError(409, "No se puede eliminar el último Administrador activo.");
      }
      db.prepare("DELETE FROM users WHERE id = ?").run(id);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createAdminRouter };
