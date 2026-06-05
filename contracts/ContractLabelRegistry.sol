// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ContractLabelRegistry
/// @notice Human-readable names for contracts on QIE, so Routebook can show
///         labels instead of raw hex. Auto-labels (from DevStation deploys) are
///         pre-approved; community submissions await owner approval. No external
///         dependencies so it compiles standalone.
contract ContractLabelRegistry {
    address public owner;

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
    uint256 public totalLabels;
    uint256 public totalApproved;

    event LabelSubmitted(address indexed contractAddress, string name, address indexed submitter, bool autoLabeled);
    event LabelApproved(address indexed contractAddress);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Submit (or overwrite) a label for `contractAddress`.
    /// @param autoLabeled true for DevStation auto-labels (pre-approved).
    function submitLabel(
        address contractAddress,
        string calldata name,
        string calldata category,
        string calldata description,
        bool autoLabeled
    ) external {
        require(bytes(name).length > 0, "Name required");
        require(contractAddress != address(0), "Invalid address");

        bool existed = bytes(_labels[contractAddress].name).length > 0;
        bool wasApproved = _labels[contractAddress].approved;

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
            _labeled.push(contractAddress);
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

    function getLabeledContracts() external view returns (address[] memory) {
        return _labeled;
    }
}
