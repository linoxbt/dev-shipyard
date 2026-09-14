// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20, QusdcCheckout} from "../src/QusdcCheckout.sol";

/// @dev A 6-decimal token shaped like QUSDC, for tests only.
contract MockQusdc {
    string public constant name = "Mock QUSDC";
    string public constant symbol = "QUSDC";
    uint8 public constant decimals = 6;
    uint256 public feeBps;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function setFee(uint256 bps) external {
        feeBps = bps;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) private {
        uint256 fee = (amount * feeBps) / 10_000;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - fee;
    }
}

contract QusdcCheckoutTest is Test {
    MockQusdc internal usdc;
    QusdcCheckout internal checkout;

    address internal shop = makeAddr("shop");
    address internal buyer = makeAddr("buyer");
    bytes32 internal constant ORDER = keccak256("order-1042");

    function setUp() public {
        usdc = new MockQusdc();
        checkout = new QusdcCheckout(IERC20(address(usdc)), shop);
        usdc.mint(buyer, 100e6);
        vm.prank(buyer);
        usdc.approve(address(checkout), type(uint256).max);
    }

    function test_pay_records_the_order_and_moves_the_funds() public {
        vm.expectEmit(address(checkout));
        emit QusdcCheckout.OrderPaid(ORDER, buyer, 25e6);
        vm.prank(buyer);
        checkout.pay(ORDER, 25e6);

        (address payer, uint96 amount, uint96 refunded, uint64 paidAt) = checkout.orders(ORDER);
        assertEq(payer, buyer);
        assertEq(amount, 25e6);
        assertEq(refunded, 0);
        assertEq(paidAt, block.timestamp);
        assertTrue(checkout.isPaid(ORDER));
        assertEq(usdc.balanceOf(address(checkout)), 25e6);
        assertEq(usdc.balanceOf(buyer), 75e6);
    }

    function test_an_order_is_paid_once() public {
        vm.startPrank(buyer);
        checkout.pay(ORDER, 25e6);
        vm.expectRevert(QusdcCheckout.AlreadyPaid.selector);
        checkout.pay(ORDER, 25e6);
        vm.stopPrank();
    }

    function test_zero_payments_are_refused() public {
        vm.prank(buyer);
        vm.expectRevert(QusdcCheckout.ZeroAmount.selector);
        checkout.pay(ORDER, 0);
    }

    function test_refunds_never_exceed_the_payment() public {
        vm.prank(buyer);
        checkout.pay(ORDER, 25e6);

        vm.startPrank(shop);
        checkout.refund(ORDER, 10e6);
        checkout.refund(ORDER, 15e6);
        vm.expectRevert(QusdcCheckout.RefundExceedsPayment.selector);
        checkout.refund(ORDER, 1);
        vm.stopPrank();

        assertEq(usdc.balanceOf(buyer), 100e6);
    }

    function test_refunding_an_unknown_order_fails() public {
        vm.prank(shop);
        vm.expectRevert(QusdcCheckout.UnknownOrder.selector);
        checkout.refund(ORDER, 1);
    }

    function test_only_the_owner_refunds_and_withdraws() public {
        vm.prank(buyer);
        checkout.pay(ORDER, 25e6);

        vm.startPrank(buyer);
        vm.expectRevert(QusdcCheckout.NotOwner.selector);
        checkout.refund(ORDER, 25e6);
        vm.expectRevert(QusdcCheckout.NotOwner.selector);
        checkout.withdraw(buyer, 25e6);
        vm.stopPrank();
    }

    function test_the_owner_withdraws_revenue() public {
        vm.prank(buyer);
        checkout.pay(ORDER, 25e6);
        vm.prank(shop);
        checkout.withdraw(shop, 25e6);
        assertEq(usdc.balanceOf(shop), 25e6);
    }

    function test_fee_on_transfer_tokens_are_refused() public {
        usdc.setFee(100); // 1%
        vm.prank(buyer);
        vm.expectRevert(QusdcCheckout.FeeOnTransferToken.selector);
        checkout.pay(ORDER, 25e6);
    }

    function test_ownership_moves_in_two_steps() public {
        address next = makeAddr("next");
        vm.prank(shop);
        checkout.transferOwnership(next);
        assertEq(checkout.owner(), shop);
        vm.prank(next);
        checkout.acceptOwnership();
        assertEq(checkout.owner(), next);
    }

    function testFuzz_any_amount_within_the_balance_can_be_paid(uint96 amount) public {
        amount = uint96(bound(amount, 1, 100e6));
        vm.prank(buyer);
        checkout.pay(keccak256(abi.encode(amount)), amount);
        assertEq(usdc.balanceOf(address(checkout)), amount);
    }
}
