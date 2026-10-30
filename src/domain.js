const PRODUCT_CATEGORIES = ["RES", "CERDO", "POLLO", "PESCADO", "EMBUTIDOS"];
const PRODUCT_UNITS = ["KG", "UNIDAD", "PAQUETE"];

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function parseMoney(value, fieldName = "valor") {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    throw validationError(`${fieldName} es obligatorio.`);
  }
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 2_000_000_000) {
    throw validationError(`${fieldName} debe ser un valor entero entre 0 y 2.000.000.000.`);
  }
  return amount;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || "").trim().replace(/\D/g, "");
}

function validatePeriodKey(value) {
  const match = /^(\d{4})-(\d{2})-([12])$/.exec(String(value || ""));
  if (!match) {
    throw validationError("El periodo debe tener el formato AAAA-MM-1 o AAAA-MM-2.");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw validationError("El mes del periodo no es válido.");
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    key: `${match[1]}-${match[2]}-${match[3]}`,
    label: `${match[3] === "1" ? "1.ª quincena" : "2.ª quincena"} de ${match[2]}/${match[1]}`,
    start: `${match[1]}-${match[2]}-${match[3] === "1" ? "01" : "16"}`,
    end: `${match[1]}-${match[2]}-${match[3] === "1" ? "15" : String(lastDay).padStart(2, "0")}`
  };
}

function calculatePayroll(baseSalary, overtimeAmount, bonuses, deductions) {
  const base = Math.floor(parseMoney(baseSalary, "Salario mensual") / 2);
  const overtime = parseMoney(overtimeAmount, "Horas extra");
  const bonusTotal = parseMoney(bonuses, "Bonos");
  const deductionTotal = parseMoney(deductions, "Débitos");
  if (deductionTotal > base + overtime + bonusTotal) {
    throw validationError("Los débitos no pueden superar el total devengado de la quincena.");
  }
  return {
    base,
    overtime,
    bonuses: bonusTotal,
    deductions: deductionTotal,
    total: base + overtime + bonusTotal - deductionTotal
  };
}

module.exports = {
  PRODUCT_CATEGORIES,
  PRODUCT_UNITS,
  calculatePayroll,
  normalizeEmail,
  normalizePhone,
  parseMoney,
  validatePeriodKey
};
