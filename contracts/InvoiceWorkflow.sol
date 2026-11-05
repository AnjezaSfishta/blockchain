// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IInvoiceRegistry {
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

    function owner() external view returns (address);
    function invoiceCount() external view returns (uint256);
    function getInvoice(uint256 invoiceId) external view returns (Invoice memory);
}

contract InvoiceWorkflow {
    enum Status {
        Registered,
        Sent,
        Accepted,
        Disputed,
        Paid,
        Cancelled
    }

    struct StatusChange {
        Status status;
        address changedBy;
        uint64 changedAt;
        string note;
    }

    IInvoiceRegistry public immutable registry;
    address public immutable owner;
    mapping(uint256 => Status) public statusOf;
    mapping(uint256 => StatusChange[]) private history;

    event StatusChanged(
        uint256 indexed invoiceId,
        Status indexed status,
        address indexed changedBy,
        string note,
        uint64 changedAt
    );
    event InvoiceSent(uint256 indexed invoiceId, address indexed issuer, uint64 changedAt);
    event InvoiceAccepted(uint256 indexed invoiceId, address indexed recipient, uint64 changedAt);
    event InvoiceDisputed(uint256 indexed invoiceId, address indexed recipient, string reason, uint64 changedAt);
    event InvoicePaid(uint256 indexed invoiceId, address indexed recipient, uint64 changedAt);
    event InvoiceCancelled(uint256 indexed invoiceId, address indexed cancelledBy, string reason, uint64 changedAt);

    modifier onlyRegistry() {
        require(msg.sender == address(registry), "Workflow: only registry");
        _;
    }

    modifier invoiceExists(uint256 invoiceId) {
        require(invoiceId > 0 && invoiceId <= registry.invoiceCount(), "Workflow: invoice not found");
        _;
    }

    constructor(address registryAddress) {
        require(registryAddress != address(0), "Workflow: zero registry");
        registry = IInvoiceRegistry(registryAddress);
        owner = IInvoiceRegistry(registryAddress).owner();
    }

    function initializeInvoice(uint256 invoiceId) external onlyRegistry {
        statusOf[invoiceId] = Status.Registered;
        _record(invoiceId, Status.Registered, "Invoice registered");
    }

    function sendInvoice(uint256 invoiceId) external invoiceExists(invoiceId) {
        IInvoiceRegistry.Invoice memory invoice = registry.getInvoice(invoiceId);
        require(msg.sender == invoice.issuer, "Workflow: issuer only");
        require(statusOf[invoiceId] == Status.Registered, "Workflow: invalid status");
        _change(invoiceId, Status.Sent, "Invoice sent");
        emit InvoiceSent(invoiceId, msg.sender, uint64(block.timestamp));
    }

    function acceptInvoice(uint256 invoiceId) external invoiceExists(invoiceId) {
        IInvoiceRegistry.Invoice memory invoice = registry.getInvoice(invoiceId);
        require(msg.sender == invoice.recipient, "Workflow: recipient only");
        Status current = statusOf[invoiceId];
        require(current == Status.Sent || current == Status.Disputed, "Workflow: invalid status");
        _change(invoiceId, Status.Accepted, "Invoice accepted");
        emit InvoiceAccepted(invoiceId, msg.sender, uint64(block.timestamp));
    }

    function disputeInvoice(uint256 invoiceId, string calldata reason) external invoiceExists(invoiceId) {
        IInvoiceRegistry.Invoice memory invoice = registry.getInvoice(invoiceId);
        require(msg.sender == invoice.recipient, "Workflow: recipient only");
        require(statusOf[invoiceId] == Status.Sent, "Workflow: invalid status");
        _validateNote(reason);
        _change(invoiceId, Status.Disputed, reason);
        emit InvoiceDisputed(invoiceId, msg.sender, reason, uint64(block.timestamp));
    }

    function markPaid(uint256 invoiceId) external invoiceExists(invoiceId) {
        IInvoiceRegistry.Invoice memory invoice = registry.getInvoice(invoiceId);
        require(msg.sender == invoice.recipient, "Workflow: recipient only");
        require(statusOf[invoiceId] == Status.Accepted, "Workflow: invalid status");
        _change(invoiceId, Status.Paid, "Invoice paid");
        emit InvoicePaid(invoiceId, msg.sender, uint64(block.timestamp));
    }

    function cancelInvoice(uint256 invoiceId, string calldata reason) external invoiceExists(invoiceId) {
        IInvoiceRegistry.Invoice memory invoice = registry.getInvoice(invoiceId);
        require(msg.sender == invoice.issuer || msg.sender == invoice.recipient, "Workflow: invoice party only");
        Status current = statusOf[invoiceId];
        require(
            current == Status.Registered || current == Status.Sent || current == Status.Disputed,
            "Workflow: invalid status"
        );
        _validateNote(reason);
        _change(invoiceId, Status.Cancelled, reason);
        emit InvoiceCancelled(invoiceId, msg.sender, reason, uint64(block.timestamp));
    }

    function getHistory(uint256 invoiceId)
        external
        view
        invoiceExists(invoiceId)
        returns (StatusChange[] memory)
    {
        return history[invoiceId];
    }

    function historyLength(uint256 invoiceId) external view invoiceExists(invoiceId) returns (uint256) {
        return history[invoiceId].length;
    }

    function _change(uint256 invoiceId, Status next, string memory note) private {
        statusOf[invoiceId] = next;
        _record(invoiceId, next, note);
    }

    function _record(uint256 invoiceId, Status next, string memory note) private {
        uint64 changedAt = uint64(block.timestamp);
        history[invoiceId].push(StatusChange(next, msg.sender, changedAt, note));
        emit StatusChanged(invoiceId, next, msg.sender, note, changedAt);
    }

    function _validateNote(string calldata note) private pure {
        require(bytes(note).length > 0 && bytes(note).length <= 200, "Workflow: invalid note");
    }
}
