const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const USDT = (n) => BigInt(Math.round(n * 1_000_000)); // 6 decimales
const FEE = USDT(0.1); // 0.10 USDT
const COMMISSION_BPS = 2000; // 20%
const DECK_10 = 10;
const DECK_15 = 15;

describe("AvispatePot", () => {
  async function deploy() {
    const [owner, commission, operator, alice, bob] =
      await ethers.getSigners();

    const MockUSDT = await ethers.getContractFactory("MockUSDT");
    const token = await MockUSDT.deploy();

    const AvispatePot = await ethers.getContractFactory("AvispatePot");
    const pot = await AvispatePot.deploy(
      await token.getAddress(),
      commission.address,
      operator.address,
      FEE,
      COMMISSION_BPS,
      owner.address
    );

    for (const who of [owner, alice, bob]) {
      await token.mint(who.address, USDT(100));
      await token
        .connect(who)
        .approve(await pot.getAddress(), ethers.MaxUint256);
    }

    return { pot, token, owner, commission, operator, alice, bob };
  }

  it("reparte 80% al pozo y 20% a la comisión en cada jugada paga", async () => {
    const { pot, token, commission, alice } = await loadFixture(deploy);

    await expect(pot.connect(alice).play(DECK_10))
      .to.emit(pot, "Played")
      .withArgs(alice.address, DECK_10, USDT(0.08), USDT(0.02));

    expect(await pot.pot(DECK_10)).to.equal(USDT(0.08));
    expect(await token.balanceOf(commission.address)).to.equal(USDT(0.02));
  });

  it("acumula el pozo por mazo de forma independiente", async () => {
    const { pot, alice, bob } = await loadFixture(deploy);
    await pot.connect(alice).play(DECK_10);
    await pot.connect(bob).play(DECK_10);
    await pot.connect(alice).play(DECK_15);

    expect(await pot.pot(DECK_10)).to.equal(USDT(0.16));
    expect(await pot.pot(DECK_15)).to.equal(USDT(0.08));
  });

  it("permite sembrar el pozo (permisivo, cualquiera puede añadir)", async () => {
    const { pot, owner } = await loadFixture(deploy);
    await expect(pot.connect(owner).seedPot(DECK_10, USDT(1)))
      .to.emit(pot, "Seeded")
      .withArgs(DECK_10, owner.address, USDT(1));
    expect(await pot.pot(DECK_10)).to.equal(USDT(1));
  });

  it("liquida: paga TODO el pozo al ganador y lo reinicia", async () => {
    const { pot, token, owner, alice, bob } = await loadFixture(deploy);
    await pot.connect(owner).seedPot(DECK_10, USDT(1));
    await pot.connect(alice).play(DECK_10); // +0.08
    await pot.connect(bob).play(DECK_10); // +0.08

    const total = USDT(1) + USDT(0.16);
    const before = await token.balanceOf(alice.address);

    await expect(pot.connect(owner).settle(DECK_10, alice.address))
      .to.emit(pot, "Settled")
      .withArgs(DECK_10, alice.address, total);

    expect(await token.balanceOf(alice.address)).to.equal(before + total);
    expect(await pot.pot(DECK_10)).to.equal(0);
  });

  it("revierte al liquidar un pozo vacío", async () => {
    const { pot, owner, alice } = await loadFixture(deploy);
    await expect(
      pot.connect(owner).settle(DECK_10, alice.address)
    ).to.be.revertedWithCustomError(pot, "EmptyPot");
  });

  it("rechaza mazos inválidos", async () => {
    const { pot, alice } = await loadFixture(deploy);
    await expect(pot.connect(alice).play(7)).to.be.revertedWithCustomError(
      pot,
      "InvalidDeck"
    );
  });

  it("el operator puede liquidar (no solo el owner)", async () => {
    const { pot, owner, operator, alice } = await loadFixture(deploy);
    await pot.connect(owner).seedPot(DECK_10, USDT(1));
    await expect(pot.connect(operator).settle(DECK_10, alice.address))
      .to.emit(pot, "Settled")
      .withArgs(DECK_10, alice.address, USDT(1));
  });

  it("un tercero no puede liquidar ni cambiar config", async () => {
    const { pot, owner, alice } = await loadFixture(deploy);
    await pot.connect(owner).seedPot(DECK_10, USDT(1));
    await expect(
      pot.connect(alice).settle(DECK_10, alice.address)
    ).to.be.revertedWithCustomError(pot, "NotAuthorized");
    await expect(pot.connect(alice).setOperator(alice.address)).to.be.reverted;
    await expect(pot.connect(alice).setFeeAmount(1)).to.be.reverted;
  });

  it("respeta un fee de 0 comisión (todo al pozo)", async () => {
    const { pot, owner, token, commission, alice } = await loadFixture(deploy);
    await pot.connect(owner).setCommissionBps(0);
    await pot.connect(alice).play(DECK_10);
    expect(await pot.pot(DECK_10)).to.equal(FEE);
    expect(await token.balanceOf(commission.address)).to.equal(0);
  });
});
