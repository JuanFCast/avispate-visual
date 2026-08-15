/**
 * Cuál es TU wallet, cuando hay más de una candidata.
 *
 * Función pura —sin React, sin red, sin `window`— por lo mismo que
 * `pay-guard.ts`: decide sobre dinero y tiene que poder correrse entera desde
 * `scripts/verify-wallet-identity.ts`, incluyendo casos que a mano exigirían
 * bloquear una extensión en el instante exacto.
 *
 * ── El incidente que la hizo falta (PipeRabby, 2026-08-07) ─────────────────
 *
 * Un jugador con su Rabby de siempre entró con la extensión bloqueada. Privy no
 * pudo leer su dirección, lo dio por "usuario sin wallets" y le creó una
 * embebida. A partir de ahí la aplicación tuvo DOS direcciones para la misma
 * persona, y las repartió entre pantallas: las estadísticas salían del perfil
 * del servidor —su Rabby, con sus 12 partidas y sus premios— mientras la tarjeta
 * de cartera y los saldos salían de lo que wagmi tuviera conectado, que era la
 * embebida vacía. Mismo perfil, saldo de otro.
 *
 * ── La regla ──────────────────────────────────────────────────────────────
 *
 * **Si el perfil ya tiene dirección, esa manda.** No es un dato de contacto: es
 * la que cobra los premios y la que ata el historial. Una embebida creada por
 * accidente no la sustituye, no se autoactiva y no gobierna ninguna pantalla.
 *
 * Y cuando la conectada no es la canónica no se cambia de identidad ni se deja
 * pasar una operación económica: se pide conectar la correcta. Cambiar de wallet
 * tiene que ser un acto deliberado del jugador, nunca el efecto secundario de
 * una extensión bloqueada.
 *
 * Falla CERRADO. Mientras no se sepa qué hay conectado, la respuesta es "no lo
 * sé", y "no lo sé" no autoriza nada.
 */

import type { CanonicalWallet } from "./pay-guard";

export type WalletIdentityVerdict =
  /** La conectada ES la canónica. Todo permitido. */
  | { kind: "ok"; address: string }
  /**
   * El perfil todavía no tiene dirección: este jugador es nuevo y la que trae
   * conectada será la suya en cuanto el servidor la anote. Se permite operar —
   * si no, nadie podría estrenar cuenta.
   */
  | { kind: "no_canonical"; address: string }
  /**
   * Hay canónica y no es la que está conectada (o no hay ninguna conectada).
   * Se mira, no se opera: hay que conectar la correcta.
   */
  | { kind: "connect_canonical"; canonical: string; connected: string | null }
  /** Todavía no se sabe. No autoriza nada. */
  | { kind: "unknown" };

const norm = (a: string | null | undefined) => (a ?? "").trim().toLowerCase();

export interface WalletIdentityCheck {
  /** `profiles.wallet_address`: la que cobra. `null` si el perfil no tiene. */
  canonical: string | null;
  /** Lo que wagmi tiene conectado AHORA. `null` si nada. */
  connected: string | null;
  /**
   * ¿Ya terminó de resolverse el estado de la wallet?
   *
   * Mientras Privy arranca o el conector se reengancha, `connected` es `null`
   * sin que eso signifique "no hay wallet". Tratar ese hueco como una respuesta
   * haría parpadear un aviso de "conecta tu cartera" a quien la tiene puesta.
   */
  ready: boolean;
}

export function decideWalletIdentity(
  check: WalletIdentityCheck
): WalletIdentityVerdict {
  // Falla cerrado: sin haber terminado de mirar, no hay veredicto.
  if (!check.ready) return { kind: "unknown" };

  const canonical = norm(check.canonical);
  const connected = norm(check.connected);

  if (!canonical) {
    // Sin canónica todavía. La conectada será la suya; si tampoco hay, no se
    // sabe nada de nadie.
    return connected
      ? { kind: "no_canonical", address: connected }
      : { kind: "unknown" };
  }

  if (connected && connected === canonical) {
    return { kind: "ok", address: canonical };
  }

  // Hay canónica y lo conectado no es eso — otra wallet, o ninguna. Las dos
  // salen por la misma puerta a propósito: en las dos la respuesta del jugador
  // es la misma, conectar la que manda, y distinguirlas solo serviría para
  // escribir dos mensajes que dicen lo mismo.
  return {
    kind: "connect_canonical",
    canonical,
    connected: connected || null,
  };
}

