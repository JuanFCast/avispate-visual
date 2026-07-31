/**
 * Todos los textos visibles de Avíspate, en inglés y español.
 *
 * El inglés es la base: `en` define las claves y `es` está obligado por el tipo
 * a traducirlas todas, así que una clave nueva sin traducir no compila. El
 * idioma por defecto es el inglés porque la base de usuarios de MiniPay lo es;
 * el español entra solo cuando el dispositivo lo pide.
 *
 * Los textos con negrita o enlaces en medio se parten en varias claves
 * (`.a`, `.strong`, `.b`) en lugar de meter HTML aquí.
 *
 * Interpolación: `{nombre}` se reemplaza con lo que pase el llamador.
 */

export const en = {
  /* ------------------------------- Comunes ------------------------------- */
  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.retry": "Try again",
  "common.loading": "Loading…",
  "common.continue": "Continue",
  "common.next": "Next",
  "common.done": "Done",
  "common.free": "free",
  "common.back_to_profile": "← Back to profile",
  "common.view_ranking": "View ranking",
  "common.live_stats": "Live stats",

  /* ------------------------------- Metadata ------------------------------ */
  "meta.home.title": "Avíspate",
  "meta.home.description":
    "Avíspate! Find the symbol two cards have in common and burn through your deck at full speed.",
  "meta.stats.title": "Live stats · Avíspate",
  "meta.stats.description":
    "How many people play Avíspate, how fast, how much is paid out in prizes and what happens on-chain. Public data, no sign-in.",
  "meta.history.title": "Winners history · Avíspate",
  "meta.history.description":
    "Who won each Avíspate round, how much they took home and how the payout went.",
  "meta.arena.title": "Multiplayer arena · Avíspate",
  "meta.arena.description":
    "Play Avíspate live against other people and win the pot. Entries of 0.10, 0.50 and 1 USDT. Coming soon.",
  "meta.terms.title": "Terms · Avíspate",
  "meta.privacy.title": "Privacy · Avíspate",

  /* ------------------------------ Navegación ----------------------------- */
  "nav.aria": "Main navigation",
  "nav.play": "Play",
  "nav.history": "History",
  "nav.profile": "Profile",

  /* -------------------------------- Sonido ------------------------------- */
  "sound.unmute": "Unmute",
  "sound.mute": "Mute",

  /* -------------------------------- Idioma ------------------------------- */
  "lang.aria": "Language",
  "lang.en": "English",
  "lang.es": "Español",

  /* -------------------------------- Partida ------------------------------ */
  "game.slot.base": "Base",
  "game.slot.mine": "Your card",
  "game.stat.time": "time",
  "game.stat.cards": "cards",
  "game.stat.errors": "misses",
  "game.hud.round": "Round {current} of {total}",

  /* ------------------------- Errores del flujo de pago ------------------- */
  "pay.error.rejected": "You cancelled the signature for this game.",
  "pay.error.insufficient":
    "Not enough USDT (or gas) for this game.",
  "pay.error.not_configured":
    "The game isn't available yet (contract not configured).",
  "pay.error.no_wallet": "Connect a wallet or sign in with your email.",
  "pay.error.generic": "We couldn't register the game. Try again.",
  "pay.error.unavailable":
    "The game isn't available yet (contract not configured, or no wallet connected).",
  "pay.register.retry":
    "Your payment went through, but we couldn't tell the server. It's saved on this device and will be sent on its own: check your connection and open the app again. Do not pay again.",
  "pay.register.rejected":
    "The server didn't accept this game. Write to soporte@avispate.fun with the time and your wallet and we'll look into it.",

  /* ----------------------- Pasos del botón de jugar ---------------------- */
  "stage.switching": "Switching to Celo…",
  "stage.confirm": "Confirm in your wallet…",
  "stage.approving": "Approving USDT…",
  "stage.confirming": "Confirming on Celo…",
  "stage.registering": "Registering game…",
  "stage.starting": "Setting up…",

  /* --------------------------------- Lobby ------------------------------- */
  "lobby.aria": "Daily challenge",
  "lobby.tag": "PLAY SOLO",
  "lobby.title": "Daily challenge",
  "lobby.support":
    "Find the matches and burn your deck. The fastest average time per card wins today's prize.",
  "lobby.prize.label": "Today's prize",
  "lobby.prize.preparing": "Prize on the way",
  "lobby.addcash": "Top up USDT",
  "lobby.howto": "See how to play",
  "deck.label": "Cards in the deck",

  "cta.checking.support": "Checking your entry…",
  "cta.checking.label": "Getting ready…",
  "cta.free.support": "Your free game on this deck is ready today.",
  "cta.free.label": "Play free",
  "cta.paid.support": "Entry 0.10 USDT · 80% goes to the prize.",
  "cta.paid.label": "Play for 0.10 USDT",
  "cta.alias.support": "Pick your alias to save your score.",
  "cta.alias.label": "Continue",
  "cta.login.support": "Sign in to check your free game.",
  "cta.login.label": "Start",
  "cta.paying.free": "This game is free. Just confirm in your wallet.",
  "cta.paying.paid": "Confirm the 0.10 USDT payment in your wallet.",

  /* --------------------------- Arena multijugador ------------------------ */
  "arena.aria": "Multiplayer arena",
  "arena.tag": "SOON",
  "arena.title": "Multiplayer arena",
  "arena.support": "Play live and win the pot",
  "arena.entries.label": "Entries",
  "arena.cta": "Enter Arena",
  "arena.soon.title": "We're building the Arena",
  "arena.soon.text":
    "Soon you'll be able to sit at a table with 2 to 4 players, all racing through the same deck at the same time: the fastest one takes the pot. Nothing to pay here yet.",
  "arena.soon.entries": "The entries we're preparing:",
  "arena.soon.back": "← Back to the daily challenge",

  /* ------------------------------ Top 3 lobby ---------------------------- */
  "top3.title": "Today's sharpest",
  "top3.error": "We couldn't load today's top.",
  "top3.empty": "No scores yet. Be the first!",
  "top3.you": "YOU",
  "top3.err": "err",
  "top3.total": "total",
  "top3.avg": "average per card",
  "top3.you_label": "· You",
  "top3.full": "See full ranking",

  /* ----------------------------- Modal de acceso ------------------------- */
  "access.title": "Save your score and compete",
  "access.text":
    "You need to sign in with email or a wallet to save your time, show up in the ranking and receive prizes.",
  "access.email": "Continue with email",
  "access.wallet": "I already have a wallet",
  "access.wallet_connect": "Connect wallet",
  "access.wallet_title": "View or change wallet",
  "access.or": "or",
  "access.alias_title": "Pick your alias",
  "access.checking": "Checking your profile…",

  /* --------------------------------- Alias ------------------------------- */
  "alias.create": "Create your alias",
  "alias.placeholder": "e.g. Vale",
  "alias.saving": "Saving…",
  "alias.save": "Save and continue",
  "alias.hint":
    "This is how you'll show up in the ranking. It's unique and you pick it once; you can change it later from your profile. 🐝",
  "alias.your": "Your alias",
  "alias.field": "Alias",
  "alias.checking": "Checking…",
  "alias.wallet_hint.a": "Wallet connected:",
  "alias.wallet_hint.b":
    ". Pick your ranking alias. You get one free game per deck per day; extra ones cost 0.10 USDT.",
  "alias.error.invalid": "Invalid alias.",
  "alias.error.too_short": "That alias is too short (minimum {min}).",
  "alias.error.too_long": "That alias is too long (maximum {max}).",
  "alias.error.charset":
    "Only letters, numbers, spaces, hyphens and underscores.",
  "alias.error.taken_try": "That alias is taken, try another one.",
  "alias.error.taken_pick": "That alias is taken, pick another one.",
  "alias.error.save_failed": "We couldn't save your alias.",
  "alias.error.save_failed_short": "We couldn't save it.",

  /* ------------------------------- Resultados ---------------------------- */
  "results.record": "🔥 New personal best, {name}!",
  "results.total_time": "Total time",
  "results.avg_card": "Avg. per card",
  "results.cards": "Cards",
  "results.errors": "Misses",
  "results.accuracy": "Accuracy",
  "results.best_avg": "Best avg.",
  "results.play_again": "Play again",
  "results.back": "Back to menu",

  /* ------------------------------ Cómo se juega -------------------------- */
  "howto.aria": "How to play",
  "howto.skip": "Skip",
  "howto.progress": "Step {n} of 4",
  "howto.kicker": "STEP {n} OF 4",
  "howto.s1.title": "Two cards. One matching symbol.",
  "howto.s1.text":
    "The Base and Your card always share exactly one symbol. Find it before your eyes wander.",
  "howto.s1.aria": "Two example cards that share the apple",
  "howto.s2.title": "Find the matching symbol",
  "howto.s2.text": "Look at the Base and tap it on Your card.",
  "howto.s2.base_aria": "Base card: it's the reference and can't be tapped",
  "howto.s2.mine_aria": "Your card: tap the symbol that's also on the Base",
  "howto.s2.hint": "Look for the apple from up top down here too.",
  "howto.s2.right": "That's it! The apple.",
  "howto.s2.wrong": "Not that one. Find the one that's also on the Base.",
  "howto.s3.title": "Your card becomes the Base",
  "howto.s3.text":
    "The old one leaves, yours moves up and another arrives from the deck. Now you're after a new symbol.",
  "howto.s3.aria":
    "The Base leaves, Your card becomes the new Base and a card comes in from the deck",
  "howto.s4.title": "Now go on — avíspate!",
  "howto.s4.text":
    "Burn the whole deck in the least time. Every miss adds 1 second and the ranking compares your average time per card.",
  "howto.s4.chip1": "🃏 10, 15 or 20 cards",
  "howto.s4.chip2": "👆 Don't tap the Base",
  "howto.s4.chip3": "⏱️ +1 s per miss",
  "howto.s4.note":
    "The terms for the free game and the prize are on the home screen.",
  "howto.show": "Show me",
  "howto.again": "Watch again",
  "howto.play": "Let's play!",

  /* --------------------------------- Perfil ------------------------------ */
  "profile.eyebrow": "Your profile",
  "profile.title": "Your profile",
  "profile.no_alias": "No alias",
  "profile.edit_alias": "Edit alias",
  "profile.new_alias": "New alias",
  "profile.save_alias": "Save alias",
  "profile.guard.text":
    "Sign in with your email or connect your wallet to see your profile.",
  "profile.guard.cta": "Go to the home screen",
  "profile.creating_wallet": "Creating your wallet…",
  "profile.link.support": "Help and support",
  "profile.link.logout": "Log out",
  "profile.links.hint": "Log out to switch accounts.",
  "profile.legal.terms": "Terms",
  "profile.legal.privacy": "Privacy",
  "profile.stats.aria": "Statistics",
  "profile.stats.games": "Games",
  "profile.stats.wins": "Wins",
  "profile.stats.total_won": "Total won",

  /* --------------------------------- Premios ----------------------------- */
  "prizes.title": "Your prizes",
  "prizes.note":
    "Prizes are sent automatically to your wallet every day at 7:00 p.m. (Colombia).",
  "prizes.empty": "No wins yet. Keep playing to take the pot!",
  "prizes.deck": "Deck {deck}",
  "prizes.view_aria": "View the prize transaction",
  "prizes.paid": "Paid",
  "prizes.more": "See full history",

  /* -------------------------------- Cartera ------------------------------ */
  "wallet.title": "Wallet",
  "wallet.note":
    "Your wallet on the Celo network. This address works as your account number for receiving CELO and USDT.",
  "wallet.hide": "Hide",
  "wallet.show": "Show full",
  "wallet.hide_aria": "Hide the full address",
  "wallet.show_aria": "Show the full address",
  "wallet.copy": "Copy address",
  "wallet.copied": "Address copied ✓",
  "wallet.copy_aria": "Copy wallet address",

  /* --------------------------------- Tokens ------------------------------ */
  "tokens.aria": "Balances",
  "tokens.add": "Add",
  "tokens.send": "Send",
  "tokens.soon": "Coming soon",
  "tokens.loading_aria": "Loading balance",
  "tokens.error": "— error",
  "token.celo.desc": "Used to pay the network fees.",
  "token.usdt.desc": "For paid games and receiving prizes.",
  "token.copm.desc":
    "Colombian digital peso on Celo. Not used for games yet: entries are charged in USDT.",

  /* ----------------------------- Agregar dinero -------------------------- */
  "fund.title": "Add {symbol}",
  "fund.minipay.text":
    "MiniPay tops up your wallet with its own screen, without leaving the app.",
  "fund.minipay.cta": "Add money in MiniPay",
  "fund.intro":
    "Three ways to get {symbol} on the Celo network. Pick whichever suits you.",
  "fund.opt1.title": "Receive at your address",
  "fund.opt1.hint.a": "If you already have {symbol} somewhere else, send it here.",
  "fund.opt1.hint.strong": "Celo network only",
  "fund.opt1.hint.b": ": sending it over another network loses the money.",
  "fund.copy": "Copy my address",
  "fund.opt2.title": "Bring it from Ethereum",
  "fund.opt2.hint": "If your {symbol} is on Ethereum, a bridge moves it to Celo.",
  "fund.opt2.link": "Open the bridge (Squid) ↗",
  "fund.opt3.title": "Swap inside Celo",
  "fund.opt3.hint":
    "If you already have another token on Celo, swap it for {symbol}.",
  "fund.opt3.link": "Open the swap (Uniswap) ↗",
  "fund.foot":
    "The bridge and the swap are third-party services: Avíspate doesn't touch that money and charges nothing there.",

  /* -------------------------------- Enviar ------------------------------- */
  "send.title": "Send {symbol}",
  "send.done": "Sent ✓",
  "send.done_text": "Your {symbol} is on its way to {to}.",
  "send.tx_link": "View the transaction on Celoscan ↗",
  "send.available": "Available",
  "send.to_label": "Destination address",
  "send.invalid_addr": "That address isn't valid.",
  "send.self": "That's your own address.",
  "send.network_note.strong": "Celo network only.",
  "send.network_note.rest":
    "If that address belongs to another network, the money is lost and nobody can return it.",
  "send.amount": "Amount",
  "send.max": "Max",
  "send.over": "That's more than you have.",
  "send.gas_note":
    "The network fee is being paid in USDT, so “Max” leaves a little balance to cover it.",
  "send.cta": "Send {symbol}",
  "send.sending": "Sending…",
  "send.confirm_note": "Confirm in your wallet. Don't close this window.",
  "send.error.rejected": "You cancelled the signature in your wallet.",
  "send.error.insufficient":
    "Not enough balance for that amount plus the network fee.",
  "send.error.chain":
    "Your wallet isn't on the Celo network. Switch it and try again.",
  "send.error.generic": "We couldn't send it. Check the amount and try again.",

  /* -------------------------------- Ranking ------------------------------ */
  "ranking.title": "Ranking",
  "lb.tabs_aria": "Deck size",
  "lb.cards": "{n} cards",
  "lb.pot_label": "🏆 Today's prize · #1 takes it all",
  "lb.title": "Today's ranking · deck {deck}",
  "lb.loading": "Loading ranking…",
  "lb.error": "We couldn't load the ranking.",
  "lb.empty": "No scores today yet. Be the first and take the pot!",
  "lb.no_wallet": "no wallet",
  "lb.err": "err",
  "lb.total": "total",

  /* ------------------------------ Reloj de ronda ------------------------- */
  "round.error": "We couldn't refresh the round",
  "round.loading": "Closes in …",
  "round.closes_in": "Closes in {time}",

  /* -------------------------------- Historial ---------------------------- */
  "history.title": "Winners history",
  "history.lead":
    "Each round closes at 7:00 p.m. (Colombia) and the #1 of each deck takes the pot.",
  "history.link.ranking": "See today's ranking",
  "hist.error": "We couldn't load the winners.",
  "hist.empty": "No winners yet. The first one shows up when a round closes.",
  "hist.deck": "Deck {deck}",
  "hist.payout.paid": "Prize paid",
  "hist.payout.pending": "Payment processing",
  "hist.payout.rollover": "Prize rolled over",
  "hist.winner": "WINNER",
  "hist.no_winner": "NO WINNER",
  "hist.nobody": "Nobody played this round",
  "hist.time": "Time: {time} per card",
  "hist.err": "err",
  "hist.tx": "View the payout on Celoscan ↗",
  "hist.more": "Load more",
  "hist.loading": "Loading…",

  /* ------------------------------ Estadísticas --------------------------- */
  "stats.title": "Live stats",
  "stats.lead":
    "Everything happening in Avíspate, in public numbers that update on their own.",
  "stats.error": "We couldn't load the stats.",
  "stats.today": "Today's round",
  "stats.updating": "Updating…",
  "stats.live": "Live",
  "stats.today.players": "Players",
  "stats.today.players_hint": "distinct, in this round",
  "stats.today.plays": "Games",
  "stats.today.plays_hint": "{paid} paid · {free} free",
  "stats.today.new": "New players",
  "stats.today.new_hint": "signed up today",
  "stats.today.pot": "Pot in play",
  "stats.today.pot_hint": "the three decks together, in the contract",
  "stats.trend.title": "Games per day · last 30 days",
  "stats.trend.empty": "No games in the last 30 days yet.",
  "stats.trend.aria":
    "Games per day over the last 30 days: {total} in total, peaking at {max} in one day.",
  "stats.trend.bar":
    "{date} · {plays} games ({paid} paid) · {players} players",
  "stats.trend.today": "{date} (today)",
  "stats.trend.paid": "Paid",
  "stats.trend.free": "Free",
  "stats.players": "Players",
  "stats.players.total": "Total",
  "stats.players.total_hint": "{email} with email · {wallet} wallet only",
  "stats.players.active7": "Active (7 days)",
  "stats.players.active30": "Active (30 days)",
  "stats.players.paid": "Have paid at least once",
  "stats.players.paid_hint": "{paid} of {total} who played",
  "stats.players.distribution": "How many games each one plays",
  "stats.bucket.1": "1 game",
  "stats.bucket.2_5": "2 to 5",
  "stats.bucket.6_20": "6 to 20",
  "stats.bucket.21": "21 or more",
  "stats.retention": "Retention",
  "stats.retention.d1": "Came back the next day",
  "stats.retention.d7": "Came back within 7 days",
  "stats.retention.d30": "Came back within 30 days",
  "stats.retention.note":
    "Of those who already had time to come back, how many played again inside that window.",
  "stats.retention.window": "Window",
  "stats.retention.returned": "Came back",
  "stats.retention.of": "of {total}",
  "stats.plays": "Games",
  "stats.plays.total": "Total played",
  "stats.plays.total_hint": "{paid} paid · {free} free",
  "stats.plays.best": "Best score",
  "stats.plays.best_hint": "per card, all-time record",
  "stats.plays.average": "Average per card",
  "stats.plays.average_hint": "mean across every game",
  "stats.plays.accuracy": "Average accuracy",
  "stats.decks": "By deck",
  "stats.decks.deck": "Deck",
  "stats.decks.plays": "Games",
  "stats.decks.players": "Players",
  "stats.decks.best": "Best score",
  "stats.decks.pot": "Pot",
  "stats.decks.paid": "Paid out",
  "stats.decks.cards": "{n} cards",
  "stats.decks.note":
    "Pot and paid out in USDT. “Paid out” is what already left the contract towards the winners of that deck.",
  "stats.economy": "Economy",
  "stats.economy.paid_out": "Prizes paid",
  "stats.economy.paid_out_hint": "across {rounds} rounds with a winner",
  "stats.economy.biggest": "Biggest prize",
  "stats.economy.revenue": "Collected",
  "stats.economy.revenue_hint": "{paid} paid × {fee}",
  "stats.economy.commission": "Commission",
  "stats.economy.commission_hint": "{pct}% of every paid game",
  "stats.economy.settled": "Rounds settled",
  "stats.economy.settled_hint": "{n} with no winner (pot rolled over)",
  "stats.economy.pending": "Payout pending",
  "stats.economy.pending_hint": "winner decided, transaction not confirmed yet",
  "stats.economy.note1":
    "“Collected” is estimated with the fee the contract charges today ({fee} USDT per paid game). If the fee changed, older games would be recalculated with the new one.",
  "stats.economy.note2":
    "Prizes paid can exceed what was collected: the pots were seeded with money put in by Avíspate, not only with player entries.",
  "stats.chain": "On-chain (Celo)",
  "stats.chain.plays": "On-chain games",
  "stats.chain.plays_hint": "every game signs its transaction",
  "stats.chain.prizes": "Prize payouts",
  "stats.chain.wallets": "Wallets",
  "stats.chain.gas": "Gas gifted",
  "stats.chain.gas_hint": "to {n} new wallets",
  "stats.chain.contract": "View the contract on Celoscan ↗",
  "stats.how": "How to read this",
  "stats.how.1a": "The day on this panel is the",
  "stats.how.1strong": "round",
  "stats.how.1b":
    ": from 7:00 p.m. to 7:00 p.m. Colombia time, same as the prizes. The amounts come from the contract and from rounds already settled, so they line up with the",
  "stats.how.1link": "winners history",
  "stats.how.2a": "Visits, country, device and failed transactions are",
  "stats.how.2strong": "not",
  "stats.how.2b":
    "measured yet: the game has no analytics installed, and we'd rather leave the gap than invent the number.",
  "stats.truncated":
    "There are so many games that the panel is only reading the most recent window.",
  "stats.updated": "Data as of {when}. Updates on its own every minute.",

  /* -------------------------------- Turnstile ---------------------------- */
  "turnstile.aria": "Security check",
  "turnstile.text":
    "One second: confirm you're human to unlock your free game.",

  /* ------------------------------ Legales -------------------------------- */
  "terms.title": "Terms",
  "terms.body":
    "Terms and conditions in preparation. Avíspate is a visual reflex game; paid games and prizes are processed on the Celo network.",
  "privacy.title": "Privacy",
  "privacy.body":
    "Privacy policy in preparation. Avíspate stores your alias and your scores for the ranking; your wallet is used for payments and prizes on the Celo network.",

  /* ------------------------ Formulario suelto (legacy) ------------------- */
  "form.pay_and_play": "Pay 0.10 USDT and play",
  "form.hint.free":
    "Your first game of the day on this deck is free. The #1 takes the pot!",
  "form.hint.paid":
    "You already used today's free game on this deck. 80% of your payment goes to the pot.",
  "form.hint.tail": "Every miss adds 1 second, so keep your eyes sharp! 🐝",
} as const;

