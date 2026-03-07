// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ok   = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", ...CORS } });
const fail = (msg: string, status = 400) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: { "Content-Type": "application/json", ...CORS } });

function db() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

function token() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(b).map(x => x.toString(16).padStart(2, "0")).join("");
}

async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: CORS });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail("Invalid JSON"); }

  const { action } = body;
  if (!action) return fail("Missing action");

  const supabase = db();

  // ?????? register ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
  // ── register ─────────────────────────────────────────────────────────────
  if (action === "register") {
    const { username, emojiKey, deviceId } = body;
    if (!username) return fail("Missing username", 400);
    if (!emojiKey) return fail("Missing emojiKey", 400);
    if (!deviceId) return fail("Missing deviceId", 400);

    const uname = (username as string).trim().toLowerCase();
    const dId   = (deviceId  as string).trim();
    const pin   = Array.isArray(emojiKey) ? (emojiKey as string[]).join("") : String(emojiKey);
    const hashedPin = await hashPin(pin);

    // Validate username server-side
    if (!/^[a-z0-9_]{4,20}$/.test(uname)) return fail("Invalid username format");

    // Check device not already registered
    const { data: existingDevice } = await supabase.from("users").select("id").eq("device_hash", dId).limit(1).maybeSingle();
    if (existingDevice) return fail("Device already registered", 409);

    // Check username not taken
    const { data: existingName } = await supabase.from("users").select("id").eq("username", uname).limit(1).maybeSingle();
    if (existingName) return fail("Username already taken", 409);

    const { data: newUser, error } = await supabase
      .from("users")
      .insert({
        username:      uname,
        password_hash: hashedPin,
        device_hash:   dId,
      })
      .select("id, username, created_at")
      .single();

    if (error) return fail(error.message, 500);

    const sessionToken = token();
    const exp = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from("sessions").insert({ user_id: newUser.id, token_hash: sessionToken, expires_at: exp });

    return ok({ success: true, user: newUser, sessionToken });
  }

  // ?????? login ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
  // ── login (device-based) ─────────────────────────────────────────────────────────
  if (action === "login") {
    const { emojiKey, deviceId } = body;
    if (!emojiKey || !deviceId) return fail("Missing fields");

    const pin = Array.isArray(emojiKey) ? (emojiKey as string[]).join("") : String(emojiKey);
    const hashedPin = await hashPin(pin);

    const { data: user, error: userError } = await supabase.from("users")
      .select("id, username, password_hash, created_at")
      .eq("device_hash", (deviceId as string).trim()).limit(1).maybeSingle();

    if (userError || !user || user.password_hash !== hashedPin) return fail("Invalid credentials", 401);

    const sessionToken = token();
    const exp = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from("sessions").insert({ user_id: user.id, token_hash: sessionToken, expires_at: exp });

    return ok({ success: true, user: { id: user.id, username: user.username, created_at: user.created_at }, sessionToken });
  }

  // ── login-username (manual login) ──────────────────────────────────────────────
  if (action === "login-username") {
    const { username, emojiKey, deviceId } = body;
    if (!username || !emojiKey || !deviceId) return fail("Missing fields");

    const uname = (username as string).trim().toLowerCase();
    const pin = Array.isArray(emojiKey) ? (emojiKey as string[]).join("") : String(emojiKey);
    const hashedPin = await hashPin(pin);

    // Look up by username
    const { data: user, error: userError } = await supabase.from("users")
      .select("id, username, password_hash, created_at")
      .eq("username", uname).limit(1).maybeSingle();

    if (userError || !user || user.password_hash !== hashedPin) return fail("Invalid username or pin", 401);

    // Update their device_hash to the new device so future logins work seamlessly
    await supabase.from("users").update({ device_hash: (deviceId as string).trim() }).eq("id", user.id);

    // Clear old sessions and issue a new one
    await supabase.from("sessions").delete().eq("user_id", user.id);
    const sessionToken = token();
    const exp = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from("sessions").insert({ user_id: user.id, token_hash: sessionToken, expires_at: exp });

    return ok({ success: true, user: { id: user.id, username: user.username, created_at: user.created_at }, sessionToken });
  }

  // ?????? recover-init ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
  if (action === "recover-init") {
    const { username } = body as { username?: string };
    if (!username) return fail("Missing username");
    const { data } = await supabase.from("users").select("security_question").eq("username", (username as string).trim().toLowerCase()).maybeSingle();
    return ok({ question: data?.security_question ?? "What's a word only you would think of?" });
  }

  // ?????? recover-verify ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
  if (action === "recover-verify") {
    const { username, answer, newEmojiKey } = body;
    if (!username || !answer || !newEmojiKey) return fail("Missing fields");
    const uname = (username as string).trim().toLowerCase();
    const { data: user } = await supabase.from("users").select("id, username, security_answer_hash, created_at").eq("username", uname).limit(1).maybeSingle();
    if (!user) return fail("Invalid credentials", 401);
    if (user.security_answer_hash !== (answer as string).trim().toLowerCase()) return fail("Invalid credentials", 401);
    const pin = Array.isArray(newEmojiKey) ? (newEmojiKey as string[]).join("") : String(newEmojiKey);
    const hashedPin = await hashPin(pin);
    await supabase.from("users").update({ password_hash: hashedPin }).eq("id", user.id);
    await supabase.from("sessions").delete().eq("user_id", user.id);
    const sessionToken = token();
    const exp = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from("sessions").insert({ user_id: user.id, token_hash: sessionToken, expires_at: exp });
    return ok({ success: true, user: { id: user.id, username: user.username, created_at: user.created_at }, sessionToken });
  }

  // ?????? signout ?????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
  if (action === "signout") {
    const { sessionToken } = body as { sessionToken?: string };
    if (sessionToken) await supabase.from("sessions").delete().eq("token_hash", sessionToken);
    return ok({ success: true });
  }

  // ?????? delete-account ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
  if (action === "delete-account") {
    const { sessionToken, emojiKey } = body;
    if (!sessionToken || !emojiKey) return fail("Missing fields");
    const { data: session } = await supabase.from("sessions").select("user_id").eq("token_hash", sessionToken as string).maybeSingle();
    if (!session) return fail("Invalid session", 401);
    const { data: user } = await supabase.from("users").select("password_hash").eq("id", session.user_id).limit(1).maybeSingle();
    if (!user) return fail("User not found", 404);
    const pin = Array.isArray(emojiKey) ? (emojiKey as string[]).join("") : String(emojiKey);
    const hashedPin = await hashPin(pin);
    if (user.password_hash !== hashedPin) return fail("Invalid credentials", 401);
    await supabase.from("users").delete().eq("id", session.user_id);
    return ok({ success: true });
  }

  // ?????? find-user ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
  if (action === "find-user") {
    const { query, sessionToken } = body as { query?: string; sessionToken?: string };
    if (!sessionToken) return fail("Unauthorized", 401);
    const { data: session } = await supabase.from("sessions").select("user_id").eq("token_hash", sessionToken).maybeSingle();
    if (!session) return fail("Invalid session", 401);
    if (!query || (query as string).trim().length < 2) return ok({ users: [] });
    const { data: users } = await supabase.from("users")
      .select("id, username, created_at")
      .ilike("username", `${(query as string).trim().toLowerCase()}%`)
      .neq("id", session.user_id).limit(20);
    return ok({ users: users ?? [] });
  }

  // ?????? check-username ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
  if (action === "check-username") {
    const { username } = body as { username?: string };
    if (!username) return fail("Missing username");
    const { data } = await supabase.from("users").select("id").eq("username", (username as string).trim().toLowerCase()).maybeSingle();
    return ok({ available: !data });
  }

  // ?????? check-device ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
  // ── check-device ─────────────────────────────────────────────────────────────────
  if (action === "check-device") {
    const { deviceId } = body as { deviceId?: string };
    if (!deviceId) return ok({ found: false });
    const { data } = await supabase.from("users")
      .select("id, username, created_at")
      .eq("device_hash", (deviceId as string).trim()).maybeSingle();
    if (!data) return ok({ found: false });
    return ok({ found: true, user: { id: data.id, username: data.username, created_at: data.created_at } });
  }

  // ── send-request ─────────────────────────────────────────────────────────────
  if (action === "send-request") {
    const { sessionToken, toUserId } = body;
    if (!sessionToken || !toUserId) return fail("Missing fields");
    const { data: session } = await supabase.from("sessions").select("user_id").eq("token_hash", sessionToken as string).maybeSingle();
    if (!session) return fail("Invalid session", 401);
    if (session.user_id === toUserId) return fail("Cannot send request to yourself", 400);
    // Upsert so re-sending a declined request works
    const { error } = await supabase.from("friend_requests")
      .upsert({ sender_id: session.user_id, receiver_id: toUserId as string, status: "pending", updated_at: new Date().toISOString() },
        { onConflict: "sender_id,receiver_id" });
    if (error) return fail(error.message, 500);
    return ok({ success: true });
  }

  // ── accept-request ───────────────────────────────────────────────────────────
  if (action === "accept-request") {
    const { sessionToken, requestId } = body;
    if (!sessionToken || !requestId) return fail("Missing fields");
    const { data: session } = await supabase.from("sessions").select("user_id").eq("token_hash", sessionToken as string).maybeSingle();
    if (!session) return fail("Invalid session", 401);
    const { error } = await supabase.from("friend_requests")
      .update({ status: "accepted", updated_at: new Date().toISOString() })
      .eq("id", requestId as string).eq("receiver_id", session.user_id).eq("status", "pending");
    if (error) return fail(error.message, 500);
    return ok({ success: true });
  }

  // ── decline-request ──────────────────────────────────────────────────────────
  if (action === "decline-request") {
    const { sessionToken, requestId } = body;
    if (!sessionToken || !requestId) return fail("Missing fields");
    const { data: session } = await supabase.from("sessions").select("user_id").eq("token_hash", sessionToken as string).maybeSingle();
    if (!session) return fail("Invalid session", 401);
    const { error } = await supabase.from("friend_requests")
      .update({ status: "declined", updated_at: new Date().toISOString() })
      .eq("id", requestId as string).eq("receiver_id", session.user_id).eq("status", "pending");
    if (error) return fail(error.message, 500);
    return ok({ success: true });
  }

  // ── cancel-request ───────────────────────────────────────────────────────────
  if (action === "cancel-request") {
    const { sessionToken, requestId } = body;
    if (!sessionToken || !requestId) return fail("Missing fields");
    const { data: session } = await supabase.from("sessions").select("user_id").eq("token_hash", sessionToken as string).maybeSingle();
    if (!session) return fail("Invalid session", 401);
    const { error } = await supabase.from("friend_requests")
      .delete().eq("id", requestId as string).eq("sender_id", session.user_id);
    if (error) return fail(error.message, 500);
    return ok({ success: true });
  }

  // ── get-requests ─────────────────────────────────────────────────────────────
  if (action === "get-requests") {
    const { sessionToken } = body;
    if (!sessionToken) return fail("Missing session", 401);
    const { data: session } = await supabase.from("sessions").select("user_id").eq("token_hash", sessionToken as string).maybeSingle();
    if (!session) return fail("Invalid session", 401);
    const uid = session.user_id;

    const { data: received } = await supabase.from("friend_requests")
      .select("id, status, created_at, sender:sender_id(id, username)")
      .eq("receiver_id", uid).eq("status", "pending").order("created_at", { ascending: false });

    const { data: sent } = await supabase.from("friend_requests")
      .select("id, status, created_at, receiver:receiver_id(id, username)")
      .eq("sender_id", uid).eq("status", "pending").order("created_at", { ascending: false });

    return ok({ received: received ?? [], sent: sent ?? [] });
  }

  // ── update-username ──────────────────────────────────────────────────────────
  if (action === "update-username") {
    const { sessionToken, newUsername } = body;
    if (!sessionToken || !newUsername) return fail("Missing fields");
    const { data: session } = await supabase.from("sessions").select("user_id").eq("token_hash", sessionToken as string).maybeSingle();
    if (!session) return fail("Invalid session", 401);
    const uname = (newUsername as string).trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(uname)) return fail("Username must be 3-20 chars, letters/numbers/underscore");
    const { data: taken } = await supabase.from("users").select("id").eq("username", uname).neq("id", session.user_id).maybeSingle();
    if (taken) return fail("Username already taken", 409);
    const { data: updated, error } = await supabase.from("users")
      .update({ username: uname }).eq("id", session.user_id)
      .select("id, username, created_at, avatar_url").single();
    if (error) return fail(error.message, 500);
    return ok({ success: true, user: updated });
  }

  // ── update-avatar ────────────────────────────────────────────────────────────
  if (action === "update-avatar") {
    const { sessionToken, avatarUrl } = body;
    if (!sessionToken || !avatarUrl) return fail("Missing fields");
    const { data: session } = await supabase.from("sessions").select("user_id").eq("token_hash", sessionToken as string).maybeSingle();
    if (!session) return fail("Invalid session", 401);
    const { data: updated, error } = await supabase.from("users")
      .update({ avatar_url: avatarUrl as string }).eq("id", session.user_id)
      .select("id, username, created_at, avatar_url").single();
    if (error) return fail(error.message, 500);
    return ok({ success: true, user: updated });
  }

  // ── get-sessions ─────────────────────────────────────────────────────────────
  if (action === "get-sessions") {
    const { sessionToken } = body;
    if (!sessionToken) return fail("Missing session", 401);
    const { data: session } = await supabase.from("sessions").select("user_id").eq("token_hash", sessionToken as string).maybeSingle();
    if (!session) return fail("Invalid session", 401);
    const { data: sessions } = await supabase.from("sessions")
      .select("id, created_at, expires_at")
      .eq("user_id", session.user_id)
      .order("created_at", { ascending: false });
    return ok({ sessions: sessions ?? [] });
  }

  // ── revoke-session ───────────────────────────────────────────────────────────
  if (action === "revoke-session") {
    const { sessionToken, revokeId } = body;
    if (!sessionToken || !revokeId) return fail("Missing fields");
    const { data: session } = await supabase.from("sessions").select("user_id").eq("token_hash", sessionToken as string).maybeSingle();
    if (!session) return fail("Invalid session", 401);
    const { error } = await supabase.from("sessions")
      .delete().eq("id", revokeId as string).eq("user_id", session.user_id);
    if (error) return fail(error.message, 500);
    return ok({ success: true });
  }

  // ── get-upload-url (signed upload URL for avatar) ────────────────────────────
  if (action === "get-upload-url") {
    const { sessionToken } = body;
    if (!sessionToken) return fail("Missing session", 401);
    const { data: session } = await supabase.from("sessions").select("user_id").eq("token_hash", sessionToken as string).maybeSingle();
    if (!session) return fail("Invalid session", 401);
    const filePath = `${session.user_id}.jpg`;
    const { data, error } = await supabase.storage.from("avatars").createSignedUploadUrl(filePath);
    if (error) return fail(error.message, 500);
    const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(filePath);
    return ok({ signedUrl: data.signedUrl, path: data.path, token: data.token, publicUrl: urlData.publicUrl });
  }

  return fail(`Unknown action: ${action}`);
});
