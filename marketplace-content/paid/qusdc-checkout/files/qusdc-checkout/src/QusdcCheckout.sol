// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
}

/// @title QusdcCheckout
/// @notice Takes payment in QUSDC (or any plain ERC-20) for orders created
///         off-chain. Each order id can be paid once; the owner can refund up
///         to what was paid and withdraw revenue.
/// @dev Compile with evmVersion shanghai for QIE, which has no MCOPY.
contract QusdcCheckout {
    struct Order {
        address payer;
        uint96 amount;
        uint96 refunded;
        uint64 paidAt;
    }

    /// @notice The token orders are paid in. QUSDC on QIE Mainnet has 6 decimals.
    IERC20 public immutable token;
    address public owner;
    address public pendingOwner;

    /// @notice Order id, typically keccak256 of your own order reference.
    mapping(bytes32 => Order) public orders;

    event OrderPaid(bytes32 indexed orderId, address indexed payer, uint256 amount);
    event OrderRefunded(bytes32 indexed orderId, address indexed payer, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error ZeroAddress();
    error ZeroAmount();
    error AmountTooLarge();
    error AlreadyPaid();
    error UnknownOrder();
    error RefundExceedsPayment();
    error FeeOnTransferToken();
    error TokenCallFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IERC20 token_, address owner_) {
        if (address(token_) == address(0) || owner_ == address(0)) revert ZeroAddress();
        token = token_;
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    /// @notice Pays `orderId`. The caller must first approve this contract for `amount`.
    function pay(bytes32 orderId, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (amount > type(uint96).max) revert AmountTooLarge();
        if (orders[orderId].payer != address(0)) revert AlreadyPaid();

        orders[orderId] =
            Order({payer: msg.sender, amount: uint96(amount), refunded: 0, paidAt: uint64(block.timestamp)});

        uint256 before = token.balanceOf(address(this));
        _tokenCall(abi.encodeCall(IERC20.transferFrom, (msg.sender, address(this), amount)));
        // A fee-on-transfer token would leave the order recording more than arrived.
        if (token.balanceOf(address(this)) - before != amount) revert FeeOnTransferToken();

        emit OrderPaid(orderId, msg.sender, amount);
    }

    /// @notice Refunds part or all of a payment to the wallet that paid it.
    function refund(bytes32 orderId, uint256 amount) external onlyOwner {
        Order storage order = orders[orderId];
        if (order.payer == address(0)) revert UnknownOrder();
        if (amount == 0) revert ZeroAmount();
        if (amount > order.amount - order.refunded) revert RefundExceedsPayment();

        order.refunded += uint96(amount);
        _tokenCall(abi.encodeCall(IERC20.transfer, (order.payer, amount)));

        emit OrderRefunded(orderId, order.payer, amount);
    }

    /// @notice Moves revenue out. Keep enough behind for refunds you may owe.
    function withdraw(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        _tokenCall(abi.encodeCall(IERC20.transfer, (to, amount)));
        emit Withdrawn(to, amount);
    }

    function isPaid(bytes32 orderId) external view returns (bool) {
        return orders[orderId].payer != address(0);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    /// @dev Works with tokens that return true and with tokens that return nothing.
    function _tokenCall(bytes memory data) private {
        if (address(token).code.length == 0) revert TokenCallFailed();
        (bool ok, bytes memory ret) = address(token).call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TokenCallFailed();
    }
}
