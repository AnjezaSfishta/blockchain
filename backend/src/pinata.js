import { createHash } from "node:crypto";

async function pinataRequest(endpoint, jwt, options) {
  const response = await fetch(`https://api.pinata.cloud/pinning/${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${jwt}`,
      ...options.headers
    }
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Pinata ${endpoint} failed (${response.status}): ${details.slice(0, 300)}`);
  }
  const result = await response.json();
  if (typeof result.IpfsHash !== "string") {
    throw new Error(`Pinata ${endpoint} did not return a CID.`);
  }
  return result.IpfsHash;
}

export async function uploadInvoiceToPinata(pdf, documentHash, jwt) {
  if (!jwt) throw new Error("PINATA_JWT is required to upload demo invoices.");
  if (!Buffer.isBuffer(pdf) || pdf.length === 0 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("A valid PDF is required for the Pinata upload.");
  }
  if (!/^0x[0-9a-f]{64}$/i.test(documentHash)) {
    throw new Error("A valid SHA-256 document hash is required.");
  }
  const actualHash = `0x${createHash("sha256").update(pdf).digest("hex")}`;
  if (actualHash.toLowerCase() !== documentHash.toLowerCase()) {
    throw new Error("The document hash does not match the PDF contents.");
  }

  const name = `invoice-${documentHash.slice(2, 14)}.pdf`;
  const fileForm = new FormData();
  fileForm.append("file", new Blob([pdf], { type: "application/pdf" }), name);
  fileForm.append("pinataMetadata", JSON.stringify({ name }));
  fileForm.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
  const documentCid = await pinataRequest("pinFileToIPFS", jwt, { method: "POST", body: fileForm });
  const documentURI = `ipfs://${documentCid}`;

  const metadataCid = await pinataRequest("pinJSONToIPFS", jwt, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pinataContent: {
        schemaVersion: 1,
        documentURI,
        documentHash: documentHash.toLowerCase(),
        contentType: "application/pdf",
        sizeBytes: pdf.length
      },
      pinataMetadata: { name: `invoice-metadata-${documentHash.slice(2, 14)}` },
      pinataOptions: { cidVersion: 1 }
    })
  });

  return { documentURI, metadataURI: `ipfs://${metadataCid}` };
}
