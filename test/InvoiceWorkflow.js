const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("InvoiceRegistry and InvoiceWorkflow", function () {
  let registry;
  let workflow;
  let owner;
  let issuer;
  let recipient;
  let outsider;
  const hash = ethers.keccak256(ethers.toUtf8Bytes("invoice pdf"));
  const currency = "EUR";
  const metadata = "ipfs://demo-metadata";

  async function createInvoice(from = issuer, recipientAddress = recipient.address, documentHash = hash) {
    const tx = await registry.connect(from).registerInvoice(
      recipientAddress,
      documentHash,
      12500,
      currency,
      metadata
    );
    await tx.wait();
    return await registry.invoiceCount();
  }

  async function sentInvoice() {
    const id = await createInvoice();
    await workflow.connect(issuer).sendInvoice(id);
    return id;
  }

  beforeEach(async function () {
    [owner, issuer, recipient, outsider] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("InvoiceRegistry", owner);
    registry = await Registry.deploy();
    const Workflow = await ethers.getContractFactory("InvoiceWorkflow", owner);
    workflow = await Workflow.deploy(await registry.getAddress());
    await registry.setWorkflow(await workflow.getAddress());
  });

  it("1. configures the workflow only once", async function () {
    await expect(registry.setWorkflow(await workflow.getAddress()))
      .to.be.revertedWith("Registry: workflow already set");
  });

  it("2. rejects workflow configuration by non-owner", async function () {
    await expect(registry.connect(issuer).setWorkflow(outsider.address))
      .to.be.revertedWith("Registry: not owner");
  });

  it("3. rejects a zero workflow address", async function () {
    const Registry = await ethers.getContractFactory("InvoiceRegistry", owner);
    const fresh = await Registry.deploy();
    await expect(fresh.setWorkflow(ethers.ZeroAddress)).to.be.revertedWith("Registry: zero workflow");
  });

  it("4. requires a configured workflow before registration", async function () {
    const Registry = await ethers.getContractFactory("InvoiceRegistry", owner);
    const fresh = await Registry.deploy();
    await expect(fresh.connect(issuer).registerInvoice(recipient.address, hash, 10, currency, ""))
      .to.be.revertedWith("Registry: workflow not configured");
  });

  it("5. registers invoice details and starts its audit history", async function () {
    const id = await createInvoice();
    const invoice = await registry.getInvoice(id);
    expect(invoice.issuer).to.equal(issuer.address);
    expect(invoice.recipient).to.equal(recipient.address);
    expect(invoice.documentHash).to.equal(hash);
    expect(await workflow.statusOf(id)).to.equal(0);
    expect(await workflow.historyLength(id)).to.equal(1);
  });

  it("6. emits invoice registration event", async function () {
    await expect(registry.connect(issuer).registerInvoice(recipient.address, hash, 42, currency, metadata))
      .to.emit(registry, "InvoiceRegistered")
      .withArgs(1, issuer.address, recipient.address, hash, 42, currency, metadata);
  });

  it("7. rejects a zero recipient", async function () {
    await expect(registry.connect(issuer).registerInvoice(ethers.ZeroAddress, hash, 1, currency, ""))
      .to.be.revertedWith("Registry: invalid recipient");
  });

  it("8. rejects the issuer as recipient", async function () {
    await expect(registry.connect(issuer).registerInvoice(issuer.address, hash, 1, currency, ""))
      .to.be.revertedWith("Registry: invalid recipient");
  });

  it("9. rejects an empty document hash", async function () {
    await expect(registry.connect(issuer).registerInvoice(recipient.address, ethers.ZeroHash, 1, currency, ""))
      .to.be.revertedWith("Registry: empty document hash");
  });

  it("10. rejects an empty currency", async function () {
    await expect(registry.connect(issuer).registerInvoice(recipient.address, hash, 1, "", ""))
      .to.be.revertedWith("Registry: invalid currency");
  });

  it("11. lets owner configure auditors and emits the event", async function () {
    await expect(registry.setAuditor(outsider.address, true))
      .to.emit(registry, "AuditorUpdated").withArgs(outsider.address, true);
    expect(await registry.auditors(outsider.address)).to.equal(true);
  });

  it("12. rejects unauthorized auditor configuration", async function () {
    await expect(registry.connect(issuer).setAuditor(outsider.address, true))
      .to.be.revertedWith("Registry: not owner");
  });

  it("13. rejects a zero auditor address", async function () {
    await expect(registry.setAuditor(ethers.ZeroAddress, true)).to.be.revertedWith("Registry: zero auditor");
  });

  it("14. rejects reads for a missing invoice", async function () {
    await expect(registry.getInvoice(1)).to.be.revertedWith("Registry: invoice not found");
  });

  it("15. reports invoice parties correctly", async function () {
    const id = await createInvoice();
    expect(await registry.isParty(id, issuer.address)).to.equal(true);
    expect(await registry.isParty(id, recipient.address)).to.equal(true);
    expect(await registry.isParty(id, outsider.address)).to.equal(false);
    expect(await registry.isParty(0, issuer.address)).to.equal(false);
  });

  it("16. rejects workflow initialization from anyone but registry", async function () {
    await expect(workflow.connect(issuer).initializeInvoice(1)).to.be.revertedWith("Workflow: only registry");
  });

  it("17. allows issuer to send and records the event", async function () {
    const id = await createInvoice();
    await expect(workflow.connect(issuer).sendInvoice(id))
      .to.emit(workflow, "StatusChanged")
      .withArgs(id, 1, issuer.address, "Invoice sent", anyValue);
    const secondId = await createInvoice();
    await expect(workflow.connect(issuer).sendInvoice(secondId))
      .to.emit(workflow, "InvoiceSent")
      .withArgs(secondId, issuer.address, anyValue);
    expect(await workflow.statusOf(id)).to.equal(1);
  });

  it("18. rejects sending by recipient", async function () {
    const id = await createInvoice();
    await expect(workflow.connect(recipient).sendInvoice(id)).to.be.revertedWith("Workflow: issuer only");
  });

  it("19. rejects sending twice", async function () {
    const id = await sentInvoice();
    await expect(workflow.connect(issuer).sendInvoice(id)).to.be.revertedWith("Workflow: invalid status");
  });

  it("20. allows recipient to accept sent invoice", async function () {
    const id = await sentInvoice();
    await workflow.connect(recipient).acceptInvoice(id);
    expect(await workflow.statusOf(id)).to.equal(2);
  });

  it("21. rejects acceptance by a non-recipient", async function () {
    const id = await sentInvoice();
    await expect(workflow.connect(outsider).acceptInvoice(id)).to.be.revertedWith("Workflow: recipient only");
  });

  it("22. allows recipient to dispute and stores reason", async function () {
    const id = await sentInvoice();
    await expect(workflow.connect(recipient).disputeInvoice(id, "Incorrect amount"))
      .to.emit(workflow, "InvoiceDisputed")
      .withArgs(id, recipient.address, "Incorrect amount", anyValue);
    const history = await workflow.getHistory(id);
    expect(history[2].status).to.equal(3);
    expect(history[2].note).to.equal("Incorrect amount");
  });

  it("23. rejects dispute with empty reason", async function () {
    const id = await sentInvoice();
    await expect(workflow.connect(recipient).disputeInvoice(id, "")).to.be.revertedWith("Workflow: invalid note");
  });

  it("24. allows recipient to accept a disputed invoice", async function () {
    const id = await sentInvoice();
    await workflow.connect(recipient).disputeInvoice(id, "Please correct");
    await workflow.connect(recipient).acceptInvoice(id);
    expect(await workflow.statusOf(id)).to.equal(2);
  });

  it("25. allows recipient to mark an accepted invoice paid", async function () {
    const id = await sentInvoice();
    await workflow.connect(recipient).acceptInvoice(id);
    await expect(workflow.connect(recipient).markPaid(id))
      .to.emit(workflow, "InvoicePaid")
      .withArgs(id, recipient.address, anyValue);
    expect(await workflow.statusOf(id)).to.equal(4);
  });

  it("26. rejects payment before acceptance", async function () {
    const id = await sentInvoice();
    await expect(workflow.connect(recipient).markPaid(id)).to.be.revertedWith("Workflow: invalid status");
  });

  it("27. rejects payment by non-recipient", async function () {
    const id = await sentInvoice();
    await workflow.connect(recipient).acceptInvoice(id);
    await expect(workflow.connect(issuer).markPaid(id)).to.be.revertedWith("Workflow: recipient only");
  });

  it("28. allows either invoice party to cancel an open dispute", async function () {
    const id = await sentInvoice();
    await workflow.connect(recipient).disputeInvoice(id, "Incorrect amount");
    await workflow.connect(issuer).cancelInvoice(id, "Cancelled after review");
    expect(await workflow.statusOf(id)).to.equal(5);
  });

  it("29. rejects cancellation by an unrelated address", async function () {
    const id = await sentInvoice();
    await expect(workflow.connect(outsider).cancelInvoice(id, "Cancel"))
      .to.be.revertedWith("Workflow: invoice party only");
  });

  it("30. prevents cancellation after payment", async function () {
    const id = await sentInvoice();
    await workflow.connect(recipient).acceptInvoice(id);
    await workflow.connect(recipient).markPaid(id);
    await expect(workflow.connect(issuer).cancelInvoice(id, "Undo")).to.be.revertedWith("Workflow: invalid status");
  });

  it("31. preserves every status change in order", async function () {
    const id = await sentInvoice();
    await workflow.connect(recipient).acceptInvoice(id);
    await workflow.connect(recipient).markPaid(id);
    const history = await workflow.getHistory(id);
    expect(history.map((entry) => Number(entry.status))).to.deep.equal([0, 1, 2, 4]);
    expect(history.map((entry) => entry.changedBy)).to.deep.equal([
      await registry.getAddress(), issuer.address, recipient.address, recipient.address
    ]);
  });

  it("32. rejects actions on a nonexistent invoice", async function () {
    await expect(workflow.connect(issuer).sendInvoice(99)).to.be.revertedWith("Workflow: invoice not found");
  });

});
