// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev The two ERC-20 calls the marketplace makes. Called through `_token`,
///      which tolerates tokens that return nothing instead of a bool.
interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
}

/// @title DevStationMarketplace
/// @notice Builders sell contract templates, full apps, agent skills and UI
///         kits, priced in native QIE or in QUSDC. Buyers pay once, or per
///         deploy for templates; anyone can tip; creators can pay to be
///         featured. DevStation keeps 5% of sales and nothing of tips.
/// @dev **What is on-chain and what is not.** A listing's terms, its sales and
///      its `contentHash` live here. The files themselves do not: an app is
///      far too large to store, and storing it would make a paid listing free
///      to read. DevStation's server holds the files and releases them only to
///      wallets for which `hasAccess` is true, so this contract is the single
///      source of truth for who may download what. The hash lets a buyer check
///      the files they received are exactly the ones that were listed.
///
///      Payments use a pull pattern: every amount owed is credited to
///      `pending` and leaves only through `withdraw`. Sending value inside a
///      purchase would hand control to the creator mid-call, letting a hostile
///      creator make their own listing unbuyable or grief buyers' gas.
contract DevStationMarketplace {
    uint8 public constant KIND_TEMPLATE = 0;
    uint8 public constant KIND_APP = 1;
    uint8 public constant KIND_SKILL = 2;
    uint8 public constant KIND_UI_KIT = 3;

    uint8 public constant CURRENCY_NATIVE = 0;
    uint8 public constant CURRENCY_QUSDC = 1;

    uint8 public constant MODEL_ONE_TIME = 0;
    uint8 public constant MODEL_PER_DEPLOY = 1;

    /// @notice Basis points of each sale kept by the protocol. Tips pay no fee.
    uint16 public constant PROTOCOL_FEE_BPS = 500; // 5%
    uint16 private constant BPS = 10_000;
    uint256 public constant MAX_FEATURE_DAYS = 90;

    struct Listing {
        address creator;
        /// @dev In the listing currency's smallest unit: wei for QIE, and
        ///      1e-6 for QUSDC, which has 6 decimals.
        uint96 price;
        uint64 createdAt;
        uint64 featuredUntil;
        uint64 sales;
        uint64 deploys;
        uint8 kind;
        uint8 currency;
        uint8 model;
        bool active;
        /// @dev Set by the owner to take down abusive content. A hidden
        ///      listing cannot be bought, tipped, featured or downloaded.
        bool hidden;
        bytes32 contentHash;
        string name;
        string description;
        /// @dev Category, tags, preview text, demo URL: presentation only,
        ///      never read by this contract.
        string metadataJson;
    }

    /// @notice Listing metadata without the long strings, for browse pages.
    struct Summary {
        uint256 id;
        address creator;
        uint96 price;
        uint64 createdAt;
        uint64 featuredUntil;
        uint64 sales;
        uint64 deploys;
        uint8 kind;
        uint8 currency;
        uint8 model;
        bool active;
        bool hidden;
        string name;
    }

    address public immutable treasury;
    /// @notice QUSDC, or address(0) where it does not exist (QUSDC-priced
    ///         listings are then refused).
    address public immutable qusdc;

    address public owner;
    address public pendingOwner;

    Listing[] private _listings;
    mapping(uint256 => mapping(address => bool)) private _purchased;
    mapping(address => uint256[]) private _byCreator;
    mapping(address => uint256[]) private _purchases;

    /// @notice token (address(0) for QIE) => account => amount awaiting withdrawal.
    mapping(address => mapping(address => uint256)) public pending;
    /// @notice Cost of one day of featured placement, per currency.
    mapping(uint8 => uint256) public featuredPricePerDay;

    uint256 private _lock = 1;

    event ListingPublished(
        uint256 indexed id,
        address indexed creator,
        uint8 kind,
        uint8 currency,
        uint8 model,
        uint256 price,
        string name,
        bytes32 contentHash
    );
    event ListingUpdated(uint256 indexed id, uint256 price, bool active);
    event ContentUpdated(uint256 indexed id, bytes32 contentHash);
    event Purchased(
        uint256 indexed id,
        address indexed buyer,
        address indexed creator,
        uint8 currency,
        uint256 paid,
        uint256 fee
    );
    event DeployRecorded(
        uint256 indexed id,
        address indexed deployer,
        address indexed creator,
        uint8 currency,
        uint256 paid,
        uint256 fee
    );
    event Tipped(
        uint256 indexed id,
        address indexed from,
        address indexed creator,
        uint8 currency,
        uint256 amount
    );
    event Featured(uint256 indexed id, address indexed creator, uint256 days_, uint64 until, uint256 paid);
    event Moderated(uint256 indexed id, bool hidden);
    event FeaturedPriceSet(uint8 indexed currency, uint256 perDay);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier nonReentrant() {
        require(_lock == 1, "Reentrant call");
        _lock = 2;
        _;
        _lock = 1;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not the owner");
        _;
    }

    constructor(address treasury_, address qusdc_) {
        require(treasury_ != address(0), "Invalid treasury");
        treasury = treasury_;
        qusdc = qusdc_;
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ------------------------------------------------------------ creators

    /// @notice List something for sale. Returns its id.
    function publish(
        uint8 kind,
        uint8 currency,
        uint8 model,
        uint96 price,
        string calldata name,
        string calldata description,
        string calldata metadataJson,
        bytes32 contentHash
    ) external returns (uint256 id) {
        require(kind <= KIND_UI_KIT, "Unknown kind");
        require(currency <= CURRENCY_QUSDC, "Unknown currency");
        require(model <= MODEL_PER_DEPLOY, "Unknown pricing model");
        require(currency == CURRENCY_NATIVE || qusdc != address(0), "QUSDC not available here");
        require(
            model == MODEL_ONE_TIME || kind == KIND_TEMPLATE,
            "Per-deploy pricing is for contract templates"
        );
        require(bytes(name).length > 0 && bytes(name).length <= 80, "Name must be 1-80 bytes");
        require(bytes(description).length <= 1000, "Description too long");
        require(bytes(metadataJson).length <= 4000, "Metadata too long");
        require(contentHash != bytes32(0), "Content hash required");

        id = _listings.length;
        _listings.push(
            Listing({
                creator: msg.sender,
                price: price,
                createdAt: uint64(block.timestamp),
                featuredUntil: 0,
                sales: 0,
                deploys: 0,
                kind: kind,
                currency: currency,
                model: model,
                active: true,
                hidden: false,
                contentHash: contentHash,
                name: name,
                description: description,
                metadataJson: metadataJson
            })
        );
        _byCreator[msg.sender].push(id);
        emit ListingPublished(id, msg.sender, kind, currency, model, price, name, contentHash);
    }

    /// @notice Change price, listing status or presentation. Creator only.
    /// @dev Currency and pricing model are fixed at publish: changing either
    ///      under existing buyers would change what they paid for.
    function update(uint256 id, uint96 price, bool active, string calldata metadataJson) external {
        Listing storage l = _own(id);
        require(bytes(metadataJson).length <= 4000, "Metadata too long");
        l.price = price;
        l.active = active;
        l.metadataJson = metadataJson;
        emit ListingUpdated(id, price, active);
    }

    /// @notice Point the listing at a new version of its files. Past buyers
    ///         keep access: access is per listing, not per version.
    function updateContent(uint256 id, bytes32 contentHash) external {
        Listing storage l = _own(id);
        require(contentHash != bytes32(0), "Content hash required");
        l.contentHash = contentHash;
        emit ContentUpdated(id, contentHash);
    }

    /// @notice Pay to pin a listing to the top of the marketplace. The whole
    ///         payment goes to the treasury. Days stack onto any time left.
    function feature(uint256 id, uint256 days_) external payable nonReentrant {
        Listing storage l = _own(id);
        require(l.active && !l.hidden, "Listing not available");
        require(days_ >= 1 && days_ <= MAX_FEATURE_DAYS, "Feature for 1-90 days");
        uint256 perDay = featuredPricePerDay[l.currency];
        require(perDay > 0, "Featuring is not open for this currency");
        uint256 cost = perDay * days_;

        uint64 start = l.featuredUntil > block.timestamp ? l.featuredUntil : uint64(block.timestamp);
        l.featuredUntil = start + uint64(days_ * 1 days);
        pending[_tokenOf(l.currency)][treasury] += cost;
        emit Featured(id, msg.sender, days_, l.featuredUntil, cost);

        _collect(l.currency, cost);
    }

    // -------------------------------------------------------------- buyers

    /// @notice Buy a one-time listing. Refuses to charge the same wallet twice.
    function buy(uint256 id) external payable nonReentrant {
        Listing storage l = _available(id);
        require(l.model == MODEL_ONE_TIME, "This listing is paid per deploy");
        require(msg.sender != l.creator, "You created this listing");
        require(!_purchased[id][msg.sender], "Already purchased");

        _grant(id, msg.sender);
        l.sales += 1;
        uint256 fee = _credit(l.currency, l.creator, l.price);
        emit Purchased(id, msg.sender, l.creator, l.currency, l.price, fee);

        _collect(l.currency, l.price);
    }

    /// @notice Pay for one deploy of a per-deploy template. Charged every time;
    ///         the creator deploys their own template free.
    function recordDeploy(uint256 id) external payable nonReentrant {
        Listing storage l = _available(id);
        require(l.model == MODEL_PER_DEPLOY, "This listing is a one-time purchase");
        uint256 due = msg.sender == l.creator ? 0 : l.price;

        if (!_purchased[id][msg.sender] && msg.sender != l.creator) _grant(id, msg.sender);
        l.deploys += 1;
        uint256 fee = _credit(l.currency, l.creator, due);
        emit DeployRecorded(id, msg.sender, l.creator, l.currency, due, fee);

        _collect(l.currency, due);
    }

    /// @notice Tip a listing's creator, in the listing's currency. No fee.
    function tip(uint256 id, uint256 amount) external payable nonReentrant {
        require(id < _listings.length, "No such listing");
        Listing storage l = _listings[id];
        require(!l.hidden, "Listing not available");
        require(amount > 0, "Tip must be more than zero");

        pending[_tokenOf(l.currency)][l.creator] += amount;
        emit Tipped(id, msg.sender, l.creator, l.currency, amount);

        _collect(l.currency, amount);
    }

    // ----------------------------------------------------------- everyone

    /// @notice Withdraw everything owed to the caller in one currency:
    ///         address(0) for QIE, or the QUSDC address.
    function withdraw(address token) external nonReentrant {
        require(token == address(0) || (token == qusdc && qusdc != address(0)), "Unknown token");
        uint256 amount = pending[token][msg.sender];
        require(amount > 0, "Nothing to withdraw");
        // Zeroed before the transfer: the reentrancy guard's second line.
        pending[token][msg.sender] = 0;
        emit Withdrawn(token, msg.sender, amount);

        if (token == address(0)) {
            (bool ok, ) = payable(msg.sender).call{value: amount}("");
            require(ok, "Withdraw failed");
        } else {
            _token(abi.encodeWithSelector(IERC20Minimal.transfer.selector, msg.sender, amount));
        }
    }

    // --------------------------------------------------------------- owner

    function setFeaturedPrice(uint8 currency, uint256 perDay) external onlyOwner {
        require(currency <= CURRENCY_QUSDC, "Unknown currency");
        featuredPricePerDay[currency] = perDay;
        emit FeaturedPriceSet(currency, perDay);
    }

    /// @notice Hide or restore a listing. For content that breaks the rules;
    ///         it never touches money already owed to anyone.
    function moderate(uint256 id, bool hidden) external onlyOwner {
        require(id < _listings.length, "No such listing");
        _listings[id].hidden = hidden;
        emit Moderated(id, hidden);
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

    // --------------------------------------------------------------- views

    /// @notice Whether `wallet` may download the listing's files: its creator,
    ///         anyone for a free listing, and whoever has paid. Nobody but the
    ///         creator while it is hidden.
    function hasAccess(uint256 id, address wallet) external view returns (bool) {
        if (id >= _listings.length) return false;
        Listing storage l = _listings[id];
        if (wallet == l.creator) return true;
        if (l.hidden) return false;
        return l.price == 0 || _purchased[id][wallet];
    }

    function getListing(uint256 id) external view returns (Listing memory) {
        require(id < _listings.length, "No such listing");
        return _listings[id];
    }

    function totalListings() external view returns (uint256) {
        return _listings.length;
    }

    function listingsByCreator(address creator) external view returns (uint256[] memory) {
        return _byCreator[creator];
    }

    function purchasesOf(address wallet) external view returns (uint256[] memory) {
        return _purchases[wallet];
    }

    /// @notice A page of listings without description, metadata or hash.
    function listSummaries(uint256 offset, uint256 limit) external view returns (Summary[] memory page) {
        uint256 total = _listings.length;
        if (offset >= total) return new Summary[](0);
        uint256 end = offset + limit > total ? total : offset + limit;
        page = new Summary[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            Listing storage l = _listings[i];
            page[i - offset] = Summary({
                id: i,
                creator: l.creator,
                price: l.price,
                createdAt: l.createdAt,
                featuredUntil: l.featuredUntil,
                sales: l.sales,
                deploys: l.deploys,
                kind: l.kind,
                currency: l.currency,
                model: l.model,
                active: l.active,
                hidden: l.hidden,
                name: l.name
            });
        }
    }

    // ------------------------------------------------------------ internal

    function _own(uint256 id) private view returns (Listing storage l) {
        require(id < _listings.length, "No such listing");
        l = _listings[id];
        require(l.creator == msg.sender, "Not the creator");
    }

    function _available(uint256 id) private view returns (Listing storage l) {
        require(id < _listings.length, "No such listing");
        l = _listings[id];
        require(l.active && !l.hidden, "Listing not available");
    }

    function _grant(uint256 id, address wallet) private {
        _purchased[id][wallet] = true;
        _purchases[wallet].push(id);
    }

    function _tokenOf(uint8 currency) private view returns (address) {
        return currency == CURRENCY_NATIVE ? address(0) : qusdc;
    }

    /// @dev Splits a sale between creator and treasury. Returns the fee.
    function _credit(uint8 currency, address creator, uint256 amount) private returns (uint256 fee) {
        if (amount == 0) return 0;
        fee = (amount * PROTOCOL_FEE_BPS) / BPS;
        address token = _tokenOf(currency);
        pending[token][treasury] += fee;
        pending[token][creator] += amount - fee;
    }

    /// @dev Takes exactly `amount` from the caller. Called last, after every
    ///      state change, and under the reentrancy lock.
    function _collect(uint8 currency, uint256 amount) private {
        if (currency == CURRENCY_NATIVE) {
            require(msg.value == amount, "Send exactly the price in QIE");
        } else {
            require(msg.value == 0, "This listing is priced in QUSDC, not QIE");
            if (amount > 0) {
                _token(
                    abi.encodeWithSelector(
                        IERC20Minimal.transferFrom.selector,
                        msg.sender,
                        address(this),
                        amount
                    )
                );
            }
        }
    }

    /// @dev A token call that accepts both `true` and an empty return.
    function _token(bytes memory data) private {
        require(qusdc.code.length > 0, "QUSDC not available here");
        (bool ok, bytes memory ret) = qusdc.call(data);
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "QUSDC transfer failed");
    }
}
