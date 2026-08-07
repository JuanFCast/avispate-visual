// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AvispateArena
 * @notice Custodia las entradas de una mesa de la Arena y paga al ganador.
 *
 *         Una MESA es una partida privada entre 2, 3 o 4 personas. Cada una
 *         pone la misma entrada en USDT; quien gana se lleva el pozo menos la
 *         comisión de la casa.
 *
 * ── La regla que gobierna el diseño ───────────────────────────────────────
 *
 *         **La silla la da la transacción, no la sesión.** Las sesiones de
 *         Avíspate pueden abrirse canjeando el hash de una jugada (es lo que
 *         permite entrar en MiniPay, donde no se pueden firmar mensajes), y
 *         un hash es público en cuanto se mina. Ese modelo se aceptó porque
 *         una sesión NO mueve dinero. Aquí sí lo hay, así que la propiedad de
 *         la silla vive en este contrato: solo la dirección que pagó figura
 *         como jugador, y ninguna sesión robada puede cambiar eso.
 *
 *         De la misma familia: `settle` la llama el operator, pero el contrato
 *         **comprueba que el ganador sea uno de los que pagaron esa mesa**.
 *         Sin ese cheque, una llave de operator comprometida podría pagarle a
 *         cualquier dirección desde cualquier mesa — que es justo el ataque
 *         que un escrow tiene que hacer imposible, no improbable.
 *
 * ── Abandonar NO es lo mismo que un fallo nuestro ─────────────────────────
 *
 *         Son dos salidas distintas a propósito, porque confundirlas crea un
 *         incentivo perverso: si desconectarse devolviera la entrada, perder
 *         saldría gratis y bastaría con cerrar la pestaña al ver que vas mal.
 *
 *         - **Abandono** → `settle(..., Reason.Abandoned)`. El que se queda
 *           cobra. Quien se fue no recupera nada. Para el contrato es una
 *           partida terminada como cualquier otra; el motivo viaja en el
 *           evento para poder auditarlo después.
 *
 *         - **Partida inválida por fallo técnico** → `void`. Nadie cobra y
 *           cada quien recupera SU entrada, sin comisión. Es la única puerta
 *           que devuelve dinero.
 *
 *         Y para que "fallo técnico" no dependa de que nosotros sigamos vivos,
 *         hay una válvula de tiempo: pasado el plazo sin liquidar, **cualquiera**
 *         puede abrir las devoluciones sin permiso de nadie. Si Avíspate
 *         desaparece, el dinero de la gente no se queda dentro.
 *
 *         Esa válvula no sirve para hacer trampa: el plazo se mide en horas y
 *         un abandono se liquida en segundos, así que quien se desconecte a
 *         propósito habrá perdido mucho antes de que la puerta se abra.
 */
