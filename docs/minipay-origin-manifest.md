# Manifiesto de orígenes — Avíspate

Entregable del **Stage 2** de MiniPay: *"provide a full manifest of every URL,
subdomain, and origin your app calls (JS, CSS, fonts, RPCs, APIs). MiniPay
reviews this for supply-chain risk."*

Producción: **https://avispate.fun** · Cadena: **Celo mainnet (42220)**

Este documento es además la fuente de qué se precarga en `app/layout.tsx`: solo
se le da `preconnect` o `dns-prefetch` a lo que aparece marcado como **carga
inicial**. Precargar un origen perezoso ocupa una conexión y no ahorra nada.

---

## 1. Carga inicial — se piden al abrir la app

| Origen | Propósito | Precarga |
|---|---|---|
| `avispate.fun` | La propia app: HTML, JS, CSS, imágenes y todas las rutas `/api/*` | — (mismo origen) |
| `auth.privy.io` | SDK de Privy: sesión por correo y wallet embebida. El tercero más pesado (~936 KB según Lighthouse) | `preconnect` |
| `forno.celo.org` | RPC principal de Celo. Lecturas de contrato en la home: pozo del día y jugadas gratis | `dns-prefetch` |
| `celo.drpc.org` | RPC de respaldo de Celo. Failover automático de `lib/chain.ts` | `dns-prefetch` |

## 2. Bajo demanda — solo tras un gesto del jugador

| Origen | Propósito | Cuándo |
|---|---|---|
| `*.walletconnect.com`, `*.walletconnect.org` | WalletConnect v2: relay y explorador de wallets | Al abrir el selector de billeteras. **Nunca dentro de MiniPay** |
| `*.reown.com` | Reown / AppKit, dependencia de WalletConnect | Ídem |
| Coinbase Wallet SDK (CDN propio) | Conector de Coinbase Wallet | Al elegir Coinbase en el selector |
| `ethereum-rpc.publicnode.com` | RPC de Ethereum, solo para el puente | Al abrir el puente desde el perfil |
| `celoscan.io` | Enlaces a transacciones y premios | Al pulsar un enlace |
| `app.squidrouter.com` | Puente entre cadenas | Enlace saliente desde el perfil |

## 3. Solo servidor — el navegador nunca los llama

| Origen | Propósito |
|---|---|
| `*.supabase.co` | Base de datos. **Únicamente desde las rutas `/api/*`**, con la clave de servicio. El cliente habla con `avispate.fun/api`, jamás con Supabase directamente |
| `auth.privy.io` (API de servidor) | Verificación del token de Privy en `lib/privy-server.ts` |
| `forno.celo.org` | Liquidaciones y devoluciones desde el operator |

## 4. Sin origen externo

- **Tipografías** (Fredoka, Nunito): vía `next/font/google`, que las **auto-hospeda
  en el build**. No hay petición a Google en tiempo de ejecución.
- **Imágenes**: todas locales (`/logo-avispate.webp`, `/icon.png`).
- **Analítica**: no hay ninguna instalada a día de hoy.

## 5. Contratos propios (Celo mainnet)

| Contrato | Dirección | Verificado |
|---|---|---|
| `AvispatePot` | `0x48089fBD48576390bfd68d106d21715200E0207f` | Celoscan — *Exact Match*, solc 0.8.24, optimizador 200 |
| `AvispateArena` | `0x095226a21FA618991672339fD94381611F429c62` | Celoscan y Sourcify — solc 0.8.24, optimizador 200 |

Token: **USDT en Celo** `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` (inmutable, 6 decimales).

---

*Última revisión: 2026-08-09. Reconfirmar en la pestaña Network de producción
antes de enviar el formulario.*
