const { PDFDocument } = require('pdf-lib');
async function realPdf(pages = 1, compressed = true) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]);
  return Buffer.from(await doc.save({ useObjectStreams: compressed }));
}
module.exports = { realPdf };
