// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title TemplateRegistry
/// @notice Community contract templates, published on-chain with a creator-set
///         price. Deploying through a template pays its creator in the same
///         transaction and credits the deploy to them.
/// @dev **The source is public.** Every template's Solidity is stored on-chain
///      and readable free of charge by anyone. Storing ~2 KB costs about
///      0.0014 QIE, so there is no reason to hide it behind a server, and
///      hiding it would mean the body was no longer trustless.
///
///      What the price buys is therefore ATTRIBUTION, not secrecy: paying is
///      what records the deploy against the template, which is what pays the
///      creator and grows their deployCount. Anyone can copy the source and
///      deploy it unattributed for free: that is an accepted property of
///      putting the source on-chain, not an oversight.
///
///      Payments use a pull pattern (`withdraw`), never a push. Sending value
///      inside `deployWithTemplate` would hand control to the creator's
///      fallback mid-call, letting a malicious creator revert every deploy of
///      their own template, or burn a deployer's gas.
contract TemplateRegistry {
    struct Template {
        address creator;
        /// @dev Wei. uint96 holds ~7.9e28, far above any real price, and
        ///      packs into the same slot as `creator`.
        uint96 price;
        uint64 createdAt;
        uint64 deployCount;
        bool active;
        string name;
        string description;
        string source;
        string abiJson;
    }

    /// @dev Basis points of each payment kept by the protocol.
    uint16 public constant PROTOCOL_FEE_BPS = 500; // 5%
    uint16 private constant BPS = 10_000;

    address public immutable protocolTreasury;

    Template[] private _templates;
    mapping(address => uint256[]) private _byCreator;
    /// @notice Balances awaiting withdrawal, for creators and the treasury.
    mapping(address => uint256) public pending;

    event TemplatePublished(uint256 indexed id, address indexed creator, string name, uint256 price);
    event TemplateUpdated(uint256 indexed id, uint256 price, bool active);
    event TemplateDeployed(
        uint256 indexed id,
        address indexed deployer,
        address indexed creator,
        uint256 paid
    );
    event Withdrawn(address indexed to, uint256 amount);

    constructor(address treasury) {
        require(treasury != address(0), "Invalid treasury");
        protocolTreasury = treasury;
    }

    /// @notice Publish a template. Returns its id.
    function publish(
        string calldata name,
        string calldata description,
        string calldata source,
        string calldata abiJson,
        uint96 price
    ) external returns (uint256 id) {
        require(bytes(name).length > 0, "Name required");
        require(bytes(source).length > 0, "Source required");
        id = _templates.length;
        _templates.push(
            Template({
                creator: msg.sender,
                price: price,
                createdAt: uint64(block.timestamp),
                deployCount: 0,
                active: true,
                name: name,
                description: description,
                source: source,
                abiJson: abiJson
            })
        );
        _byCreator[msg.sender].push(id);
        emit TemplatePublished(id, msg.sender, name, price);
    }

    /// @notice Change a template's price, or list/delist it. Creator only.
    /// @dev The source is deliberately immutable. A published template is
    ///      something other people have deployed and attributed; letting the
    ///      creator swap the code underneath it would rewrite what those
    ///      deployments meant. Publish a new template instead.
    function update(uint256 id, uint96 price, bool active) external {
        Template storage t = _templates[id];
        require(t.creator == msg.sender, "Not the creator");
        t.price = price;
        t.active = active;
        emit TemplateUpdated(id, price, active);
    }

    /// @notice Pay for and record a deploy of template `id`.
    /// @dev Overpayment is credited to the creator rather than refunded: a
    ///      refund would be a second value transfer in the same call, which is
    ///      what the pull pattern above exists to avoid.
    function deployWithTemplate(uint256 id) external payable {
        Template storage t = _templates[id];
        require(t.active, "Template not available");
        require(msg.value >= t.price, "Insufficient payment");

        t.deployCount += 1;

        if (msg.value > 0) {
            uint256 fee = (msg.value * PROTOCOL_FEE_BPS) / BPS;
            pending[protocolTreasury] += fee;
            pending[t.creator] += msg.value - fee;
        }
        emit TemplateDeployed(id, msg.sender, t.creator, msg.value);
    }

    /// @notice Withdraw everything owed to the caller.
    function withdraw() external {
        uint256 amount = pending[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        // Zeroed BEFORE the transfer: the classic reentrancy guard, and the
        // reason this is the only place value leaves the contract.
        pending[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "Withdraw failed");
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice One template, including its full source.
    function getTemplate(uint256 id) external view returns (Template memory) {
        return _templates[id];
    }

    /// @notice Ids published by `creator`.
    function getTemplatesByCreator(address creator) external view returns (uint256[] memory) {
        return _byCreator[creator];
    }

    /// @notice How many templates exist. Ids are 0..totalTemplates-1.
    function totalTemplates() external view returns (uint256) {
        return _templates.length;
    }

    /// @notice Metadata for a page of templates, WITHOUT the source bodies.
    /// @dev The listing page needs 20 templates at once; returning their
    ///      sources too would be ~40 KB of ABI-encoded strings in one eth_call.
    ///      Bodies are fetched individually via getTemplate.
    function listSummaries(uint256 offset, uint256 limit)
        external
        view
        returns (
            uint256[] memory ids,
            address[] memory creators,
            uint96[] memory prices,
            uint64[] memory deployCounts,
            bool[] memory actives,
            string[] memory names
        )
    {
        uint256 total = _templates.length;
        if (offset >= total) {
            return (
                new uint256[](0),
                new address[](0),
                new uint96[](0),
                new uint64[](0),
                new bool[](0),
                new string[](0)
            );
        }
        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 n = end - offset;

        ids = new uint256[](n);
        creators = new address[](n);
        prices = new uint96[](n);
        deployCounts = new uint64[](n);
        actives = new bool[](n);
        names = new string[](n);

        for (uint256 i = 0; i < n; i++) {
            Template storage t = _templates[offset + i];
            ids[i] = offset + i;
            creators[i] = t.creator;
            prices[i] = t.price;
            deployCounts[i] = t.deployCount;
            actives[i] = t.active;
            names[i] = t.name;
        }
    }
}
