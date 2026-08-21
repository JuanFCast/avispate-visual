/**
 * Texto de los Términos, en español y en inglés.
 *
 * Vive aquí y NO en `lib/i18n/dictionary.ts` a propósito: el diccionario
 * exporta `en` y `es` como un solo módulo que importan decenas de componentes
 * cliente, así que meter miles de palabras legales ×2 idiomas las haría viajar
 * en el JavaScript de todas las rutas del juego. Esto son componentes de
 * servidor: el jugador recibe HTML y cero JS por ellos.
 */

export const LAST_UPDATED_ES = "Última actualización: 20 de agosto de 2026";
export const LAST_UPDATED_EN = "Last updated: 20 August 2026";

const POT_URL =
  "https://celoscan.io/address/0x48089fBD48576390bfd68d106d21715200E0207f";
const ARENA_URL =
  "https://celoscan.io/address/0x095226a21FA618991672339fD94381611F429c62";

export const CONTACT_EMAIL = "hi@casgostudio.com";

function ContactLink() {
  return <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
}

function ContractLinks() {
  return (
    <ul className="legal-list">
      <li>
        <a href={POT_URL} target="_blank" rel="noreferrer">
          AvispatePot
        </a>
      </li>
      <li>
        <a href={ARENA_URL} target="_blank" rel="noreferrer">
          AvispateArena
        </a>
      </li>
    </ul>
  );
}

