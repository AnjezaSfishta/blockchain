import "dotenv/config";
import cors from "cors";
import express from "express";
import { Contract, JsonRpcProvider, isAddress } from "ethers";

const app = express();
const port = Number(process.env.PORT || 3001);
const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
const registryAddress = process.env.REGISTRY_ADDRESS || "";
const workflowAddress = process.env.WORKFLOW_ADDRESS || "";
const startBlock = Number(process.env.DEPLOYMENT_BLOCK || 0);
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
    const first = Math.max(startBlock, indexedThrough + 1);
    const batchSize = 1500;

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