/**
 * ¿Hay que crearle una wallet embebida a este jugador?
 *
 * ── Una identidad, una wallet ──────────────────────────────────────────────
 *
 * La regla de Avíspate es más estricta que "hay una canónica entre varias": una
 * identidad tiene UNA wallet. Que la extensión esté bloqueada o no conteste no
 * es motivo para estrenarle otra — es motivo para pedirle que la desbloquee.
 *
 * ── Por qué esta decisión tiene que estar AQUÍ ─────────────────────────────
 *
 * Porque es el único sitio que sabe. Las dos vías por las que nacía una embebida
 * decidían mirando el registro de Privy (`linkedAccounts`), que no sabe nada del
 * perfil de Avíspate:
 *
 *   · Privy al entrar, con `createOnLogin: "users-without-wallets"`.
 *   · Nuestro propio `createWallet()` de `embedded-wallet.tsx`, a los 6 s.
 *
 * Para las dos, un jugador que entra por correo y tiene su Rabby solo CONECTADA
 * —no enlazada a su cuenta de Privy— es un "usuario sin wallets". Da igual que
 * su perfil lleve meses apuntando a una dirección con historial y premios: esa
 * columna no entra en la decisión, y no puede, porque vive en nuestra base.
 *
 * Así que la decisión se trae aquí, donde sí se ve el perfil, y las dos vías de
 * arriba se apagan. Falla CERRADO: mientras no se sepa si hay canónica, no se
 * crea nada. Crear de más es irreversible —una wallet nueva ya existe— y no
 * crear a tiempo solo cuesta unos segundos de espera.
 */
export type EmbeddedCreation =
  /** Jugador nuevo de verdad: no tiene ninguna wallet en ningún sitio. */
  | { kind: "create" }
  /** Todavía no se sabe. No se crea nada. */
  | { kind: "wait" }
  /** Ya tiene wallet. Nunca se le crea otra. */
  | {
      kind: "never";
      reason: "minipay" | "has_canonical" | "has_external" | "has_embedded";
    };

export function decideEmbeddedCreation(check: {
  /**
   * Estamos dentro de MiniPay.
   *
   * Detectarlo ES detectar su wallet: `isMiniPay()` mira
   * `window.ethereum.isMiniPay`, o sea el proveedor inyectado. Si eso está, el
   * jugador ya tiene wallet por definición y no hay nada que crearle.
   */
  inMiniPay: boolean;
  /** ¿Ya llegó el perfil del servidor? Sin él no se sabe si hay canónica. */
  profileReady: boolean;
  /** `profiles.wallet_address`. Si existe, no se crea nada jamás. */
  canonical: string | null;
  /** Privy ya tiene una embebida para este usuario. */
  hasEmbedded: boolean;
  /** El usuario tiene una wallet propia enlazada en Privy. */
  hasExternal: boolean;
}): EmbeddedCreation {
  /**
   * Dentro de MiniPay NUNCA se crea una embebida. Va lo primero, y por delante
   * incluso de esperar al perfil.
   *
   * El jugador ya tiene wallet: la inyectada, que es la identidad con la que
   * juega y con la que cobra. Crearle otra sería exactamente el caso PipeRabby
   * pero dentro de MiniPay — dos identidades en el mismo entorno.
   *
   * Y aplica aunque entre por CORREO. `loginMethods` incluye email, así que
   * alguien puede abrir sesión de Privy dentro de MiniPay; para Privy ese
   * usuario "no tiene wallets" porque la inyectada no está enlazada a su
   * cuenta, y le provisionaría una. La regla del perfil no lo cubre: solo
   * frena si el perfil YA tiene dirección anotada.
   *
   * No espera al perfil porque no lo necesita y adelantarse aquí es seguro:
   * este camino solo puede NEGAR la creación, nunca autorizarla.
   *
   * Fuera de MiniPay no cambia nada: Rabby, MetaMask y el resto siguen por los
   * mismos filtros de siempre.
   */
  if (check.inMiniPay) return { kind: "never", reason: "minipay" };

  // Sin saber si tiene canónica no se crea. Es la diferencia entre esperar dos
  // segundos y regalarle una segunda identidad a alguien que ya tenía la suya.
  if (!check.profileReady) return { kind: "wait" };

  if (check.hasEmbedded) return { kind: "never", reason: "has_embedded" };
  if (check.hasExternal) return { kind: "never", reason: "has_external" };

  // La regla nueva, y la que cierra el incidente: el perfil ya tiene wallet.
  // Que ahora mismo no esté conectada no la borra — hay que desbloquearla.
  if (norm(check.canonical)) return { kind: "never", reason: "has_canonical" };

  return { kind: "create" };
}

