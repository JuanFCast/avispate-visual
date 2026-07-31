"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let cached: SupabaseClient | null = null;

/**
 * Cliente Supabase del NAVEGADOR, con la anon key. Se usa para una sola cosa:
 * los canales de broadcast de Realtime, que avisan "algo cambió en esta sala"
 * para que la pantalla vuelva a preguntar por el estado.
 *
 * No lee tablas. Las de la Arena tienen RLS sin políticas y no están en la
 * publicación de Realtime, así que ni el mensaje ni este cliente pueden sacar
 * datos de la base: el estado siempre baja por `/api`, verificado contra Privy.
 * El broadcast solo acorta la espera entre un latido y el siguiente.
 *
 * Devuelve `null` si falta la anon key. No es un error: sin ella la sala sigue
 * funcionando con los latidos, solo que los cambios tardan unos segundos más.
 */
export function getSupabaseBrowser(): SupabaseClient | null {
  if (!url || !anonKey) return null;
  if (!cached) {
    cached = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 4 } },
    });
  }
  return cached;
}
