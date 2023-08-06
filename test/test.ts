import {
  setBalance,
  loadFixture,
  time,
} from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { ERC20, IMockUniswapV2Router, Vault, WETH9 } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

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
    };
  }

  let signer: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let ogre: ERC20;
  let weth: WETH9;
  let router: IMockUniswapV2Router;
  let vault: Vault;
  let pair: ERC20;

  beforeEach("deploy", async function () {
    ({ signer, user, ogre, weth, router, vault, pair } = await loadFixture(
      deploy
    ));
  });

  // not testing these extensively as the logic was not modified from the default OZ impl
  it("should deposit assets with no issues", async function () {
    let bal = await pair.balanceOf(signer.address);
    await expect(vault.deposit(bal, signer.address)).to.not.be.reverted;

    bal = await pair.balanceOf(user.address);
    await expect(vault.connect(user).deposit(bal, user.address)).to.not.be
      .reverted;
  });

  it("should mint shares with no issues", async function () {
    let bal = await pair.balanceOf(signer.address);
    let shares = await vault.previewDeposit(bal);
    await expect(vault.mint(shares, signer.address)).to.not.be.reverted;

    bal = await pair.balanceOf(user.address);
    shares = await vault.previewDeposit(bal);
    await expect(vault.connect(user).mint(shares, user.address)).to.not.be
      .reverted;
  });

  it("should withdraw all assets with no issues", async function () {
    let bal = await pair.balanceOf(signer.address);
    await vault.deposit(bal, signer.address);

    bal = await pair.balanceOf(user.address);
    await vault.connect(user).deposit(bal, user.address);

    let assets = await vault.maxWithdraw(signer.address);
    await expect(vault.withdraw(assets, signer.address, signer.address)).to.not
      .be.reverted;

    assets = await vault.maxWithdraw(user.address);
    await expect(
      vault.connect(user).withdraw(assets, user.address, user.address)
    ).to.not.be.reverted;
  });

  it("should redeem all shares with no issues", async function () {
    let bal = await pair.balanceOf(signer.address);
    let shares = await vault.previewDeposit(bal);
    await vault.mint(shares, signer.address);

    bal = await pair.balanceOf(user.address);
    shares = await vault.previewDeposit(bal);
    await vault.connect(user).mint(shares, user.address);

    bal = await vault.balanceOf(signer.address);
    await expect(vault.redeem(bal, signer.address, signer.address)).to.not.be
      .reverted;

    bal = await vault.balanceOf(user.address);
    await expect(vault.connect(user).redeem(bal, user.address, user.address)).to
      .not.be.reverted;
  });

  it("should not allow users with no balance to withdraw", async function () {
    let bal = await pair.balanceOf(signer.address);
    await vault.deposit(bal, signer.address);

    await expect(vault.connect(user).withdraw(bal, user.address, user.address))
      .to.be.reverted;

    await expect(
      vault.connect(user).withdraw(bal, signer.address, signer.address)
    ).to.be.reverted; // can't withdraw for someone else
  });

  it("should handle reinvest properly", async function () {
    let bal = await pair.balanceOf(signer.address);
    await vault.deposit(bal, signer.address);

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
  });
});
