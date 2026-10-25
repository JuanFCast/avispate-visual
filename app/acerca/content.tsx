import Link from "next/link";
import { CONTACT_EMAIL, ContractLinks } from "../terminos/content";

/**
 * Texto de "Acerca de", en español y en inglés.
 *
 * Mismo motivo que los Términos para vivir aquí y no en el diccionario: son
 * componentes de servidor, el jugador recibe HTML y cero JS por ellos.
 *
 * Las cifras (0,10 USDT, 20 %, 7:00 p. m.) son las mismas que dicen los
 * Términos. Si cambian allí, cambian aquí.
 */

function ContactLink() {
  return <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
}

export function AboutEs() {
  return (
    <div className="legal-doc">
      <section className="profile-section legal-section">
        <h2 className="section-title">Qué es Avíspate</h2>
        <p>
          Avíspate es un juego de agilidad visual sobre la red Celo. Cada carta
          comparte exactamente un símbolo con la anterior: lo encuentras, lo
          tocas y sigues. Gana quien vea más rápido.
        </p>
        <p>Lo hace Casgo Studio, un estudio independiente.</p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">Dos formas de jugar</h2>
        <p>
          <strong>Reto diario.</strong> Mazos de 10, 15 y 20 cartas, cada uno
          con su propio pozo en USDT. Tienes una jugada gratis al día por mazo;
          las siguientes cuestan 0,10 USDT. Quien tenga el mejor tiempo promedio
          del día se lleva el pozo de ese mazo, que se paga solo a las 7:00 p.
          m. (Colombia).
        </p>
        <p>
          <strong>Arena.</strong> Partidas en vivo de 2 a 4 personas, en salas
          rápidas o privadas con código. Cada quien pone su entrada, y el
          primero en vaciar su mazo se lleva el pozo menos una comisión del 20
          %, en cuanto termina la partida. Si la mesa no llega a empezar, cada
          entrada se devuelve entera.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">Tu dinero es tuyo</h2>
        <p>
          Juegas con tu propia wallet —MiniPay, una wallet creada con tu correo
          o la que ya uses— y nunca guardamos tus fondos ni tus llaves. Los
          premios los paga el contrato directamente a tu wallet; no hay nada que
          reclamar.
        </p>
        <p>
          El código de los dos contratos está publicado y verificado:
        </p>
        <ContractLinks />
        <p>
          Avíspate no es operado ni respaldado por MiniPay ni por Celo.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">Contacto</h2>
        <p>
          ¿Una duda, un error o una idea? Escríbenos a <ContactLink />. Lo lee
          una persona.
        </p>
        <p>
          Más: <Link href="/stats">estadísticas en vivo</Link> ·{" "}
          <Link href="/historial">historial de ganadores</Link> ·{" "}
          <Link href="/terminos">términos</Link> ·{" "}
          <Link href="/privacidad">privacidad</Link>.
        </p>
      </section>
    </div>
  );
}

export function AboutEn() {
  return (
    <div className="legal-doc">
      <section className="profile-section legal-section">
        <h2 className="section-title">What Avíspate is</h2>
        <p>
          Avíspate is a visual speed game on the Celo network. Every card shares
          exactly one symbol with the one before it: spot it, tap it, keep
          going. Whoever sees fastest wins.
        </p>
        <p>It is made by Casgo Studio, an independent studio.</p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">Two ways to play</h2>
        <p>
          <strong>Daily challenge.</strong> Decks of 10, 15 and 20 cards, each
          with its own USDT pot. You get one free game a day per deck; after
          that each game costs 0.10 USDT. The best average time of the day takes
          that deck&apos;s pot, paid automatically at 7:00 p.m. (Colombia).
        </p>
        <p>
          <strong>Arena.</strong> Live matches for 2 to 4 people, in quick rooms
          or private rooms with a code. Everyone puts in their entry, and the
          first to empty their deck takes the pot minus a 20% fee, as soon as
          the match ends. If a table never starts, every entry is refunded in
          full.
        </p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">Your money stays yours</h2>
        <p>
          You play with your own wallet —MiniPay, a wallet created from your
          email, or the one you already use— and we never hold your funds or
          your keys. Prizes are paid by the contract straight to your wallet;
          there is nothing to claim.
        </p>
        <p>The code of both contracts is published and verified:</p>
        <ContractLinks />
        <p>Avíspate is not operated or endorsed by MiniPay or Celo.</p>
      </section>

      <section className="profile-section legal-section">
        <h2 className="section-title">Contact</h2>
        <p>
          A question, a bug or an idea? Write to us at <ContactLink />. A person
          reads it.
        </p>
        <p>
          More: <Link href="/stats">live stats</Link> ·{" "}
          <Link href="/historial">winners history</Link> ·{" "}
          <Link href="/terminos">terms</Link> ·{" "}
          <Link href="/privacidad">privacy</Link>.
        </p>
      </section>
    </div>
  );
}
