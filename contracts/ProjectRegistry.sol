// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ProjectRegistry
/// @notice On-chain record of contracts deployed through DevStation. Powers the
///         Projects page and provides an auditable deployment trail. No external
///         dependencies so it compiles standalone.
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
