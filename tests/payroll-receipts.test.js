const test = require("node:test");
const assert = require("node:assert/strict");
const { createDatabase } = require("../src/db");
const { generatePayrollReceipts } = require("../src/payroll-receipts");

test("genera y guarda comprobantes PDF sin depender del correo", async t => {
  const db = createDatabase(":memory:");
  t.after(() => db.close());
  const workerId = Number(db.prepare(`
    INSERT INTO workers (name, identification, position, monthly_salary, phone, email)
    VALUES ('Ana Ejemplo', '123456', 'Vendedora', 2000000, '3001234567', '')
  `).run().lastInsertRowid);
  const period = {
    key: "2026-10-2",
    label: "2.ª quincena de 10/2026",
    start: "2026-10-16",
    end: "2026-10-31"
  };

  const result = await generatePayrollReceipts(db, period);
  const receipt = db.prepare(`
    SELECT snapshot_json, pdf, delivery_status FROM payroll_receipts
    WHERE period_key = ? AND worker_id = ?
  `).get(period.key, workerId);

  assert.deepEqual(result, { generatedCount: 1, workerCount: 1 });
  assert.equal(receipt.delivery_status, "pending");
  const pdf = Buffer.from(receipt.pdf);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.subarray(-20).toString("latin1").includes("%%EOF"));
  assert.equal(JSON.parse(receipt.snapshot_json).pay.total, 1000000);
  assert.equal(
    db.prepare("SELECT status FROM payroll_closures WHERE period_key = ?").get(period.key).status,
    "generated"
  );

  assert.deepEqual(await generatePayrollReceipts(db, period), { generatedCount: 0, workerCount: 1 });
});
