// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ProjectRegistry
/// @notice On-chain record of contracts deployed through DevStation. Powers the
///         Projects page. No external dependencies so it compiles standalone.
/// @dev This is a self-reported log, not a verified audit trail: there is no
///      on-chain check that `contractAddress` was actually deployed by
///      `msg.sender`, or that `txHash` corresponds to a real transaction -
///      only that the caller signed this particular recordDeployment call.
///      Access control is scoped (a caller can only append to their own
///      bucket, never someone else's), so this can't be used to pollute
///      another wallet's history, but it should be read as "what this wallet
///      told the registry it deployed," not independently verified fact.
contract ProjectRegistry {
    struct Deployment {
        address contractAddress;
        string templateId;
        string projectName;
        string network;
        uint256 deployedAt;
        string txHash;
    }

    mapping(address => Deployment[]) private _deployments;
    uint256 public totalDeployments;

    event DeploymentRecorded(
        address indexed deployer,
        address indexed contractAddress,
        string templateId,
        string projectName,
        uint256 timestamp
    );

    /// @notice Record a deployment made by msg.sender.
    function recordDeployment(
        address contractAddress,
        string calldata templateId,
        string calldata projectName,
        string calldata network,
        string calldata txHash
    ) external {
        require(contractAddress != address(0), "Invalid address");
        require(bytes(txHash).length > 0, "txHash required");
        _deployments[msg.sender].push(
            Deployment({
                contractAddress: contractAddress,
                templateId: templateId,
                projectName: projectName,
                network: network,
                deployedAt: block.timestamp,
                txHash: txHash
            })
        );
        totalDeployments++;
        emit DeploymentRecorded(msg.sender, contractAddress, templateId, projectName, block.timestamp);
    }

    /// @notice All deployments recorded by `deployer`.
    function getDeployments(address deployer) external view returns (Deployment[] memory) {
        return _deployments[deployer];
    }

    /// @notice Count of deployments recorded by `deployer`.
    function getDeploymentCount(address deployer) external view returns (uint256) {
        return _deployments[deployer].length;
    }
}
