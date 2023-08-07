//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "./interfaces/IMultiRewards.sol";
import "./interfaces/IUniswapV2Pair.sol";
import "./interfaces/IUniswapV2Router.sol";

/// @notice all values are hardcoded and made specifically for swapBased dex
contract vault is Ownable, ERC4626 {
    IERC20 constant __asset =
        IERC20(0xBB2a2D17685C3BC71562A87fA4f66F68999F59c7);
    address public treasury;
    address public constant reward = 0xd07379a755A8f11B57610154861D694b2A0f615a;
    address public constant multiRewards =
        0x5240C435e402f995dde9aff97438Dc48f88A0624;
    address public constant ogre = 0xAB8a1c03b8E4e1D21c8Ddd6eDf9e07f26E843492;
    address public constant router = 0xaaa3b1F1bd7BCc97fD1917c18ADE665C5D31F066;
    address public constant weth = 0x4200000000000000000000000000000000000006;
    address[] route;

    uint public _totalAssets;
    uint public reinvestFee;
    uint public treasuryFee;

    bool public reinvestOnDeposit;

    event Reinvest(address indexed caller, uint bounty, uint fee);

    modifier checkOnDeposit() {
        if (reinvestOnDeposit) {
            reinvest(address(0));
        }
        _;
    }

    constructor(
        string memory name,
        string memory symbol
    ) ERC20(name, symbol) ERC4626(__asset) {
        __asset.approve(multiRewards, type(uint).max);
        reinvestFee = 10;
        treasuryFee = 50;
    }

    function reinvest(address to) public {
        IMultiRewards(multiRewards).getReward();
        swapToWeth(reward);

        uint bal = IERC20(weth).balanceOf(address(this));
        if (bal > 0 && totalSupply() > 0) {
            uint _reinvestFee = to == address(0)
                ? 0
                : (bal * reinvestFee) / 1000;
            uint _treasuryFee = (bal * treasuryFee) / 1000;

            if (_reinvestFee > 0) {
                IERC20(weth).transfer(to, _reinvestFee);
            }

            IERC20(weth).transfer(treasury, _treasuryFee);
            bal -= (_reinvestFee + _treasuryFee);
            (uint swapAmount, uint amountOut) = _calcSwap(bal);
            address pair = address(__asset);
            IERC20(weth).transfer(pair, swapAmount);

            // weth is token0
            IUniswapV2Pair(pair).swap(0, amountOut, address(this), "");

            // check actual balances
            uint bal0 = IERC20(weth).balanceOf(address(this));
            uint bal1 = IERC20(ogre).balanceOf(address(this));
            IERC20(weth).transfer(pair, bal0);
            IERC20(ogre).transfer(pair, bal1);

            uint liquidity = IUniswapV2Pair(pair).mint(address(this));
            IMultiRewards(multiRewards).stake(liquidity);
            emit Reinvest(msg.sender, _reinvestFee, _treasuryFee);
        }
    }

    /// @notice swaps farm token balance to weth
    function swapToWeth(address token) internal {
        uint bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) {
            IUniswapV2Router(router).swapExactTokensForTokens(
                bal,
                0,
                route,
                address(this),
                block.timestamp
            );
        }
    }

    function _calcSwap(
        uint amountA
    ) internal view returns (uint swapAmount, uint amountOut) {
        // (sqrt(((2 - f)r)^2 + 4(1 - f)ar) - (2 - f)r) / (2(1 - f))
        (uint reserve0, uint reserve1, ) = IUniswapV2Pair(asset())
            .getReserves(); // not sorting as we know weth is token0
        uint x = 1997;
        uint y = 3988000;
        uint z = 1994;
        swapAmount =
            (Math.sqrt(reserve0 * (x * x * reserve0 + amountA * y)) -
                reserve0 *
                x) /
            z;
        amountA -= swapAmount;
        amountOut = (amountA * 997 * reserve1) / (reserve0 * 1000 + amountA);
    }

    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal override checkOnDeposit {
        SafeERC20.safeTransferFrom(__asset, caller, address(this), assets);
        IMultiRewards(multiRewards).stake(assets);
        _mint(receiver, shares);
        emit Deposit(caller, receiver, assets, shares);
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override {
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }

        _burn(owner, shares);
        IMultiRewards(multiRewards).withdraw(assets);
        SafeERC20.safeTransfer(__asset, receiver, assets);

        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    function pendingRewards() external view returns (uint pending) {
        pending = IMultiRewards(multiRewards).earned(address(this));
        if (pending > 0) {
            pending = IUniswapV2Router(router).getAmountsOut(pending, route)[
                route.length - 1
            ];
            pending -= (pending * (reinvestFee + treasuryFee)) / 1000;
        }
    }

    function setReinvestOnDeposit(bool _reinvest) external onlyOwner {
        reinvestOnDeposit = _reinvest;
    }

    function setReinvestFee(uint fee) external onlyOwner {
        reinvestFee = fee;
    }

    function setTreasuryFee(uint fee) external onlyOwner {
        treasuryFee = fee;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function getRoute() external view returns (address[] memory _route) {
        _route = route;
    }

    function totalAssets() public view override returns (uint bal) {
        bal = IMultiRewards(multiRewards).balanceOf(address(this));
    }

    /// @notice set route from farm token to weth.
    function setRoute(address[] calldata _route) external onlyOwner {
        route = _route;
        IERC20(_route[0]).approve(router, type(uint).max);
    }
}
