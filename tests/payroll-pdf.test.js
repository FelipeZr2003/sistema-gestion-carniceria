const test = require("node:test");
const assert = require("node:assert/strict");
const { createPayrollPdf, formatCop } = require("../src/payroll-pdf");

test("genera un PDF de nómina legible en formato PDF", async () => {
  const pdf = await createPayrollPdf({
    periodLabel: "2.ª quincena de 10/2026",
    periodStart: "2026-10-16",
    periodEnd: "2026-10-31",
    worker: {
      name: "Ana Ejemplo",
      identification: "123456",
      position: "Vendedora",
      email: "ana@example.test"
    },
    pay: { base: 1_000_000, overtime: 50_000, bonuses: 20_000, deductions: 10_000, total: 1_060_000 }
  });
  assert.ok(pdf.length > 1000);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.subarray(-20).toString("latin1").includes("%%EOF"));
});

test("formatea COP sin decimales", () => {
  assert.match(formatCop(2_000_000), /^\$2\.000\.000$/);
  assert.match(formatCop(-10_000), /^-\$10\.000$/);
});
