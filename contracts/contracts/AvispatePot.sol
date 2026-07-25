// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AvispatePot
 * @notice Pozo por mazo para Avíspate. TODA jugada pasa por `play(deck)`: la
 *         primera del día UTC por (mazo, wallet) es GRATIS (no cobra USDT ni
 *         alimenta el pozo, pero cuenta para el ranking); las siguientes pagan
 *         `feeAmount` en USDT: un % va a la wallet de comisión y el resto al
 *         pozo del mazo. Al cierre de cada ronda diaria, el operator paga el
 *         pozo completo al ganador (#1) y este se reinicia.
 *
 * Diseño (v2):
 *  - La jugada gratis vive ON-CHAIN (`lastFreePlayDay`): así funciona igual
 *    para correo (wallet embebida), wallet externa y MiniPay, y el txHash es
 *    la prueba de identidad de TODAS las jugadas, gratis incluidas.
 *  - El "día" es block.timestamp / 1 days (medianoche UTC = 7 p. m. Colombia),
 *    exactamente el mismo corte que usa el backend para `round_date` y el cron
 *    de liquidación. No depende de que el operator llame nada: en mazos sin
 *    ganador el pozo rueda y la gratis igual se renueva a medianoche.
 *  - `settle` confía en que el operator/backend elige al #1 real (lo calcula
 *    desde Supabase). Punto de confianza aceptable: el owner es el dueño del
 *    juego y el operator solo puede pagar, no retirar ni cambiar config.
 *  - USDT en Celo es ERC-20 estándar (6 decimales); para jugadas pagas el
 *    jugador debe `approve` este contrato por al menos `feeAmount`.
 */