/**
 * ¿Se debe auto-conectar la wallet embebida en wagmi, sin que el jugador toque
 * nada?
 *
 * ── El bug que la hizo falta (misma identidad, 2026-08-13) ─────────────────
 *
 * `decideEmbeddedCreation` ya impedía CREAR una segunda embebida cuando el
 * perfil tiene canónica. Pero la de PipeRabby (2026-08-07) no hay que
 * crearla: ya EXISTE, enlazada en Privy desde el incidente. Nadie decidía si
 * CONECTARLA sola era buena idea, y el efecto de `embedded-wallet.tsx` lo
 * hacía sin preguntar en cuanto veía sesión activa y nada más conectado. El
 * resultado: la misma partida gratis y el mismo pago de Arena bloqueados por
 * `wrong_wallet`, en el mismo navegador, un año después de "arreglado".
 *
 * ── La regla ──────────────────────────────────────────────────────────────
 *
 * La EXTERNA manda por defecto. Si esta identidad tiene una wallet externa
 * enlazada (`hasExternal`), la embebida NUNCA se conecta sola — ni siquiera
 * si también hay una embebida (`hasEmbedded`) y todavía no hay canónica en el
 * perfil. Dos wallets enlazadas y ninguna canónica anotada es exactamente la
 * ambigüedad que no se puede resolver por defecto; el mismo criterio que ya
 * usa el servidor (`privy-server.ts`: "la externa se elige primero").
 *
 * La única excepción es cuando el PERFIL, la fuente que manda, dice
 * explícitamente que la embebida es su canónica — alguien enlazó una externa
 * por curiosidad pero su cuenta real, la que cobra, sigue siendo la
 * embebida. Ahí sí se conecta.
 *
 * Sin externa enlazada, manda el perfil: si su canónica es otra dirección,
 * tampoco se conecta (`canonical_elsewhere` — el caso PipeRabby en sí, donde
 * la Rabby nunca llegó a *enlazarse* en Privy, solo se *conectó* por wagmi).
 * Si el perfil TODAVÍA no respondió, se espera — conectar antes de saber es
 * la misma carrera que esto existe para cerrar. Y si no hay canónica ni
 * externa, es un jugador nuevo de verdad: la embebida es correcta.
 *
 * ── Y DENTRO de MiniPay, ni siquiera esa última excepción ──────────────────
 *
 * `decideEmbeddedCreation` ya trata MiniPay como caso absoluto, comprobado
 * ANTES que cualquier otra cosa: ahí la wallet inyectada ES la identidad, sin
 * excepción. Esto tenía que copiar el mismo criterio y no lo hacía —así
 * volvió a pasar, ahora dentro de MiniPay: alguien con la MISMA cuenta de
 * correo enlazada en un navegador normal (con su embebida) y en MiniPay
 * (con la inyectada) hace que `hasEmbedded` sea `true` también ahí dentro, y
 * si la canónica coincidía con esa embebida, `MiniPayBridge` (la inyectada) y
 * este efecto (la embebida) intentaban conectar CADA UNO su wallet a la vez.
 * Dentro de MiniPay, la inyectada tiene que ganar siempre — no por canónica,
 * por estar en MiniPay.
 */
/**
 * ── Reenganchar la wallet CANÓNICA externa, sin pedirle nada a nadie ────────
 *
 * El caso PipeRabby: identidad de correo, canónica en Rabby, y una embebida
 * enlazada de arrastre. Al cargar, `decideEmbeddedAutoConnect` suelta la
 * embebida (bien: no es quien cobra) y no queda NADA conectado, así que el
 * lobby pide "conecta tu billetera" en cada visita aunque Rabby lleve meses
 * autorizada para el sitio.
 *
 * Se puede arreglar sin regalar nada, porque preguntar y pedir son cosas
 * distintas: `eth_accounts` devuelve las cuentas YA autorizadas sin abrir
 * ninguna ventana —lista vacía si la extensión está bloqueada o sin permiso—,
 * mientras que `eth_requestAccounts` es el que interrumpe. `reconnect()` de
 * wagmi usa solo la primera (`connect({ isReconnecting: true })`), así que
 * reenganchar es demostrar, no suponer.
 *
 * La condición para hacerlo es estricta a propósito: la cuenta que el conector
 * enseña PRIMERO tiene que ser la canónica. No basta con que esté entre las
 * autorizadas — wagmi deja activa `accounts[0]`, así que conectar con la
 * canónica en segundo lugar dejaría activa OTRA dirección. Si no se puede
 * demostrar, se pide conexión manual y ya está.
 */
