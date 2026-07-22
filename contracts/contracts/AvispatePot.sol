// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AvispatePot
 * @notice Pozo por mazo para Avíspate. Cada re-jugada paga una comisión en USDT
 *         (por defecto 0.10): un % va a la wallet de comisión y el resto al pozo
 *         del mazo. Al cierre de cada ronda diaria, el owner (el backend) paga el
 *         pozo completo al ganador (#1) y este se reinicia.
 *
 * Diseño para MVP:
 *  - La 1ª jugada gratis por día NO pasa por aquí: se maneja off-chain vía Privy.
 *    Este contrato solo procesa jugadas PAGAS, cuya prueba on-chain sirve además
 *    de identidad del jugador.
 *  - `settle` confía en que el owner/backend elige al #1 real (lo calcula desde
 *    Supabase). Es un punto de confianza aceptable para el MVP: el owner es el
 *    dueño del juego.
 *  - USDT en Celo es ERC-20 estándar (6 decimales); el jugador debe `approve`
 *    este contrato por `feeAmount` antes de `play`.
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

    uint16 private constant BPS_DENOMINATOR = 10_000;

    event Played(address indexed player, uint8 indexed deck, uint256 toPot, uint256 commission);
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

    /**
     * @notice Paga una jugada del mazo `deck`. Requiere `approve` previo por
     *         `feeAmount`. La comisión va a `commissionWallet` y el resto al pozo.
     */
    function play(uint8 deck) external nonReentrant validDeck(deck) {
        uint256 fee = feeAmount;
        uint256 commission = (fee * commissionBps) / BPS_DENOMINATOR;
        uint256 toPot = fee - commission;

        // Un solo transferFrom del jugador a este contrato; luego repartimos.
        token.safeTransferFrom(msg.sender, address(this), fee);
        if (commission > 0) {
            token.safeTransfer(commissionWallet, commission);
        }
        pot[deck] += toPot;

        emit Played(msg.sender, deck, toPot, commission);
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
