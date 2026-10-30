const state = {
  section: "cash",
  products: [],
  workers: [],
  inventory: [],
  payroll: null,
  payrollPeriod: null,
  payrollWorker: null,
  payrollAction: "send",
  users: [],
  user: null,
  csrfToken: null,
  denominations: new Map()
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const amountFormatter = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const sectionTitles = {
  cash: "Caja y vueltos",
  products: "Productos",
  inventory: "Inventarios",
  workers: "Trabajadores",
  payroll: "Nómina",
  users: "Usuarios"
};
const moduleLabels = {
  cash: "Caja / Vueltos",
  products: "Productos",
  inventory: "Inventarios",
  workers: "Trabajadores",
  payroll: "Nómina"
};

function money(value) {
  return `$${amountFormatter.format(Math.abs(Number(value) || 0))}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

async function api(url, options = {}) {
  if (window.demoMode) return window.demoApi(url, options);
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers };
  if (state.csrfToken && !["GET", "HEAD", "OPTIONS"].includes(options.method || "GET")) {
    headers["X-CSRF-Token"] = state.csrfToken;
  }
  let response;
  try {
    response = await fetch(url, { credentials: "same-origin", ...options, headers });
  } catch {
    throw new Error("No fue posible conectarse con la aplicación local. Comprueba que el servidor esté activo.");
  }
  const contentType = response.headers.get("content-type") || "";
  const result = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(result?.error || result?.message || `Error HTTP ${response.status}`);
    error.status = response.status;
    error.details = result;
    throw error;
  }
  return result;
}

function notify(message, type = "success") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", type === "error");
  toast.classList.add("show");
  window.clearTimeout(notify.timeout);
  notify.timeout = window.setTimeout(() => toast.classList.remove("show"), 3800);
}

function handleError(error) {
  if (error.status === 401 && state.user && /inicia sesión|inactiva|ya no existe/i.test(error.message)) {
    endSession("Tu sesión terminó. Ingresa de nuevo.");
    return;
  }
  notify(error.message || "Ocurrió un error inesperado.", "error");
}

function openDialog(id) {
  const dialog = document.getElementById(id);
  if (!dialog.open) dialog.showModal();
}

function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog.open) dialog.close();
}

function setSection(section) {
  const allowed = state.user && (
    state.user.role === "admin" ||
    (section === "users" ? false : state.user.permissions.includes(section))
  );
  if (!allowed) {
    notify("Tu cuenta no tiene acceso a ese módulo.", "error");
    return;
  }
  state.section = section;
  $$(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.section === section));
  $$(".page-section").forEach(page => page.classList.toggle("active", page.id === `section-${section}`));
  $("#page-title").textContent = sectionTitles[section];
  if (section === "products") loadProducts().catch(handleError);
  if (section === "inventory") loadInventory().catch(handleError);
  if (section === "workers") loadWorkers().catch(handleError);
  if (section === "payroll") loadPayroll().catch(handleError);
  if (section === "users") loadUsers().catch(handleError);
}

function renderNavigation() {
  const isAdmin = state.user.role === "admin";
  $$("[data-module]").forEach(button => {
    button.classList.toggle("hidden", !isAdmin && !state.user.permissions.includes(button.dataset.module));
  });
  $$("[data-admin-only]").forEach(button => button.classList.toggle("hidden", !isAdmin));
  $("#header-user").textContent = `${state.user.name} · ${isAdmin ? "Administrador" : "Operador"}`;
  $("#admin-name").textContent = `${state.user.name} (${state.user.username})`;
}

function enterApplication() {
  $("#login-screen").classList.add("hidden");
  $(".app-shell").classList.remove("hidden");
  renderNavigation();
  if (!$("#payroll-month").value) setDefaultPeriod();
  const firstSection = state.user.role === "admin"
    ? "cash"
    : state.user.permissions.find(section => sectionTitles[section]) || null;
  if (firstSection) {
    setSection(firstSection);
    return;
  }
  $$(".page-section").forEach(page => page.classList.remove("active"));
  $("#page-title").textContent = "Sin módulos asignados";
  $("#section-none").classList.add("active");
}

async function syncAccess() {
  try {
    const result = await api("/api/auth/me");
    if (!result.user) {
      await endSession("Tu sesión terminó. Ingresa de nuevo.");
      return;
    }
    state.user = result.user;
    state.csrfToken = result.csrfToken;
    renderNavigation();
    const stillAllowed = state.user.role === "admin" ||
      state.user.permissions.includes(state.section);
    if (!stillAllowed) enterApplication();
  } catch (error) {
    handleError(error);
  }
}

async function endSession(message) {
  state.user = null;
  state.csrfToken = null;
  state.payroll = null;
  state.users = [];
  $(".app-shell").classList.add("hidden");
  $("#login-screen").classList.remove("hidden");
  $("#global-login-form").reset();
  $("#login-error").textContent = message || "";
  $("#login-error").classList.toggle("hidden", !message);
}

function renderCash() {
  const total = [...state.denominations].reduce((sum, [denomination, count]) => sum + denomination * count, 0);
  const purchase = Math.max(0, Math.trunc(Number($("#purchase-amount").value) || 0));
  const change = total - purchase;
  $("#received-total").textContent = money(total);
  $("#purchase-total").textContent = money(purchase);
  $("#change-value").textContent = money(Math.max(0, change));
  const message = $("#change-message");
  message.classList.toggle("error", purchase > total && purchase > 0);
  if (!purchase) message.textContent = "Ingresa el valor de la compra";
  else if (change < 0) message.textContent = `Faltan ${money(Math.abs(change))}`;
  else if (change === 0) message.textContent = "Pago exacto";
  else message.textContent = "Listo para entregar al cliente";

  $("#received-list").innerHTML = [...state.denominations]
    .filter(([, count]) => count > 0)
    .map(([denomination, count]) => `
      <div class="received-row">
        <span>${money(denomination)} × ${count}</span>
        <strong>${money(denomination * count)}</strong>
        <button class="remove-denom" type="button" data-remove-denom="${denomination}" aria-label="Quitar ${money(denomination)}">×</button>
      </div>
    `).join("");
}

function addDenomination(value) {
  const denomination = Number(value);
  if (!Number.isSafeInteger(denomination) || denomination <= 0) {
    notify("Ingresa una denominación válida en pesos.", "error");
    return;
  }
  state.denominations.set(denomination, (state.denominations.get(denomination) || 0) + 1);
  renderCash();
}

const commonDenominations = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
$("#denominations").innerHTML = commonDenominations.map(value =>
  `<button class="denom-button" type="button" data-denomination="${value}">${money(value)}</button>`
).join("");
$("#denominations").addEventListener("click", event => {
  const button = event.target.closest("[data-denomination]");
  if (button) addDenomination(button.dataset.denomination);
});
$("#add-denomination").addEventListener("click", () => {
  addDenomination($("#custom-denomination").value);
  $("#custom-denomination").value = "";
});
$("#custom-denomination").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    $("#add-denomination").click();
  }
});
$("#purchase-amount").addEventListener("input", renderCash);
$("#clear-cash").addEventListener("click", () => {
  $("#purchase-amount").value = "";
  state.denominations.clear();
  renderCash();
});
$("#received-list").addEventListener("click", event => {
  const button = event.target.closest("[data-remove-denom]");
  if (!button) return;
  const amount = Number(button.dataset.removeDenom);
  const count = state.denominations.get(amount) || 0;
  if (count <= 1) state.denominations.delete(amount);
  else state.denominations.set(amount, count - 1);
  renderCash();
});
renderCash();

async function loadProducts() {
  state.products = await api("/api/products");
  renderProducts();
}

function renderProducts() {
  const query = $("#product-search").value.trim().toLocaleLowerCase("es-CO");
  const products = state.products.filter(product =>
    `${product.code} ${product.name}`.toLocaleLowerCase("es-CO").includes(query)
  );
  $("#product-count").textContent = `${products.length} producto${products.length === 1 ? "" : "s"}`;
  $("#products-empty").classList.toggle("hidden", products.length > 0);
  $("#products-body").innerHTML = products.map(product => `
    <tr>
      <td><span class="code-pill">${escapeHtml(product.code)}</span></td>
      <td><span class="primary-cell">${escapeHtml(product.name)}</span></td>
      <td><span class="category-pill">${escapeHtml(product.category)}</span></td>
      <td><strong>${money(product.unit_price)}</strong></td>
      <td>${escapeHtml(product.unit)}</td>
      <td><div class="table-actions">
        <button class="icon-action" type="button" data-edit-product="${product.id}">Editar</button>
        <button class="icon-action danger" type="button" data-delete-product="${product.id}">Eliminar</button>
      </div></td>
    </tr>
  `).join("");
}

$("#product-search").addEventListener("input", renderProducts);
$("#new-product").addEventListener("click", () => {
  $("#product-form").reset();
  $("#product-id").value = "";
  $("#product-code").disabled = false;
  $("#product-dialog-title").textContent = "Nuevo producto";
  openDialog("product-dialog");
});
$("#products-body").addEventListener("click", async event => {
  const edit = event.target.closest("[data-edit-product]");
  const remove = event.target.closest("[data-delete-product]");
  if (edit) {
    const product = state.products.find(item => item.id === Number(edit.dataset.editProduct));
    if (!product) return;
    $("#product-id").value = product.id;
    $("#product-code").value = product.code;
    $("#product-code").disabled = true;
    $("#product-name").value = product.name;
    $("#product-category").value = product.category;
    $("#product-unit").value = product.unit;
    $("#product-price").value = product.unit_price;
    $("#product-dialog-title").textContent = "Editar producto";
    openDialog("product-dialog");
  }
  if (remove) {
    const product = state.products.find(item => item.id === Number(remove.dataset.deleteProduct));
    if (!product || !window.confirm(`¿Eliminar el producto "${product.name}"? Su código quedará disponible.`)) return;
    try {
      await api(`/api/products/${product.id}`, { method: "DELETE" });
      notify("Producto eliminado.");
      await loadProducts();
    } catch (error) {
      handleError(error);
    }
  }
});

$("#product-form").addEventListener("submit", async event => {
  event.preventDefault();
  const id = $("#product-id").value;
  const data = {
    code: $("#product-code").value.trim(),
    name: $("#product-name").value.trim(),
    category: $("#product-category").value,
    unit: $("#product-unit").value,
    unit_price: Number($("#product-price").value)
  };
  try {
    await api(id ? `/api/products/${id}` : "/api/products", {
      method: id ? "PUT" : "POST", body: JSON.stringify(data)
    });
    closeDialog("product-dialog");
    notify(id ? "Producto actualizado." : "Producto creado.");
    await loadProducts();
  } catch (error) {
    handleError(error);
  }
});

async function loadInventory() {
  state.inventory = await api("/api/inventory");
  renderInventory();
}

function renderInventory() {
  const query = $("#inventory-search").value.trim().toLocaleLowerCase("es-CO");
  const items = state.inventory.filter(item =>
    `${item.code} ${item.name}`.toLocaleLowerCase("es-CO").includes(query)
  );
  $("#inventory-count").textContent = `${items.length} producto${items.length === 1 ? "" : "s"}`;
  $("#inventory-empty").classList.toggle("hidden", items.length > 0);
  $("#inventory-body").innerHTML = items.map(item => `
    <tr>
      <td><span class="primary-cell">${escapeHtml(item.name)}</span><span class="sub-cell">${escapeHtml(item.code)} · ${escapeHtml(item.category)}</span></td>
      <td>${escapeHtml(item.unit)}</td>
      <td>${escapeHtml(String(item.baseline))} ${escapeHtml(item.unit)}</td>
      <td><div class="inline-field"><input class="count-input" type="number" min="0" max="1000000" step="0.001" value="0" aria-label="Cantidad a sumar para ${escapeHtml(item.name)}"><button class="icon-action" type="button" data-add-count="${item.id}">＋</button></div></td>
      <td class="quantity-current">${escapeHtml(String(item.current_quantity))} ${escapeHtml(item.unit)}</td>
    </tr>
  `).join("");
}

$("#inventory-search").addEventListener("input", renderInventory);
$("#inventory-body").addEventListener("click", async event => {
  const button = event.target.closest("[data-add-count]");
  if (!button) return;
  const row = button.closest("tr");
  const input = row.querySelector(".count-input");
  const quantity = Number(input.value);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    notify("Ingresa una cantidad mayor que cero para sumar al inventario.", "error");
    return;
  }
  try {
    await api(`/api/inventory/${button.dataset.addCount}/count`, {
      method: "PUT", body: JSON.stringify({ quantity })
    });
    await loadInventory();
    notify("Conteo sumado al saldo actual.");
  } catch (error) {
    handleError(error);
  }
});
$("#inventory-body").addEventListener("keydown", event => {
  if (event.key === "Enter" && event.target.matches(".count-input")) {
    event.preventDefault();
    event.target.closest("tr").querySelector("[data-add-count]").click();
  }
});
$("#save-inventory").addEventListener("click", async () => {
  if (!state.inventory.length) {
    notify("No hay productos para guardar.", "error");
    return;
  }
  if (!window.confirm("¿Guardar el saldo actual como la nueva base de inventario?")) return;
  try {
    const result = await api("/api/inventory/save", { method: "POST" });
    await loadInventory();
    notify(`Inventario guardado. Nuevo ciclo listo (${new Date(result.savedAt).toLocaleString("es-CO")}).`);
  } catch (error) {
    handleError(error);
  }
});

async function loadWorkers() {
  state.workers = await api("/api/workers");
  renderWorkers();
}

function renderWorkers() {
  const query = $("#worker-search").value.trim().toLocaleLowerCase("es-CO");
  const workers = state.workers.filter(worker =>
    `${worker.name} ${worker.position} ${worker.phone} ${worker.email}`.toLocaleLowerCase("es-CO").includes(query)
  );
  $("#worker-count").textContent = `${workers.length} trabajador${workers.length === 1 ? "" : "es"}`;
  $("#workers-empty").classList.toggle("hidden", workers.length > 0);
  $("#workers-body").innerHTML = workers.map(worker => `
    <tr>
      <td><span class="primary-cell">${escapeHtml(worker.name)}</span><span class="sub-cell">${escapeHtml(worker.identification || "Documento sin registrar")}</span></td>
      <td>${escapeHtml(worker.position)}</td>
      <td><strong>${money(worker.monthly_salary)}</strong></td>
      <td>${escapeHtml(worker.phone)}</td>
      <td>${escapeHtml(worker.email)}</td>
      <td><div class="table-actions">
        <button class="icon-action" type="button" data-edit-worker="${worker.id}">Editar</button>
        <button class="icon-action danger" type="button" data-delete-worker="${worker.id}">Eliminar</button>
      </div></td>
    </tr>
  `).join("");
}

$("#worker-search").addEventListener("input", renderWorkers);
$("#new-worker").addEventListener("click", () => {
  $("#worker-form").reset();
  $("#worker-id").value = "";
  $("#worker-dialog-title").textContent = "Nuevo trabajador";
  openDialog("worker-dialog");
});
$("#workers-body").addEventListener("click", async event => {
  const edit = event.target.closest("[data-edit-worker]");
  const remove = event.target.closest("[data-delete-worker]");
  if (edit) {
    const worker = state.workers.find(item => item.id === Number(edit.dataset.editWorker));
    if (!worker) return;
    $("#worker-id").value = worker.id;
    $("#worker-name").value = worker.name;
    $("#worker-identification").value = worker.identification;
    $("#worker-position").value = worker.position;
    $("#worker-salary").value = worker.monthly_salary;
    $("#worker-phone").value = worker.phone;
    $("#worker-email").value = worker.email;
    $("#worker-dialog-title").textContent = "Editar trabajador";
    openDialog("worker-dialog");
  }
  if (remove) {
    const worker = state.workers.find(item => item.id === Number(remove.dataset.deleteWorker));
    if (!worker || !window.confirm(`¿Eliminar al trabajador "${worker.name}"?`)) return;
    try {
      await api(`/api/workers/${worker.id}`, { method: "DELETE" });
      notify("Trabajador eliminado.");
      await loadWorkers();
    } catch (error) {
      handleError(error);
    }
  }
});

$("#worker-form").addEventListener("submit", async event => {
  event.preventDefault();
  const id = $("#worker-id").value;
  const data = {
    name: $("#worker-name").value.trim(),
    identification: $("#worker-identification").value.trim(),
    position: $("#worker-position").value.trim(),
    monthly_salary: Number($("#worker-salary").value),
    phone: $("#worker-phone").value.trim(),
    email: $("#worker-email").value.trim()
  };
  try {
    await api(id ? `/api/workers/${id}` : "/api/workers", {
      method: id ? "PUT" : "POST", body: JSON.stringify(data)
    });
    closeDialog("worker-dialog");
    notify(id ? "Trabajador actualizado." : "Trabajador registrado.");
    await loadWorkers();
  } catch (error) {
    handleError(error);
  }
});

async function loadUsers() {
  state.users = await api("/api/admin/users");
  renderUsers();
}

function renderUsers() {
  $("#user-count").textContent = `${state.users.length} cuenta${state.users.length === 1 ? "" : "s"}`;
  $("#users-empty").classList.toggle("hidden", state.users.length > 0);
  $("#users-body").innerHTML = state.users.map(user => {
    const permissions = user.role === "admin"
      ? "Todos los módulos"
      : user.permissions.map(module => moduleLabels[module]).join(", ") || "Sin permisos";
    return `
      <tr>
        <td><span class="primary-cell">${escapeHtml(user.name)}</span></td>
        <td>${escapeHtml(user.username)}</td>
        <td>${user.role === "admin" ? "Administrador" : "Operador"}</td>
        <td><span class="status-pill ${user.active ? "" : "inactive"}">${user.active ? "Activo" : "Inactivo"}</span></td>
        <td class="permissions-cell">${escapeHtml(permissions)}</td>
        <td><div class="table-actions">
          <button class="icon-action" type="button" data-edit-user="${user.id}">Editar</button>
          ${user.id === state.user.id ? "" : `<button class="icon-action danger" type="button" data-delete-user="${user.id}">Eliminar</button>`}
        </div></td>
      </tr>
    `;
  }).join("");
}

function setPermissionVisibility() {
  const isAdmin = $("#user-role").value === "admin";
  $("#user-permissions").classList.toggle("hidden", isAdmin);
}

$("#new-user").addEventListener("click", () => {
  $("#user-form").reset();
  $("#user-id").value = "";
  $("#user-active").value = "true";
  $("#user-active").disabled = false;
  $("#user-password").required = true;
  $("#password-hint").textContent = "(mínimo 12 caracteres)";
  $("#user-dialog-title").textContent = "Nuevo usuario";
  setPermissionVisibility();
  openDialog("user-dialog");
});

$("#user-role").addEventListener("change", setPermissionVisibility);

$("#users-body").addEventListener("click", async event => {
  const edit = event.target.closest("[data-edit-user]");
  const remove = event.target.closest("[data-delete-user]");
  if (edit) {
    const user = state.users.find(item => item.id === Number(edit.dataset.editUser));
    if (!user) return;
    $("#user-id").value = user.id;
    $("#user-name").value = user.name;
    $("#user-username").value = user.username;
    $("#user-password").value = "";
    $("#user-password").required = false;
    $("#password-hint").textContent = "(dejar vacío para conservar)";
    $("#user-role").value = user.role;
    $("#user-active").value = String(user.active);
    $("#user-active").disabled = user.id === state.user.id;
    $$("[name=permission]").forEach(input => {
      input.checked = user.permissions.includes(input.value);
    });
    $("#user-dialog-title").textContent = "Editar usuario";
    setPermissionVisibility();
    openDialog("user-dialog");
  }
  if (remove) {
    const user = state.users.find(item => item.id === Number(remove.dataset.deleteUser));
    if (!user || !window.confirm(`¿Eliminar la cuenta de "${user.name}"?`)) return;
    try {
      await api(`/api/admin/users/${user.id}`, { method: "DELETE" });
      notify("Usuario eliminado.");
      await loadUsers();
    } catch (error) {
      handleError(error);
    }
  }
});

$("#user-form").addEventListener("submit", async event => {
  event.preventDefault();
  const id = $("#user-id").value;
  const data = {
    name: $("#user-name").value.trim(),
    username: $("#user-username").value.trim(),
    password: $("#user-password").value,
    role: $("#user-role").value,
    active: $("#user-active").value === "true",
    permissions: $$("[name=permission]:checked").map(input => input.value)
  };
  try {
    await api(id ? `/api/admin/users/${id}` : "/api/admin/users", {
      method: id ? "PUT" : "POST", body: JSON.stringify(data)
    });
    closeDialog("user-dialog");
    notify(id ? "Usuario actualizado." : "Usuario creado.");
    if (Number(id) === state.user.id) {
      await syncAccess();
      if (state.user?.role === "admin") await loadUsers();
    } else {
      await loadUsers();
    }
  } catch (error) {
    handleError(error);
  }
});

function currentPeriodKey() {
  return `${$("#payroll-month").value}-${$("#payroll-half").value}`;
}

function setDefaultPeriod() {
  const today = new Date();
  $("#payroll-month").value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  $("#payroll-half").value = today.getDate() <= 15 ? "1" : "2";
}

async function loadPayroll() {
  if (!state.user) return;
  const period = currentPeriodKey();
  const result = await api(`/api/payroll?period=${encodeURIComponent(period)}`);
  state.payroll = result;
  state.payrollPeriod = period;
  renderPayroll();
}

function renderPayroll() {
  const result = state.payroll;
  if (!result) return;
  const workers = result.workers;
  const locked = Boolean(result.closure);
  $("#payroll-closed-banner").classList.toggle("hidden", !locked);
  if (locked) {
    const statusText = result.closure.status === "sent"
      ? "Nómina enviada y periodo cerrado."
      : result.closure.status === "generated"
        ? "Comprobantes PDF generados y periodo cerrado. Puedes abrirlos o enviarlos por correo cuando lo necesites."
        : `El envío quedó ${result.closure.status === "sending" ? "en proceso" : "parcial"}. Se pueden reintentar únicamente los comprobantes pendientes o fallidos.`;
    $("#payroll-closed-banner").innerHTML = `<span>i</span><div><strong>Periodo ${escapeHtml(result.period.label)}</strong><p>${statusText}</p></div>`;
  }
  $("#generate-payroll").disabled = locked;
  $("#generate-payroll").textContent = locked
    ? result.closure.status === "sent" ? "Periodo cerrado" : "Comprobantes generados"
    : "Generar comprobantes";
  $("#send-payroll").disabled = locked && result.closure.status === "sent";
  $("#send-payroll").textContent = !locked || result.closure.status === "generated"
    ? "Enviar nómina"
    : result.closure.status === "sent" ? "Nómina enviada" : "Reintentar pendientes";
  $("#send-payroll").classList.toggle("button-outline", locked);
  $("#send-payroll").classList.toggle("button-primary", !(locked && result.closure.status === "sent"));
  $("#payroll-workers-total").textContent = String(workers.length);
  $("#payroll-base-total").textContent = money(workers.reduce((sum, worker) => sum + worker.pay.base, 0));
  $("#payroll-grand-total").textContent = money(workers.reduce((sum, worker) => sum + worker.pay.total, 0));
  $("#payroll-empty").classList.toggle("hidden", workers.length > 0);
  $("#payroll-body").innerHTML = workers.map(worker => {
    const receiptStatus = worker.receipt_status;
    const statusMarkup = receiptStatus
      ? `<span class="status-pill ${receiptStatus === "failed" ? "failed" : receiptStatus === "sent" ? "" : "pending"}">${receiptStatus === "sent" ? "Enviado" : receiptStatus === "failed" ? "Falló" : "Pendiente"}</span>`
      : `<span class="muted small">Sin generar</span>`;
    return `
      <tr>
        <td><span class="primary-cell">${escapeHtml(worker.name)}</span><span class="sub-cell">${escapeHtml(worker.position)}</span></td>
        <td>${money(worker.pay.base)}</td>
        <td>${money(worker.pay.overtime)}</td>
        <td>${money(worker.pay.bonuses)}</td>
        <td>${money(worker.pay.deductions)}</td>
        <td><strong>${money(worker.pay.total)}</strong></td>
        <td><div class="payroll-actions">${statusMarkup}${receiptStatus ? `<button class="icon-action receipt-button" type="button" data-receipt-worker="${worker.id}">Ver comprobante</button>` : ""}</div></td>
        <td>${locked ? "" : `<button class="icon-action" type="button" data-edit-payroll="${worker.id}">Editar</button>`}</td>
      </tr>
    `;
  }).join("");
}

$("#global-login-form").addEventListener("submit", async event => {
  event.preventDefault();
  $("#login-error").classList.add("hidden");
  try {
    const result = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("#login-username").value.trim(),
        password: $("#login-password").value
      })
    });
    state.user = result.user;
    state.csrfToken = result.csrfToken;
    $("#login-password").value = "";
    enterApplication();
  } catch (error) {
    $("#login-error").textContent = error.message || "No fue posible iniciar sesión.";
    $("#login-error").classList.remove("hidden");
  }
});

$("#header-logout").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
    await endSession();
  } catch (error) {
    handleError(error);
  }
});

$("#payroll-month").addEventListener("change", () => loadPayroll().catch(handleError));
$("#payroll-half").addEventListener("change", () => loadPayroll().catch(handleError));
$("#payroll-body").addEventListener("click", event => {
  const edit = event.target.closest("[data-edit-payroll]");
  const receipt = event.target.closest("[data-receipt-worker]");
  if (edit) {
    const worker = state.payroll?.workers.find(item => item.id === Number(edit.dataset.editPayroll));
    if (!worker) return;
    state.payrollWorker = worker;
    $("#payroll-worker-id").value = worker.id;
    $("#payroll-dialog-title").textContent = worker.name;
    $("#payroll-overtime").value = worker.overtime;
    $("#payroll-bonuses").value = worker.bonuses;
    $("#payroll-deductions").value = worker.deductions;
    updatePayrollLiveTotal();
    openDialog("payroll-dialog");
  }
  if (receipt) {
    const url = `/api/payroll/${encodeURIComponent(state.payrollPeriod)}/${receipt.dataset.receiptWorker}/receipt`;
    if (window.demoMode) window.demoApi.openReceipt(state.payroll, Number(receipt.dataset.receiptWorker));
    else window.open(url, "_blank", "noopener,noreferrer");
  }
});

function updatePayrollLiveTotal() {
  const worker = state.payrollWorker;
  if (!worker) return;
  const overtime = Math.max(0, Number($("#payroll-overtime").value) || 0);
  const bonuses = Math.max(0, Number($("#payroll-bonuses").value) || 0);
  const deductions = Math.max(0, Number($("#payroll-deductions").value) || 0);
  $("#payroll-live-total").innerHTML = `Total quincenal estimado <strong>${money(Math.floor(worker.monthly_salary / 2) + overtime + bonuses - deductions)}</strong>`;
}
["#payroll-overtime", "#payroll-bonuses", "#payroll-deductions"].forEach(selector =>
  $(selector).addEventListener("input", updatePayrollLiveTotal)
);

$("#payroll-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!state.payrollWorker) return;
  try {
    await api(`/api/payroll/${encodeURIComponent(state.payrollPeriod)}/${state.payrollWorker.id}`, {
      method: "PUT",
      body: JSON.stringify({
        overtime: Number($("#payroll-overtime").value),
        bonuses: Number($("#payroll-bonuses").value),
        deductions: Number($("#payroll-deductions").value)
      })
    });
    closeDialog("payroll-dialog");
    notify("Rubros de nómina guardados.");
    await loadPayroll();
  } catch (error) {
    handleError(error);
  }
});

$("#send-payroll").addEventListener("click", () => {
  if (!state.payroll?.workers.length) {
    notify("No hay trabajadores para procesar.", "error");
    return;
  }
  if (state.payroll.closure?.status === "sent") return;
  state.payrollAction = "send";
  $("#authorize-title").textContent = "Autorizar envío de nómina";
  $("#authorize-description").textContent = "Se generarán los comprobantes PDF y se enviarán a los correos registrados. El periodo quedará cerrado.";
  $("#authorize-submit").textContent = "Enviar y cerrar periodo";
  $("#authorize-password").value = "";
  openDialog("authorize-dialog");
});

$("#generate-payroll").addEventListener("click", () => {
  if (!state.payroll?.workers.length) {
    notify("No hay trabajadores para procesar.", "error");
    return;
  }
  if (state.payroll.closure) return;
  state.payrollAction = "generate";
  $("#authorize-title").textContent = "Autorizar generación de comprobantes";
  $("#authorize-description").textContent = "Se generará y guardará un comprobante PDF por trabajador. No se enviará ningún correo.";
  $("#authorize-submit").textContent = "Generar PDF y cerrar periodo";
  $("#authorize-password").value = "";
  openDialog("authorize-dialog");
});

$("#authorize-form").addEventListener("submit", async event => {
  event.preventDefault();
  const submitButton = event.submitter;
  submitButton.disabled = true;
  try {
    const result = await api(state.payrollAction === "generate" ? "/api/payroll/generate" : "/api/payroll/send", {
      method: "POST",
      body: JSON.stringify({
        period: state.payrollPeriod,
        password: $("#authorize-password").value
      })
    });
    closeDialog("authorize-dialog");
    await loadPayroll();
    notify(result.message);
  } catch (error) {
    await loadPayroll().catch(handleError);
    handleError(error);
  } finally {
    submitButton.disabled = false;
  }
});

$$("[data-close]").forEach(button => {
  button.addEventListener("click", () => closeDialog(button.dataset.close));
});

$$(".nav-item").forEach(button => {
  button.addEventListener("click", () => setSection(button.dataset.section));
});

if (window.demoMode) {
  $$(".demo-notice").forEach(notice => notice.classList.remove("hidden"));
  $("#demo-reset").addEventListener("click", () => {
    if (!window.confirm("¿Restablecer esta demostración en este navegador? Se borrarán sus cambios locales.")) return;
    window.demoApi.reset();
    window.location.reload();
  });
}

api("/api/auth/me")
  .then(result => {
    state.user = result.user;
    state.csrfToken = result.csrfToken;
    if (state.user) enterApplication();
  })
  .catch(handleError);

window.addEventListener("focus", () => {
  if (state.user) syncAccess();
});