export type CanonicalReconnect =
  /** Hay canónica externa y nada puesto: se puede preguntar en silencio. */
  | { kind: "probe"; canonical: string }
  /** Todavía no se sabe (perfil cargando, o wagmi aún reenganchando). */
  | { kind: "wait" }
  | {
      kind: "skip";
      reason:
        /** MiniPay: manda su inyectada, aquí no se reengancha nada. */
        | "minipay"
        /** Ya hay una wallet puesta. NUNCA se cambia sola por otra. */
        | "already_connected"
        /** Sin sesión no hay perfil, y sin perfil no hay canónica. */
        | "no_session"
        /** El perfil no tiene wallet anotada: la primera que traiga será suya. */
        | "no_canonical"
        /** La canónica ES la embebida: de esa se encarga el otro decisor. */
        | "canonical_is_embedded";
    };

export function decideCanonicalReconnect(check: {
  inMiniPay: boolean;
  /** Hay sesión (Privy o de wallet). Sin ella no hay perfil que consultar. */
  authenticated: boolean;
  /** wagmi ya tiene una wallet activa. */
  isConnected: boolean;
  /** wagmi sigue reenganchando por su cuenta: no adelantarse. */
  reconnecting: boolean;
  canonical: CanonicalWallet;
  embeddedAddress: string | null;
}): CanonicalReconnect {
  // MiniPay primero y sin excepción, igual que en los otros dos decisores.
  if (check.inMiniPay) return { kind: "skip", reason: "minipay" };
  // Una wallet ya puesta es una decisión de la persona (o de wagmi). Cambiarla
  // sola sería exactamente lo que no se puede hacer.
  if (check.isConnected) return { kind: "skip", reason: "already_connected" };
  if (!check.authenticated) return { kind: "skip", reason: "no_session" };
  // wagmi reengancha solo al montar. Correr en paralelo es pedir una pelea.
  if (check.reconnecting) return { kind: "wait" };
  if (check.canonical.status === "loading") return { kind: "wait" };
  if (check.canonical.status === "none")
    return { kind: "skip", reason: "no_canonical" };
  if (
    check.embeddedAddress &&
    norm(check.canonical.address) === norm(check.embeddedAddress)
  )
    return { kind: "skip", reason: "canonical_is_embedded" };
  return { kind: "probe", canonical: norm(check.canonical.address) };
}

/** Lo que contestó un conector cuando se le preguntó en silencio. */
export interface ProbedConnector {
  id: string;
  name: string;
  /** Lo que devolvió `eth_accounts`. Vacío = bloqueada o sin permiso. */
  accounts: readonly string[];
}

/**
 * Cuál de los conectores DEMUESTRA ser la wallet canónica, si alguno.
 *
 * "Demuestra" es literal: su primera cuenta autorizada es la canónica. Con eso,
 * reenganchar deja activa esa misma dirección y no otra — que es la única forma
 * de cumplir "nunca cambies solo a una wallet distinta de la canónica" sin
 * tener que deshacer nada después.
 */
export function pickCanonicalConnector(
  canonical: string,
  probed: readonly ProbedConnector[]
): string | null {
  const suya = norm(canonical);
  if (!suya) return null;
  for (const c of probed) {
    // La embebida no compite aquí: su conexión la gobierna
    // `decideEmbeddedAutoConnect`, y meterla sería tener dos autoridades.
    if (c.name === EMBEDDED_WALLET_NAME) continue;
    if (norm(c.accounts[0]) === suya) return c.id;
  }
  return null;
}