contract AvispatePot is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Token de pago (USDT en Celo, 6 decimales).
    IERC20 public immutable token;

    /// @notice Recibe la comisión del dueño.
    address public commissionWallet;

    /// @notice Puede liquidar rondas (el bot backend), sin poder cambiar config.
    address public operator;

    /// @notice Costo de una jugada paga, en unidades del token (0.10 USDT = 100000).
    uint256 public feeAmount;

    /// @notice Comisión en basis points (2000 = 20%).
    uint16 public commissionBps;

    /// @notice Mazos válidos.
    uint8 public constant DECK_10 = 10;
    uint8 public constant DECK_15 = 15;
    uint8 public constant DECK_20 = 20;

    /// @notice Saldo del pozo por mazo (incluye lo sembrado + 80% de las jugadas).
    mapping(uint8 => uint256) public pot;

    /// @notice Último día UTC en que cada wallet usó su jugada gratis del mazo.
    mapping(uint8 => mapping(address => uint256)) public lastFreePlayDay;

    uint16 private constant BPS_DENOMINATOR = 10_000;

    event Played(
        address indexed player,
        uint8 indexed deck,
        uint256 toPot,
        uint256 commission,
        bool wasFree
    );
    event Seeded(uint8 indexed deck, address indexed from, uint256 amount);
    event Settled(uint8 indexed deck, address indexed winner, uint256 amount);
    event CommissionWalletUpdated(address indexed wallet);
    event OperatorUpdated(address indexed operator);
    event FeeAmountUpdated(uint256 feeAmount);
    event CommissionBpsUpdated(uint16 commissionBps);

    error InvalidDeck();
    error ZeroAddress();
    error InvalidBps();
    error EmptyPot();
    error NotAuthorized();

    constructor(
        address token_,
        address commissionWallet_,
        address operator_,
        uint256 feeAmount_,
        uint16 commissionBps_,
        address owner_
    ) Ownable(owner_) {
        if (
            token_ == address(0) ||
            commissionWallet_ == address(0) ||
            operator_ == address(0) ||
            owner_ == address(0)
        ) {
            revert ZeroAddress();
        }
        if (commissionBps_ > BPS_DENOMINATOR) revert InvalidBps();
        token = IERC20(token_);
        commissionWallet = commissionWallet_;
        operator = operator_;
        feeAmount = feeAmount_;
        commissionBps = commissionBps_;
    }

    modifier validDeck(uint8 deck) {
        if (deck != DECK_10 && deck != DECK_15 && deck != DECK_20) revert InvalidDeck();
        _;
    }

    modifier onlyOperatorOrOwner() {
        if (msg.sender != operator && msg.sender != owner()) revert NotAuthorized();
        _;
    }

    /// @notice Día UTC actual: cambia a medianoche UTC (7 p. m. Colombia).
    function currentDay() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    /// @notice ¿La wallet aún tiene su jugada gratis de hoy en este mazo?
    function hasFreePlayToday(uint8 deck, address user)
        external
        view
        validDeck(deck)
        returns (bool)
    {
        return lastFreePlayDay[deck][user] < currentDay();
    }

    /**
     * @notice Juega el mazo `deck`. La primera vez del día UTC por wallet es
     *         gratis: no mueve USDT ni alimenta el pozo (solo deja constancia
     *         para el ranking). Las siguientes cobran `feeAmount` (requiere
     *         `approve` previo): la comisión va a `commissionWallet` y el
     *         resto al pozo.
     * @return wasFree true si esta jugada consumió la gratis del día.
     */
    function play(uint8 deck) external nonReentrant validDeck(deck) returns (bool wasFree) {
        uint256 day = currentDay();
        if (lastFreePlayDay[deck][msg.sender] < day) {
            // Jugada gratis del día: cuenta para el ranking, no toca fondos.
            lastFreePlayDay[deck][msg.sender] = day;
            wasFree = true;
            emit Played(msg.sender, deck, 0, 0, true);
        } else {
            uint256 fee = feeAmount;
            uint256 commission = (fee * commissionBps) / BPS_DENOMINATOR;
            uint256 toPot = fee - commission;

            // Un solo transferFrom del jugador a este contrato; luego repartimos.
            token.safeTransferFrom(msg.sender, address(this), fee);
            if (commission > 0) {
                token.safeTransfer(commissionWallet, commission);
            }
            pot[deck] += toPot;

            emit Played(msg.sender, deck, toPot, commission, false);
        }
    }

    /**
     * @notice Siembra el pozo de un mazo (p. ej. el Funder mete su 1 USDT).
     *         Permisivo: solo puedes AÑADIR fondos. Requiere `approve` previo
     *         de `msg.sender` por `amount`.
     */
    function seedPot(uint8 deck, uint256 amount) external validDeck(deck) {
        token.safeTransferFrom(msg.sender, address(this), amount);
        pot[deck] += amount;
        emit Seeded(deck, msg.sender, amount);
    }

    /**
     * @notice Cierra la ronda de un mazo: paga TODO el pozo al ganador y lo
     *         reinicia. Lo llama el operator (bot) o el owner con el #1
     *         calculado desde Supabase.
     */
    function settle(uint8 deck, address winner)
        external
        onlyOperatorOrOwner
        nonReentrant
        validDeck(deck)
    {
        if (winner == address(0)) revert ZeroAddress();
        uint256 amount = pot[deck];
        if (amount == 0) revert EmptyPot();
        pot[deck] = 0;
        token.safeTransfer(winner, amount);
        emit Settled(deck, winner, amount);
    }

    // --- Administración ---

    function setCommissionWallet(address wallet) external onlyOwner {
        if (wallet == address(0)) revert ZeroAddress();
        commissionWallet = wallet;
        emit CommissionWalletUpdated(wallet);
    }

    function setOperator(address operator_) external onlyOwner {
        if (operator_ == address(0)) revert ZeroAddress();
        operator = operator_;
        emit OperatorUpdated(operator_);
    }

    function setFeeAmount(uint256 feeAmount_) external onlyOwner {
        feeAmount = feeAmount_;
        emit FeeAmountUpdated(feeAmount_);
    }

    function setCommissionBps(uint16 commissionBps_) external onlyOwner {
        if (commissionBps_ > BPS_DENOMINATOR) revert InvalidBps();
        commissionBps = commissionBps_;
        emit CommissionBpsUpdated(commissionBps_);
    }
}
