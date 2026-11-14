import "dotenv/config";
import cors from "cors";
import express from "express";
import { createHash } from "node:crypto";
import { Contract, JsonRpcProvider, isAddress } from "ethers";
import { uploadInvoiceToPinata } from "./pinata.js";

const app = express();
const port = Number(process.env.PORT || 3001);
const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
const registryAddress = process.env.REGISTRY_ADDRESS || "";
const workflowAddress = process.env.WORKFLOW_ADDRESS || "";
const startBlock = Number(process.env.DEPLOYMENT_BLOCK || 0);
const pinataJwt = process.env.PINATA_JWT || "";
const maxDocumentBytes = 10 * 1024 * 1024;
const registryAbi = [
  "event InvoiceRegistered(uint256 indexed invoiceId,address indexed issuer,address indexed recipient,bytes32 documentHash,uint256 amount,string currency,string metadataURI)"
];
const workflowAbi = [
  "event StatusChanged(uint256 indexed invoiceId,uint8 indexed status,address indexed changedBy,string note,uint64 changedAt)"
];

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") || true }));
app.use(express.json({ limit: "32kb" }));

let provider;
let registry;
let workflow;
let indexedThrough = startBlock - 1;
let indexedBlockHash = "";
let lastError = "";
let invoiceEvents = [];
let statusEvents = [];
let indexing = false;

function chainReady() {
  return Boolean(provider && registry && workflow);
}

async function indexNewBlocks() {
  if (!chainReady() || indexing) return;
  indexing = true;
  try {
    const latest = await provider.getBlockNumber();
    if (indexedThrough >= startBlock) {
      const indexedBlock = latest >= indexedThrough
        ? await provider.getBlock(indexedThrough)
        : null;
      if (!indexedBlock || indexedBlock.hash !== indexedBlockHash) {
        console.warn("Chain reset or reorganization detected; rebuilding indexed events.");
        invoiceEvents = [];
        statusEvents = [];
        indexedThrough = startBlock - 1;
        indexedBlockHash = "";
      }
    }

    const first = Math.max(startBlock, indexedThrough + 1);
    const batchSize = 10;

    for (let from = first; from <= latest; from += batchSize) {
      const to = Math.min(from + batchSize - 1, latest);
      const [registered, changed] = await Promise.all([
        registry.queryFilter(registry.filters.InvoiceRegistered(), from, to),
        workflow.queryFilter(workflow.filters.StatusChanged(), from, to)
      ]);
      invoiceEvents.push(...registered.map((log) => ({
        invoiceId: log.args.invoiceId.toString(),
        issuer: log.args.issuer,
        recipient: log.args.recipient,
        documentHash: log.args.documentHash,
        amount: log.args.amount.toString(),
        currency: log.args.currency,
        metadataURI: log.args.metadataURI,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash
      })));
      statusEvents.push(...changed.map((log) => ({
        invoiceId: log.args.invoiceId.toString(),
        status: Number(log.args.status),
        changedBy: log.args.changedBy,
        note: log.args.note,
        changedAt: Number(log.args.changedAt),
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash
      })));
      indexedThrough = to;
    }
    if (indexedThrough >= startBlock) {
      const indexedBlock = await provider.getBlock(indexedThrough);
      if (!indexedBlock) throw new Error(`Could not read indexed block ${indexedThrough}.`);
      indexedBlockHash = indexedBlock.hash;
    }
    lastError = "";
  } finally {
    indexing = false;
  }
}

app.get("/api/health", (_request, response) => {
  response.status(lastError ? 503 : 200).json({
    status: lastError ? "degraded" : "ok",
    chainConnected: chainReady(),
    indexedThrough,
    invoiceEvents: invoiceEvents.length,
    statusEvents: statusEvents.length,
    error: lastError || undefined
  });
});