/**
 * Con qué nombre se anuncia la wallet embebida a wagmi.
 *
 * Vive aquí, y no en `embedded-wallet.tsx`, porque hay más de un sitio que
 * necesita RECONOCERLA para no confundirla con otra: el más importante es
 * `useMiniPayAutoConnect`, que busca la wallet inyectada de MiniPay. Una wallet
 * descubierta por EIP-6963 también le sale a wagmi como `type: "injected"`, así
 * que sin este nombre a mano MiniPay podría acabar conectando la embebida de
 * Privy en vez de la del teléfono — la wallet equivocada, en el único sitio
 * donde la inyectada tiene que ganar siempre. `wallet-identity.ts` no importa
 * nada, así que puede leerlo cualquiera sin ciclos.
 */
export const EMBEDDED_WALLET_NAME = "Avíspate (Privy)";

/**
 * ── El anuncio EIP-6963 de la embebida ──────────────────────────────────────
 *
 * La wallet embebida NO es un conector declarado en `lib/wagmi.ts`: llega a
 * wagmi únicamente porque la anunciamos por EIP-6963. Ese anuncio es, por
 * tanto, la única forma que tiene la app de poder firmar con ella — si se
 * pierde, wagmi se queda sin conector, `embedded-wallet.tsx` reintenta ocho
 * veces contra algo que no existe y el botón de jugar pasa media hora
 * deshabilitado diciendo "preparando tu billetera".
 *
 * La regla, entera: **un anuncio, un uuid y un oyente por dirección embebida.**
 * Se pone cuando aparece la dirección, se reemplaza solo cuando la dirección
 * CAMBIA, y se retira al desmontar. Nunca se rehace por un render.
 *
 * Las dos mitades importan y se rompieron por separado:
 *
 *   · Rehacerlo en cada render dejaba una closure viva por render, cada una
 *     agarrada a un proveedor viejo, y todas contestaban al siguiente
 *     `eip6963:requestProvider`. wagmi redescubría proveedores muertos y podía
 *     reconectar uno anterior: la intermitencia de "a veces sale una dirección
 *     y a veces otra".
 *   · Y quitarlo sin volver a ponerlo —el arreglo de lo anterior— dejaba a la
 *     app SIN anuncio para el resto de la sesión, que es el otro extremo del
 *     mismo problema.
 *
 * Por eso la decisión vive aquí, pura: se puede recorrer una secuencia entera
 * de renders en `scripts/verify-embedded-announce.ts` y comprobar que converge.
 */
export type EmbeddedAnnounce =
  /** Ya está anunciada esa misma dirección (o no hay nada que anunciar). */
  | { kind: "keep" }
  /** Hay una embebida sin anunciar: se anuncia, retirando antes la anterior. */
  | { kind: "announce"; address: string }
  /** Ya no hay embebida y quedaba un anuncio vivo: se retira. */
  | { kind: "retract" };

export function decideEmbeddedAnnounce(check: {
  /** La embebida que Privy expone AHORA, o `null` si no hay. */
  embeddedAddress: string | null;
  /** La dirección cuyo anuncio está VIVO ahora mismo, o `null`. */
  announced: string | null;
}): EmbeddedAnnounce {
  const embedded = norm(check.embeddedAddress);
  const announced = norm(check.announced);

  if (!embedded) return announced ? { kind: "retract" } : { kind: "keep" };
  // La comparación es por DIRECCIÓN, nunca por la identidad del objeto que
  // devuelve Privy: ese objeto cambia entre renders sin que cambie la wallet,
  // y confundir las dos cosas es exactamente lo que rehacía el anuncio.
  if (embedded === announced) return { kind: "keep" };
  return { kind: "announce", address: embedded };
}

/**
 * El uuid con el que se anuncia una embebida. DERIVADO de la dirección, no
 * aleatorio.
 *
 * wagmi indexa los proveedores descubiertos por `info.uuid`. Con uno aleatorio,
 * anunciar dos veces la misma wallet le crea DOS conectores con el mismo
 * nombre, y `connectors.find(c => c.name === …)` se queda con el primero — que
 * puede ser el del proveedor muerto. Derivándolo de la dirección, anunciar de
 * más es idempotente: la misma wallet es siempre el mismo conector.
 *
 * Sale con forma de UUIDv4 (8-4-4-4-12, versión y variante en su sitio) porque
 * es lo que pide EIP-6963; no pretende ser aleatorio ni secreto, y no lo es:
 * la dirección de la que sale ya es pública.
 */
