const PDFDocument = require("pdfkit");

function formatCop(value) {
  const formatted = new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0
  }).format(Math.abs(value));
  return `${value < 0 ? "-$" : "$"}${formatted}`;
}

function createPayrollPdf(snapshot) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 52 });
    const chunks = [];
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.fontSize(22).fillColor("#8b271e").text("Carnes Santa Elena", { align: "center" });
    doc.moveDown(0.35);
    doc.fontSize(15).fillColor("#202923").text("Comprobante de nómina", { align: "center" });
    doc.moveDown();
    doc.fontSize(11).fillColor("#47534b");
    doc.text(`Periodo: ${snapshot.periodLabel} (${snapshot.periodStart} al ${snapshot.periodEnd})`);
    doc.text(`Fecha de generación: ${new Date().toLocaleDateString("es-CO")}`);
    doc.moveDown();
    doc.fontSize(13).fillColor("#202923").text("Información del trabajador", { underline: true });
    doc.moveDown(0.45);
    doc.fontSize(11);
    doc.text(`Nombre: ${snapshot.worker.name}`);
    doc.text(`Identificación: ${snapshot.worker.identification || "No registrada"}`);
    doc.text(`Puesto: ${snapshot.worker.position}`);
    doc.text(`Correo: ${snapshot.worker.email}`);
    doc.moveDown();
    doc.fontSize(13).text("Desglose de pago", { underline: true });
    doc.moveDown(0.45);
    const rows = [
      ["Salario quincenal base", snapshot.pay.base],
      ["Horas extra (monto ingresado)", snapshot.pay.overtime],
      ["Bonos", snapshot.pay.bonuses],
      ["Débitos / descuentos", -snapshot.pay.deductions]
    ];
    for (const [label, amount] of rows) {
      doc.fontSize(11).text(`${label}:`, 58, doc.y, { continued: true });
      doc.text(formatCop(amount), { align: "right" });
    }
    doc.moveDown();
    doc.moveTo(52, doc.y).lineTo(543, doc.y).strokeColor("#d9dfd8").stroke();
    doc.moveDown(0.65);
    doc.fontSize(15).fillColor("#8b271e").text(`TOTAL A PAGAR: ${formatCop(snapshot.pay.total)}`, {
      align: "right"
    });
    doc.moveDown(2);
    doc.fontSize(9).fillColor("#778078").text(
      "Comprobante generado por el sistema interno de Carnes Santa Elena.",
      { align: "center" }
    );
    doc.end();
  });
}

module.exports = { createPayrollPdf, formatCop };
