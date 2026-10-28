// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ContractLabelRegistryV2
/// @notice Version 2 of ContractLabelRegistry (see contracts/V2_CHANGES.md):
///         - the owner can remove a label outright (a squatted or abusive
///           community label could only be overwritten before, and only by
///           its submitter, the owner or the auto-labeler);
///         - label text has length limits, so one submission cannot make
///           every later read expensive;
///         - ownership moves in two steps, so it cannot be handed to a typo.
/// @notice Human-readable names for contracts on QIE, so Routebook can show
///         labels instead of raw hex. Auto-labels (from DevStation deploys) are
///         pre-approved; community submissions await owner approval. No external
///         dependencies so it compiles standalone.
/// @dev v2: `submitLabel`'s `autoLabeled` flag is now access-controlled (only
///      `autoLabeler` may set it true; anyone claiming autoLabeled=true from
///      another address reverts instead of silently minting a trusted-looking
///      label for an address they don't control). Only the current submitter,
///      the owner, or the autoLabeler may overwrite an existing label: the
///      original version allowed anyone to overwrite anyone's label. See
///      `getLabeledContractsPage` for a bounded alternative to
///      `getLabeledContracts`, which has no size limit and can be grown by an
///      attacker into a read that reverts out-of-gas for every caller.
contract ContractLabelRegistryV2 {
    /// @notice Interface version, so a client can tell v2 from v1.
    uint256 public constant version = 2;
    uint256 public constant MAX_NAME = 80;
    uint256 public constant MAX_CATEGORY = 40;
    uint256 public constant MAX_DESCRIPTION = 500;

    address public owner;
    address public pendingOwner;
    /// @notice The only address allowed to submit a pre-approved (autoLabeled=true)
    ///         label: DevStation's own deploy flow signer. Anyone can still submit
    ///         a COMMUNITY label (autoLabeled=false) for any address.
    address public autoLabeler;

    struct Label {
        string name;
        string category;
        string description;
        address submitter;
        uint256 submittedAt;
        bool approved;
        bool autoLabeled;
    }

    mapping(address => Label) private _labels;
    address[] private _labeled;
    /// @dev Whether an address is already in `_labeled`, so a label removed
    ///      and submitted again is not listed twice.
    mapping(address => bool) private _listed;
    uint256 public totalLabels;
    uint256 public totalApproved;

    event LabelSubmitted(address indexed contractAddress, string name, address indexed submitter, bool autoLabeled);
    event LabelApproved(address indexed contractAddress);
    event AutoLabelerUpdated(address indexed autoLabeler);
    event LabelRemoved(address indexed contractAddress);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    /// @param autoLabeler_ Address authorized to submit pre-approved labels.
    ///        Pass address(0) to default it to the deployer.
    constructor(address autoLabeler_) {
        owner = msg.sender;
        autoLabeler = autoLabeler_ == address(0) ? msg.sender : autoLabeler_;
    }

    /// @notice Owner can rotate the authorized auto-labeler (e.g. a new deploy signer).
    function setAutoLabeler(address autoLabeler_) external onlyOwner {
        require(autoLabeler_ != address(0), "Invalid address");
        autoLabeler = autoLabeler_;
        emit AutoLabelerUpdated(autoLabeler_);
    }

    /// @notice Submit (or overwrite) a label for `contractAddress`.
    /// @param autoLabeled true for a pre-approved DevStation auto-label: only
    ///        callable by `autoLabeler`, reverts for anyone else. Everyone else
    ///        may submit with autoLabeled=false (a COMMUNITY label pending
    ///        owner approval via `approveLabel`).
    function submitLabel(
        address contractAddress,
        string calldata name,
        string calldata category,
        string calldata description,
        bool autoLabeled
    ) external {
        require(bytes(name).length > 0, "Name required");
        require(bytes(name).length <= MAX_NAME, "Name too long");
        require(bytes(category).length <= MAX_CATEGORY, "Category too long");
        require(bytes(description).length <= MAX_DESCRIPTION, "Description too long");
        require(contractAddress != address(0), "Invalid address");
        if (autoLabeled) {
            require(msg.sender == autoLabeler, "Not authorized to auto-label");
        }

        bool existed = bytes(_labels[contractAddress].name).length > 0;
        bool wasApproved = _labels[contractAddress].approved;
        if (existed) {
            address currentSubmitter = _labels[contractAddress].submitter;
            require(
                msg.sender == currentSubmitter || msg.sender == owner || msg.sender == autoLabeler,
                "Not authorized to update this label"
            );
        }

        _labels[contractAddress] = Label({
            name: name,
            category: category,
            description: description,
            submitter: msg.sender,
            submittedAt: block.timestamp,
            approved: autoLabeled,
            autoLabeled: autoLabeled
        });

        if (!existed) {
            if (!_listed[contractAddress]) {
                _listed[contractAddress] = true;
                _labeled.push(contractAddress);
            }
            totalLabels++;
        }
        if (autoLabeled && !wasApproved) totalApproved++;
        if (!autoLabeled && wasApproved) totalApproved--;

        emit LabelSubmitted(contractAddress, name, msg.sender, autoLabeled);
    }

    /// @notice Owner approves a pending community label.
    function approveLabel(address contractAddress) external onlyOwner {
        require(bytes(_labels[contractAddress].name).length > 0, "No label");
        require(!_labels[contractAddress].approved, "Already approved");
        _labels[contractAddress].approved = true;
        totalApproved++;
        emit LabelApproved(contractAddress);
    }

    /// @notice Owner removes a label entirely, approved or not. The address
    ///         can then be labelled again by anyone. For squatted names
    ///         ("Official Bridge" on a stranger's contract) and abuse.
    function removeLabel(address contractAddress) external onlyOwner {
        Label storage l = _labels[contractAddress];
        require(bytes(l.name).length > 0, "No label");
        if (l.approved) totalApproved--;
        totalLabels--;
        delete _labels[contractAddress];
        emit LabelRemoved(contractAddress);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Not the pending owner");
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    function getLabel(address contractAddress) external view returns (Label memory) {
        return _labels[contractAddress];
    }

    function getLabelName(address contractAddress) external view returns (string memory) {
        return _labels[contractAddress].name;
    }

    /// @notice Batch label-name lookup for Routebook route trees.
    function batchGetLabels(address[] calldata addresses) external view returns (string[] memory names) {
        names = new string[](addresses.length);
        for (uint256 i = 0; i < addresses.length; i++) {
            names[i] = _labels[addresses[i]].name;
        }
    }

    /// @notice Full labeled-address list. UNBOUNDED: grows by one for every
    ///         new address ever submitted, with no size cap. Anyone can grow
    ///         this until this call reverts out-of-gas for every caller.
    ///         Prefer `getLabeledContractsPage` for anything reachable
    ///         off-chain by an untrusted party.
    function getLabeledContracts() external view returns (address[] memory) {
        return _labeled;
    }

    /// @notice Bounded page of the labeled-address list, safe regardless of
    ///         how large `_labeled` has grown.
    function getLabeledContractsPage(uint256 offset, uint256 limit) external view returns (address[] memory page) {
        uint256 total = _labeled.length;
        if (offset >= total) return new address[](0);
        uint256 end = offset + limit;
        if (end > total) end = total;
        page = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = _labeled[i];
        }
    }
}
