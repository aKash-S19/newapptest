import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

// ─── Config (injected via app.config.js → expo-constants) ────────────────────
const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;

const SUPABASE_URL  = extra.supabaseUrl  ?? 'https://roqqrtbohtqadmkhgffr.supabase.co';
const SUPABASE_ANON = extra.supabaseAnonKey ?? '';
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

// ─── Supabase JS client (for realtime, etc.) ───────────────────────────
export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  realtime: { params: { eventsPerSecond: 10 } },
});

// Alias for backwards compatibility
export const supabase = supabaseClient;

// ─── Generic caller ───────────────────────────────────────────────────────────
/**
 * Call the Supabase `auth` edge function via plain fetch.
 * Accepts any action payload — type safety lives in AuthContext.
 */
export async function callAuthFunction(payload: Record<string, unknown>): Promise<any> {
  const { data } = await supabaseClient.auth.getSession();
  const accessToken = data.session?.access_token ?? '';

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const invoke = async () => {
    let response: Response;
    try {
      response = await fetch(`${FUNCTIONS_URL}/auth`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        SUPABASE_ANON,
          'Authorization': accessToken ? `Bearer ${accessToken}` : `Bearer ${SUPABASE_ANON}`,
        },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new Error('Network error — check your internet connection and try again.');
    }

    const rawText = await response.text();

    let json: any = null;
    if (rawText) {
      try {
        json = JSON.parse(rawText);
      } catch {
        if (response.ok) {
          throw new Error(`Server returned an invalid response (HTTP ${response.status}).`);
        }
      }
    }

    return { response, json, rawText };
  };

  const MAX_TRANSIENT_RETRIES = 4;
  const transientBackoffMs = [500, 900, 1400, 2200];
  let transientRetryCount = 0;

  while (true) {
    try {
      let { response, json, rawText } = await invoke();

      const looksLikeSchemaCacheError =
        !response.ok &&
        typeof json?.error === 'string' &&
        /schema cache|Could not find the table/i.test(json.error);

      // PostgREST schema cache can lag briefly right after migrations/deploys.
      if (looksLikeSchemaCacheError) {
        await sleep(1200);

        // Ask backend to trigger an explicit schema cache reload when possible.
        if (payload.action !== 'reload-schema-cache') {
          try {
            await fetch(`${FUNCTIONS_URL}/auth`, {
              method: 'POST',
              headers: {
                'Content-Type':  'application/json',
                'apikey':        SUPABASE_ANON,
                'Authorization': `Bearer ${SUPABASE_ANON}`,
              },
              body: JSON.stringify({ action: 'reload-schema-cache' }),
            });
          } catch {
            // Ignore and continue with retry.
          }
          await sleep(600);
        }

        ({ response, json, rawText } = await invoke());
      }

      if (!response.ok) {
        const status = Number(response.status);
        const rawSnippet = rawText?.slice(0, 220).trim() ?? '';
        const isTransientGatewayError =
          status === 502 ||
          status === 503 ||
          status === 504 ||
          status === 520 ||
          status === 522 ||
          status === 524 ||
          /bad gateway|upstream connect|temporarily unavailable/i.test(rawSnippet);

        if (isTransientGatewayError && transientRetryCount < MAX_TRANSIENT_RETRIES) {
          const backoff = transientBackoffMs[Math.min(transientRetryCount, transientBackoffMs.length - 1)] ?? 500;
          transientRetryCount += 1;
          await sleep(backoff);
          continue;
        }

        throw new Error(json?.error ?? (rawSnippet ? `Server error ${status}: ${rawSnippet}` : `Server error ${status}`));
      }

      return json;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
      const isNetworkError = /Network error/i.test(message);

      if (isNetworkError && transientRetryCount < MAX_TRANSIENT_RETRIES) {
        const backoff = transientBackoffMs[Math.min(transientRetryCount, transientBackoffMs.length - 1)] ?? 500;
        transientRetryCount += 1;
        await sleep(backoff);
        continue;
      }

      throw error;
    }
  }
}
