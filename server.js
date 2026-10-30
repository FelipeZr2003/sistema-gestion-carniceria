require("dotenv").config();

const bcrypt = require("bcryptjs");
const { randomBytes } = require("node:crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const helmet = require("helmet");
const nodemailer = require("nodemailer");
const fs = require("node:fs");
const path = require("node:path");
const { createDatabase } = require("./src/db");
const { createPayrollPdf, formatCop } = require("./src/payroll-pdf");
const { createAdminRouter } = require("./src/admin-routes");
const {
  readUser,
  requireAuth,
  requireCsrf,
  requireModule,
  serializeUser,
  sessionMatches
} = require("./src/rbac");
const {
  PRODUCT_CATEGORIES,
  PRODUCT_UNITS,
  calculatePayroll,
  normalizeEmail,
  normalizePhone,
  parseMoney,
  validatePeriodKey
} = require("./src/domain");

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || "").trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT debe ser un puerto válido.");
}
if (SESSION_SECRET.length < 32) {
  throw new Error("Configura SESSION_SECRET con al menos 32 caracteres en el archivo .env.");
}
if (!ADMIN_USERNAME || ADMIN_PASSWORD.length < 12) {
  throw new Error("Configura ADMIN_USERNAME y un ADMIN_PASSWORD de al menos 12 caracteres en el archivo .env.");
}

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = createDatabase(path.join(DATA_DIR, "carnes-santa-elena.sqlite"));
const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
if (userCount === 0) {
  db.prepare("INSERT INTO users (username, password_hash, name, role, active) VALUES (?, ?, ?, 'admin', 1)").run(
    ADMIN_USERNAME,
    bcrypt.hashSync(ADMIN_PASSWORD, 12),
    ADMIN_USERNAME
  );
}

const app = express();

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: "100kb" }));
app.use((req, _res, next) => {
  if (!req.body || typeof req.body !== "object") req.body = {};
  next();
});
app.use(session({
  name: "cse.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  }
}));

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requiredText(value, label, maxLength = 120) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength) {
    throw httpError(400, `${label} es obligatorio y debe tener máximo ${maxLength} caracteres.`);
  }
  return text;
}

function parseQuantity(value, label = "Cantidad") {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > 1_000_000) {
    throw httpError(400, `${label} debe ser un número entre 0 y 1.000.000.`);
  }
  return Math.round(quantity * 1000) / 1000;
}

function parseProduct(body, includeCode) {
  const product = {
    name: requiredText(body.name, "El nombre", 100),
    category: requiredText(body.category, "La clasificación", 30),
    unit_price: parseMoney(body.unit_price, "El precio unitario"),
    unit: requiredText(body.unit, "La unidad", 20)
  };
  if (!PRODUCT_CATEGORIES.includes(product.category)) {
    throw httpError(400, "La clasificación del producto no es válida.");
  }
  if (!PRODUCT_UNITS.includes(product.unit)) {
    throw httpError(400, "La unidad de medida no es válida.");
  }
  if (includeCode) {
    product.code = requiredText(body.code, "El código", 40);
  }
  return product;
}

function parseWorker(body) {
  const rawPhone = String(body.phone || "").trim();
  if (!/^[+\d().\s-]+$/.test(rawPhone)) {
    throw httpError(400, "El teléfono contiene caracteres no válidos.");
  }
  const worker = {
    name: requiredText(body.name, "El nombre", 120),
    identification: String(body.identification || "").trim().slice(0, 40),
    position: requiredText(body.position, "El puesto", 80),
    monthly_salary: parseMoney(body.monthly_salary, "El salario mensual"),
    phone: normalizePhone(rawPhone),
    email: normalizeEmail(body.email)
  };
  if (worker.phone.length < 7 || worker.phone.length > 20) {
    throw httpError(400, "Ingresa un teléfono válido de entre 7 y 20 caracteres.");
  }
  if (worker.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(worker.email)) {
    throw httpError(400, "Ingresa un correo electrónico válido.");
  }
  return worker;
}

function parsePayrollAmounts(body) {
  return {
    overtime: parseMoney(body.overtime, "El valor de horas extra"),
    bonuses: parseMoney(body.bonuses, "El valor de bonos"),
    deductions: parseMoney(body.deductions, "El valor de débitos")
  };
}

function isUniqueConstraint(error) {
  return error.code === "SQLITE_CONSTRAINT_UNIQUE" || Number(error.errcode) === 2067;
}

