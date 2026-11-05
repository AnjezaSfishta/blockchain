export const registryAbi = [
  "function invoiceCount() view returns (uint256)",
  "function getInvoice(uint256) view returns (tuple(uint256 id,address issuer,address recipient,bytes32 documentHash,uint256 amount,string currency,string metadataURI,uint64 createdAt))",
  "function registerInvoice(address,bytes32,uint256,string,string) returns (uint256)",
  "function isParty(uint256,address) view returns (bool)",
  "function auditors(address) view returns (bool)",
  "event InvoiceRegistered(uint256 indexed invoiceId,address indexed issuer,address indexed recipient,bytes32 documentHash,uint256 amount,string currency,string metadataURI)"
] as const;

export const workflowAbi = [
  "function statusOf(uint256) view returns (uint8)",
  "function getHistory(uint256) view returns (tuple(uint8 status,address changedBy,uint64 changedAt,string note)[])",
  "function sendInvoice(uint256)",
  "function acceptInvoice(uint256)",
  "function disputeInvoice(uint256,string)",
  "function markPaid(uint256)",
  "function cancelInvoice(uint256,string)",
  "event StatusChanged(uint256 indexed invoiceId,uint8 indexed status,address indexed changedBy,string note,uint64 changedAt)"
] as const;

export const statusNames = ["Regjistruar", "Dërguar", "Pranuar", "Kontestuar", "Paguar", "Anuluar"];
export const statusClasses = ["registered", "sent", "accepted", "disputed", "paid", "cancelled"];

export type Invoice = {
  id: bigint;
  issuer: string;
  recipient: string;
  documentHash: string;
  amount: bigint;
  currency: string;
  metadataURI: string;
  createdAt: bigint;
  status: number;
};

export type HistoryEntry = {
  status: number;
  changedBy: string;
  changedAt: bigint;
  note: string;
};