contract AvispateArena is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Token de las entradas y del premio. Inmutable: la mesa no puede
    ///         cambiar de moneda a mitad.
    IERC20 public immutable token;

    /// @notice Quién recibe la comisión de la casa.
    address public commissionWallet;

    /// @notice Bot que liquida las mesas. No puede mover fondos a su antojo:
    ///         solo puede pagar a un jugador que pagó esa misma mesa.
    address public operator;

    /// @notice Comisión sobre el pozo, en puntos básicos. 2000 = 20%.
    uint16 public commissionBps;

    uint16 private constant BPS_DENOMINATOR = 10_000;

    /**
     * @notice Cuánto se espera antes de que cualquiera pueda abrir las
     *         devoluciones de una mesa que se LLENÓ y nunca se liquidó.
     *
     *         Es el seguro contra "Avíspate se cayó con la plata dentro". Se
     *         mide en horas a propósito: una partida dura minutos y se liquida
     *         al terminar, así que llegar aquí significa que algo nuestro falló
     *         de verdad. Ajustable por el owner porque el número correcto solo
     *         se aprende operando.
     */
    uint256 public settleTimeout;

    /**
     * @notice Cuánto se espera antes de devolver la entrada de una mesa que
     *         NUNCA llegó a llenarse.
     *
     *         Aquí no hubo partida ni hay nada que decidir: solo gente que
     *         puso su entrada y se quedó esperando rivales. El plazo existe
     *         únicamente para que nadie se salga con su dinero mientras la
     *         mesa todavía se está llenando y le rompa la partida al resto.
     */
    uint256 public openTimeout;

    enum Status {
        None,
        Open, // Admite jugadores.
        Full, // Completa: la partida puede empezar; ya no entra nadie.
        Settled, // Pagada al ganador.
        Voided // Anulada: cada quien puede retirar su entrada.
    }

    /// @notice Por qué terminó una mesa. Viaja en el evento para poder auditar
    ///         después cuántas acabaron en abandono y cuántas jugadas.
    enum Reason {
        Cleared, // Alguien vació su mazo: ganó jugando.
        Abandoned // Un jugador se fue o no volvió: gana quien se quedó.
    }

    struct Table {
        Status status;
        uint8 maxPlayers;
        uint256 entry;
        /// @dev Cuándo entró el primero. Reloj del plazo de mesa sin llenar.
        uint64 openedAt;
        /// @dev Cuándo se completó. Reloj del plazo de mesa sin liquidar.
        uint64 filledAt;
        address[] players;
    }

    mapping(bytes32 => Table) private tables;
    /// @dev Quién pagó qué mesa. Es la prueba de la silla y la lista blanca de
    ///      ganadores posibles.
    mapping(bytes32 => mapping(address => bool)) public paid;
    /// @dev Entradas ya devueltas, para que nadie cobre su devolución dos veces.
    mapping(bytes32 => mapping(address => bool)) public refunded;

    event TableOpened(bytes32 indexed tableId, uint256 entry, uint8 maxPlayers);
    event Joined(bytes32 indexed tableId, address indexed player, uint8 seats);
    event TableFilled(bytes32 indexed tableId);
    event Settled(
        bytes32 indexed tableId,
        address indexed winner,
        uint256 prize,
        uint256 commission,
        Reason reason
    );
    event Voided(bytes32 indexed tableId, address indexed by, bool byTimeout);
    event Refunded(bytes32 indexed tableId, address indexed player, uint256 amount);
    event OperatorUpdated(address operator);
    event CommissionWalletUpdated(address wallet);
    event CommissionBpsUpdated(uint16 commissionBps);
    event TimeoutsUpdated(uint256 settleTimeout, uint256 openTimeout);

    error ZeroAddress();
    error InvalidBps();
    error InvalidPlayers();
    error InvalidEntry();
    error NotOperator();
    error TableNotOpen();
    error TermsMismatch();
    error AlreadyJoined();
    error TableNotPlayable();
    error WinnerNotInTable();
    error NotVoided();
    error NothingToRefund();
    error TooEarly();

    modifier onlyOperatorOrOwner() {
        if (msg.sender != operator && msg.sender != owner()) revert NotOperator();
        _;
    }

    constructor(
        address token_,
        address commissionWallet_,
        address operator_,
        uint16 commissionBps_,
        uint256 settleTimeout_,
        uint256 openTimeout_
    ) Ownable(msg.sender) {
        if (token_ == address(0) || commissionWallet_ == address(0)) {
            revert ZeroAddress();
        }
        if (commissionBps_ > BPS_DENOMINATOR) revert InvalidBps();
        token = IERC20(token_);
        commissionWallet = commissionWallet_;
        operator = operator_;
        commissionBps = commissionBps_;
        settleTimeout = settleTimeout_;
        openTimeout = openTimeout_;
    }

    /**
     * @notice Sentarse en una mesa pagando la entrada. El primero en llegar
     *         fija los términos; el resto tiene que traer los mismos.
     *
     *         Requiere `approve` previo de este contrato por `entry`.
     *
     * @dev El `tableId` lo calcula el servidor a partir del código de sala Y de
     *      los términos, así que una mesa con otra entrada o con otro número de
     *      jugadores es OTRO identificador. Por eso `TermsMismatch` no puede
     *      usarse para estorbar a nadie: quien invente términos distintos se
     *      queda jugando solo en una mesa que no existe para los demás.
     */
    function join(bytes32 tableId, uint256 entry, uint8 maxPlayers)
        external
        nonReentrant
    {
        if (maxPlayers < 2 || maxPlayers > 4) revert InvalidPlayers();
        if (entry == 0) revert InvalidEntry();

        Table storage t = tables[tableId];

        if (t.status == Status.None) {
            t.status = Status.Open;
            t.entry = entry;
            t.maxPlayers = maxPlayers;
            t.openedAt = uint64(block.timestamp);
            emit TableOpened(tableId, entry, maxPlayers);
        } else if (t.status != Status.Open) {
            revert TableNotOpen();
        }

        if (t.entry != entry || t.maxPlayers != maxPlayers) revert TermsMismatch();
        if (paid[tableId][msg.sender]) revert AlreadyJoined();

        // El dinero entra ANTES de apuntar la silla. Con un token que cobre
        // comisión al transferir esto no cuadraría, pero USDT en Celo no lo
        // hace y el token es inmutable: no puede cambiar bajo nuestros pies.
        token.safeTransferFrom(msg.sender, address(this), entry);

        paid[tableId][msg.sender] = true;
        t.players.push(msg.sender);
        emit Joined(tableId, msg.sender, uint8(t.players.length));

        if (t.players.length == t.maxPlayers) {
            t.status = Status.Full;
            t.filledAt = uint64(block.timestamp);
            emit TableFilled(tableId);
        }
    }

    /**
     * @notice Paga la mesa al ganador. La llama el operator cuando la partida
     *         termina — porque alguien vació su mazo o porque los demás se
     *         fueron.
     *
     *         El contrato no sabe jugar y no pretende saberlo: lo que sí hace,
     *         y es lo que importa, es **negarse a pagar a quien no se sentó en
     *         esta mesa**. Con eso, una llave de operator robada no puede sacar
     *         fondos hacia una dirección cualquiera; como mucho puede elegir mal
     *         entre quienes ya pagaron.
     */
    function settle(bytes32 tableId, address winner, Reason reason)
        external
        onlyOperatorOrOwner
        nonReentrant
    {
        Table storage t = tables[tableId];
        // Solo una mesa COMPLETA se puede pagar: si nunca se llenó, no hubo
        // partida que ganar y el camino correcto es la devolución.
        if (t.status != Status.Full) revert TableNotPlayable();
        if (!paid[tableId][winner]) revert WinnerNotInTable();

        uint256 pot = t.entry * t.players.length;
        uint256 commission = (pot * commissionBps) / BPS_DENOMINATOR;
        uint256 prize = pot - commission;

        t.status = Status.Settled;

        if (commission > 0) token.safeTransfer(commissionWallet, commission);
        token.safeTransfer(winner, prize);

        emit Settled(tableId, winner, prize, commission, reason);
    }

    /**
     * @notice Anula una mesa por fallo técnico: nadie gana y cada quien retira
     *         su entrada, sin comisión.
     *
     *         Es la ÚNICA puerta que devuelve dinero, y existe para los casos
     *         en que no se puede determinar un ganador legítimo ni continuar
     *         —una caída nuestra, la base de datos perdida, la partida colgada
     *         a medias—. Nunca para un abandono: eso se liquida con `settle`.
     */
    function voidTable(bytes32 tableId) external onlyOperatorOrOwner {
        Table storage t = tables[tableId];
        if (t.status != Status.Open && t.status != Status.Full) {
            revert TableNotPlayable();
        }
        t.status = Status.Voided;
        emit Voided(tableId, msg.sender, false);
    }

    /**
     * @notice La válvula contra los fondos atrapados: pasado el plazo,
     *         CUALQUIERA puede anular una mesa que sigue sin liquidar.
     *
     *         No hace falta ser jugador ni tener permiso. Es deliberado: si
     *         Avíspate desaparece, nadie debería necesitar nuestra colaboración
     *         para recuperar lo suyo. Un escrow del que solo nosotros podemos
     *         abrir la puerta no es un escrow, es un depósito de confianza.
     *
     *         No sirve para escaparse de una derrota: el plazo se mide en horas
     *         y un abandono se liquida en segundos.
     */
    function voidByTimeout(bytes32 tableId) external {
        Table storage t = tables[tableId];
        uint256 since;
        if (t.status == Status.Full) {
            since = t.filledAt + settleTimeout;
        } else if (t.status == Status.Open) {
            since = t.openedAt + openTimeout;
        } else {
            revert TableNotPlayable();
        }
        if (block.timestamp < since) revert TooEarly();

        t.status = Status.Voided;
        emit Voided(tableId, msg.sender, true);
    }

    /**
     * @notice Retira tu entrada de una mesa anulada. Íntegra: una partida que
     *         no se pudo jugar no deja comisión.
     */
    function claimRefund(bytes32 tableId) external nonReentrant {
        Table storage t = tables[tableId];
        if (t.status != Status.Voided) revert NotVoided();
        if (!paid[tableId][msg.sender] || refunded[tableId][msg.sender]) {
            revert NothingToRefund();
        }
        refunded[tableId][msg.sender] = true;
        token.safeTransfer(msg.sender, t.entry);
        emit Refunded(tableId, msg.sender, t.entry);
    }

    // ─────────────────────────── Lecturas ────────────────────────────

    function tableOf(bytes32 tableId)
        external
        view
        returns (
            Status status,
            uint256 entry,
            uint8 maxPlayers,
            uint8 seats,
            uint64 openedAt,
            uint64 filledAt
        )
    {
        Table storage t = tables[tableId];
        return (
            t.status,
            t.entry,
            t.maxPlayers,
            uint8(t.players.length),
            t.openedAt,
            t.filledAt
        );
    }

    /// @notice Quiénes pagaron esta mesa. Es la lista que el servidor puede
    ///         creerse para sentar gente, en vez de creerle a una sesión.
    function playersOf(bytes32 tableId) external view returns (address[] memory) {
        return tables[tableId].players;
    }

    // ─────────────────────────── Administración ──────────────────────

    function setOperator(address operator_) external onlyOwner {
        operator = operator_;
        emit OperatorUpdated(operator_);
    }

    function setCommissionWallet(address wallet) external onlyOwner {
        if (wallet == address(0)) revert ZeroAddress();
        commissionWallet = wallet;
        emit CommissionWalletUpdated(wallet);
    }

    function setCommissionBps(uint16 commissionBps_) external onlyOwner {
        if (commissionBps_ > BPS_DENOMINATOR) revert InvalidBps();
        commissionBps = commissionBps_;
        emit CommissionBpsUpdated(commissionBps_);
    }

    /**
     * @notice Ajusta los plazos. Se pueden cambiar a propósito: el número
     *         correcto solo se aprende operando, y descubrirlo no puede
     *         obligar a desplegar otro contrato y mudar las mesas.
     *
     *         Ojo con bajarlos de más: un plazo más corto que una partida
     *         convertiría la válvula en una salida de emergencia para perdedores.
     */
    function setTimeouts(uint256 settleTimeout_, uint256 openTimeout_)
        external
        onlyOwner
    {
        settleTimeout = settleTimeout_;
        openTimeout = openTimeout_;
        emit TimeoutsUpdated(settleTimeout_, openTimeout_);
    }
}
