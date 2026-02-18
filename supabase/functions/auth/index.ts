import { createClient } from "jsr:@supabase/supabase-js@2";
import { argon2id, argon2Verify } from "npm:hash-wasm";

// ─── CORS ────────────────────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const fail = (msg: string, status: number) =>
  new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

// ─── DB ───────────────────────────────────────────────────────────────────────
function db() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );
}

// ─── Argon2id via WebAssembly (hash-wasm — works in Deno) ────────────────────
async function hashPin(pin: string): Promise<string> {
  return argon2id({
    password: pin,
    salt: crypto.getRandomValues(new Uint8Array(16)),
    parallelism: 1,
    iterations: 3,
    memorySize: 65536,
    hashLength: 32,
    outputType: "encoded",
  });
}

async function verifyPin(hash: string, pin: string): Promise<boolean> {
  return argon2Verify({ password: pin, hash });
}

// ─── Handler ─────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: CORS });
  }

  let body: { action?: string; username?: string; emojiKey?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON", 400);
  }

  const { action, username, emojiKey } = body;
  if (!action || !username || !emojiKey) {
    return fail("Missing: action, username, emojiKey", 400);
  }

  const pin = Array.isArray(emojiKey) ? emojiKey.join("") : String(emojiKey);

  // ── Register ─────────────────────────────────────────────────────────────
  if (action === "register") {
    const { data: existing } = await db()
      .from("users").select("id").eq("username", username).maybeSingle();

    if (existing) return fail("Username already taken", 409);

    const hash = await hashPin(pin);

    const { data: newUser, error: insertErr } = await db()
      .from("users")
      .insert({ username, password_hash: hash })
      .select("id, username, created_at")
      .single();

    if (insertErr) return fail(insertErr.message, 500);
    return ok({ success: true, action: "register", user: newUser });
  }

  // ── Login ─────────────────────────────────────────────────────────────────
  if (action === "login") {
    const { data: user, error: fetchErr } = await db()
      .from("users")
      .select("id, username, password_hash, created_at")
      .eq("username", username)
      .maybeSingle();

    if (fetchErr) return fail(fetchErr.message, 500);
    if (!user)   return fail("Username not found", 404);

    const valid = await verifyPin(user.password_hash, pin);
    if (!valid) return fail("Wrong emoji pin", 401);

    return ok({
      success: true,
      action: "login",
      user: { id: user.id, username: user.username, created_at: user.created_at },
    });
  }

  return fail(`Unknown action: ${action}`, 400);
});