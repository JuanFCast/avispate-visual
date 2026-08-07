const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const USDT = (n) => BigInt(Math.round(n * 1_000_000)); // 6 decimales
const ENTRY = USDT(0.1);
const COMMISSION_BPS = 2000; // 20%
const HOUR = 60 * 60;
const SETTLE_TIMEOUT = 24 * HOUR;
const OPEN_TIMEOUT = 2 * HOUR;

const CLEARED = 0;
const ABANDONED = 1;

const Status = {
  None: 0n,
  Open: 1n,
  Full: 2n,
  Settled: 3n,
  Voided: 4n,
};

const TABLE = ethers.id("AVP-4821|100000|2");

/** El secreto vive en el dispositivo; a la cadena solo va su huella. */
const secretoDe = (quien) => ethers.id(`secreto-de-${quien}`);
const huellaDe = (quien) => ethers.keccak256(secretoDe(quien));
const HUELLA = huellaDe("alice");
const OTRA = ethers.id("AVP-9999|100000|2");

describe("AvispateArena", () => {
  async function deploy() {
    const [owner, commission, operator, alice, bob, carol, extraño] =
      await ethers.getSigners();

    const MockUSDT = await ethers.getContractFactory("MockUSDT");
    const token = await MockUSDT.deploy();

    const Arena = await ethers.getContractFactory("AvispateArena");
    const arena = await Arena.deploy(
      await token.getAddress(),
      commission.address,
      operator.address,
      COMMISSION_BPS,
      SETTLE_TIMEOUT,
      OPEN_TIMEOUT,
      owner.address
    );

    for (const who of [alice, bob, carol]) {
      await token.mint(who.address, USDT(100));
      await token
        .connect(who)
        .approve(await arena.getAddress(), ethers.MaxUint256);
    }

    return { arena, token, owner, commission, operator, alice, bob, carol, extraño };
  }

  /** Mesa de 2 con alice y bob dentro: el punto de partida de casi todo. */
  async function llena() {
    const f = await loadFixture(deploy);
    await f.arena.connect(f.alice).join(TABLE, ENTRY, 2, huellaDe("alice"));
    await f.arena.connect(f.bob).join(TABLE, ENTRY, 2, huellaDe("bob"));
    return f;
  }

  describe("sentarse cuesta, y la silla es de quien pagó", () => {
    it("cobra la entrada y apunta al jugador", async () => {
      const { arena, token, alice } = await loadFixture(deploy);
      const antes = await token.balanceOf(alice.address);

      await expect(arena.connect(alice).join(TABLE, ENTRY, 2, HUELLA))
        .to.emit(arena, "TableOpened")
        .withArgs(TABLE, ENTRY, 2)
        .and.to.emit(arena, "Joined")
        .withArgs(TABLE, alice.address, 1, HUELLA);

      expect(await token.balanceOf(alice.address)).to.equal(antes - ENTRY);
      expect(await arena.paid(TABLE, alice.address)).to.equal(true);
      expect(await arena.playersOf(TABLE)).to.deep.equal([alice.address]);
    });

    it("la mesa se cierra al llenarse y ya no admite a nadie", async () => {
      const { arena, carol } = await llena();
      const t = await arena.tableOf(TABLE);
      expect(t.status).to.equal(Status.Full);
      await expect(
        arena.connect(carol).join(TABLE, ENTRY, 2, HUELLA)
      ).to.be.revertedWithCustomError(arena, "TableNotOpen");
    });

    it("nadie paga dos veces la misma silla", async () => {
      const { arena, alice } = await loadFixture(deploy);
      await arena.connect(alice).join(TABLE, ENTRY, 2, HUELLA);
      await expect(
        arena.connect(alice).join(TABLE, ENTRY, 2, HUELLA)
      ).to.be.revertedWithCustomError(arena, "AlreadyJoined");
    });

    it("los términos de la mesa no se pueden cambiar a mitad", async () => {
      const { arena, alice, bob } = await loadFixture(deploy);
      await arena.connect(alice).join(TABLE, ENTRY, 2, HUELLA);
      await expect(
        arena.connect(bob).join(TABLE, USDT(1), 2, HUELLA)
      ).to.be.revertedWithCustomError(arena, "TermsMismatch");
      await expect(
        arena.connect(bob).join(TABLE, ENTRY, 4, HUELLA)
      ).to.be.revertedWithCustomError(arena, "TermsMismatch");
    });
  });

  describe("la huella de la silla", () => {
    it("queda registrada al pagar y se puede comprobar contra el secreto", async () => {
      const { arena, alice } = await loadFixture(deploy);
      await arena.connect(alice).join(TABLE, ENTRY, 2, huellaDe("alice"));

      const guardada = await arena.seatCommitment(TABLE, alice.address);
      expect(guardada).to.equal(huellaDe("alice"));
      // Quien conoce el secreto puede demostrarlo; quien solo mira la cadena
      // ve la huella y no puede darle la vuelta.
      expect(ethers.keccak256(secretoDe("alice"))).to.equal(guardada);
      expect(ethers.keccak256(secretoDe("ladrón"))).to.not.equal(guardada);
    });

    it("cada silla tiene la suya: la de uno no sirve para la del otro", async () => {
      const { arena, alice, bob } = await llena();
      expect(await arena.seatCommitment(TABLE, alice.address)).to.equal(
        huellaDe("alice")
      );
      expect(await arena.seatCommitment(TABLE, bob.address)).to.equal(
        huellaDe("bob")
      );
      expect(await arena.seatCommitment(TABLE, alice.address)).to.not.equal(
        await arena.seatCommitment(TABLE, bob.address)
      );
    });

    it("sin huella no se puede pagar la entrada: la silla quedaría muda", async () => {
      const { arena, alice } = await loadFixture(deploy);
      await expect(
        arena.connect(alice).join(TABLE, ENTRY, 2, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(arena, "EmptyCommitment");
    });

    it("no se puede reescribir la huella de una silla ya pagada", async () => {
      const { arena, alice } = await loadFixture(deploy);
      await arena.connect(alice).join(TABLE, ENTRY, 2, huellaDe("alice"));
      // Volver a entrar es la única vía para reescribirla, y está cerrada.
      await expect(
        arena.connect(alice).join(TABLE, ENTRY, 2, huellaDe("ladrón"))
      ).to.be.revertedWithCustomError(arena, "AlreadyJoined");
      expect(await arena.seatCommitment(TABLE, alice.address)).to.equal(
        huellaDe("alice")
      );
    });

    it("quien no pagó no tiene huella en esa mesa", async () => {
      const { arena, carol } = await llena();
      expect(await arena.seatCommitment(TABLE, carol.address)).to.equal(
        ethers.ZeroHash
      );
    });
  });

  describe("pagar al ganador", () => {
    it("el ganador cobra el pozo menos la comisión, y las cuentas cuadran", async () => {
      const { arena, token, operator, alice, commission } = await llena();
      const pozo = ENTRY * 2n;
      const comision = (pozo * BigInt(COMMISSION_BPS)) / 10_000n;
      const premio = pozo - comision;

      const antes = await token.balanceOf(alice.address);
      await expect(
        arena.connect(operator).settle(TABLE, alice.address, CLEARED)
      )
        .to.emit(arena, "Settled")
        .withArgs(TABLE, alice.address, premio, comision, CLEARED);

      expect(await token.balanceOf(alice.address)).to.equal(antes + premio);
      expect(await token.balanceOf(commission.address)).to.equal(comision);
      // La mesa queda vacía: ni un céntimo se queda dentro.
      expect(await token.balanceOf(await arena.getAddress())).to.equal(0n);
    });

    it("NO se puede pagar a quien no se sentó en esa mesa", async () => {
      const { arena, operator, carol } = await llena();
      await expect(
        arena.connect(operator).settle(TABLE, carol.address, CLEARED)
      ).to.be.revertedWithCustomError(arena, "WinnerNotInTable");
    });

    it("NO se puede pagar a alguien que pagó OTRA mesa", async () => {
      const { arena, operator, carol } = await llena();
      await arena.connect(carol).join(OTRA, ENTRY, 2, HUELLA);
      await expect(
        arena.connect(operator).settle(TABLE, carol.address, CLEARED)
      ).to.be.revertedWithCustomError(arena, "WinnerNotInTable");
    });

    it("solo el operator o el owner liquidan", async () => {
      const { arena, alice, extraño } = await llena();
      await expect(
        arena.connect(extraño).settle(TABLE, alice.address, CLEARED)
      ).to.be.revertedWithCustomError(arena, "NotOperator");
      await expect(
        arena.connect(alice).settle(TABLE, alice.address, CLEARED)
      ).to.be.revertedWithCustomError(arena, "NotOperator");
    });

    it("una mesa a medio llenar no se puede pagar", async () => {
      const { arena, operator, alice } = await loadFixture(deploy);
      await arena.connect(alice).join(TABLE, ENTRY, 2, HUELLA);
      await expect(
        arena.connect(operator).settle(TABLE, alice.address, CLEARED)
      ).to.be.revertedWithCustomError(arena, "TableNotPlayable");
    });

    it("no se paga dos veces", async () => {
      const { arena, operator, alice } = await llena();
      await arena.connect(operator).settle(TABLE, alice.address, CLEARED);
      await expect(
        arena.connect(operator).settle(TABLE, alice.address, CLEARED)
      ).to.be.revertedWithCustomError(arena, "TableNotPlayable");
    });
  });

  describe("abandonar NO devuelve la entrada", () => {
    it("el que se queda cobra el pozo entero menos comisión", async () => {
      const { arena, token, operator, alice, bob } = await llena();
      const pozo = ENTRY * 2n;
      const premio = pozo - (pozo * BigInt(COMMISSION_BPS)) / 10_000n;

      const antesBob = await token.balanceOf(bob.address);
      const antesAlice = await token.balanceOf(alice.address);

      // Alice se desconecta; el servidor liquida a favor de bob.
      await expect(arena.connect(operator).settle(TABLE, bob.address, ABANDONED))
        .to.emit(arena, "Settled")
        .withArgs(TABLE, bob.address, premio, anyUint(), ABANDONED);

      expect(await token.balanceOf(bob.address)).to.equal(antesBob + premio);
      // Quien abandonó no recupera NADA.
      expect(await token.balanceOf(alice.address)).to.equal(antesAlice);
    });

    it("el que abandonó no puede reclamar devolución después", async () => {
      const { arena, operator, alice, bob } = await llena();
      await arena.connect(operator).settle(TABLE, bob.address, ABANDONED);
      await expect(
        arena.connect(alice).refund(TABLE, alice.address)
      ).to.be.revertedWithCustomError(arena, "NotVoided");
    });

    it("desconectarse y esperar el plazo NO rescata la entrada: ya se liquidó", async () => {
      const { arena, operator, alice, bob } = await llena();
      await arena.connect(operator).settle(TABLE, bob.address, ABANDONED);
      await time.increase(SETTLE_TIMEOUT + HOUR);
      // La válvula no puede reabrir una mesa ya pagada.
      await expect(
        arena.connect(alice).voidByTimeout(TABLE)
      ).to.be.revertedWithCustomError(arena, "TableNotPlayable");
    });
  });

  describe("fallo técnico: la única puerta que devuelve dinero", () => {
    it("anulada por el operator, cada quien recupera su entrada ÍNTEGRA", async () => {
      const { arena, token, operator, alice, bob, commission } = await llena();
      const antes = await token.balanceOf(alice.address);

      await expect(arena.connect(operator).voidTable(TABLE))
        .to.emit(arena, "Voided")
        .withArgs(TABLE, operator.address, false);

      await expect(arena.connect(alice).refund(TABLE, alice.address))
        .to.emit(arena, "Refunded")
        .withArgs(TABLE, alice.address, ENTRY);
      await arena.connect(bob).refund(TABLE, bob.address);

      expect(await token.balanceOf(alice.address)).to.equal(antes + ENTRY);
      // Sin comisión: una partida que no se jugó no deja nada a la casa.
      expect(await token.balanceOf(commission.address)).to.equal(0n);
      expect(await token.balanceOf(await arena.getAddress())).to.equal(0n);
    });

    it("nadie cobra su devolución dos veces", async () => {
      const { arena, operator, alice } = await llena();
      await arena.connect(operator).voidTable(TABLE);
      await arena.connect(alice).refund(TABLE, alice.address);
      await expect(
        arena.connect(alice).refund(TABLE, alice.address)
      ).to.be.revertedWithCustomError(arena, "NothingToRefund");
    });

    it("quien no jugó esa mesa no cobra nada de ella", async () => {
      const { arena, operator, carol } = await llena();
      await arena.connect(operator).voidTable(TABLE);
      await expect(
        arena.connect(carol).refund(TABLE, carol.address)
      ).to.be.revertedWithCustomError(arena, "NothingToRefund");
    });

    it("la devolución la puede EMPUJAR un tercero, y el dinero va al jugador", async () => {
      const { arena, token, operator, alice, extraño } = await llena();
      await arena.connect(operator).voidTable(TABLE);

      const antesAlice = await token.balanceOf(alice.address);
      const antesExtraño = await token.balanceOf(extraño.address);

      // Lo paga el operator (o cualquiera): si la mesa se anuló por un fallo
      // nuestro, el jugador no tiene por qué gastar para recuperar lo suyo.
      await expect(arena.connect(extraño).refund(TABLE, alice.address))
        .to.emit(arena, "Refunded")
        .withArgs(TABLE, alice.address, ENTRY);

      expect(await token.balanceOf(alice.address)).to.equal(antesAlice + ENTRY);
      // Quien empuja no se lleva nada: no hay premio por hacerlo ni riesgo.
      expect(await token.balanceOf(extraño.address)).to.equal(antesExtraño);
    });

    it("una mesa anulada ya no se puede pagar a nadie", async () => {
      const { arena, operator, alice } = await llena();
      await arena.connect(operator).voidTable(TABLE);
      await expect(
        arena.connect(operator).settle(TABLE, alice.address, CLEARED)
      ).to.be.revertedWithCustomError(arena, "TableNotPlayable");
    });
  });

  describe("la válvula: si Avíspate desaparece, el dinero sale igual", () => {
    it("pasado el plazo, CUALQUIERA abre las devoluciones de una mesa sin liquidar", async () => {
      const { arena, token, alice, extraño } = await llena();
      await time.increase(SETTLE_TIMEOUT + 1);

      // Ni operator, ni owner, ni jugador: un desconocido cualquiera.
      await expect(arena.connect(extraño).voidByTimeout(TABLE))
        .to.emit(arena, "Voided")
        .withArgs(TABLE, extraño.address, true);

      const antes = await token.balanceOf(alice.address);
      await arena.connect(alice).refund(TABLE, alice.address);
      expect(await token.balanceOf(alice.address)).to.equal(antes + ENTRY);
    });

    it("antes del plazo la válvula NO abre", async () => {
      const { arena, extraño } = await llena();
      await time.increase(SETTLE_TIMEOUT - HOUR);
      await expect(
        arena.connect(extraño).voidByTimeout(TABLE)
      ).to.be.revertedWithCustomError(arena, "TooEarly");
    });

    it("una mesa que nunca se llenó devuelve con su propio plazo, más corto", async () => {
      const { arena, token, alice } = await loadFixture(deploy);
      await arena.connect(alice).join(TABLE, ENTRY, 2, HUELLA);

      await time.increase(OPEN_TIMEOUT - 60);
      await expect(
        arena.connect(alice).voidByTimeout(TABLE)
      ).to.be.revertedWithCustomError(arena, "TooEarly");

      await time.increase(120);
      await arena.connect(alice).voidByTimeout(TABLE);
      const antes = await token.balanceOf(alice.address);
      await arena.connect(alice).refund(TABLE, alice.address);
      expect(await token.balanceOf(alice.address)).to.equal(antes + ENTRY);
    });

    it("el reloj de la mesa llena empieza al LLENARSE, no al abrirse", async () => {
      const { arena, alice, bob, extraño } = await loadFixture(deploy);
      await arena.connect(alice).join(TABLE, ENTRY, 2, HUELLA);
      await time.increase(OPEN_TIMEOUT + HOUR); // se llenó tarde
      await arena.connect(bob).join(TABLE, ENTRY, 2, HUELLA);

      // El plazo largo se cuenta desde ahora: no hereda la espera del lobby.
      await expect(
        arena.connect(extraño).voidByTimeout(TABLE)
      ).to.be.revertedWithCustomError(arena, "TooEarly");
    });
  });

  describe("mesas de 3 y 4", () => {
    it("una mesa de 3 reparte igual y no se llena antes de tiempo", async () => {
      const { arena, token, operator, alice, bob, carol, commission } =
        await loadFixture(deploy);
      const ID = ethers.id("AVP-3333|100000|3");

      await arena.connect(alice).join(ID, ENTRY, 3, HUELLA);
      await arena.connect(bob).join(ID, ENTRY, 3, HUELLA);
      expect((await arena.tableOf(ID)).status).to.equal(Status.Open);

      await arena.connect(carol).join(ID, ENTRY, 3, HUELLA);
      expect((await arena.tableOf(ID)).status).to.equal(Status.Full);

      const pozo = ENTRY * 3n;
      const comision = (pozo * BigInt(COMMISSION_BPS)) / 10_000n;
      const antes = await token.balanceOf(carol.address);
      await arena.connect(operator).settle(ID, carol.address, CLEARED);

      expect(await token.balanceOf(carol.address)).to.equal(
        antes + pozo - comision
      );
      expect(await token.balanceOf(commission.address)).to.equal(comision);
      expect(await token.balanceOf(await arena.getAddress())).to.equal(0n);
    });

    it("una mesa fuera de 2–4 no existe", async () => {
      const { arena, alice } = await loadFixture(deploy);
      await expect(
        arena.connect(alice).join(TABLE, ENTRY, 1, HUELLA)
      ).to.be.revertedWithCustomError(arena, "InvalidPlayers");
      await expect(
        arena.connect(alice).join(TABLE, ENTRY, 5, HUELLA)
      ).to.be.revertedWithCustomError(arena, "InvalidPlayers");
    });
  });

  describe("el despliegue guarda lo que se le pide", () => {
    // Lo mismo que relee `scripts/deploy-arena.js` justo después de desplegar.
    // Un contrato no se corrige: si algo quedó distinto de lo pedido hay que
    // saberlo antes de que alguien pague una entrada, no después.
    it("token, comisión, operator, plazos y owner quedan como se pasaron", async () => {
      const { arena, token, owner, commission, operator } =
        await loadFixture(deploy);

      expect(await arena.token()).to.equal(await token.getAddress());
      expect(await arena.commissionWallet()).to.equal(commission.address);
      expect(await arena.operator()).to.equal(operator.address);
      expect(await arena.commissionBps()).to.equal(COMMISSION_BPS);
      expect(await arena.settleTimeout()).to.equal(SETTLE_TIMEOUT);
      expect(await arena.openTimeout()).to.equal(OPEN_TIMEOUT);
      expect(await arena.owner()).to.equal(owner.address);
    });

    it("el token es inmutable: no hay forma de cambiarlo después", async () => {
      const { arena } = await loadFixture(deploy);
      // Si algún día apareciera un setter, esta prueba lo delata.
      expect(arena.interface.fragments.some(
        (f) => f.type === "function" && /setToken/i.test(f.name ?? "")
      )).to.equal(false);
    });

    it("el owner es el que se PASA, no quien despliega", async () => {
      const [deployer, commission, operator, futuroDueño] =
        await ethers.getSigners();
      const MockUSDT = await ethers.getContractFactory("MockUSDT");
      const token = await MockUSDT.deploy();
      const Arena = await ethers.getContractFactory("AvispateArena");

      // Firma `deployer`, manda `futuroDueño`. Es el caso que importa: la llave
      // que firma el despliegue depende de la máquina y del apuro, y el dueño
      // de un contrato que custodia dinero ajeno no puede depender de eso.
      const arena = await Arena.connect(deployer).deploy(
        await token.getAddress(),
        commission.address,
        operator.address,
        COMMISSION_BPS,
        SETTLE_TIMEOUT,
        OPEN_TIMEOUT,
        futuroDueño.address
      );

      expect(await arena.owner()).to.equal(futuroDueño.address);
      expect(await arena.owner()).to.not.equal(deployer.address);

      // Y manda de verdad: el que desplegó no puede tocar la configuración.
      await expect(arena.connect(deployer).setCommissionBps(0)).to.be.reverted;
      await arena.connect(futuroDueño).setCommissionBps(1000);
      expect(await arena.commissionBps()).to.equal(1000);
    });

    it("un owner en cero deja el contrato sin dueño: lo rechaza Ownable", async () => {
      const [, commission, operator] = await ethers.getSigners();
      const MockUSDT = await ethers.getContractFactory("MockUSDT");
      const token = await MockUSDT.deploy();
      const Arena = await ethers.getContractFactory("AvispateArena");
      await expect(
        Arena.deploy(
          await token.getAddress(),
          commission.address,
          operator.address,
          COMMISSION_BPS,
          SETTLE_TIMEOUT,
          OPEN_TIMEOUT,
          ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(Arena, "OwnableInvalidOwner");
    });

    it("no acepta una comisión imposible", async () => {
      const [, commission, operator] = await ethers.getSigners();
      const MockUSDT = await ethers.getContractFactory("MockUSDT");
      const token = await MockUSDT.deploy();
      const Arena = await ethers.getContractFactory("AvispateArena");
      await expect(
        Arena.deploy(
          await token.getAddress(),
          commission.address,
          operator.address,
          10_001, // más del 100%
          SETTLE_TIMEOUT,
          OPEN_TIMEOUT,
          operator.address
        )
      ).to.be.revertedWithCustomError(Arena, "InvalidBps");
    });

    it("no acepta direcciones cero donde iría el dinero", async () => {
      const [, , operator] = await ethers.getSigners();
      const MockUSDT = await ethers.getContractFactory("MockUSDT");
      const token = await MockUSDT.deploy();
      const Arena = await ethers.getContractFactory("AvispateArena");
      await expect(
        Arena.deploy(
          await token.getAddress(),
          ethers.ZeroAddress,
          operator.address,
          COMMISSION_BPS,
          SETTLE_TIMEOUT,
          OPEN_TIMEOUT,
          operator.address
        )
      ).to.be.revertedWithCustomError(Arena, "ZeroAddress");
    });
  });

  describe("administración", () => {
    it("los plazos se pueden ajustar sin desplegar otro contrato", async () => {
      const { arena, owner, extraño } = await llena();
      await expect(arena.connect(owner).setTimeouts(HOUR, 600))
        .to.emit(arena, "TimeoutsUpdated")
        .withArgs(HOUR, 600);

      await time.increase(HOUR + 1);
      await arena.connect(extraño).voidByTimeout(TABLE);
      expect((await arena.tableOf(TABLE)).status).to.equal(Status.Voided);
    });

    it("solo el owner toca la configuración", async () => {
      const { arena, extraño } = await loadFixture(deploy);
      await expect(arena.connect(extraño).setTimeouts(1, 1)).to.be.reverted;
      await expect(arena.connect(extraño).setOperator(extraño.address)).to.be
        .reverted;
      await expect(arena.connect(extraño).setCommissionBps(0)).to.be.reverted;
    });
  });
});

/** Cualquier uint: para no repetir la cuenta de la comisión dentro del evento. */
function anyUint() {
  const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
  return anyValue;
}
