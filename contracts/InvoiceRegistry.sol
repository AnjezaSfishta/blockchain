// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IInvoiceWorkflow {
    function initializeInvoice(uint256 invoiceId) external;
}

contract InvoiceRegistry {
    struct Invoice {
        uint256 id;
        address issuer;
        address recipient;
        bytes32 documentHash;
        uint256 amount;
        string currency;
        string metadataURI;
        uint64 createdAt;
    }

    address public immutable owner;
    IInvoiceWorkflow public workflow;
    uint256 public invoiceCount;

    mapping(uint256 => Invoice) private invoices;
    mapping(address => bool) public auditors;

    event InvoiceRegistered(
        uint256 indexed invoiceId,
        address indexed issuer,
        address indexed recipient,
        bytes32 documentHash,
        uint256 amount,
        string currency,
        string metadataURI
    );
    event AuditorUpdated(address indexed auditor, bool enabled);
    event WorkflowConfigured(address indexed workflow);

    modifier onlyOwner() {
        require(msg.sender == owner, "Registry: not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setWorkflow(address workflowAddress) external onlyOwner {
        require(address(workflow) == address(0), "Registry: workflow already set");
        require(workflowAddress != address(0), "Registry: zero workflow");
        workflow = IInvoiceWorkflow(workflowAddress);
        emit WorkflowConfigured(workflowAddress);
    }

    function setAuditor(address auditor, bool enabled) external onlyOwner {
        require(auditor != address(0), "Registry: zero auditor");
        auditors[auditor] = enabled;
        emit AuditorUpdated(auditor, enabled);
    }

    function registerInvoice(
        address recipient,
        bytes32 documentHash,
        uint256 amount,
        string calldata currency,
        string calldata metadataURI
    ) external returns (uint256 invoiceId) {
        require(address(workflow) != address(0), "Registry: workflow not configured");
        require(recipient != address(0) && recipient != msg.sender, "Registry: invalid recipient");
        require(documentHash != bytes32(0), "Registry: empty document hash");
        require(bytes(currency).length > 0 && bytes(currency).length <= 12, "Registry: invalid currency");
        require(bytes(metadataURI).length <= 256, "Registry: metadata URI too long");

        invoiceId = ++invoiceCount;
        invoices[invoiceId] = Invoice({
            id: invoiceId,
            issuer: msg.sender,
            recipient: recipient,
            documentHash: documentHash,
            amount: amount,
            currency: currency,
            metadataURI: metadataURI,
            createdAt: uint64(block.timestamp)
        });

        emit InvoiceRegistered(
            invoiceId,
            msg.sender,
            recipient,
            documentHash,
            amount,
            currency,
            metadataURI
        );
        workflow.initializeInvoice(invoiceId);
    }

    function getInvoice(uint256 invoiceId) external view returns (Invoice memory) {
        require(invoiceId > 0 && invoiceId <= invoiceCount, "Registry: invoice not found");
        return invoices[invoiceId];
    }

    function isParty(uint256 invoiceId, address account) external view returns (bool) {
        if (invoiceId == 0 || invoiceId > invoiceCount) return false;
        Invoice storage invoice = invoices[invoiceId];
        return invoice.issuer == account || invoice.recipient == account;
    }
}
