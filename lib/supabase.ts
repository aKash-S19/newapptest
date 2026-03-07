import Constants from 'expo-constants';
import { createClient } from '@supabase/supabase-js';

// ─── Config (injected via app.config.js → expo-constants) ────────────────────
const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;

const SUPABASE_URL  = extra.supabaseUrl  ?? 'https://roqqrtbohtqadmkhgffr.supabase.co';
const SUPABASE_ANON = extra.supabaseAnonKey ?? '';
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

// ─── Supabase JS client (for realtime, etc.) ───────────────────────────
export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 10 } },
});

// ─── Generic caller ───────────────────────────────────────────────────────────
/**
 * Call the Supabase `auth` edge function via plain fetch.
 * Accepts any action payload — type safety lives in AuthContext.
 */
export async function callAuthFunction(payload: Record<string, unknown>): Promise<any> {
  let response: Response;
  try {
    response = await fetch(`${FUNCTIONS_URL}/auth`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SUPABASE_ANON,
        'Authorization': `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('Network error — check your internet connection and try again.');
  }

  let json: any;
  try {
    json = await response.json();
  } catch {
    throw new Error(`Server returned an invalid response (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    throw new Error(json?.error ?? `Server error ${response.status}`);
  }

  return json;
}