function isConstraintError(error) {
  return error.code?.startsWith("SQLITE_CONSTRAINT") || (Number(error.errcode) & 0xff) === 19;
}

function createMailer() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = process.env.SMTP_PASS || "";
  const from = String(process.env.SMTP_FROM || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  if (!host || !user || !pass || !from || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw httpError(503, "Configura SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS y SMTP_FROM en .env para enviar la nómina.");
  }
  return nodemailer.createTransport({
    host,
    port,
    secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
    auth: { user, pass }
  });
}

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.post("/api/auth/login", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Espera 15 minutos e inténtalo de nuevo." }
}), asyncRoute(async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const user = db.prepare(`
    SELECT id, name, username, password_hash, role, active, session_version FROM users WHERE username = ?
  `).get(username);
  if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) {
    throw httpError(401, "Usuario o contraseña incorrectos.");
  }
  await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  req.session.user = { id: user.id, sessionVersion: user.session_version };
  req.session.csrfToken = randomBytes(32).toString("hex");
  res.json({
    user: serializeUser(user, db.prepare(
      "SELECT module FROM user_module_permissions WHERE user_id = ? ORDER BY module"
    ).all(user.id).map(row => row.module)),
    csrfToken: req.session.csrfToken
  });
}));

app.get("/api/auth/me", (req, res) => {
  const user = sessionMatches(db, req.session.user)
    ? readUser(db, req.session.user.id)
    : null;
  if (req.session.user && !user) req.session.destroy(() => {});
  if (user && !req.session.csrfToken) {
    req.session.csrfToken = randomBytes(32).toString("hex");
  }
  res.json({ user, csrfToken: user ? req.session.csrfToken : null });
});

app.post("/api/auth/logout", requireAuth(db), requireCsrf, (req, res, next) => {
  req.session.destroy(error => {
    if (error) return next(error);
    res.clearCookie("cse.sid", { httpOnly: true, sameSite: "strict" });
    res.json({ ok: true });
  });
});

app.use("/api", requireAuth(db), requireCsrf);
app.use("/api/admin/users", createAdminRouter(db));

app.get("/api/products", requireModule("products"), (_req, res) => {
  res.json(db.prepare("SELECT * FROM products ORDER BY name COLLATE NOCASE").all());
});

app.post("/api/products", requireModule("products"), (req, res, next) => {
  try {
    const product = parseProduct(req.body, true);
    const result = db.transaction(() => {
      const inserted = db.prepare(
        "INSERT INTO products (code, name, category, unit_price, unit) VALUES (@code, @name, @category, @unit_price, @unit)"
      ).run(product);
      db.prepare("INSERT INTO inventory (product_id) VALUES (?)").run(inserted.lastInsertRowid);
      return db.prepare("SELECT * FROM products WHERE id = ?").get(inserted.lastInsertRowid);
    })();
    res.status(201).json(result);
  } catch (error) {
    if (isUniqueConstraint(error)) return next(httpError(409, "Ya existe un producto con ese código."));
    next(error);
  }
});