export function TermsEs() {
  return (
    <div className="legal-doc">
      <section className="profile-section legal-section">
        <h2 className="section-title">1. Qué es Avíspate</h2>
        <p>
          Avíspate es un juego diario de agilidad visual sobre la red Celo,
          hecho por Casgo Studio, un estudio independiente. Cada carta comparte
          exactamente un símbolo con la anterior: lo encuentras, lo tocas, y
          sigues. Gana quien gaste todo el mazo en el menor tiempo promedio por
          carta. Hay mazos de 10, 15 y 20 cartas, y cada uno tiene su propio
          pozo en USDT. Avíspate no es operado ni respaldado por MiniPay, por
          Celo ni por ninguno de los servicios que utiliza.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">2. Elegibilidad</h2>
        <p>
          Debes tener al menos 18 años, o la mayoría de edad en tu país, la que
          sea mayor. Avíspate no está disponible donde los juegos de habilidad
          con premio estén prohibidos. Tú eres responsable de saber si puedes
          participar donde vives.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">3. Tu wallet y tu cuenta</h2>
        <p>
          Juegas con tu propia wallet: una wallet embebida creada por Privy
          cuando entras con correo, o una wallet de autocustodia (MiniPay,
          MetaMask, Rabby y otras). En ningún momento custodiamos tus fondos ni
          tus llaves privadas. No podemos recuperar una llave perdida, revertir
          una transacción ni mover nada desde tu wallet.
        </p>
        <p>
          Tu alias pertenece a la wallet, no al dispositivo: entrando desde otro
          teléfono con la misma wallet recuperas tu nombre y tu historial. Un
          alias es único y visible para todos en el ranking.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">4. Entradas y jugada gratis</h2>
        <p>
          Tienes una jugada gratis al día por cada mazo y por cada wallet. Quien
          decide si te corresponde es el contrato inteligente, no la aplicación.
        </p>
        <p>
          Las jugadas siguientes cuestan una entrada en USDT —hoy 0,10 USDT—, de
          la cual el 80 % va al pozo de ese mazo y el 20 % es comisión del
          protocolo. Ambos valores son parámetros del contrato y pueden cambiar;
          el valor vigente siempre se muestra antes de que confirmes.
        </p>
        <p>
          Toda jugada, gratis o paga, es una transacción real en Celo, y las
          transacciones en la red pueden implicar una tarifa de red. Cómo se
          cobra esa tarifa depende de tu wallet y del mecanismo de abstracción
          de tarifas de Celo: puede descontarse en USDT, puede descontarse en la
          moneda nativa de la red, o puede gestionarse de forma automática sin
          que tengas que ocuparte de ella, como ocurre dentro de MiniPay. En
          cualquier caso, esa tarifa corresponde a la red, no a Casgo Studio.
        </p>
        <p>
          El permiso de gasto que la aplicación te pide está limitado al
          equivalente de diez entradas — nunca es ilimitado.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">5. Premios del reto diario</h2>
        <p>
          La ronda cierra a las 00:00 UTC. En cada mazo, quien tenga el mejor
          tiempo promedio se lleva el pozo completo de ese mazo. Si nadie jugó
          ese mazo en el día, el pozo se acumula para el siguiente.
        </p>
        <p>
          La liquidación es automática: un proceso envía el pago a la wallet
          ganadora calculada a partir de los resultados registrados on-chain.
          Ante un fallo técnico o de red, un pago puede demorarse o tener que
          reintentarse.
        </p>
        <p>
          Casgo Studio puede aportar fondos a los pozos por su cuenta. Ese
          aporte es enteramente discrecional: no garantizamos ningún monto
          mínimo ni su continuidad, y puede reducirse o terminar en cualquier
          momento sin aviso previo.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">6. Arena</h2>
        <p>
          En la Arena juegas contra otras personas en salas rápidas o privadas.
          Para ocupar una silla firmas con tu wallet una transacción que
          deposita tu entrada en el contrato de la Arena. Esa transacción, y
          solo esa, es la que te asigna la silla.
        </p>
        <p>
          La liquidación la ejecuta Avíspate, no tú. Al terminar la partida
          enviamos al contrato una transacción indicando quién ganó, y el
          contrato paga el pozo acumulado, menos la comisión del protocolo, a
          esa wallet. No tienes que hacer nada para cobrar tu premio.
        </p>
        <p>
          Si una mesa no llega a empezar, la anulamos y empujamos nosotros la
          devolución de cada entrada, sin coste para ti. La función de reembolso
          del contrato también puede ser invocada por cualquiera, pero solo
          surte efecto cuando se cumplen las condiciones de reembolso previstas
          en el propio contrato. Cuando se cumplen, los fondos se envían siempre
          a la wallet que depositó la entrada, y nunca a otra.
        </p>
        <p>
          Una vez que la partida arranca, la entrada ya no es reembolsable:
          perder es un resultado del juego, no un error.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">7. Juego limpio</h2>
        <p>
          El servidor verifica cada jugada antes de aceptarla: revisa que los
          movimientos sean posibles y coherentes con los tiempos declarados, y
          limita el ritmo de peticiones. Los resultados que no superan esa
          verificación se rechazan.
        </p>
        <p>
          No está permitido automatizar el juego, usar bots, ni operar varias
          wallets para acaparar jugadas gratis o pozos. Podemos excluir
          resultados y retirar el acceso de wallets que muestren ese
          comportamiento, sin aviso previo. Si crees que se te señaló por error,
          escríbenos a <ContactLink />.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">8. Sin garantías</h2>
        <p>
          Avíspate se ofrece tal cual. No garantizamos un servicio
          ininterrumpido, ni lógica de juego libre de errores, ni exactitud en
          el reparto de pozos más allá de nuestro mejor esfuerzo.
        </p>
        <p>
          El código de los contratos está publicado y verificado, y puedes
          revisarlo antes de jugar:
        </p>
        <ContractLinks />
        <p>Ninguno de los dos ha sido auditado por un tercero independiente.</p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">9. Riesgo on-chain</h2>
        <p>
          Todas las transacciones en Celo son finales: una vez confirmada, no
          puede cancelarse ni deshacerse — ni por ti, ni por nosotros, ni por
          nadie.
        </p>
        <p>
          Conviene no confundir eso con los reembolsos de la Arena, que sí
          existen. Un reembolso no revierte tu pago original —ese permanece en
          la cadena para siempre—, sino que es una transacción nueva, en sentido
          contrario, que el contrato realiza únicamente en los casos que él
          mismo permite. Fuera de esos casos previstos, no hay forma de
          recuperar lo pagado.
        </p>
        <p>
          Los contratos inteligentes pueden contener errores. Como se explica en
          la sección 4, las transacciones pueden implicar tarifas de red, y su
          gestión depende de tu wallet y del mecanismo de abstracción de tarifas
          de Celo. No somos responsables de pérdidas derivadas de tarifas de
          red, fallos en los contratos, caídas de la red Celo, fluctuaciones en
          el valor del USDT, ni de que tu wallet se vea comprometida.
        </p>
        <p>
          Avíspate es un juego de habilidad, no un producto de inversión ni de
          ahorro.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">
          10. Cambios en el juego y en estos términos
        </h2>
        <p>
          Podemos cambiar las reglas del juego, el valor de la entrada, la
          comisión, los tokens aceptados o estos términos en cualquier momento.
          Los cambios importantes se anuncian dentro de la aplicación, y la
          fecha de última actualización de esta página siempre refleja la
          versión vigente.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">11. Suspensión de acceso</h2>
        <p>
          Podemos retirar el acceso a quien incumpla estos términos o a quien,
          de buena fe, consideremos que está abusando del sistema.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">12. Contacto</h2>
        <p>
          Escríbenos a <ContactLink />. Las dudas sobre estos términos, sobre
          una jugada o sobre una decisión de juego limpio llegan todas al mismo
          sitio.
        </p>
      </section>
    </div>
  );
}