app.post(
  "/api/storage",
  express.raw({ type: "application/pdf", limit: maxDocumentBytes }),
  async (request, response) => {
    if (!pinataJwt) {
      response.status(503).json({ error: "Ruajtja IPFS nuk është konfiguruar në backend (PINATA_JWT mungon)." });
      return;
    }
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      response.status(400).json({ error: "Dërgo një dokument PDF." });
      return;
    }
    if (request.body.subarray(0, 5).toString("ascii") !== "%PDF-") {
      response.status(400).json({ error: "Skedari nuk ka format të vlefshëm PDF." });
      return;
    }

    const documentHash = request.get("x-document-hash") || "";
    if (!/^0x[0-9a-f]{64}$/i.test(documentHash)) {
      response.status(400).json({ error: "Hash-i SHA-256 i dokumentit mungon ose është i pavlefshëm." });
      return;
    }
    const actualHash = `0x${createHash("sha256").update(request.body).digest("hex")}`;
    if (actualHash.toLowerCase() !== documentHash.toLowerCase()) {
      response.status(400).json({ error: "Hash-i i dërguar nuk përputhet me përmbajtjen e PDF-së." });
      return;
    }

    try {
      const { documentURI, metadataURI } = await uploadInvoiceToPinata(request.body, documentHash, pinataJwt);
      response.status(201).json({
        documentURI,
        metadataURI,
        documentHash: documentHash.toLowerCase()
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("IPFS upload failed:", message);
      response.status(502).json({ error: `Ngarkimi në Pinata dështoi: ${message}` });
    }
  }
);

app.get("/api/events", (_request, response) => {
  response.json({ events: [...statusEvents].sort((a, b) => a.blockNumber - b.blockNumber) });
});

app.get("/api/invoices", (_request, response) => {
  response.json({ invoices: [...invoiceEvents].sort((a, b) => Number(b.invoiceId) - Number(a.invoiceId)) });
});

app.get("/api/invoices/:id/history", (request, response) => {
  if (!/^[1-9]\d*$/.test(request.params.id)) {
    response.status(400).json({ error: "Invoice ID must be a positive integer." });
    return;
  }
  const history = statusEvents
    .filter((entry) => entry.invoiceId === request.params.id)
    .sort((a, b) => a.blockNumber - b.blockNumber);
  response.json({ invoiceId: request.params.id, history });
});

app.get("/api/addresses/:address/invoices", (request, response) => {
  if (!isAddress(request.params.address)) {
    response.status(400).json({ error: "A valid Ethereum address is required." });
    return;
  }
  const address = request.params.address.toLowerCase();
  const invoices = invoiceEvents.filter((invoice) =>
    invoice.issuer.toLowerCase() === address || invoice.recipient.toLowerCase() === address
  );
  response.json({ invoices });
});

app.use((error, _request, response, next) => {
  if (error?.type === "entity.too.large") {
    response.status(413).json({ error: "PDF-ja duhet të jetë më e vogël se 10 MB." });
    return;
  }
  next(error);
});

if (registryAddress && workflowAddress && isAddress(registryAddress) && isAddress(workflowAddress)) {
  provider = new JsonRpcProvider(rpcUrl);
  registry = new Contract(registryAddress, registryAbi, provider);
  workflow = new Contract(workflowAddress, workflowAbi, provider);
  indexNewBlocks().catch((error) => {
    lastError = error instanceof Error ? error.message : String(error);
    console.error("Initial event indexing failed:", error);
  });
  setInterval(() => {
    indexNewBlocks().catch((error) => {
      lastError = error instanceof Error ? error.message : String(error);
      console.error("Event indexing failed:", error);
    });
  }, 10000).unref();
} else if (registryAddress || workflowAddress) {
  console.error("Both REGISTRY_ADDRESS and WORKFLOW_ADDRESS must be valid Ethereum addresses.");
}

app.listen(port, () => {
  console.log(`Invoice API listening on http://localhost:${port}`);
  if (!chainReady()) console.warn("Chain indexing is disabled; configure RPC_URL and contract addresses.");
});