app.put("/api/products/:id", requireModule("products"), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) throw httpError(400, "Producto no válido.");
    const product = parseProduct(req.body, false);
    const result = db.prepare(`
      UPDATE products SET name = @name, category = @category, unit_price = @unit_price,
        unit = @unit, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ ...product, id });
    if (!result.changes) throw httpError(404, "El producto no existe.");
    res.json(db.prepare("SELECT * FROM products WHERE id = ?").get(id));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/products/:id", requireModule("products"), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) throw httpError(400, "Producto no válido.");
    const result = db.prepare("DELETE FROM products WHERE id = ?").run(id);
    if (!result.changes) throw httpError(404, "El producto no existe.");
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/inventory", requireModule("inventory"), (_req, res) => {
  res.json(db.prepare(`
    SELECT p.id, p.code, p.name, p.category, p.unit,
      COALESCE(i.baseline, 0) AS baseline, COALESCE(i.added, 0) AS added,
      COALESCE(i.baseline, 0) + COALESCE(i.added, 0) AS current_quantity
    FROM products p LEFT JOIN inventory i ON i.product_id = p.id
    ORDER BY p.name COLLATE NOCASE
  `).all());
});

app.put("/api/inventory/:productId/count", requireModule("inventory"), (req, res, next) => {
  try {
    const productId = Number(req.params.productId);
    const quantity = parseQuantity(req.body.quantity, "La cantidad a sumar");
    if (!Number.isSafeInteger(productId) || productId < 1) throw httpError(400, "Producto no válido.");
    const result = db.prepare(`
      UPDATE inventory SET added = added + ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ?
    `).run(quantity, productId);
    if (!result.changes) throw httpError(404, "El producto no existe en el inventario.");
    res.json(db.prepare(`
      SELECT baseline, added, baseline + added AS current_quantity FROM inventory WHERE product_id = ?
    `).get(productId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/inventory/save", requireModule("inventory"), (_req, res, next) => {
  try {
    const result = db.transaction(() => {
      const run = db.prepare("INSERT INTO inventory_runs DEFAULT VALUES").run();
      db.prepare(`
        INSERT INTO inventory_run_items (run_id, product_id, product_code, product_name, unit, quantity)
        SELECT ?, p.id, p.code, p.name, p.unit, i.baseline + i.added
        FROM products p JOIN inventory i ON i.product_id = p.id
      `).run(run.lastInsertRowid);
      db.prepare(`
        UPDATE inventory SET baseline = baseline + added, added = 0, updated_at = CURRENT_TIMESTAMP
      `).run();
      return db.prepare("SELECT saved_at FROM inventory_runs WHERE id = ?").get(run.lastInsertRowid);
    })();
    res.json({ ok: true, savedAt: result.saved_at });
  } catch (error) {
    next(error);
  }
});

app.get("/api/inventory/history", requireModule("inventory"), (_req, res) => {
  res.json(db.prepare(`
    SELECT r.id, r.saved_at, COUNT(i.product_id) AS products_count
    FROM inventory_runs r LEFT JOIN inventory_run_items i ON i.run_id = r.id
    GROUP BY r.id ORDER BY r.id DESC LIMIT 20
  `).all());
});

app.get("/api/workers", requireModule("workers"), (_req, res) => {
  res.json(db.prepare("SELECT * FROM workers ORDER BY name COLLATE NOCASE").all());
});

app.post("/api/workers", requireModule("workers"), (req, res, next) => {
  try {
    const worker = parseWorker(req.body);
    const result = db.prepare(`
      INSERT INTO workers (name, identification, position, monthly_salary, phone, email)
      VALUES (@name, @identification, @position, @monthly_salary, @phone, @email)
    `).run(worker);
    res.status(201).json(db.prepare("SELECT * FROM workers WHERE id = ?").get(result.lastInsertRowid));
  } catch (error) {
    if (isUniqueConstraint(error)) return next(httpError(409, "El teléfono o el correo ya está registrado en otro trabajador."));
    next(error);
  }
});

app.put("/api/workers/:id", requireModule("workers"), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) throw httpError(400, "Trabajador no válido.");
    const worker = parseWorker(req.body);
    const result = db.prepare(`
      UPDATE workers SET name = @name, identification = @identification, position = @position,
        monthly_salary = @monthly_salary, phone = @phone, email = @email,
        updated_at = CURRENT_TIMESTAMP WHERE id = @id
    `).run({ ...worker, id });
    if (!result.changes) throw httpError(404, "El trabajador no existe.");
    res.json(db.prepare("SELECT * FROM workers WHERE id = ?").get(id));
  } catch (error) {
    if (isUniqueConstraint(error)) return next(httpError(409, "El teléfono o el correo ya está registrado en otro trabajador."));
    next(error);
  }
});

app.delete("/api/workers/:id", requireModule("workers"), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) throw httpError(400, "Trabajador no válido.");
    const result = db.prepare("DELETE FROM workers WHERE id = ?").run(id);
    if (!result.changes) throw httpError(404, "El trabajador no existe.");
    res.json({ ok: true });
  } catch (error) {
    if (isConstraintError(error)) {
      return next(httpError(409, "No se puede eliminar un trabajador con comprobantes de nómina registrados."));
    }
    next(error);
  }
});

app.use("/api/payroll", requireModule("payroll"));

app.get("/api/payroll", (req, res, next) => {
  try {
    const period = validatePeriodKey(req.query.period);
    const rows = db.prepare(`
      SELECT w.id, w.name, w.identification, w.position, w.monthly_salary, w.phone, w.email,
        COALESCE(e.overtime, 0) AS overtime, COALESCE(e.bonuses, 0) AS bonuses,
        COALESCE(e.deductions, 0) AS deductions,
        r.delivery_status AS receipt_status
      FROM workers w
      LEFT JOIN payroll_entries e ON e.worker_id = w.id AND e.period_key = ?
      LEFT JOIN payroll_receipts r ON r.worker_id = w.id AND r.period_key = ?
      ORDER BY w.name COLLATE NOCASE
    `).all(period.key, period.key).map(worker => ({
      ...worker,
      pay: calculatePayroll(worker.monthly_salary, worker.overtime, worker.bonuses, worker.deductions)
    }));
    const closure = db.prepare("SELECT status, sent_at FROM payroll_closures WHERE period_key = ?").get(period.key);
    res.json({ period, closure: closure || null, workers: rows });
  } catch (error) {
    next(error);
  }
});

app.put("/api/payroll/:period/:workerId", (req, res, next) => {
  try {
    const period = validatePeriodKey(req.params.period);
    const workerId = Number(req.params.workerId);
    if (!Number.isSafeInteger(workerId) || workerId < 1) throw httpError(400, "Trabajador no válido.");
    if (db.prepare("SELECT 1 FROM payroll_closures WHERE period_key = ?").get(period.key)) {
      throw httpError(409, "Este periodo ya está cerrado. No se pueden modificar sus valores.");
    }
    const worker = db.prepare("SELECT monthly_salary FROM workers WHERE id = ?").get(workerId);
    if (!worker) {
      throw httpError(404, "El trabajador no existe.");
    }
    const amounts = parsePayrollAmounts(req.body);
    calculatePayroll(worker.monthly_salary, amounts.overtime, amounts.bonuses, amounts.deductions);
    db.prepare(`
      INSERT INTO payroll_entries (period_key, worker_id, overtime, bonuses, deductions)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(period_key, worker_id) DO UPDATE SET
        overtime = excluded.overtime, bonuses = excluded.bonuses, deductions = excluded.deductions,
        updated_at = CURRENT_TIMESTAMP
    `).run(period.key, workerId, amounts.overtime, amounts.bonuses, amounts.deductions);
    res.json({ ok: true, amounts });
  } catch (error) {
    next(error);
  }
});

app.post("/api/payroll/send", asyncRoute(async (req, res) => {
  const period = validatePeriodKey(req.body.period);
  const password = String(req.body.password || "");
  const currentUser = db.prepare("SELECT id, password_hash FROM users WHERE id = ?").get(req.session.user.id);
  if (!currentUser || !(await bcrypt.compare(password, currentUser.password_hash))) {
    throw httpError(401, "La contraseña de autorización no es correcta.");
  }
  const existingClosure = db.prepare("SELECT status FROM payroll_closures WHERE period_key = ?").get(period.key);
  if (existingClosure && existingClosure.status === "sent") {
    throw httpError(409, "Esta quincena ya fue enviada y cerrada.");
  }
  const transporter = createMailer();
  try {
    await transporter.verify();
  } catch (error) {
    throw httpError(502, `No fue posible conectar con SMTP: ${error.message}`);
  }

  const workers = db.prepare(`
    SELECT w.id, w.name, w.identification, w.position, w.monthly_salary, w.email,
      COALESCE(e.overtime, 0) AS overtime, COALESCE(e.bonuses, 0) AS bonuses,
      COALESCE(e.deductions, 0) AS deductions
    FROM workers w LEFT JOIN payroll_entries e ON e.worker_id = w.id AND e.period_key = ?
    ORDER BY w.name COLLATE NOCASE
  `).all(period.key);
  if (!workers.length) throw httpError(400, "No hay trabajadores registrados para procesar la nómina.");
  const missingEmail = workers.filter(worker => !worker.email);
  if (missingEmail.length) {
    throw httpError(400, `Falta correo electrónico para: ${missingEmail.map(worker => worker.name).join(", ")}.`);
  }

  const hasClosure = Boolean(existingClosure);
  const snapshots = await Promise.all(workers.map(async worker => {
    const saved = db.prepare(`
      SELECT snapshot_json, pdf, delivery_status FROM payroll_receipts
      WHERE period_key = ? AND worker_id = ?
    `).get(period.key, worker.id);
    if (saved) return { worker, receipt: saved };
    const snapshot = {
      periodKey: period.key,
      periodLabel: period.label,
      periodStart: period.start,
      periodEnd: period.end,
      worker: {
        id: worker.id,
        name: worker.name,
        identification: worker.identification,
        position: worker.position,
        email: worker.email
      },
      pay: calculatePayroll(worker.monthly_salary, worker.overtime, worker.bonuses, worker.deductions)
    };
    const pdf = await createPayrollPdf(snapshot);
    return { worker, snapshot, pdf };
  }));

  if (!hasClosure) {
    db.transaction(() => {
      db.prepare("INSERT INTO payroll_closures (period_key, status) VALUES (?, 'sending')").run(period.key);
      const insert = db.prepare(`
        INSERT INTO payroll_receipts (period_key, worker_id, snapshot_json, pdf)
        VALUES (?, ?, ?, ?)
      `);
      for (const item of snapshots) {
        if (item.snapshot) {
          insert.run(period.key, item.worker.id, JSON.stringify(item.snapshot), item.pdf);
        }
      }
    })();
  }

  const pending = db.prepare(`
    SELECT r.worker_id, r.snapshot_json, r.pdf, w.email, w.name
    FROM payroll_receipts r JOIN workers w ON w.id = r.worker_id
    WHERE r.period_key = ? AND r.delivery_status != 'sent'
    ORDER BY w.name COLLATE NOCASE
  `).all(period.key);
  let sentCount = 0;
  const failures = [];
  for (const item of pending) {
    const snapshot = JSON.parse(item.snapshot_json);
    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM,
        to: item.email,
        subject: `Comprobante de nómina - ${snapshot.periodLabel}`,
        text: `Hola ${item.name}, adjuntamos tu comprobante de nómina correspondiente a ${snapshot.periodLabel}.`,
        attachments: [{
          filename: `comprobante-nomina-${period.key}-${item.worker_id}.pdf`,
          content: item.pdf,
          contentType: "application/pdf"
        }]
      });
      db.prepare(`
        UPDATE payroll_receipts SET delivery_status = 'sent', delivery_error = NULL,
          sent_at = CURRENT_TIMESTAMP WHERE period_key = ? AND worker_id = ?
      `).run(period.key, item.worker_id);
      sentCount += 1;
    } catch (error) {
      const message = String(error.message || "Error de envío").slice(0, 500);
      db.prepare(`
        UPDATE payroll_receipts SET delivery_status = 'failed', delivery_error = ?
        WHERE period_key = ? AND worker_id = ?
      `).run(message, period.key, item.worker_id);
      failures.push({ worker: item.name, error: message });
    }
  }

  const remaining = db.prepare(`
    SELECT COUNT(*) AS count FROM payroll_receipts
    WHERE period_key = ? AND delivery_status != 'sent'
  `).get(period.key).count;
  const status = remaining === 0 ? "sent" : "partial";
  db.prepare(`
    UPDATE payroll_closures SET status = ?, sent_at = CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE sent_at END
    WHERE period_key = ?
  `).run(status, status, period.key);
  res.status(remaining === 0 ? 200 : 502).json({
    status,
    sentCount,
    remaining,
    failures,
    message: remaining === 0
      ? "Nómina enviada y periodo cerrado correctamente."
      : "El envío quedó parcial. Los comprobantes enviados no se repetirán al reintentar."
  });
}));

app.get("/api/payroll/:period/:workerId/receipt", (req, res, next) => {
  try {
    const period = validatePeriodKey(req.params.period);
    const workerId = Number(req.params.workerId);
    if (!Number.isSafeInteger(workerId) || workerId < 1) throw httpError(400, "Trabajador no válido.");
    const receipt = db.prepare(`
      SELECT r.pdf, w.name FROM payroll_receipts r
      JOIN workers w ON w.id = r.worker_id
      WHERE r.period_key = ? AND r.worker_id = ?
    `).get(period.key, workerId);
    if (!receipt) throw httpError(404, "El comprobante aún no ha sido generado.");
    const safeName = receipt.name.replace(/[^\p{L}\p{N}-]/gu, "-").slice(0, 60);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="comprobante-${safeName}-${period.key}.pdf"`);
    res.send(receipt.pdf);
  } catch (error) {
    next(error);
  }
});

app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

app.use((error, _req, res, _next) => {
  if (res.headersSent) return;
  const status = Number(error.status) || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({
    error: status >= 500 ? "Ocurrió un error interno. Consulta los registros del servidor." : error.message
  });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Carnes Santa Elena disponible en http://localhost:${PORT}`);
});