export function TermsEn() {
  return (
    <div className="legal-doc">
      <section className="profile-section legal-section">
        <h2 className="section-title">1. What Avíspate is</h2>
        <p>
          Avíspate is a daily visual reflex game on the Celo network, made by
          Casgo Studio, an independent studio. Every card shares exactly one
          symbol with the one before it: find it, tap it, keep going. Whoever
          clears the whole deck with the lowest average time per card wins.
          There are decks of 10, 15 and 20 cards, and each one has its own pot
          in USDT. Avíspate is not operated or endorsed by MiniPay, by Celo, or
          by any of the services it uses.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">2. Eligibility</h2>
        <p>
          You must be at least 18 years old, or the age of majority in your
          country, whichever is higher. Avíspate is not available where skill
          games with prizes are prohibited. It is up to you to know whether you
          can take part where you live.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">3. Your wallet and your account</h2>
        <p>
          You play with your own wallet: an embedded wallet created by Privy
          when you sign in with email, or a self-custody wallet (MiniPay,
          MetaMask, Rabby and others). At no point do we hold your funds or your
          private keys. We cannot recover a lost key, reverse a transaction, or
          move anything out of your wallet.
        </p>
        <p>
          Your alias belongs to the wallet, not to the device: sign in from
          another phone with the same wallet and you get your name and your
          history back. An alias is unique and visible to everyone on the
          ranking.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">4. Entries and the free game</h2>
        <p>
          You get one free game a day for each deck and each wallet. What
          decides whether one is due to you is the smart contract, not the app.
        </p>
        <p>
          Further games cost an entry in USDT — today 0.10 USDT — of which 80%
          goes to that deck&apos;s pot and 20% is the protocol fee. Both values
          are contract parameters and can change; the current value is always
          shown before you confirm.
        </p>
        <p>
          Every game, free or paid, is a real transaction on Celo, and
          transactions on the network can carry a network fee. How that fee is
          charged depends on your wallet and on Celo&apos;s fee abstraction
          mechanism: it may be taken in USDT, it may be taken in the
          network&apos;s native currency, or it may be handled automatically
          without you having to deal with it at all, as happens inside MiniPay.
          Either way, that fee goes to the network, not to Casgo Studio.
        </p>
        <p>
          The spending allowance the app asks you for is capped at the
          equivalent of ten entries — it is never unlimited.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">5. Daily challenge prizes</h2>
        <p>
          The round closes at 00:00 UTC. In each deck, whoever has the best
          average time takes that deck&apos;s entire pot. If nobody played that
          deck that day, the pot rolls over to the next one.
        </p>
        <p>
          Settlement is automatic: a process sends the payment to the winning
          wallet calculated from the results recorded on-chain. If something
          fails technically or on the network, a payment may be delayed or have
          to be retried.
        </p>
        <p>
          Casgo Studio may add funds to the pots of its own accord. That
          contribution is entirely discretionary: we do not guarantee any
          minimum amount or its continuity, and it may be reduced or ended at
          any time without prior notice.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">6. Arena</h2>
        <p>
          In the Arena you play against other people in quick or private rooms.
          To take a seat you sign a transaction with your wallet that deposits
          your entry into the Arena contract. That transaction, and only that
          one, is what assigns you the seat.
        </p>
        <p>
          Settlement is carried out by Avíspate, not by you. When the game ends
          we send the contract a transaction stating who won, and the contract
          pays the accumulated pot, minus the protocol fee, to that wallet. You
          do not have to do anything to collect your prize.
        </p>
        <p>
          If a table never gets started, we void it and push the refund of every
          entry ourselves, at no cost to you. The contract&apos;s refund
          function can also be called by anyone, but it only takes effect when
          the refund conditions set out in the contract itself are met. When
          they are, the funds are always sent to the wallet that deposited the
          entry, and never to another one.
        </p>
        <p>
          Once the game starts, the entry is no longer refundable: losing is a
          game result, not a failure.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">7. Fair play</h2>
        <p>
          The server checks every game before accepting it: it verifies that the
          moves are possible and consistent with the times reported, and it
          limits the rate of requests. Results that do not pass that check are
          rejected.
        </p>
        <p>
          Automating the game, using bots, or running several wallets to hoard
          free games or pots is not allowed. We may exclude results and withdraw
          access from wallets that show that behaviour, without prior notice. If
          you believe you were flagged by mistake, write to us at{" "}
          <ContactLink />.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">8. No warranties</h2>
        <p>
          Avíspate is offered as is. We do not guarantee uninterrupted service,
          game logic free of bugs, or accuracy in pot distribution beyond our
          best effort.
        </p>
        <p>
          The contract code is published and verified, and you can review it
          before playing:
        </p>
        <ContractLinks />
        <p>Neither has been audited by an independent third party.</p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">9. On-chain risk</h2>
        <p>
          Every transaction on Celo is final: once confirmed, it cannot be
          cancelled or undone — not by you, not by us, not by anyone.
        </p>
        <p>
          That should not be confused with Arena refunds, which do exist. A
          refund does not reverse your original payment — that stays on the
          chain forever — it is a new transaction, in the opposite direction,
          that the contract carries out only in the cases it itself allows.
          Outside those cases, there is no way to recover what you paid.
        </p>
        <p>
          Smart contracts can contain bugs. As explained in section 4,
          transactions can carry network fees, and how they are handled depends
          on your wallet and on Celo&apos;s fee abstraction mechanism. We are
          not responsible for losses arising from network fees, contract
          failures, Celo network outages, fluctuations in the value of USDT, or
          your wallet being compromised.
        </p>
        <p>Avíspate is a game of skill, not an investment or savings product.</p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">
          10. Changes to the game and to these terms
        </h2>
        <p>
          We may change the rules of the game, the entry value, the fee, the
          tokens accepted, or these terms at any time. Significant changes are
          announced inside the app, and the last-updated date on this page
          always reflects the version in force.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">11. Suspension of access</h2>
        <p>
          We may withdraw access from anyone who breaches these terms or who, in
          good faith, we consider to be abusing the system.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">12. Contact</h2>
        <p>
          Write to us at <ContactLink />. Questions about these terms, about a
          game, or about a fair-play decision all reach the same place.
        </p>
      </section>
    </div>
  );
}