export function embeddedAnnounceUuid(address: string): string {
  const hex = norm(address).replace(/^0x/, "").padEnd(32, "0").slice(0, 32);
  // Nibble de versión (4) y de variante (8..b), como exige el formato.
  const conVersion = `${hex.slice(0, 12)}4${hex.slice(13, 16)}`;
  const variante = "89ab"[parseInt(hex[16] ?? "0", 16) % 4];
  const resto = `${variante}${hex.slice(17, 20)}${hex.slice(20)}`;
  const todo = `${conVersion}${resto}`;
  return [
    todo.slice(0, 8),
    todo.slice(8, 12),
    todo.slice(12, 16),
    todo.slice(16, 20),
    todo.slice(20, 32),
  ].join("-");
}

export type EmbeddedAutoConnect =
  | { kind: "connect" }
  /** El perfil no ha terminado de resolverse (cargando, falló, o va a
      reintentar). Fallar cerrado: no se sabe, no se conecta nada solo. */
  | { kind: "wait" }
  | {
      kind: "skip";
      reason:
        /** Estamos dentro de MiniPay: la inyectada manda, sin excepción. */
        | "minipay"
        /** Externa enlazada, sin ninguna embebida de por medio. */
        | "has_external"
        /** Externa Y embebida enlazadas, sin canónica todavía: ambiguo, y la
            externa gana el desempate por defecto. */
        | "ambiguous_identity"
        /** Hay canónica y es una dirección distinta a esta embebida. */
        | "canonical_elsewhere";
    };

export function decideEmbeddedAutoConnect(check: {
  /** Estamos dentro de MiniPay: su wallet inyectada manda, siempre. */
  inMiniPay: boolean;
  /** La canónica del perfil, en sus tres estados (`canonicalFromProfile`). */
  canonical: CanonicalWallet;
  /** La dirección de la embebida EN ESTA SESIÓN, o `null` si Privy aún no la
      expone en `useWallets()`. */
  embeddedAddress: string | null;
  /** Privy tiene una wallet externa enlazada a esta identidad. */
  hasExternal: boolean;
  /** Privy tiene una wallet embebida enlazada a esta identidad. */
  hasEmbedded: boolean;
}): EmbeddedAutoConnect {
  // Va lo primero, igual que en `decideEmbeddedCreation`: dentro de MiniPay
  // no hay canónica, `hasExternal` ni `hasEmbedded` que puedan cambiar esto.
  if (check.inMiniPay) return { kind: "skip", reason: "minipay" };

  if (check.hasExternal) {
    const embeddedIsCanonical =
      check.canonical.status === "known" &&
      check.embeddedAddress !== null &&
      norm(check.canonical.address) === norm(check.embeddedAddress);
    if (!embeddedIsCanonical) {
      return {
        kind: "skip",
        reason: check.hasEmbedded ? "ambiguous_identity" : "has_external",
      };
    }
  }

  // Sin externa que la gane de entrada: falla cerrado mientras no se sepa.
  if (check.canonical.status === "loading") return { kind: "wait" };

  if (
    check.canonical.status === "known" &&
    norm(check.canonical.address) !== norm(check.embeddedAddress)
  ) {
    return { kind: "skip", reason: "canonical_elsewhere" };
  }

  return { kind: "connect" };
}

/**
 * Cuánto puede durar un "todavía no lo sé" antes de dejar de creérselo.
 *
 * Esperar es correcto: mientras wagmi reengancha la wallet de siempre o Privy
 * arranca, ofrecerle "entrar" a quien ya está dentro es el parpadeo que hace
 * pensar que la sesión no se guardó. Pero esperar SIN TOPE no es prudencia, es
 * un cuelgue — y es el que se veía: sesión cerrada, y el lobby en "Preparando…"
 * para siempre.
 *
 * Pasa cuando wagmi intenta reconectar un conector que ya no puede existir. El
 * caso concreto: la wallet embebida se anuncia por EIP-6963 solo si hay sesión
 * de Privy; sin ella nadie la anuncia nunca, y la reconexión guardada se queda
 * esperando a un proveedor que no va a llegar.
 *
 * Así que el "no lo sé" caduca. Equivocarse por el lado de enseñar el botón de
 * entrar se corrige solo en cuanto la sesión aparece —el botón cambia—; el otro
 * lado no se corrige nunca sin recargar.
 */
export const SETTLE_LIMIT_MS = 6_000;

