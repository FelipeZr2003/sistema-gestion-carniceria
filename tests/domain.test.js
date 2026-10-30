const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculatePayroll,
  normalizeEmail,
  normalizePhone,
  parseMoney,
  validatePeriodKey
} = require("../src/domain");

test("calcula el pago quincenal a partir de la mitad del salario mensual", () => {
  assert.deepEqual(calculatePayroll(2_000_000, 75_000, 50_000, 25_000), {
    base: 1_000_000,
    overtime: 75_000,
    bonuses: 50_000,
    deductions: 25_000,
    total: 1_100_000
  });
});

test("redondea hacia abajo la mitad de un salario mensual impar", () => {
  assert.equal(calculatePayroll(2_000_001, 0, 0, 0).base, 1_000_000);
});

test("rechaza débitos por encima de los ingresos quincenales", () => {
  assert.throws(
    () => calculatePayroll(1_000_000, 0, 0, 500_001),
    { status: 400, message: "Los débitos no pueden superar el total devengado de la quincena." }
  );
});

test("valida montos enteros de pesos colombianos", () => {
  assert.equal(parseMoney("2000000"), 2_000_000);
  assert.throws(() => parseMoney(1000.5), /valor entero/);
  assert.throws(() => parseMoney(-1), /valor entero/);
  assert.throws(() => parseMoney(""), { status: 400, message: "valor es obligatorio." });
});

test("normaliza correo y teléfono antes de validar duplicados", () => {
  assert.equal(normalizeEmail("  Ana@Correo.COM "), "ana@correo.com");
  assert.equal(normalizePhone("+57 (300) 123-4567"), "573001234567");
  assert.equal(normalizePhone("3001234567"), "3001234567");
});

test("calcula periodos quincenales, incluidos años bisiestos", () => {
  assert.deepEqual(validatePeriodKey("2024-02-2"), {
    key: "2024-02-2",
    label: "2.ª quincena de 02/2024",
    start: "2024-02-16",
    end: "2024-02-29"
  });
  assert.throws(() => validatePeriodKey("2024-13-1"), /mes del periodo/);
});
