/**
 * Texto de la Política de Privacidad, en español y en inglés.
 *
 * Mismo motivo que en `app/terminos/content.tsx` para no meterlo en el
 * diccionario: son componentes de servidor y así el texto legal no viaja en el
 * JavaScript de las rutas de juego.
 */

import { CONTACT_EMAIL } from "@/app/terminos/content";

export const LAST_UPDATED_ES = "Última actualización: 20 de agosto de 2026";
export const LAST_UPDATED_EN = "Last updated: 20 August 2026";

function ContactLink() {
  return <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
}

/** Un tercero: para qué está y qué alcanza a ver. */
function Party({
  name,
  purposeLabel,
  purpose,
  seesLabel,
  sees,
}: {
  name: string;
  purposeLabel: string;
  purpose: string;
  seesLabel: string;
  sees: string;
}) {
  return (
    <li className="legal-party">
      <strong>{name}</strong>
      <span>
        {purposeLabel}: {purpose}
      </span>
      <span>
        {seesLabel}: {sees}
      </span>
    </li>
  );
}

export function PrivacyEs() {
  const purposeLabel = "Para qué";
  const seesLabel = "Qué ve";

  return (
    <div className="legal-doc">
      <section className="profile-section legal-section">
        <p>
          Avíspate es un juego de Casgo Studio, un estudio independiente. Esta
          página explica exactamente qué datos toca el juego y qué hace con
          ellos. Es corta porque el juego recoge poco.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">1. Qué recogemos</h2>
        <ul className="legal-list">
          <li>
            Tu dirección de wallet — el identificador público con el que juegas.
          </li>
          <li>Tu alias — el nombre que eliges para el ranking.</li>
          <li>
            Tu identificador de Privy — un código interno que enlaza tu forma de
            entrar con tu perfil.
          </li>
          <li>
            Tu correo — únicamente si entras con correo. Quien entra con MiniPay
            o con otra wallet no nos da ningún correo.
          </li>
          <li>
            Tus resultados — tamaño del mazo, tiempo total, tiempo promedio,
            errores y precisión de cada partida terminada.
          </li>
          <li>
            Los identificadores de tus transacciones — el hash de cada jugada y
            de cada entrada a la Arena. Son públicos por naturaleza.
          </li>
          <li>Tu idioma — el que elijas, guardado en una cookie.</li>
        </ul>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">2. Qué no recogemos y qué no hacemos</h2>
        <ul className="legal-list">
          <li>
            Nombre real, teléfono, documento de identidad ni documentos de
            verificación.
          </li>
          <li>
            Datos de tarjeta o de banco: el juego solo funciona con USDT, nunca
            con dinero en efectivo o bancario.
          </li>
          <li>Tu actividad de navegación fuera de Avíspate.</li>
          <li>
            No tenemos analítica de terceros, ni publicidad, ni rastreadores.
            Las estadísticas públicas de /stats se calculan con nuestros propios
            datos y con lo que ya está en la cadena.
          </li>
          <li>
            Casgo Studio no te envía correos de marketing, promociones ni
            boletines, y no cede tu correo a terceros con ese fin. Ten en cuenta
            que Privy, como servicio de autenticación, sí puede enviarte
            mensajes técnicos —por ejemplo, códigos para entrar o avisos de
            seguridad de tu cuenta—, porque son necesarios para que puedas
            acceder.
          </li>
          <li>Nunca vendemos ni alquilamos ninguno de estos datos.</li>
        </ul>
        <p>
          Sobre tu ubicación: no solicitamos ni almacenamos tu ubicación
          precisa. La aplicación no pide permiso de geolocalización y no
          guardamos ningún dato de ubicación en nuestra base de datos. Ten en
          cuenta, eso sí, que cualquier servicio de internet recibe tu dirección
          IP al conectarte y que de una IP puede deducirse una ubicación
          aproximada; nuestros proveedores la procesan técnicamente para poder
          servir la aplicación y verificar el captcha.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">3. Para qué lo usamos</h2>
        <ul className="legal-list">
          <li>
            Wallet y alias — identificar tus jugadas, mostrarte en el ranking y
            enviar los premios a la dirección correcta.
          </li>
          <li>
            Resultados y transacciones — construir el ranking, verificar que una
            partida es válida y pagar los pozos.
          </li>
          <li>
            Correo — solo se guarda como registro del pequeño aporte de tarifas
            de red que se entrega una única vez a cada wallet embebida nueva,
            para que puedas firmar tus primeras jugadas. Casgo Studio no lo usa
            para nada más.
          </li>
          <li>
            Tu dirección IP — se usa en el momento para limitar el ritmo de
            peticiones, y se envía a Cloudflare al verificar el captcha de ese
            aporte inicial. No la guardamos en nuestra base de datos.
          </li>
        </ul>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">4. Qué es público</h2>
        <p>Conviene que lo sepas antes de jugar, no después:</p>
        <ul className="legal-list">
          <li>
            Tu alias, tu dirección de wallet abreviada y tus resultados aparecen
            en el ranking público y en el historial de ganadores. Cualquiera
            puede verlos.
          </li>
          <li>
            Todo lo que ocurre en la cadena —tus jugadas, tus entradas, tus
            premios— es público y permanente por diseño de Celo. Cualquiera
            puede consultarlo en un explorador de bloques, y nadie, nosotros
            incluidos, puede borrarlo.
          </li>
        </ul>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">5. Con quién lo compartimos</h2>
        <p>Solo con los servicios que hacen funcionar el juego:</p>
        <ul className="legal-parties">
          <Party
            name="Privy"
            purposeLabel={purposeLabel}
            purpose="entrar con correo y crear la wallet embebida"
            seesLabel={seesLabel}
            sees="tu correo y tu wallet"
          />
          <Party
            name="Supabase"
            purposeLabel={purposeLabel}
            purpose="base de datos"
            seesLabel={seesLabel}
            sees="perfiles, alias, resultados, partidas"
          />
          <Party
            name="Vercel"
            purposeLabel={purposeLabel}
            purpose="alojamiento de la aplicación"
            seesLabel={seesLabel}
            sees="datos técnicos de las peticiones"
          />
          <Party
            name="Cloudflare Turnstile"
            purposeLabel={purposeLabel}
            purpose="captcha del aporte inicial de tarifas de red"
            seesLabel={seesLabel}
            sees="tu IP en ese momento"
          />
          <Party
            name="WalletConnect"
            purposeLabel={purposeLabel}
            purpose="conectar wallets externas, solo fuera de MiniPay"
            seesLabel={seesLabel}
            sees="tu wallet al conectar"
          />
          <Party
            name="Proveedores de RPC de Celo"
            purposeLabel={purposeLabel}
            purpose="leer y enviar transacciones"
            seesLabel={seesLabel}
            sees="tu wallet y tus transacciones"
          />
        </ul>
        <p>Cada uno tiene sus propias políticas y trata tus datos bajo ellas.</p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">
          6. Cookies y almacenamiento en tu dispositivo
        </h2>
        <p>
          Una sola cookie propia: la que recuerda tu idioma. No hay cookies de
          publicidad ni de seguimiento.
        </p>
        <p>
          En el almacenamiento local de tu navegador se guardan dos clases de
          cosas distintas, y al cerrar sesión se tratan distinto a propósito:
        </p>
        <ul className="legal-list">
          <li>
            Identidad y conexión — tu sesión y la wallet que tenías conectada.
            Esto sí se borra al cerrar sesión.
          </li>
          <li>
            Constancias de pagos ya hechos — la prueba para reclamar una silla
            de Arena que ya pagaste, un pago aún sin registrar y la cola de
            jugadas pendientes de enviar. Esto NO se borra al cerrar sesión,
            deliberadamente: borrarlo te haría perder una entrada que ya
            pagaste.
          </li>
        </ul>
        <p>
          Todo ello vive únicamente en tu dispositivo. Puedes eliminarlo por
          completo limpiando los datos del navegador, teniendo en cuenta que, si
          lo haces con una entrada pagada pendiente, perderás la forma de
          reclamarla.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">7. Cuánto tiempo lo guardamos</h2>
        <ul className="legal-list">
          <li>
            Perfil, alias y resultados: mientras el juego siga funcionando,
            porque son el ranking.
          </li>
          <li>
            Correo: mientras exista el registro del aporte inicial, o hasta que
            pidas borrarlo.
          </li>
          <li>
            Datos on-chain: para siempre. Son inmutables por diseño y están
            fuera de nuestro control.
          </li>
        </ul>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">8. Tus derechos</h2>
        <p>
          Puedes pedirnos acceder a lo que tenemos sobre ti, corregirlo o
          borrarlo. Cambiar tu alias lo haces tú desde tu perfil, cuando
          quieras.
        </p>
        <p>
          Con un límite que preferimos decirte de frente: lo que ya está en la
          cadena no se puede borrar. Tus transacciones y tu dirección seguirán
          siendo públicas en Celo aunque borremos todo lo que tenemos en nuestra
          base de datos.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">9. Menores</h2>
        <p>
          Avíspate no está dirigido a menores de 18 años y no recogemos datos de
          menores a sabiendas.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">10. Cambios</h2>
        <p>
          Actualizaremos esta página cuando la política cambie, y anunciaremos
          los cambios importantes dentro de la aplicación. La fecha de arriba
          indica siempre la versión vigente.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">11. Contacto</h2>
        <p>
          Para ejercer cualquiera de los derechos de la sección 8, o para
          preguntar qué tenemos sobre ti, escríbenos a <ContactLink />.
        </p>
      </section>
    </div>
  );
}