/** ¿Lleva demasiado tiempo sin decidirse? */
export function waitingExpired(
  /** Cuándo empezó la espera, o `null` si no se está esperando. */
  since: number | null,
  now: number,
  limitMs: number = SETTLE_LIMIT_MS
): boolean {
  if (since === null) return false;
  return now - since >= limitMs;
}

/**
 * El perfil, traducido a los tres estados de la wallet canónica.
 *
 * Pura para poder probarla, y en un solo sitio para que ninguna pantalla vuelva
 * a deducirlo por su cuenta.
 *
 * El caso que la hizo falta: `refresh()` en `profile-context` hacía
 * `catch { setState(EMPTY) }`, y `EMPTY` es `alias: null, walletAddress: null`.
 * Como `authenticated` se calcula aparte y seguía en true, **un fallo al cargar
 * el perfil quedaba indistinguible de "usuario nuevo sin nada"**. A un jugador
 * con alias y wallet de siempre se le pedía alias, y de paso el guardián de pago
 * se apagaba —`walletAddress` null se leía como "no tiene wallet anotada"—.
 *
 * Por eso `failed` entra aquí y sale como `loading`: no es que no tenga wallet,
 * es que no lo sabemos. Y no saber nunca autoriza.
 */
export function canonicalFromProfile(p: {
  ready: boolean;
  loading: boolean;
  failed: boolean;
  authenticated: boolean;
  walletAddress: string | null;
  /**
   * La dirección FIRMADA por el servidor dentro de la sesión de wallet
   * (`walletSessionAddress()`), si hay una viva. Segunda fuente de la canónica.
   */
  walletSessionAddress?: string | null;
}):
  | { status: "loading" }
  | { status: "none" }
  | { status: "known"; address: string } {
  // 1. El perfil manda cuando de verdad contestó. No cambia nada de antes.
  if (p.ready && p.authenticated && !p.loading && !p.failed && p.walletAddress) {
    return { status: "known", address: p.walletAddress };
  }

  /**
   * 2. Y si el perfil no puede decirlo —tarda, falló, o volvió sin dirección—,
   *    todavía se sabe: la sesión de wallet lleva dentro la dirección que el
   *    servidor firmó DESPUÉS de comprobar en la cadena que esa wallet firmó
   *    una transacción nuestra (`/api/session/wallet` → `verifyWalletControl`).
   *
   *    Esto APRIETA la regla, no la afloja, y por dos sitios a la vez:
   *
   *      · donde antes se respondía `loading`, el cobro quedaba frenado para
   *        siempre y el jugador tenía que cerrar sesión para poder jugar otra
   *        partida con SU MISMA wallet;
   *      · y donde antes se respondía `none` —perfil autenticado pero sin
   *        dirección anotada—, `decidePlayStart` dejaba pagar con CUALQUIER
   *        wallet conectada. Ahora exige exactamente esta.
   *
   *    Lo que no cambia en absoluto: a quién se le atribuye el pago. Eso lo
   *    lee el servidor del evento `Played` on-chain (`verifyPlayTx`), nunca de
   *    una sesión.
   */
  const firmada = norm(p.walletSessionAddress);
  if (firmada) return { status: "known", address: firmada };

  // 3. Sin segunda fuente, exactamente lo de siempre.
  if (!p.ready) return { status: "loading" };
  if (p.authenticated && (p.loading || p.failed)) return { status: "loading" };
  if (!p.authenticated) return { status: "none" };
  return p.walletAddress
    ? { status: "known", address: p.walletAddress }
    : { status: "none" };
}

/** ¿Se puede firmar, pagar o cobrar con lo que hay ahora mismo? */
export function mayTransact(verdict: WalletIdentityVerdict): boolean {
  return verdict.kind === "ok" || verdict.kind === "no_canonical";
}

/**
 * Qué dirección debe mirar la pantalla: saldos, tarjeta de cartera, premios.
 *
 * SIEMPRE la canónica cuando existe, aunque no esté conectada. Enseñar el saldo
 * de la que está puesta cuando no es la tuya fue exactamente el bug: el perfil
 * decía una cosa y la cartera otra, y las dos parecían igual de oficiales.
 */
export function walletToShow(verdict: WalletIdentityVerdict): string | null {
  switch (verdict.kind) {
    case "ok":
    case "no_canonical":
      return verdict.address;
    case "connect_canonical":
      return verdict.canonical;
    case "unknown":
      return null;
  }
}
