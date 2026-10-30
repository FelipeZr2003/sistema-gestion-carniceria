const { calculatePayroll } = require("./domain");
const { createPayrollPdf } = require("./payroll-pdf");

async function generatePayrollReceipts(db, period) {
  const workers = db.prepare(`
    SELECT w.id, w.name, w.identification, w.position, w.monthly_salary, w.email,
      COALESCE(e.overtime, 0) AS overtime, COALESCE(e.bonuses, 0) AS bonuses,
      COALESCE(e.deductions, 0) AS deductions
    FROM workers w LEFT JOIN payroll_entries e ON e.worker_id = w.id AND e.period_key = ?
    ORDER BY w.name COLLATE NOCASE
  `).all(period.key);
  if (!workers.length) {
    const error = new Error("No hay trabajadores registrados para procesar la nómina.");
    error.status = 400;
    throw error;
  }

  const receipts = await Promise.all(workers.map(async worker => {
    const saved = db.prepare(`
      SELECT 1 FROM payroll_receipts WHERE period_key = ? AND worker_id = ?
    `).get(period.key, worker.id);
    if (saved) return null;

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
    return { workerId: worker.id, snapshot, pdf };
  }));
  const generated = receipts.filter(Boolean);

  db.transaction(() => {
    db.prepare(`
      INSERT OR IGNORE INTO payroll_closures (period_key, status) VALUES (?, 'generated')
    `).run(period.key);
    const insert = db.prepare(`
      INSERT OR IGNORE INTO payroll_receipts (period_key, worker_id, snapshot_json, pdf)
      VALUES (?, ?, ?, ?)
    `);
    for (const receipt of generated) {
      insert.run(period.key, receipt.workerId, JSON.stringify(receipt.snapshot), receipt.pdf);
    }
  })();

  return { generatedCount: generated.length, workerCount: workers.length };
}

module.exports = { generatePayrollReceipts };