export function PrivacyEn() {
  const purposeLabel = "What for";
  const seesLabel = "What it sees";

  return (
    <div className="legal-doc">
      <section className="profile-section legal-section">
        <p>
          Avíspate is a game by Casgo Studio, an independent studio. This page
          explains exactly what data the game touches and what it does with it.
          It is short because the game collects little.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">1. What we collect</h2>
        <ul className="legal-list">
          <li>
            Your wallet address — the public identifier you play with.
          </li>
          <li>Your alias — the name you choose for the ranking.</li>
          <li>
            Your Privy identifier — an internal code linking your sign-in method
            to your profile.
          </li>
          <li>
            Your email — only if you sign in with email. Anyone who comes in
            through MiniPay or another wallet gives us no email at all.
          </li>
          <li>
            Your results — deck size, total time, average time, misses and
            accuracy for each finished game.
          </li>
          <li>
            Your transaction identifiers — the hash of every game and every
            Arena entry. These are public by nature.
          </li>
          <li>Your language — the one you pick, stored in a cookie.</li>
        </ul>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">
          2. What we do not collect and what we do not do
        </h2>
        <ul className="legal-list">
          <li>
            Real name, phone number, ID document or verification documents.
          </li>
          <li>
            Card or bank details: the game works only with USDT, never with cash
            or bank money.
          </li>
          <li>Your browsing activity outside Avíspate.</li>
          <li>
            We have no third-party analytics, no advertising and no trackers.
            The public statistics on /stats are computed from our own data and
            from what is already on the chain.
          </li>
          <li>
            Casgo Studio does not send you marketing emails, promotions or
            newsletters, and does not pass your email to third parties for that
            purpose. Do bear in mind that Privy, as the authentication service,
            can send you technical messages — sign-in codes or security notices
            about your account, for instance — because they are needed for you
            to get in.
          </li>
          <li>We never sell or rent any of this data.</li>
        </ul>
        <p>
          About your location: we do not ask for or store your precise location.
          The app does not request geolocation permission and we keep no
          location data in our database. Do bear in mind, though, that any
          internet service receives your IP address when you connect, and that
          an approximate location can be inferred from an IP; our providers
          process it technically in order to serve the app and verify the
          captcha.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">3. What we use it for</h2>
        <ul className="legal-list">
          <li>
            Wallet and alias — to identify your games, show you on the ranking
            and send prizes to the right address.
          </li>
          <li>
            Results and transactions — to build the ranking, verify that a game
            is valid and pay out the pots.
          </li>
          <li>
            Email — it is only kept as the record of the small network-fee
            contribution given once to each new embedded wallet, so that you can
            sign your first games. Casgo Studio uses it for nothing else.
          </li>
          <li>
            Your IP address — used on the spot to limit the rate of requests,
            and sent to Cloudflare when verifying the captcha for that initial
            contribution. We do not store it in our database.
          </li>
        </ul>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">4. What is public</h2>
        <p>Better you know before you play than after:</p>
        <ul className="legal-list">
          <li>
            Your alias, your shortened wallet address and your results appear on
            the public ranking and in the winners&apos; history. Anyone can see
            them.
          </li>
          <li>
            Everything that happens on the chain — your games, your entries,
            your prizes — is public and permanent by Celo&apos;s design. Anyone
            can look it up in a block explorer, and nobody, us included, can
            delete it.
          </li>
        </ul>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">5. Who we share it with</h2>
        <p>Only with the services that make the game work:</p>
        <ul className="legal-parties">
          <Party
            name="Privy"
            purposeLabel={purposeLabel}
            purpose="signing in with email and creating the embedded wallet"
            seesLabel={seesLabel}
            sees="your email and your wallet"
          />
          <Party
            name="Supabase"
            purposeLabel={purposeLabel}
            purpose="database"
            seesLabel={seesLabel}
            sees="profiles, aliases, results, games"
          />
          <Party
            name="Vercel"
            purposeLabel={purposeLabel}
            purpose="hosting the app"
            seesLabel={seesLabel}
            sees="technical request data"
          />
          <Party
            name="Cloudflare Turnstile"
            purposeLabel={purposeLabel}
            purpose="captcha for the initial network-fee contribution"
            seesLabel={seesLabel}
            sees="your IP at that moment"
          />
          <Party
            name="WalletConnect"
            purposeLabel={purposeLabel}
            purpose="connecting external wallets, outside MiniPay only"
            seesLabel={seesLabel}
            sees="your wallet when connecting"
          />
          <Party
            name="Celo RPC providers"
            purposeLabel={purposeLabel}
            purpose="reading and sending transactions"
            seesLabel={seesLabel}
            sees="your wallet and your transactions"
          />
        </ul>
        <p>
          Each has its own policies and handles your data under them.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">6. Cookies and storage on your device</h2>
        <p>
          A single cookie of our own: the one that remembers your language.
          There are no advertising or tracking cookies.
        </p>
        <p>
          Your browser&apos;s local storage holds two different classes of
          thing, and they are deliberately treated differently when you sign
          out:
        </p>
        <ul className="legal-list">
          <li>
            Identity and connection — your session and the wallet you had
            connected. This is cleared when you sign out.
          </li>
          <li>
            Records of payments already made — the proof needed to claim an
            Arena seat you already paid for, a payment not yet registered, and
            the queue of games waiting to be sent. This is NOT cleared when you
            sign out, deliberately: clearing it would make you lose an entry you
            already paid for.
          </li>
        </ul>
        <p>
          All of it lives only on your device. You can remove it completely by
          clearing your browser data, bearing in mind that if you do so with a
          paid entry pending, you will lose the way to claim it.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">7. How long we keep it</h2>
        <ul className="legal-list">
          <li>
            Profile, alias and results: for as long as the game keeps running,
            because they are the ranking.
          </li>
          <li>
            Email: for as long as the record of the initial contribution exists,
            or until you ask us to delete it.
          </li>
          <li>
            On-chain data: forever. It is immutable by design and outside our
            control.
          </li>
        </ul>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">8. Your rights</h2>
        <p>
          You can ask us to access what we hold about you, correct it or delete
          it. Changing your alias is something you do yourself from your
          profile, whenever you like.
        </p>
        <p>
          With one limit we would rather tell you up front: what is already on
          the chain cannot be deleted. Your transactions and your address will
          remain public on Celo even if we delete everything we hold in our
          database.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">9. Minors</h2>
        <p>
          Avíspate is not aimed at people under 18 and we do not knowingly
          collect data from minors.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">10. Changes</h2>
        <p>
          We will update this page when the policy changes, and we will announce
          significant changes inside the app. The date above always indicates
          the version in force.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">11. Contact</h2>
        <p>
          To exercise any of the rights in section 8, or to ask what we hold
          about you, write to <ContactLink />.
        </p>
      </section>
    </div>
  );
}
