(() => {
  const isPages = location.hostname.endsWith(".github.io");
  const demoRequested = new URLSearchParams(location.search).get("demo") === "1";
  if (!isPages && !demoRequested) return;

  const storageKey = "carnes-santa-elena-pages-demo-v1";
  const modules = ["cash", "products", "inventory", "workers", "payroll"];
  const seed = () => ({
    nextId: 10,
    sessionUserId: null,
    users: [
      { id: 1, name: "Administrador de muestra", username: "admin", password: "DemoCarnes2026", role: "admin", active: true, permissions: [...modules] },
      { id: 2, name: "Operador de muestra", username: "operador", password: "DemoOperador2026", role: "operator", active: true, permissions: ["cash", "products"] }
    ],
    products: [
      { id: 1, code: "RES-001", name: "Lomo de res", category: "RES", unit_price: 32900, unit: "KG" },
      { id: 2, code: "CER-002", name: "Costilla de cerdo", category: "CERDO", unit_price: 18900, unit: "KG" },
      { id: 3, code: "POL-003", name: "Pechuga de pollo", category: "POLLO", unit_price: 15900, unit: "KG" },
      { id: 4, code: "EMB-004", name: "Chorizo artesanal", category: "EMBUTIDOS", unit_price: 9500, unit: "PAQUETE" }
    ],
    inventory: { 1: { baseline: 24.5, added: 0 }, 2: { baseline: 18, added: 0 }, 3: { baseline: 32, added: 0 }, 4: { baseline: 16, added: 0 } },
    workers: [
      { id: 1, name: "Ana Pérez (muestra)", identification: "DOC-0001", position: "Mostrador", monthly_salary: 1800000, phone: "3000000001", email: "ana@example.com" },
      { id: 2, name: "Luis Gómez (muestra)", identification: "DOC-0002", position: "Corte y preparación", monthly_salary: 2100000, phone: "3000000002", email: "luis@example.com" }
    ],
    payrollEntries: {},
    closures: {}
  });

  function read() {
    const stored = localStorage.getItem(storageKey);
    if (stored) return JSON.parse(stored);
    const initial = seed();
    localStorage.setItem(storageKey, JSON.stringify(initial));
    return initial;
  }

  let data = read();
  const persist = () => localStorage.setItem(storageKey, JSON.stringify(data));
  const bodyOf = options => options.body ? JSON.parse(options.body) : {};
  const fail = (status, message) => {
    const error = new Error(message);
    error.status = status;
    error.details = { error: message };
    throw error;
  };
  const currentUser = () => data.users.find(user => user.id === data.sessionUserId && user.active) || null;
  const publicUser = user => ({
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    active: user.active,
    permissions: user.role === "admin" ? [...modules] : [...user.permissions]
  });
  const requireUser = () => {
    const user = currentUser();
    if (!user) fail(401, "Inicia sesión para continuar.");
    return user;
  };
  const requireAdmin = () => {
    const user = requireUser();
    if (user.role !== "admin") fail(403, "Solo un Administrador puede gestionar usuarios.");
    return user;
  };
  const requireModule = module => {
    const user = requireUser();
    if (user.role !== "admin" && !user.permissions.includes(module)) {
      fail(403, "Tu cuenta no tiene acceso a ese módulo.");
    }
    return user;
  };
  const numericId = value => {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id < 1) fail(400, "Identificador no válido.");
    return id;
  };
  const decodeBody = bodyOf;
  const payFor = (worker, entry = {}) => {
    const base = Math.floor(worker.monthly_salary / 2);
    const overtime = Number(entry.overtime) || 0;
    const bonuses = Number(entry.bonuses) || 0;
    const deductions = Number(entry.deductions) || 0;
    return { base, overtime, bonuses, deductions, total: base + overtime + bonuses - deductions };
  };
  const formatPeriod = period => {
    const match = /^(\d{4})-(\d{2})-([12])$/.exec(period || "");
    if (!match) fail(400, "Selecciona un periodo de nómina válido.");
    return {
      key: period,
      label: `${match[3] === "1" ? "1.ª quincena" : "2.ª quincena"} de ${match[2]}/${match[1]}`
    };
  };
  const normalizedPhone = value => String(value || "").replace(/\D/g, "");
  const normalizedEmail = value => String(value || "").trim().toLowerCase();

  async function api(url, options = {}) {
    const parsed = new URL(url, location.href);
    const path = parsed.pathname;
    const method = options.method || "GET";
    const body = decodeBody(options);
    if (path === "/api/auth/me" && method === "GET") {
      const user = currentUser();
      return { user: user ? publicUser(user) : null, csrfToken: user ? "demo-only" : null };
    }
    if (path === "/api/auth/login" && method === "POST") {
      const user = data.users.find(item =>
        item.username === String(body.username || "").trim() &&
        item.password === String(body.password || "") &&
        item.active
      );
      if (!user) fail(401, "Usuario o contraseña incorrectos.");
      data.sessionUserId = user.id;
      persist();
      return { user: publicUser(user), csrfToken: "demo-only" };
    }
    if (path === "/api/auth/logout" && method === "POST") {
      data.sessionUserId = null;
      persist();
      return { ok: true };
    }
    requireUser();

    if (path === "/api/products") {
      requireModule("products");
      if (method === "GET") return [...data.products].sort((a, b) => a.name.localeCompare(b.name, "es"));
      if (method === "POST") {
        const code = String(body.code || "").trim();
        if (data.products.some(item => item.code.toLowerCase() === code.toLowerCase())) fail(409, "Ya existe un producto con ese código.");
        const product = { id: data.nextId++, ...body, code };
        data.products.push(product);
        data.inventory[product.id] = { baseline: 0, added: 0 };
        persist();
        return product;
      }
    }
    const productRoute = /^\/api\/products\/(\d+)$/.exec(path);
    if (productRoute) {
      requireModule("products");
      const id = numericId(productRoute[1]);
      const index = data.products.findIndex(item => item.id === id);
      if (index < 0) fail(404, "El producto no existe.");
      if (method === "PUT") {
        data.products[index] = { ...data.products[index], name: body.name, category: body.category, unit_price: Number(body.unit_price), unit: body.unit };
        persist();
        return data.products[index];
      }
      if (method === "DELETE") {
        data.products.splice(index, 1);
        delete data.inventory[id];
        persist();
        return { ok: true };
      }
    }
    if (path === "/api/inventory" && method === "GET") {
      requireModule("inventory");
      return data.products.map(product => {
        const entry = data.inventory[product.id] || { baseline: 0, added: 0 };
        return { ...product, ...entry, current_quantity: entry.baseline + entry.added };
      });
    }
    const inventoryCountRoute = /^\/api\/inventory\/(\d+)\/count$/.exec(path);
    if (inventoryCountRoute && method === "PUT") {
      requireModule("inventory");
      const id = numericId(inventoryCountRoute[1]);
      const entry = data.inventory[id];
      const quantity = Number(body.quantity);
      if (!entry || !Number.isFinite(quantity) || quantity <= 0) fail(400, "Ingresa una cantidad positiva para sumar.");
      entry.added += quantity;
      persist();
      return { ...entry, current_quantity: entry.baseline + entry.added };
    }
    if (path === "/api/inventory/save" && method === "POST") {
      requireModule("inventory");
      for (const item of Object.values(data.inventory)) {
        item.baseline += item.added;
        item.added = 0;
      }
      persist();
      return { ok: true, savedAt: new Date().toISOString() };
    }
    if (path === "/api/workers") {
      requireModule("workers");
      if (method === "GET") return [...data.workers].sort((a, b) => a.name.localeCompare(b.name, "es"));
      if (method === "POST") {
        ensureUniqueWorker(body);
        const worker = { id: data.nextId++, ...body, monthly_salary: Number(body.monthly_salary) };
        data.workers.push(worker);
        persist();
        return worker;
      }
    }
    const workerRoute = /^\/api\/workers\/(\d+)$/.exec(path);
    if (workerRoute) {
      requireModule("workers");
      const id = numericId(workerRoute[1]);
      const index = data.workers.findIndex(item => item.id === id);
      if (index < 0) fail(404, "El trabajador no existe.");
      if (method === "PUT") {
        ensureUniqueWorker(body, id);
        data.workers[index] = { ...data.workers[index], ...body, monthly_salary: Number(body.monthly_salary) };
        persist();
        return data.workers[index];
      }
      if (method === "DELETE") {
        data.workers.splice(index, 1);
        persist();
        return { ok: true };
      }
    }
    if (path === "/api/admin/users" || /^\/api\/admin\/users\/\d+$/.test(path)) {
      const admin = requireAdmin();
      const target = /^\/api\/admin\/users\/(\d+)$/.exec(path);
      if (path === "/api/admin/users" && method === "GET") {
        return data.users.map(publicUser).sort((a, b) => a.name.localeCompare(b.name, "es"));
      }
      if (method === "POST" && !target) {
        validateUser(body, null);
        const user = {
          id: data.nextId++,
          name: String(body.name).trim(),
          username: String(body.username).trim().toLowerCase(),
          password: String(body.password),
          role: body.role,
          active: Boolean(body.active),
          permissions: body.role === "admin" ? [...modules] : body.permissions.filter(item => modules.includes(item))
        };
        data.users.push(user);
        persist();
        return publicUser(user);
      }
      if (target) {
        const id = numericId(target[1]);
        const index = data.users.findIndex(item => item.id === id);
        if (index < 0) fail(404, "El usuario no existe.");
        const existing = data.users[index];
        if (method === "PUT") {
          validateUser(body, id);
          if (id === admin.id && !body.active) fail(409, "No puedes desactivar tu propia cuenta.");
          data.users[index] = {
            ...existing,
            name: String(body.name).trim(),
            username: String(body.username).trim().toLowerCase(),
            password: body.password ? String(body.password) : existing.password,
            role: body.role,
            active: Boolean(body.active),
            permissions: body.role === "admin" ? [...modules] : body.permissions.filter(item => modules.includes(item))
          };
          persist();
          return publicUser(data.users[index]);
        }
        if (method === "DELETE") {
          if (id === admin.id) fail(409, "No puedes eliminar tu propia cuenta.");
          if (existing.role === "admin" && existing.active && data.users.filter(user => user.role === "admin" && user.active).length <= 1) {
            fail(409, "No se puede eliminar el último Administrador activo.");
          }
          data.users.splice(index, 1);
          persist();
          return { ok: true };
        }
      }
    }
    if (path === "/api/payroll" && method === "GET") {
      requireModule("payroll");
      const period = formatPeriod(parsed.searchParams.get("period"));
      const closure = data.closures[period.key] || null;
      const workers = data.workers.map(worker => {
        const entry = data.payrollEntries[`${period.key}:${worker.id}`] || {};
        return {
          ...worker,
          overtime: Number(entry.overtime) || 0,
          bonuses: Number(entry.bonuses) || 0,
          deductions: Number(entry.deductions) || 0,
          pay: payFor(worker, entry),
          receipt_status: closure ? "sent" : null
        };
      });
      return { period, closure, workers };
    }
    const payrollWorkerRoute = /^\/api\/payroll\/(\d{4}-\d{2}-[12])\/(\d+)$/.exec(path);
    if (payrollWorkerRoute && method === "PUT") {
      requireModule("payroll");
      const period = formatPeriod(payrollWorkerRoute[1]);
      const workerId = numericId(payrollWorkerRoute[2]);
      const worker = data.workers.find(item => item.id === workerId);
      if (!worker) fail(404, "El trabajador no existe.");
      if (data.closures[period.key]) fail(409, "El periodo de nómina ya fue cerrado.");
      const amounts = ["overtime", "bonuses", "deductions"].map(key => Number(body[key]));
      if (amounts.some(amount => !Number.isSafeInteger(amount) || amount < 0)) fail(400, "Los rubros deben ser valores enteros no negativos.");
      const [overtime, bonuses, deductions] = amounts;
      if (deductions > Math.floor(worker.monthly_salary / 2) + overtime + bonuses) fail(400, "Los débitos no pueden superar el total devengado.");
      data.payrollEntries[`${period.key}:${workerId}`] = { overtime, bonuses, deductions };
      persist();
      return { ok: true };
    }
    if (path === "/api/payroll/send" && method === "POST") {
      const admin = requireModule("payroll");
      if (body.password !== admin.password) fail(401, "La contraseña de autorización no es correcta.");
      const period = formatPeriod(body.period);
      if (!data.workers.length) fail(400, "No hay trabajadores para procesar.");
      data.closures[period.key] = { period_key: period.key, status: "sent", sent_at: new Date().toISOString() };
      persist();
      return { ok: true, message: "Demostración: comprobantes generados; no se envió ningún correo real." };
    }
    fail(404, `Ruta de demostración no disponible: ${method} ${path}`);
  }

  function ensureUniqueWorker(worker, excludeId = null) {
    const duplicate = data.workers.some(item => item.id !== excludeId && (
      normalizedPhone(item.phone) === normalizedPhone(worker.phone) ||
      normalizedEmail(item.email) === normalizedEmail(worker.email)
    ));
    if (duplicate) fail(409, "El teléfono o el correo ya está registrado en otro trabajador.");
  }

  function validateUser(user, excludeId) {
    const username = String(user.username || "").trim().toLowerCase();
    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) fail(400, "El usuario debe tener entre 3 y 40 caracteres válidos.");
    if (data.users.some(item => item.id !== excludeId && item.username.toLowerCase() === username)) fail(409, "Ese nombre de usuario ya está registrado.");
    if (user.role !== "admin" && user.role !== "operator") fail(400, "El rol seleccionado no es válido.");
    if (user.password && (String(user.password).length < 12 || String(user.password).length > 200)) {
      fail(400, "La contraseña debe tener entre 12 y 200 caracteres.");
    }
  }

  function openReceipt(payroll, workerId) {
    const worker = payroll?.workers.find(item => item.id === workerId);
    if (!worker) return;
    const escape = value => String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
    const money = value => `$${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(value)}`;
    const receipt = `<!doctype html><html lang="es"><meta charset="utf-8"><title>Comprobante de demostración</title><style>body{max-width:680px;margin:48px auto;padding:24px;color:#1a1a1a;font:16px Arial;background:#f4f1ea}article{padding:32px;border:1px solid #cbd1ca;background:white}h1{color:#1b4332;font:600 28px Georgia}table{width:100%;border-collapse:collapse}td{padding:10px 0;border-bottom:1px solid #ddd}td:last-child{text-align:right;font-weight:bold}.note{margin-top:24px;color:#656b66;font-size:13px}</style><article><p>CARNES SANTA ELENA · DEMOSTRACIÓN</p><h1>Comprobante de nómina</h1><p>${escape(worker.name)} · ${escape(worker.position)}</p><p>${escape(payroll.period.label)}</p><table><tr><td>Salario quincenal</td><td>${money(worker.pay.base)}</td></tr><tr><td>Horas extra</td><td>${money(worker.pay.overtime)}</td></tr><tr><td>Bonos</td><td>${money(worker.pay.bonuses)}</td></tr><tr><td>Débitos</td><td>− ${money(worker.pay.deductions)}</td></tr><tr><td>Total a pagar</td><td>${money(worker.pay.total)}</td></tr></table><p class="note">Comprobante ficticio para revisión visual. No es un documento de pago real.</p></article></html>`;
    const popup = window.open("", "_blank", "noopener,noreferrer");
    if (popup) popup.document.write(receipt);
  }

  window.demoMode = true;
  window.demoApi = Object.assign(api, {
    openReceipt,
    reset() {
      localStorage.removeItem(storageKey);
    }
  });
})();
