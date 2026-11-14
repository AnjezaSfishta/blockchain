const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { ethers } = require("hardhat");
require("dotenv").config({ path: path.join(__dirname, "..", "backend", ".env") });

function makePdf(label) {
  const text = label.replace(/[()\\]/g, "");
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let document = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  document += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document, "ascii");
}

async function main() {
  const registryAddress = process.env.REGISTRY_ADDRESS;
  const workflowAddress = process.env.WORKFLOW_ADDRESS;
  if (!registryAddress || !workflowAddress) {
    throw new Error("Set REGISTRY_ADDRESS and WORKFLOW_ADDRESS before running the demo seeder.");
  }
  if (!process.env.PINATA_JWT) {
    throw new Error("Set PINATA_JWT in backend/.env before uploading demo documents.");
  }
  const [, issuer, recipient] = await ethers.getSigners();
  if (!issuer || !recipient) {
    throw new Error("The demo seeder needs separate issuer and recipient accounts; use a local Hardhat network.");
  }
  const registry = await ethers.getContractAt("InvoiceRegistry", registryAddress, issuer);
  const workflow = await ethers.getContractAt("InvoiceWorkflow", workflowAddress);
  if ((await registry.invoiceCount()) !== 0n) {
    throw new Error("Demo seeding requires a fresh deployment with no existing invoices.");
  }
  const documentsDirectory = path.join(__dirname, "..", "demo", "documents");
  fs.mkdirSync(documentsDirectory, { recursive: true });

  const samples = [];
  for (let index = 1; index <= 5; index += 1) {
    const pdf = makePdf(`DEMO INVOICE ${String(index).padStart(3, "0")}`);
    const filePath = path.join(documentsDirectory, `invoice-${String(index).padStart(3, "0")}.pdf`);
    fs.writeFileSync(filePath, pdf);
    samples.push({
      pdf,
      hash: `0x${crypto.createHash("sha256").update(pdf).digest("hex")}`
    });
  }
  fs.writeFileSync(
    path.join(documentsDirectory, "invoice-001-altered.pdf"),
    makePdf("DEMO INVOICE 001 ALTERED")
  );

  const { uploadInvoiceToPinata } = await import("../backend/src/pinata.js");
  for (const [index, sample] of samples.entries()) {
    const upload = await uploadInvoiceToPinata(sample.pdf, sample.hash, process.env.PINATA_JWT);
    sample.metadataURI = upload.metadataURI;
    console.log(`Uploaded invoice ${index + 1}: ${upload.documentURI} (metadata: ${upload.metadataURI})`);
  }

  const ids = [];
  for (let index = 0; index < samples.length; index += 1) {
    const tx = await registry.registerInvoice(
      recipient.address,
      samples[index].hash,
      (index + 1) * 12500,
      "EUR",
      samples[index].metadataURI
    );
    await tx.wait();
    ids.push(await registry.invoiceCount());
    if (index < 4) {
      const send = await workflow.connect(issuer).sendInvoice(ids[index]);
      await send.wait();
    }
  }

  await (await workflow.connect(recipient).acceptInvoice(ids[0])).wait();
  await (await workflow.connect(recipient).markPaid(ids[0])).wait();
  await (await workflow.connect(recipient).disputeInvoice(ids[1], "Demo: amount requires review")).wait();
  await (await workflow.connect(recipient).acceptInvoice(ids[2])).wait();

  console.log("Created five demo invoices; invoice #2 is disputed.");
  console.log(`Issuer/business: ${issuer.address}`);
  console.log(`Recipient/client: ${recipient.address}`);
  console.log(`Documents: ${documentsDirectory}`);
  console.log("Demo flows: invoice #1 sent, accepted, and paid; invoice #2 sent and disputed; invoice #3 sent and accepted.");
  console.log("Verify invoice #1 with invoice-001.pdf (match), invoice-001-altered.pdf (mismatch),");
  console.log("and invoice #3 with invoice-003.pdf (match).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
