//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "./interfaces/IMultiRewards.sol";
import "./interfaces/IUniswapV2Pair.sol";
import "./interfaces/IUniswapV2Router.sol";

contract vault is Ownable, ERC4626 {
    address treasury;
    address reward;
    address public multiRewards;
    address token0;
    address token1;
    address public router;
    address public constant weth = address(0);
    address[] route;

    uint public _totalAssets;
    uint public reinvestFee;
    uint public treasuryFee;
    uint public pairFee;

    constructor(
        IERC20 asset,
        string memory name,
        string memory symbol,
        address _reward,
        address _multiRewards,
        address _router
    ) ERC20(name, symbol) ERC4626(asset) {
        multiRewards = _multiRewards;
        router = _router;
        reward = _reward;
        asset.approve(_multiRewards, type(uint).max);
        reinvestFee = 10;
        treasuryFee = 50;
        token0 = IUniswapV2Pair(address(asset)).token0();
        token1 = IUniswapV2Pair(address(asset)).token1();
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

    function totalAssets() public view override returns (uint bal) {
        bal = IMultiRewards(multiRewards).balanceOf(address(this));
    }

    function setRoute(address[] calldata _route) external onlyOwner {
        route = _route;
        IERC20(_route[0]).approve(router, type(uint).max);
    }

    function swapToWeth(address token) internal {
        uint bal = IERC20(token).balanceOf(address(this));
        IUniswapV2Router(router).swapExactTokensForTokens(
            bal,
            0,
            route,
            address(this),
            block.timestamp
        );
    }

    function reinvest() external {
        IMultiRewards(multiRewards).getReward();
        swapToWeth(reward);

        uint bal = IERC20(weth).balanceOf(address(this));
        uint _reinvestFee = (bal * reinvestFee) / 1000;
        uint _treasuryFee = (bal * treasuryFee) / 1000;
        IERC20(weth).transfer(msg.sender, _reinvestFee);
        IERC20(weth).transfer(treasury, _treasuryFee);
        bal -= (_reinvestFee + _treasuryFee);

        (uint swapAmount, uint amountOut) = _calcSwap(bal);
        address pair = asset();
        IERC20(weth).transfer(pair, swapAmount);

        if (weth == token0) {
            IUniswapV2Pair(pair).swap(0, amountOut, address(this), "");
        } else {
            IUniswapV2Pair(pair).swap(amountOut, 0, address(this), "");
        }

        // check actual balances
        uint bal0 = IERC20(token0).balanceOf(address(this));
        uint bal1 = IERC20(token1).balanceOf(address(this));
        IERC20(token0).transfer(pair, bal0);
        IERC20(token1).transfer(pair, bal1);

        uint liquidity = IUniswapV2Pair(pair).mint(address(this));
        IMultiRewards(multiRewards).stake(liquidity);
    }

    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal override {
        SafeERC20.safeTransferFrom(
            IERC20(asset()),
            caller,
            address(this),
            assets
        );
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
        SafeERC20.safeTransfer(IERC20(asset()), receiver, assets);

        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    function _calcSwap(
        uint amountA
    ) internal view returns (uint swapAmount, uint amountOut) {
        // (sqrt(((2 - f)r)^2 + 4(1 - f)ar) - (2 - f)r) / (2(1 - f))
        (uint reserve0, uint reserve1, ) = IUniswapV2Pair(asset())
            .getReserves();
        (reserve0, reserve1) = token0 == weth
            ? (reserve0, reserve1)
            : (reserve1, reserve0);
        uint x = 1997;
        uint y = 3988000;
        uint z = 1994;
        swapAmount =
            (Math.sqrt(reserve0 * (x * x * reserve0 + amountA * y)) -
                reserve0 *
                x) /
            z;
        amountA = (amountA - swapAmount) * 997;
        amountOut =
            (amountA - swapAmount * reserve1) /
            (reserve0 * 1000 + amountA);
    }
}
