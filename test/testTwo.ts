import {
  setBalance,
  loadFixture,
  time,
} from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  ERC20,
  IMockUniswapV2Router,
  IMultiRewards,
  Vault,
  WETH9,
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Block } from "ethers";

describe("compounder", function () {
  async function deploy() {
    const signer = (await ethers.getSigners())[0];
    const Vault = await ethers.getContractFactory("vault");
    const vault = (await Vault.deploy("test", "tst")) as Vault;
    await vault.waitForDeployment();

    const route = [
      "0xd07379a755A8f11B57610154861D694b2A0f615a",
      "0x4200000000000000000000000000000000000006",
    ];

    await (await vault.setRoute(route)).wait();
    await (await vault.setTreasury(signer.address)).wait();
    await (await vault.setReinvestOnDeposit(true)).wait();

    const pair = await ethers.getContractAt(
      "ERC20",
      "0xBB2a2D17685C3BC71562A87fA4f66F68999F59c7"
    );
    const ogre = await ethers.getContractAt(
      "ERC20",
      "0xAB8a1c03b8E4e1D21c8Ddd6eDf9e07f26E843492"
    );
    const weth = (await ethers.getContractAt(
      "WETH9",
      "0x4200000000000000000000000000000000000006"
    )) as WETH9;
    const router = (await ethers.getContractAt(
      "IMockUniswapV2Router",
      "0xaaa3b1F1bd7BCc97fD1917c18ADE665C5D31F066"
    )) as IMockUniswapV2Router;

    const user = await ethers.getImpersonatedSigner(
      "0xCF2C2fdc9A5A6fa2fc237DC3f5D14dd9b49F66A3"
    );

    const rewarder = await ethers.getContractAt(
      "IMultiRewards",
      "0x5240C435e402f995dde9aff97438Dc48f88A0624"
    );

    await setBalance(signer.address, ethers.parseEther("1000"));
    await setBalance(user.address, ethers.parseEther("1000"));

    await (
      await ogre.approve(await router.getAddress(), ethers.MaxUint256)
    ).wait();

    await (
      await ogre
        .connect(user)
        .approve(await router.getAddress(), ethers.MaxUint256)
    ).wait();

    await (
      await weth.approve(await router.getAddress(), ethers.MaxUint256)
    ).wait();

    await (
      await weth
        .connect(user)
        .approve(await router.getAddress(), ethers.MaxUint256)
    ).wait();

    await (
      await pair.approve(await vault.getAddress(), ethers.MaxUint256)
    ).wait();

    await (
      await pair
        .connect(user)
        .approve(await vault.getAddress(), ethers.MaxUint256)
    ).wait();

    const ogrePath = [await weth.getAddress(), await ogre.getAddress()];

    await (await weth.deposit({ value: ethers.parseEther("10") })).wait();

    // lp ogre
    await router.swapExactTokensForTokens(
      ethers.parseEther("0.05"),
      0,
      ogrePath,
      signer.address,
      (await time.latest()) + 60
    );
    let bal = await ogre.balanceOf(signer.address);
    await router.addLiquidity(
      await weth.getAddress(),
      await ogre.getAddress(),
      ethers.parseEther("0.05"),
      bal,
      0,
      0,
      signer.address,
      (await time.latest()) + 60
    );

    await (
      await weth.connect(user).deposit({ value: ethers.parseEther("10") })
    ).wait();

    await router
      .connect(user)
      .swapExactTokensForTokens(
        ethers.parseEther("0.05"),
        0,
        ogrePath,
        user.address,
        (await time.latest()) + 60
      );
    bal = await ogre.balanceOf(user.address);
    await router
      .connect(user)
      .addLiquidity(
        await weth.getAddress(),
        await ogre.getAddress(),
        ethers.parseEther("0.05"),
        bal,
        0,
        0,
        user.address,
        (await time.latest()) + 60
      );

    return {
      signer,
      user,
      ogre,
      weth,
      router,
      vault,
      pair,
      rewarder,
      route,
    };
  }

  let signer: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let ogre: ERC20;
  let weth: WETH9;
  let router: IMockUniswapV2Router;
  let vault: Vault;
  let pair: ERC20;
  let rewarder: IMultiRewards;
  let route: string[];

  before("deploy", async function () {
    ({ signer, user, ogre, weth, router, vault, pair, rewarder, route } =
      await loadFixture(deploy));
  });

  it("should deposit assets with no issues", async function () {
    let bal = await pair.balanceOf(signer.address);
    await expect(vault.deposit(bal, signer.address)).to.not.be.reverted;
  });

  it("should return pending rewards", async function () {
    await time.increase(3600);
    let earned = await rewarder.earned(vault.getAddress());
    let pending = (await router.getAmountsOut(earned, route)).slice(-1)[0];

    pending -= (pending * 60n) / 1000n;

    expect(pending).eq(await vault.pendingRewards()); // possible diff due to rounding
  });

  it("should handle reinvest properly", async function () {
    let earned = await rewarder.earned(await vault.getAddress());
    let pending = (await router.getAmountsOut(earned, route)).slice(-1)[0];
    let treasuryShare = (pending * 50n) / 1000n;
    let harvesterShare = (pending * 10n) / 1000n;
    // account for slippage/price impact from swap
    treasuryShare = (treasuryShare * 99n) / 100n;
    harvesterShare = (harvesterShare * 99n) / 100n;

    let treasuryBal = await weth.balanceOf(signer.address);
    let userBal = await weth.balanceOf(user.address);
    let totalAssets = await vault.totalAssets();
    await expect(vault.connect(user).reinvest(user.address)).to.not.be.reverted;
    let newTreasuryBal = await weth.balanceOf(signer.address);
    let newUserBal = await weth.balanceOf(user.address);
    let newTotalAssets = await vault.totalAssets();

    expect(newTreasuryBal).greaterThan(treasuryBal);
    expect(newUserBal).greaterThan(userBal);
    expect(newTotalAssets).greaterThan(totalAssets);
    expect(newTreasuryBal - treasuryBal).greaterThanOrEqual(treasuryShare);
    expect(newUserBal - userBal).greaterThanOrEqual(harvesterShare);
  });

  // not testing extensively as it's the default OZ implementation
  it("should have no issues with new deposits", async function () {
    let bal = await pair.balanceOf(user.address);
    let estimatedShares = await vault.previewDeposit(bal);
    await expect(vault.connect(user).deposit(bal, user.address)).to.not.be
      .reverted;

    let shares = await vault.previewWithdraw(
      await vault.balanceOf(user.address)
    );
    expect(shares).greaterThanOrEqual(estimatedShares);
  });

  it("should increase price per share after reinvest", async function () {
    let priceBefore = await vault.convertToAssets(ethers.parseEther("1"));
    await time.increase(3600); // increase time to build more rewards
    await vault.reinvest(signer.address);
    let priceAfter = await vault.convertToAssets(ethers.parseEther("1"));
    expect(priceAfter).greaterThan(priceBefore);
  });

  it("should not have any issues when vault is drained", async function () {
    // using redeem to estimate assets from shares
    let userOneBal = await vault.balanceOf(signer.address);
    let userTwoBal = await vault.balanceOf(user.address);

    let userOneAssets = await vault.previewRedeem(userOneBal);
    let userTwoAssets = await vault.previewRedeem(userTwoBal);
    let pairBalBeforeOne = await pair.balanceOf(signer.address);
    let pairBalBeforeTwo = await pair.balanceOf(user.address);

    // possibility for rounding errors or share price impact irl in the event vault gets drained.
    // not accounting for that
    // do one last reinvest
    await vault.reinvest(signer.address);
    await vault.redeem(userOneBal, signer.address, signer.address);
    await vault.connect(user).redeem(userTwoBal, user.address, user.address);

    let pairBalOne = (await pair.balanceOf(signer.address)) - pairBalBeforeOne;
    let pairBalTwo = (await pair.balanceOf(user.address)) - pairBalBeforeTwo;

    expect(pairBalOne).greaterThanOrEqual(userOneAssets);
    expect(pairBalTwo).greaterThanOrEqual(userTwoAssets);
    expect(await rewarder.balanceOf(await vault.getAddress())).eq(0n);
    expect(await vault.totalAssets()).eq(0);
    expect(await vault.totalSupply()).eq(0);
  });

  it("should not lose any value on deposit", async function () {
    // there are multiple factors here
    // first deposit (or when vault balance is low) usually loses value due to the virtual offset
    // underlying deposit fees reduce value
    // a ~5% loss in some situations is not unexpected

    let bal = await pair.balanceOf(signer.address);
    await vault.deposit(bal, signer.address);
    let shares = await vault.balanceOf(signer.address);
    let assets = await vault.previewRedeem(shares);
    expect(assets).greaterThanOrEqual((bal * 99n) / 100n);
  });
});
