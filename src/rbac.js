const MODULES = ["cash", "products", "inventory", "workers", "payroll"];

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function listPermissions(db, userId) {
  return db.prepare(
    "SELECT module FROM user_module_permissions WHERE user_id = ? ORDER BY module"
  ).all(userId).map(row => row.module);
}

function serializeUser(user, permissions) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    active: Boolean(user.active),
    permissions: user.role === "admin" ? [...MODULES] : permissions
  };
}

function readUser(db, userId) {
  const user = db.prepare(
    "SELECT id, name, username, role, active FROM users WHERE id = ?"
  ).get(userId);
  if (!user || !user.active) return null;
  return serializeUser(user, listPermissions(db, user.id));
}

function sessionMatches(db, sessionUser) {
  if (!sessionUser) return false;
  const user = db.prepare(
    "SELECT active, session_version FROM users WHERE id = ?"
  ).get(sessionUser.id);
  return Boolean(user && user.active && user.session_version === sessionUser.sessionVersion);
}

function requireAuth(db) {
  return (req, _res, next) => {
    const sessionUser = req.session.user;
    if (!sessionUser) return next(httpError(401, "Inicia sesión para continuar."));
    if (!sessionMatches(db, sessionUser)) {
      req.session.destroy(() => {});
      return next(httpError(401, "La cuenta está inactiva o ya no existe. Inicia sesión de nuevo."));
    }
    const user = readUser(db, sessionUser.id);
    req.currentUser = user;
    next();
  };
}

function requireModule(module) {
  if (!MODULES.includes(module)) throw new Error(`Unknown module: ${module}`);
  return (req, _res, next) => {
    if (req.currentUser.role === "admin" || req.currentUser.permissions.includes(module)) return next();
    next(httpError(403, "No tienes permiso para acceder a este módulo."));
  };
}

function requireAdmin(req, _res, next) {
  if (req.currentUser?.role === "admin") return next();
  next(httpError(403, "Esta sección está disponible únicamente para Administradores."));
}

function requireCsrf(req, _res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const expected = req.session.csrfToken;
  const provided = req.get("x-csrf-token");
  if (!expected || !provided || expected !== provided) {
    return next(httpError(403, "La solicitud expiró. Recarga la página e inicia sesión de nuevo."));
  }
  next();
}

function parsePermissions(value, role) {
  if (role === "admin") return [];
  if (!Array.isArray(value) || value.some(module => !MODULES.includes(module))) {
    throw httpError(400, "Selecciona permisos válidos para cada módulo.");
  }
  return [...new Set(value)];
}

module.exports = {
  MODULES,
  httpError,
  listPermissions,
  parsePermissions,
  readUser,
  requireAdmin,
  requireAuth,
  requireCsrf,
  requireModule,
  sessionMatches,
  serializeUser
};