export type MessageKey = keyof typeof en;

export const es: Record<MessageKey, string> = {
  /* ------------------------------- Comunes ------------------------------- */
  "common.close": "Cerrar",
  "common.cancel": "Cancelar",
  "common.retry": "Reintentar",
  "common.loading": "Cargando…",
  "common.continue": "Continuar",
  "common.next": "Siguiente",
  "common.done": "Listo",
  "common.free": "gratis",
  "common.back_to_profile": "← Volver al perfil",
  "common.view_ranking": "Ver ranking",
  "common.live_stats": "Estadísticas en vivo",

  /* ------------------------------- Metadata ------------------------------ */
  "meta.home.title": "Avíspate",
  "meta.home.description":
    "¡Avíspate! Encuentra el símbolo común entre dos cartas y gasta tu mazo a toda velocidad.",
  "meta.stats.title": "Estadísticas en vivo · Avíspate",
  "meta.stats.description":
    "Cuánta gente juega Avíspate, qué tan rápido, cuánto se reparte en premios y qué pasa en la cadena. Datos públicos, sin sesión.",
  "meta.history.title": "Historial de ganadores · Avíspate",
  "meta.history.description":
    "Quién ganó cada ronda de Avíspate, cuánto se llevó y cómo quedó el pago.",
  "meta.arena.title": "Arena multijugador · Avíspate",
  "meta.arena.description":
    "Juega Avíspate en tiempo real contra otras personas y gana el pozo. Entradas de 0.10, 0.50 y 1 USDT. Muy pronto.",
  "meta.terms.title": "Términos · Avíspate",
  "meta.privacy.title": "Privacidad · Avíspate",

  /* ------------------------------ Navegación ----------------------------- */
  "nav.aria": "Navegación principal",
  "nav.play": "Jugar",
  "nav.history": "Historial",
  "nav.profile": "Perfil",

  /* -------------------------------- Sonido ------------------------------- */
  "sound.unmute": "Activar sonido",
  "sound.mute": "Silenciar",

  /* -------------------------------- Idioma ------------------------------- */
  "lang.aria": "Idioma",
  "lang.en": "English",
  "lang.es": "Español",

  /* -------------------------------- Partida ------------------------------ */
  "game.slot.base": "Base",
  "game.slot.mine": "Tu carta",
  "game.stat.time": "tiempo",
  "game.stat.cards": "cartas",
  "game.stat.errors": "errores",
  "game.hud.round": "Ronda {current} de {total}",

  /* ------------------------- Errores del flujo de pago ------------------- */
  "pay.error.rejected": "Cancelaste la firma de la jugada.",
  "pay.error.insufficient":
    "Saldo insuficiente de USDT (o gas) para esta jugada.",
  "pay.error.not_configured":
    "El juego aún no está disponible (contrato no configurado).",
  "pay.error.no_wallet": "Conecta una wallet o entra con tu correo.",
  "pay.error.generic": "No se pudo registrar la jugada. Inténtalo de nuevo.",
  "pay.error.unavailable":
    "El juego aún no está disponible (contrato no configurado o wallet sin conectar).",
  "pay.register.retry":
    "Tu pago quedó confirmado, pero no pudimos avisarle al servidor. Quedó guardado en este dispositivo y se enviará solo: revisa tu conexión y vuelve a abrir la app. No vuelvas a pagar.",
  "pay.register.rejected":
    "El servidor no aceptó esta jugada. Escríbenos a soporte@avispate.fun con la hora y tu wallet y lo revisamos.",

  /* ----------------------- Pasos del botón de jugar ---------------------- */
  "stage.switching": "Cambiando a Celo…",
  "stage.confirm": "Confirma en tu wallet…",
  "stage.approving": "Autorizando USDT…",
  "stage.confirming": "Confirmando en Celo…",
  "stage.registering": "Registrando jugada…",
  "stage.starting": "Preparando partida…",

  /* --------------------------------- Lobby ------------------------------- */
  "lobby.aria": "Reto diario",
  "lobby.tag": "JUEGA SOLO",
  "lobby.title": "Reto diario",
  "lobby.support":
    "Encuentra las parejas y gasta tu mazo. El menor tiempo promedio por carta gana el premio de hoy.",
  "lobby.prize.label": "Premio de hoy",
  "lobby.prize.preparing": "Premio en preparación",
  "lobby.addcash": "Recargar USDT",
  "lobby.howto": "Ver cómo se juega",
  "deck.label": "Cartas del mazo",

  "cta.checking.support": "Comprobando tu entrada…",
  "cta.checking.label": "Preparando…",
  "cta.free.support": "Tu partida gratis de hoy en este mazo está lista.",
  "cta.free.label": "Jugar gratis",
  "cta.paid.support": "Entrada 0.10 USDT · 80% va al premio.",
  "cta.paid.label": "Jugar por 0.10 USDT",
  "cta.alias.support": "Elige tu alias para guardar tu marca.",
  "cta.alias.label": "Continuar",
  "cta.login.support": "Inicia sesión para revisar tu jugada gratis.",
  "cta.login.label": "Empezar",
  "cta.paying.free": "Esta jugada es gratis. Solo debes confirmar en tu wallet.",
  "cta.paying.paid": "Confirma el pago de 0,10 USDT en tu wallet.",

  /* --------------------------- Arena multijugador ------------------------ */
  "arena.aria": "Arena multijugador",
  "arena.tag": "PRONTO",
  "arena.title": "Arena multijugador",
  "arena.support": "Compite en tiempo real y gana el pozo",
  "arena.entries.label": "Entradas",
  "arena.cta": "Entrar a Arena",
  "arena.soon.title": "Estamos armando la Arena",
  "arena.soon.text":
    "Pronto vas a poder sentarte en una mesa de 2 a 4 jugadores y correr el mismo mazo al mismo tiempo: el más rápido se lleva el pozo. Todavía no hay nada que pagar aquí.",
  "arena.soon.entries": "Las entradas que estamos preparando:",
  "arena.soon.back": "← Volver al reto diario",

  /* ------------------------------ Top 3 lobby ---------------------------- */
  "top3.title": "Los más avispados de hoy",
  "top3.error": "No se pudo cargar el top de hoy.",
  "top3.empty": "Todavía no hay marcas. ¡Sé el primero!",
  "top3.you": "TÚ",
  "top3.err": "err",
  "top3.total": "total",
  "top3.avg": "promedio por carta",
  "top3.you_label": "· Tú",
  "top3.full": "Ver ranking completo",

  /* ----------------------------- Modal de acceso ------------------------- */
  "access.title": "Guarda tu marca y compite",
  "access.text":
    "Necesitas entrar con correo o wallet para guardar tu tiempo, aparecer en el ranking y recibir premios.",
  "access.email": "Continuar con correo",
  "access.wallet": "Ya tengo una wallet",
  "access.wallet_connect": "Conectar wallet",
  "access.wallet_title": "Ver o cambiar wallet",
  "access.or": "o",
  "access.alias_title": "Elige tu alias",
  "access.checking": "Comprobando tu perfil…",

  /* --------------------------------- Alias ------------------------------- */
  "alias.create": "Crea tu alias",
  "alias.placeholder": "Ej: Vale",
  "alias.saving": "Guardando…",
  "alias.save": "Guardar y continuar",
  "alias.hint":
    "Así te verán en el ranking. Es único y lo eliges una vez; luego puedes cambiarlo desde tu perfil. 🐝",
  "alias.your": "Tu alias",
  "alias.field": "Alias",
  "alias.checking": "Verificando…",
  "alias.wallet_hint.a": "Wallet conectada:",
  "alias.wallet_hint.b":
    ". Elige tu alias para el ranking. Tienes una jugada gratis al día por mazo; las extras cuestan 0.10 USDT.",
  "alias.error.invalid": "Alias inválido.",
  "alias.error.too_short": "El alias es muy corto (mínimo {min}).",
  "alias.error.too_long": "El alias es muy largo (máximo {max}).",
  "alias.error.charset":
    "Solo letras, números, espacio, guion y guion bajo.",
  "alias.error.taken_try": "Ese alias ya está tomado, prueba otro.",
  "alias.error.taken_pick": "Ese alias ya está tomado, elige otro.",
  "alias.error.save_failed": "No se pudo guardar el alias.",
  "alias.error.save_failed_short": "No se pudo guardar.",

  /* ------------------------------- Resultados ---------------------------- */
  "results.record": "🔥 ¡Nuevo récord personal, {name}!",
  "results.total_time": "Tiempo total",
  "results.avg_card": "Prom. por carta",
  "results.cards": "Cartas",
  "results.errors": "Errores",
  "results.accuracy": "Precisión",
  "results.best_avg": "Mejor prom.",
  "results.play_again": "Jugar otra vez",
  "results.back": "Volver al menú",

  /* ------------------------------ Cómo se juega -------------------------- */
  "howto.aria": "Cómo se juega",
  "howto.skip": "Saltar",
  "howto.progress": "Paso {n} de 4",
  "howto.kicker": "PASO {n} DE 4",
  "howto.s1.title": "Dos cartas. Un símbolo igual.",
  "howto.s1.text":
    "La Base y Tu carta siempre comparten exactamente un símbolo. Encuéntralo antes de que tus ojos se distraigan.",
  "howto.s1.aria": "Dos cartas de ejemplo que comparten la manzana",
  "howto.s2.title": "Encuentra el símbolo común",
  "howto.s2.text": "Mira la Base y tócalo en Tu carta.",
  "howto.s2.base_aria": "Carta Base: es la referencia y no se toca",
  "howto.s2.mine_aria": "Tu carta: toca el símbolo que también está en la Base",
  "howto.s2.hint": "Busca la manzana de arriba también abajo.",
  "howto.s2.right": "¡Eso! La manzana.",
  "howto.s2.wrong": "Ese no. Busca el que también aparece en la Base.",
  "howto.s3.title": "Tu carta se vuelve la Base",
  "howto.s3.text":
    "La anterior sale, la tuya sube y llega otra del mazo. Ahora buscas un símbolo nuevo.",
  "howto.s3.aria":
    "La Base sale, Tu carta pasa a ser la nueva Base y entra una carta del mazo",
  "howto.s4.title": "Ahora sí, ¡avíspate!",
  "howto.s4.text":
    "Gasta todo el mazo en el menor tiempo. Cada error suma 1 segundo y el ranking compara tu tiempo promedio por carta.",
  "howto.s4.chip1": "🃏 10, 15 o 20 cartas",
  "howto.s4.chip2": "👆 La Base no se toca",
  "howto.s4.chip3": "⏱️ +1 s por error",
  "howto.s4.note":
    "Las condiciones de la jugada gratis y del premio están en el inicio.",
  "howto.show": "Muéstrame",
  "howto.again": "Ver otra vez",
  "howto.play": "¡A jugar!",

  /* --------------------------------- Perfil ------------------------------ */
  "profile.eyebrow": "Tu perfil",
  "profile.title": "Tu perfil",
  "profile.no_alias": "Sin alias",
  "profile.edit_alias": "Editar alias",
  "profile.new_alias": "Nuevo alias",
  "profile.save_alias": "Guardar alias",
  "profile.guard.text":
    "Inicia sesión con tu correo o conecta tu wallet para ver tu perfil.",
  "profile.guard.cta": "Ir al inicio",
  "profile.creating_wallet": "Creando tu wallet…",
  "profile.link.support": "Ayuda y soporte",
  "profile.link.logout": "Cerrar sesión",
  "profile.links.hint": "Cierra sesión para cambiar de cuenta.",
  "profile.legal.terms": "Términos",
  "profile.legal.privacy": "Privacidad",
  "profile.stats.aria": "Estadísticas",
  "profile.stats.games": "Partidas",
  "profile.stats.wins": "Victorias",
  "profile.stats.total_won": "Total ganado",

  /* --------------------------------- Premios ----------------------------- */
  "prizes.title": "Tus premios",
  "prizes.note":
    "Los premios se envían automáticamente a tu wallet todos los días a las 7:00 p. m. (Colombia).",
  "prizes.empty": "Aún no has ganado. ¡Sigue jugando para ganar el pozo!",
  "prizes.deck": "Mazo {deck}",
  "prizes.view_aria": "Ver transacción del premio",
  "prizes.paid": "Pagado",
  "prizes.more": "Ver historial completo",

  /* -------------------------------- Cartera ------------------------------ */
  "wallet.title": "Cartera",
  "wallet.note":
    "Tu cartera en la red Celo. Esta dirección funciona como tu número de cuenta para recibir CELO y USDT.",
  "wallet.hide": "Ocultar",
  "wallet.show": "Ver completa",
  "wallet.hide_aria": "Ocultar dirección completa",
  "wallet.show_aria": "Ver dirección completa",
  "wallet.copy": "Copiar dirección",
  "wallet.copied": "Dirección copiada ✓",
  "wallet.copy_aria": "Copiar dirección de la wallet",

  /* --------------------------------- Tokens ------------------------------ */
  "tokens.aria": "Saldos",
  "tokens.add": "Agregar",
  "tokens.send": "Enviar",
  "tokens.soon": "Próximamente",
  "tokens.loading_aria": "Cargando saldo",
  "tokens.error": "— error",
  "token.celo.desc": "Se usa para pagar las tarifas de la red.",
  "token.usdt.desc": "Para entrar a partidas pagadas y recibir premios.",
  "token.copm.desc":
    "Peso colombiano digital en Celo. Todavía no se juega con él: las entradas se cobran en USDT.",

  /* ----------------------------- Agregar dinero -------------------------- */
  "fund.title": "Agregar {symbol}",
  "fund.minipay.text":
    "MiniPay recarga tu cartera con su propia pantalla, sin salir de la aplicación.",
  "fund.minipay.cta": "Agregar dinero en MiniPay",
  "fund.intro":
    "Tres formas de conseguir {symbol} en la red Celo. Elige la que te quede más cómoda.",
  "fund.opt1.title": "Recibir en tu dirección",
  "fund.opt1.hint.a": "Si ya tienes {symbol} en otro lado, envíalo aquí.",
  "fund.opt1.hint.strong": "Solo por la red Celo",
  "fund.opt1.hint.b": ": mandarlo por otra red pierde el dinero.",
  "fund.copy": "Copiar mi dirección",
  "fund.opt2.title": "Traer desde Ethereum",
  "fund.opt2.hint": "Si tu {symbol} está en Ethereum, un puente lo pasa a Celo.",
  "fund.opt2.link": "Abrir el puente (Squid) ↗",
  "fund.opt3.title": "Cambiar dentro de Celo",
  "fund.opt3.hint":
    "Si ya tienes otro token en Celo, cámbialo por {symbol}.",
  "fund.opt3.link": "Abrir el cambio (Uniswap) ↗",
  "fund.foot":
    "El puente y el cambio son servicios de terceros: Avíspate no toca ese dinero ni cobra nada por ahí.",

  /* -------------------------------- Enviar ------------------------------- */
  "send.title": "Enviar {symbol}",
  "send.done": "Enviado ✓",
  "send.done_text": "Tu {symbol} ya va en camino a {to}.",
  "send.tx_link": "Ver la transacción en Celoscan ↗",
  "send.available": "Disponible",
  "send.to_label": "Dirección de destino",
  "send.invalid_addr": "Esa dirección no es válida.",
  "send.self": "Esa es tu propia dirección.",
  "send.network_note.strong": "Solo por la red Celo.",
  "send.network_note.rest":
    "Si esa dirección es de otra red, el dinero se pierde y nadie lo puede devolver.",
  "send.amount": "Monto",
  "send.max": "Máximo",
  "send.over": "Es más de lo que tienes.",
  "send.gas_note":
    "La tarifa de red se está pagando en USDT, así que “Máximo” deja un poco de saldo para cubrirla.",
  "send.cta": "Enviar {symbol}",
  "send.sending": "Enviando…",
  "send.confirm_note": "Confirma en tu wallet. No cierres esta ventana.",
  "send.error.rejected": "Cancelaste la firma en tu wallet.",
  "send.error.insufficient":
    "Saldo insuficiente para ese monto más la tarifa de red.",
  "send.error.chain":
    "Tu wallet no está en la red Celo. Cámbiala e inténtalo de nuevo.",
  "send.error.generic": "No se pudo enviar. Revisa el monto y vuelve a intentar.",

  /* -------------------------------- Ranking ------------------------------ */
  "ranking.title": "Ranking",
  "lb.tabs_aria": "Tamaño de mazo",
  "lb.cards": "{n} cartas",
  "lb.pot_label": "🏆 Premio de hoy · el #1 se lo lleva todo",
  "lb.title": "Ranking de hoy · mazo {deck}",
  "lb.loading": "Cargando ranking…",
  "lb.error": "No se pudo cargar el ranking.",
  "lb.empty": "Aún no hay marcas hoy. ¡Sé el primero y gana el pozo!",
  "lb.no_wallet": "sin wallet",
  "lb.err": "err",
  "lb.total": "total",

  /* ------------------------------ Reloj de ronda ------------------------- */
  "round.error": "No pudimos actualizar la ronda",
  "round.loading": "Cierra en …",
  "round.closes_in": "Cierra en {time}",

  /* -------------------------------- Historial ---------------------------- */
  "history.title": "Historial de ganadores",
  "history.lead":
    "Cada ronda cierra a las 7:00 p. m. (Colombia) y el #1 de cada mazo se lleva el pozo.",
  "history.link.ranking": "Ver el ranking de hoy",
  "hist.error": "No pudimos cargar los ganadores.",
  "hist.empty": "Aún no hay ganadores. El primero aparecerá al cerrar una ronda.",
  "hist.deck": "Mazo {deck}",
  "hist.payout.paid": "Premio pagado",
  "hist.payout.pending": "Pago procesándose",
  "hist.payout.rollover": "Premio acumulado",
  "hist.winner": "GANADOR",
  "hist.no_winner": "SIN GANADOR",
  "hist.nobody": "Nadie jugó esta ronda",
  "hist.time": "Tiempo: {time} por carta",
  "hist.err": "err",
  "hist.tx": "Ver el pago en Celoscan ↗",
  "hist.more": "Ver más",
  "hist.loading": "Cargando…",

  /* ------------------------------ Estadísticas --------------------------- */
  "stats.title": "Estadísticas en vivo",
  "stats.lead":
    "Todo lo que pasa en Avíspate, en números públicos y actualizados solos.",
  "stats.error": "No pudimos cargar las estadísticas.",
  "stats.today": "La ronda de hoy",
  "stats.updating": "Actualizando…",
  "stats.live": "En vivo",
  "stats.today.players": "Jugadores",
  "stats.today.players_hint": "distintos, en esta ronda",
  "stats.today.plays": "Partidas",
  "stats.today.plays_hint": "{paid} pagas · {free} gratis",
  "stats.today.new": "Jugadores nuevos",
  "stats.today.new_hint": "se registraron hoy",
  "stats.today.pot": "Pozo en juego",
  "stats.today.pot_hint": "suma de los tres mazos, en el contrato",
  "stats.trend.title": "Partidas por día · últimos 30 días",
  "stats.trend.empty": "Todavía no hay partidas en los últimos 30 días.",
  "stats.trend.aria":
    "Partidas por día en los últimos 30 días: {total} en total, con un máximo de {max} en un día.",
  "stats.trend.bar":
    "{date} · {plays} partidas ({paid} pagas) · {players} jugadores",
  "stats.trend.today": "{date} (hoy)",
  "stats.trend.paid": "Pagas",
  "stats.trend.free": "Gratis",
  "stats.players": "Jugadores",
  "stats.players.total": "Total",
  "stats.players.total_hint": "{email} con correo · {wallet} solo wallet",
  "stats.players.active7": "Activos (7 días)",
  "stats.players.active30": "Activos (30 días)",
  "stats.players.paid": "Han pagado alguna",
  "stats.players.paid_hint": "{paid} de {total} que jugaron",
  "stats.players.distribution": "Cuántas partidas juega cada uno",
  "stats.bucket.1": "1 partida",
  "stats.bucket.2_5": "2 a 5",
  "stats.bucket.6_20": "6 a 20",
  "stats.bucket.21": "21 o más",
  "stats.retention": "Retención",
  "stats.retention.d1": "Volvió al día siguiente",
  "stats.retention.d7": "Volvió en 7 días",
  "stats.retention.d30": "Volvió en 30 días",
  "stats.retention.note":
    "De quienes ya tuvieron tiempo de volver, cuántos volvieron a jugar dentro de esa ventana.",
  "stats.retention.window": "Ventana",
  "stats.retention.returned": "Volvieron",
  "stats.retention.of": "de {total}",
  "stats.plays": "Partidas",
  "stats.plays.total": "Total jugadas",
  "stats.plays.total_hint": "{paid} pagas · {free} gratis",
  "stats.plays.best": "Mejor marca",
  "stats.plays.best_hint": "por carta, récord absoluto",
  "stats.plays.average": "Promedio por carta",
  "stats.plays.average_hint": "media de todas las partidas",
  "stats.plays.accuracy": "Precisión media",
  "stats.decks": "Por mazo",
  "stats.decks.deck": "Mazo",
  "stats.decks.plays": "Partidas",
  "stats.decks.players": "Jugadores",
  "stats.decks.best": "Mejor marca",
  "stats.decks.pot": "Pozo",
  "stats.decks.paid": "Pagado",
  "stats.decks.cards": "{n} cartas",
  "stats.decks.note":
    "Pozo y pagado en USDT. “Pagado” es lo que ya salió del contrato hacia los ganadores de ese mazo.",
  "stats.economy": "Economía",
  "stats.economy.paid_out": "Premios pagados",
  "stats.economy.paid_out_hint": "en {rounds} rondas con ganador",
  "stats.economy.biggest": "Premio más grande",
  "stats.economy.revenue": "Recaudado",
  "stats.economy.revenue_hint": "{paid} pagas × {fee}",
  "stats.economy.commission": "Comisión",
  "stats.economy.commission_hint": "{pct}% de cada jugada paga",
  "stats.economy.settled": "Rondas liquidadas",
  "stats.economy.settled_hint": "{n} sin ganador (pozo acumulado)",
  "stats.economy.pending": "Pago pendiente",
  "stats.economy.pending_hint": "ganador definido, transacción aún sin confirmar",
  "stats.economy.note1":
    "“Recaudado” se estima con la tarifa que el contrato cobra hoy ({fee} USDT por jugada paga). Si la tarifa cambiara, las jugadas viejas se recalcularían con la nueva.",
  "stats.economy.note2":
    "Los premios pagados pueden superar lo recaudado: los pozos se arrancaron con dinero puesto por Avíspate, no solo con las entradas de los jugadores.",
  "stats.chain": "En la cadena (Celo)",
  "stats.chain.plays": "Jugadas on-chain",
  "stats.chain.plays_hint": "cada partida firma su transacción",
  "stats.chain.prizes": "Pagos de premio",
  "stats.chain.wallets": "Wallets",
  "stats.chain.gas": "Gas regalado",
  "stats.chain.gas_hint": "a {n} wallets nuevas",
  "stats.chain.contract": "Ver el contrato en Celoscan ↗",
  "stats.how": "Cómo leer esto",
  "stats.how.1a": "El día de este panel es la",
  "stats.how.1strong": "ronda",
  "stats.how.1b":
    ": de 7:00 p. m. a 7:00 p. m. hora de Colombia, igual que los premios. Los montos salen del contrato y de las rondas ya liquidadas, así que cuadran con el",
  "stats.how.1link": "historial de ganadores",
  "stats.how.2a": "Todavía",
  "stats.how.2strong": "no",
  "stats.how.2b":
    "se miden visitas, país, dispositivo ni transacciones fallidas: el juego no tiene analítica instalada, y preferimos dejar el hueco a inventar el número.",
  "stats.truncated":
    "Hay tantas partidas que el panel está leyendo solo la ventana más reciente.",
  "stats.updated": "Datos al {when}. Se actualiza solo cada minuto.",

  /* -------------------------------- Turnstile ---------------------------- */
  "turnstile.aria": "Verificación de seguridad",
  "turnstile.text":
    "Un segundo: confirma que eres humano para activar tu jugada gratis.",

  /* ------------------------------ Legales -------------------------------- */
  "terms.title": "Términos",
  "terms.body":
    "Contenido de términos y condiciones en preparación. Avíspate es un juego de agilidad visual; las partidas pagadas y los premios se procesan en la red Celo.",
  "privacy.title": "Privacidad",
  "privacy.body":
    "Política de privacidad en preparación. Avíspate guarda tu alias y tus puntajes para el ranking; tu wallet se usa para pagos y premios en la red Celo.",

  /* ------------------------ Formulario suelto (legacy) ------------------- */
  "form.pay_and_play": "Pagar 0.10 USDT y jugar",
  "form.hint.free":
    "Tu primera jugada del día en este mazo es gratis. ¡El #1 se lleva el pozo!",
  "form.hint.paid":
    "Ya usaste tu jugada gratis de hoy en este mazo. El 80% de tu pago va al pozo.",
  "form.hint.tail": "Cada error suma 1 segundo, ¡así que ojo avispa! 🐝",
};
