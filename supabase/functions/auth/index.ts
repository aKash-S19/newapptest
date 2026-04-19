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

function adminDb() {
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

const PIN_HASH_PREFIX = "pbkdf2_sha256";
const PIN_HASH_ITERATIONS = 210_000;
const SESSION_HASH_PREFIX = "sha256";
const DEVICE_HASH_PREFIX = "sha256";
const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_TOKEN_RE = /^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/;
const LEGACY_HEX_HASH_RE = /^[a-f0-9]{64}$/i;
const ENCRYPTED_PAYLOAD_RE = /^[A-Za-z0-9+/]+={0,2}\.[A-Za-z0-9+/]+={0,2}$/;
const CALL_SIGNAL_TYPES = new Set(["offer", "answer", "ice", "end", "decline", "busy"]);
const SUPPORTED_DIRECT_MESSAGE_TYPES = new Set(["text", "image", "file"]);
const CALL_EVENT_MIME = "application/x-privy-call-event";
const CALL_EVENT_FILE_PREFIX = "call:";
const CALL_EVENT_STATUSES = new Set(["completed", "missed", "declined", "busy"]);

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  if (!hex || hex.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(hex)) return new Uint8Array(0);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const decoded = atob(value);
    const out = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) out[i] = decoded.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function isValidPublicKey(publicKey: string): boolean {
  const keyBytes = base64ToBytes(publicKey.trim());
  return !!keyBytes && keyBytes.length === 65 && keyBytes[0] === 0x04;
}

function isEncryptedPayload(payload: string): boolean {
  const trimmed = payload.trim();
  if (!ENCRYPTED_PAYLOAD_RE.test(trimmed)) return false;
  const [ivB64, ctB64] = trimmed.split(".");
  const iv = base64ToBytes(ivB64);
  const ct = base64ToBytes(ctB64);
  if (!iv || !ct) return false;
  if (iv.length !== 12) return false;
  // AES-GCM ciphertext includes a 16-byte auth tag.
  return ct.length >= 16;
}

async function sha256Hex(value: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(hashBuffer));
}

async function hashSessionToken(rawToken: string): Promise<string> {
  return `${SESSION_HASH_PREFIX}:${await sha256Hex(rawToken)}`;
}

async function hashDeviceId(deviceId: string): Promise<string> {
  return `${DEVICE_HASH_PREFIX}:${await sha256Hex(deviceId)}`;
}

async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: PIN_HASH_ITERATIONS,
    },
    keyMaterial,
    256,
  );
  const hashHex = bytesToHex(new Uint8Array(bits));
  return `${PIN_HASH_PREFIX}$${PIN_HASH_ITERATIONS}$${bytesToHex(salt)}$${hashHex}`;
}

async function verifyPin(pin: string, storedHash: string): Promise<{ ok: boolean; shouldUpgrade: boolean }> {
  if (!storedHash) return { ok: false, shouldUpgrade: false };

  if (storedHash.startsWith(`${PIN_HASH_PREFIX}$`)) {
    const parts = storedHash.split("$");
    if (parts.length !== 4) return { ok: false, shouldUpgrade: false };
    const [, iterRaw, saltHex, expectedHex] = parts;
    const iterations = Number(iterRaw);
    const salt = hexToBytes(saltHex);
    const expected = hexToBytes(expectedHex);
    if (!Number.isFinite(iterations) || iterations < 1000 || salt.length === 0 || expected.length === 0) {
      return { ok: false, shouldUpgrade: false };
    }
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(pin),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt,
        iterations,
      },
      keyMaterial,
      expected.length * 8,
    );
    const actual = bytesToHex(new Uint8Array(bits));
    return { ok: actual === expectedHex.toLowerCase(), shouldUpgrade: false };
  }

  // Backwards compatibility for old unsalted SHA-256 hashes.
  if (LEGACY_HEX_HASH_RE.test(storedHash)) {
    const legacyHex = await sha256Hex(pin);
    return {
      ok: legacyHex === storedHash.toLowerCase(),
      shouldUpgrade: true,
    };
  }

  return { ok: false, shouldUpgrade: false };
}

async function requireUser(req: Request, admin: ReturnType<typeof adminDb>) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

async function userFromSessionToken(sessionToken: string, admin: ReturnType<typeof adminDb>) {
  if (!sessionToken) return null;

  const hashedToken = await hashSessionToken(sessionToken);
  let { data: session } = await admin
    .from("sessions")
    .select("id, user_id, expires_at, token_hash")
    .eq("token_hash", hashedToken)
    .maybeSingle();

  if (!session) {
    const { data: legacySession } = await admin
      .from("sessions")
      .select("id, user_id, expires_at, token_hash")
      .eq("token_hash", sessionToken)
      .maybeSingle();
    session = legacySession ?? null;

    // Migrate legacy plain session token hash in-place.
    if (session?.id) {
      await admin
        .from("sessions")
        .update({ token_hash: hashedToken })
        .eq("id", session.id);
    }
  }

  if (!session) return null;
  if (session.expires_at && new Date(session.expires_at) < new Date()) {
    await admin.from("sessions").delete().eq("id", session.id);
    return null;
  }

  const { data: user } = await admin
    .from("users")
    .select("id, username, created_at, avatar_url")
    .eq("id", session.user_id)
    .maybeSingle();
  return user ?? null;
}

async function resolveUser(
  body: Record<string, unknown>,
  authUser: Awaited<ReturnType<typeof requireUser>>,
  admin: ReturnType<typeof adminDb>,
) {
  if (authUser?.id) {
    const { data: user } = await admin
      .from("users")
      .select("id, username, created_at, avatar_url")
      .eq("id", authUser.id)
      .maybeSingle();
    if (user) return user;
  }
  const sessionToken = typeof body.sessionToken === "string" ? body.sessionToken : "";
  return userFromSessionToken(sessionToken, admin);
}

function inviteCode(len = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function isGroupKind(kind: string) {
  return kind === "avatar" || kind === "banner";
}

function emailFromUsername(username: string) {
  const cleaned = username.trim().toLowerCase();
  return `${cleaned}@privy.local`;
}

const SETTINGS_FIELDS: Record<string, 'string' | 'boolean' | 'object'> = {
  accentColor: 'string',
  darkMode: 'boolean',
  bubbleStyle: 'string',
  fontSize: 'string',
  readReceipts: 'boolean',
  typingIndicator: 'boolean',
  disappearDefault: 'string',
  autoDownload: 'boolean',
  biometricLock: 'boolean',
  whoCanMessage: 'string',
  whoCanAddToGroup: 'string',
  msgNotifs: 'boolean',
  muteGroups: 'boolean',
  dnd: 'boolean',
  notificationSound: 'string',
  chatCustomizations: 'object',
};

function sanitizeChatCustomizations(input: any) {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, { color?: string; nickname?: string }> = {};
  for (const [chatId, value] of Object.entries(input)) {
    if (!chatId || typeof value !== 'object' || !value) continue;
    const v = value as { color?: unknown; nickname?: unknown };
    const next: { color?: string; nickname?: string } = {};
    if (typeof v.nickname === 'string') {
      const n = v.nickname.trim().slice(0, 40);
      if (n) next.nickname = n;
    }
    if (typeof v.color === 'string') {
      const c = v.color.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(c)) next.color = c.toUpperCase();
    }
    if (next.nickname || next.color) out[chatId] = next;
  }
  return out;
}

function sanitizeSettings(input: any) {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, string | boolean | Record<string, { color?: string; nickname?: string }>> = {};
  for (const key of Object.keys(SETTINGS_FIELDS)) {
    const type = SETTINGS_FIELDS[key];
    const val = input[key];
    if (type === 'boolean' && typeof val === 'boolean') out[key] = val;
    if (type === 'string' && typeof val === 'string') out[key] = val;
    if (type === 'object' && key === 'chatCustomizations') out[key] = sanitizeChatCustomizations(val);
  }
  return out;
}

function isValidExpoPushToken(value: string): boolean {
  return EXPO_PUSH_TOKEN_RE.test(value.trim());
}

function messagePreviewForPush(msgType: string): string {
  if (msgType === "image") return "Photo";
  if (msgType === "file") return "Document";
  if (msgType === "voice") return "Voice message";
  if (msgType === "video") return "Video";
  return "New message";
}

function formatPushBody(preview: string, unreadCount: number): string {
  const count = Number.isFinite(unreadCount) ? Math.max(1, Math.floor(unreadCount)) : 1;
  return count > 1 ? `${preview} (${count} unread)` : preview;
}

async function userHasActiveSession(
  supabase: ReturnType<typeof adminDb>,
  userId: string,
): Promise<boolean> {
  const { data: rows } = await supabase
    .from("sessions")
    .select("expires_at")
    .eq("user_id", userId)
    .limit(20);

  const now = Date.now();
  return (rows ?? []).some((row: any) => {
    if (!row?.expires_at) return true;
    const expiresAt = new Date(row.expires_at).getTime();
    return Number.isFinite(expiresAt) && expiresAt > now;
  });
}

function recipientAllowsPush(rawSettings: any, isGroup: boolean): boolean {
  const settings = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
  if (settings.msgNotifs === false) return false;
  if (settings.dnd === true) return false;
  if (isGroup && settings.muteGroups === true) return false;
  return true;
}

async function getPushEligibleUserIds(
  supabase: ReturnType<typeof adminDb>,
  userIds: string[],
  isGroup: boolean,
): Promise<string[]> {
  if (!userIds.length) return [];

  const { data: rows } = await supabase
    .from("user_settings")
    .select("user_id, settings")
    .in("user_id", userIds);

  const settingByUser = new Map<string, any>();
  for (const row of rows ?? []) {
    if (row?.user_id) settingByUser.set(String(row.user_id), row.settings ?? {});
  }

  return userIds.filter((id) => recipientAllowsPush(settingByUser.get(id), isGroup));
}

async function getActivePushTokensForUsers(
  supabase: ReturnType<typeof adminDb>,
  userIds: string[],
): Promise<Array<{ userId: string; token: string }>> {
  if (!userIds.length) return [];

  const { data: rows } = await supabase
    .from("user_push_tokens")
    .select("user_id, expo_push_token")
    .in("user_id", userIds)
    .eq("is_active", true);

  const seen = new Set<string>();
  const targets: Array<{ userId: string; token: string }> = [];
  for (const row of rows ?? []) {
    const token = String(row?.expo_push_token ?? "").trim();
    const userId = String(row?.user_id ?? "").trim();
    if (!userId || !token || !isValidExpoPushToken(token) || seen.has(`${userId}:${token}`)) continue;
    seen.add(`${userId}:${token}`);
    targets.push({ userId, token });
  }
  return targets;
}

async function sendExpoPushNotifications(
  supabase: ReturnType<typeof adminDb>,
  messages: Array<Record<string, unknown>>,
) {
  if (!messages.length) return;

  const invalidTokens = new Set<string>();

  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const res = await fetch(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(chunk),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error("Expo push send failed", res.status, text.slice(0, 500));
        continue;
      }

      const payload = await res.json().catch(() => null);
      const tickets = Array.isArray(payload?.data) ? payload.data : [];
      for (let j = 0; j < tickets.length; j++) {
        const ticket = tickets[j] ?? {};
        if (ticket?.status !== "error") continue;

        const token = String(chunk[j]?.to ?? "").trim();
        const reason = String(ticket?.details?.error ?? "");
        const message = String(ticket?.message ?? "");
        console.error("Expo push ticket error", reason || "unknown", message);

        if (token && reason === "DeviceNotRegistered") {
          invalidTokens.add(token);
        }
      }
    } catch (error) {
      console.error("Expo push send error", error);
    }
  }

  if (invalidTokens.size > 0) {
    await supabase
      .from("user_push_tokens")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .in("expo_push_token", Array.from(invalidTokens));
  }
}

async function reloadSchemaCache(supabase: ReturnType<typeof adminDb>) {
  try {
    // Some projects expose a custom helper RPC; ignore if unavailable.
    const { error } = await supabase.rpc("reload_schema_cache");
    if (error) {
      // Non-fatal: schema cache warm-up is best effort only.
      console.warn("reload_schema_cache RPC unavailable", error.message);
    }
  } catch (error) {
    // Never crash request flow due to cache refresh helper.
    console.warn("reload schema cache failed", error);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: CORS });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail("Invalid JSON"); }

  const { action } = body;
  if (!action) return fail("Missing action");

  const supabase = adminDb();
  const authUser = await requireUser(req, supabase);
  const sessionUser = await resolveUser(body, authUser, supabase);

  const groupActionsNeedingFreshSchema = new Set([
    "create-group",
    "list-groups",
    "create-group-invite",
    "join-group-via-invite",
    "get-group-join-requests",
    "resolve-group-join-request",
    "list-group-members",
    "add-group-member",
    "update-group-member",
    "set-group-settings",
    "rotate-group-key",
    "get-group-state",
    "send-group-message",
    "get-group-messages",
    "set-group-receipt",
    "set-group-typing",
    "report-group-user",
  ]);
  if (typeof action === "string" && groupActionsNeedingFreshSchema.has(action)) {
    await reloadSchemaCache(supabase);
  }

  if (action === "reload-schema-cache") {
    await reloadSchemaCache(supabase);
    return ok({ success: true });
  }

  // ?????? register ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
  // ── register ─────────────────────────────────────────────────────────────
  if (action === "register") {
    const { username, emojiKey, deviceId } = body;
    if (!username) return fail("Missing username", 400);
    if (!emojiKey) return fail("Missing emojiKey", 400);
    if (!deviceId) return fail("Missing deviceId", 400);

    const uname = (username as string).trim().toLowerCase();
    const dIdRaw = (deviceId as string).trim();
    const dIdHashed = await hashDeviceId(dIdRaw);
    const pin   = Array.isArray(emojiKey) ? (emojiKey as string[]).join("") : String(emojiKey);
    const hashedPin = await hashPin(pin);

    if (body.publicKey && !isValidPublicKey(String(body.publicKey))) {
      return fail("Invalid public key", 400);
    }

    // Validate username server-side
    if (!/^[a-z0-9_]{4,20}$/.test(uname)) return fail("Invalid username format");

    // Check device not already registered (supports legacy unhashed entries).
    let { data: existingDevice } = await supabase.from("users")
      .select("id")
      .eq("device_hash", dIdHashed)
      .limit(1)
      .maybeSingle();
    if (!existingDevice) {
      const { data: legacyDevice } = await supabase.from("users")
        .select("id")
        .eq("device_hash", dIdRaw)
        .limit(1)
        .maybeSingle();
      existingDevice = legacyDevice;
    }
    if (existingDevice) return fail("Device already registered", 409);

    // Check username not taken
    const { data: existingName } = await supabase.from("users").select("id").eq("username", uname).limit(1).maybeSingle();
    if (existingName) return fail("Username already taken", 409);

    const { data: newUser, error } = await supabase
      .from("users")
      .insert({
        username:      uname,
        password_hash: hashedPin,
        device_hash:   dIdHashed,
      })
      .select("id, username, created_at")
      .single();

    if (error) return fail(error.message, 500);

    const sessionToken = token();
    const sessionTokenHash = await hashSessionToken(sessionToken);
    const exp = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from("sessions").insert({ user_id: newUser.id, token_hash: sessionTokenHash, expires_at: exp });

    // Store ECDH public key atomically so peers can find it immediately
    if (body.publicKey) {
      await supabase.from("user_public_keys").upsert({
        user_id:    newUser.id,
        public_key: body.publicKey as string,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
    }

    return ok({ success: true, user: newUser, sessionToken });
  }

  // ?????? login ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
  // ── login (device-based) ─────────────────────────────────────────────────────────
  if (action === "login") {
    const { emojiKey, deviceId } = body;
    if (!emojiKey || !deviceId) return fail("Missing fields");

    const pin = Array.isArray(emojiKey) ? (emojiKey as string[]).join("") : String(emojiKey);
    const rawDeviceId = (deviceId as string).trim();
    const hashedDeviceId = await hashDeviceId(rawDeviceId);

    let { data: user, error: userError } = await supabase.from("users")
      .select("id, username, password_hash, created_at, device_hash")
      .eq("device_hash", hashedDeviceId).limit(1).maybeSingle();

    if (!user && !userError) {
      const { data: legacyUser, error: legacyError } = await supabase.from("users")
        .select("id, username, password_hash, created_at, device_hash")
        .eq("device_hash", rawDeviceId).limit(1).maybeSingle();
      user = legacyUser;
      userError = legacyError;
    }

    if (userError || !user) return fail("Invalid credentials", 401);

    const pinCheck = await verifyPin(pin, user.password_hash ?? "");
    if (!pinCheck.ok) return fail("Invalid credentials", 401);

    const userUpdates: Record<string, unknown> = {};
    if (pinCheck.shouldUpgrade) userUpdates.password_hash = await hashPin(pin);
    if (user.device_hash !== hashedDeviceId) userUpdates.device_hash = hashedDeviceId;
    if (Object.keys(userUpdates).length > 0) {
      await supabase.from("users").update(userUpdates).eq("id", user.id);
    }

    const sessionToken = token();
    const sessionTokenHash = await hashSessionToken(sessionToken);
    const exp = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from("sessions").insert({ user_id: user.id, token_hash: sessionTokenHash, expires_at: exp });

    return ok({ success: true, user: { id: user.id, username: user.username, created_at: user.created_at }, sessionToken });
  }

  // ── login-username (manual login) ──────────────────────────────────────────────
  if (action === "login-username") {
    const { username, emojiKey, deviceId } = body;
    if (!username || !emojiKey || !deviceId) return fail("Missing fields");

    if (body.publicKey && !isValidPublicKey(String(body.publicKey))) {
      return fail("Invalid public key", 400);
    }

    const uname = (username as string).trim().toLowerCase();
    const pin = Array.isArray(emojiKey) ? (emojiKey as string[]).join("") : String(emojiKey);
    const rawDeviceId = (deviceId as string).trim();
    const hashedDeviceId = await hashDeviceId(rawDeviceId);

    // Look up by username
    const { data: user, error: userError } = await supabase.from("users")
      .select("id, username, password_hash, created_at, device_hash")
      .eq("username", uname).limit(1).maybeSingle();

    if (userError || !user) return fail("Invalid username or pin", 401);

    const updates: Record<string, unknown> = {};
    if (!user.password_hash) {
      updates.password_hash = await hashPin(pin);
    } else {
      const pinCheck = await verifyPin(pin, user.password_hash);
      if (!pinCheck.ok) return fail("Invalid username or pin", 401);
      if (pinCheck.shouldUpgrade) updates.password_hash = await hashPin(pin);
    }

    // Update their device hash to the active device fingerprint.
    if (user.device_hash !== hashedDeviceId) updates.device_hash = hashedDeviceId;
    if (Object.keys(updates).length > 0) {
      await supabase.from("users").update(updates).eq("id", user.id);
    }

    // Clear old sessions and issue a new one
    await supabase.from("sessions").delete().eq("user_id", user.id);
    const sessionToken = token();
    const sessionTokenHash = await hashSessionToken(sessionToken);
    const exp = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from("sessions").insert({ user_id: user.id, token_hash: sessionTokenHash, expires_at: exp });

    // Store ECDH public key atomically
    if (body.publicKey) {
      await supabase.from("user_public_keys").upsert({
        user_id:    user.id,
        public_key: body.publicKey as string,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
    }

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

    if (body.publicKey && !isValidPublicKey(String(body.publicKey))) {
      return fail("Invalid public key", 400);
    }

    const uname = (username as string).trim().toLowerCase();
    const { data: user } = await supabase.from("users").select("id, username, security_answer_hash, created_at").eq("username", uname).limit(1).maybeSingle();
    if (!user) return fail("Invalid credentials", 401);
    if (user.security_answer_hash !== (answer as string).trim().toLowerCase()) return fail("Invalid credentials", 401);
    const pin = Array.isArray(newEmojiKey) ? (newEmojiKey as string[]).join("") : String(newEmojiKey);
    const hashedPin = await hashPin(pin);
    await supabase.from("users").update({ password_hash: hashedPin }).eq("id", user.id);
    await supabase.from("sessions").delete().eq("user_id", user.id);
    const sessionToken = token();
    const sessionTokenHash = await hashSessionToken(sessionToken);
    const exp = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from("sessions").insert({ user_id: user.id, token_hash: sessionTokenHash, expires_at: exp });

    if (body.publicKey) {
      await supabase.from("user_public_keys").upsert({
        user_id:    user.id,
        public_key: body.publicKey as string,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
    }

    return ok({ success: true, user: { id: user.id, username: user.username, created_at: user.created_at }, sessionToken });
  }

  // ?????? signout ?????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
  if (action === "signout") {
    const sessionToken = typeof body.sessionToken === "string" ? body.sessionToken.trim() : "";
    if (sessionToken) {
      const sessionTokenHash = await hashSessionToken(sessionToken);
      await supabase
        .from("sessions")
        .delete()
        .in("token_hash", [sessionTokenHash, sessionToken]);
    }
    return ok({ success: true });
  }

  // ?????? delete-account ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
  if (action === "delete-account") {
    if (!sessionUser) return fail("Unauthorized", 401);
    const uid = sessionUser.id;
    await supabase.from("users").delete().eq("id", uid);
    await supabase.from("sessions").delete().eq("user_id", uid);
    if (authUser?.id) await supabase.auth.admin.deleteUser(authUser.id);
    return ok({ success: true });
  }

  // ── find-user ─────────────────────────────────────────────────────────────
  if (action === "find-user") {
    const { query } = body as { query?: string };
    if (!sessionUser) return fail("Unauthorized", 401);
    const uid = sessionUser.id;
    if (!query || (query as string).trim().length < 2) return ok({ users: [] });
    const { data: users } = await supabase.from("users")
      .select("id, username, created_at, avatar_url")
      .ilike("username", `${(query as string).trim().toLowerCase()}%`)
      .neq("id", uid).limit(20);

    const userIds = (users ?? []).map((u: any) => u.id);
    // Fetch any existing friend requests between current user and found users
    const { data: rels } = userIds.length > 0
      ? await supabase.from("friend_requests")
          .select("id, status, sender_id, receiver_id")
          .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
      : { data: [] };
    const relevantRels = (rels ?? []).filter((r: any) =>
      userIds.includes(r.sender_id) || userIds.includes(r.receiver_id),
    );
    const usersWithStatus = (users ?? []).map((u: any) => {
      const rel = relevantRels.find((r: any) =>
        (r.sender_id === uid && r.receiver_id === u.id) ||
        (r.receiver_id === uid && r.sender_id === u.id),
      );
      let requestStatus = "none";
      if (rel) {
        if (rel.status === "accepted") requestStatus = "friends";
        else if (rel.status === "pending" && rel.sender_id === uid) requestStatus = "sent";
        else if (rel.status === "pending" && rel.receiver_id === uid) requestStatus = "received";
      }
      return { ...u, requestStatus };
    });

    // For friends, also look up their shared chat_id (may be null if deleted) and public key
    const friendIds = usersWithStatus.filter((u: any) => u.requestStatus === "friends").map((u: any) => u.id);
    const chatIdMap: Record<string, string> = {};
    const keyMap:    Record<string, string> = {};
    if (friendIds.length > 0) {
      const { data: myChats } = await supabase.from("chat_members").select("chat_id").eq("user_id", uid);
      const myChatIds = (myChats ?? []).map((r: any) => r.chat_id as string);
      if (myChatIds.length > 0) {
        const { data: theirChats } = await supabase.from("chat_members")
          .select("chat_id, user_id").in("chat_id", myChatIds).in("user_id", friendIds);
        (theirChats ?? []).forEach((r: any) => { chatIdMap[r.user_id] = r.chat_id; });
      }
      const { data: keys } = await supabase.from("user_public_keys")
        .select("user_id, public_key").in("user_id", friendIds);
      (keys ?? []).forEach((k: any) => { keyMap[k.user_id] = k.public_key; });
    }

    return ok({ users: usersWithStatus.map((u: any) => ({
      ...u,
      chatId:         chatIdMap[u.id] ?? null,
      peerPublicKey:  keyMap[u.id]    ?? null,
    })) });
  }

  // ?????? check-username ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
  if (action === "check-username") {
    const { username } = body as { username?: string };
    if (!username) return fail("Missing username");
    const { data } = await supabase.from("users").select("id").eq("username", (username as string).trim().toLowerCase()).maybeSingle();
    return ok({ available: !data });
  }

  // ── get-session-user ─────────────────────────────────────────────────────
  if (action === "get-session-user") {
    const token = typeof body.sessionToken === "string" ? body.sessionToken : "";
    const user = await userFromSessionToken(token, supabase);
    if (!user) return fail("Unauthorized", 401);
    return ok({ user });
  }

  // ?????? check-device ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
  // ── check-device ─────────────────────────────────────────────────────────────────
  if (action === "check-device") {
    return fail("Deprecated", 410);
  }

  // ── send-request ─────────────────────────────────────────────────────────────
  if (action === "send-request") {
    const { toUserId } = body;
    if (!sessionUser || !toUserId) return fail("Missing fields", 400);
    if (sessionUser.id === toUserId) return fail("Cannot send request to yourself", 400);
    // Upsert so re-sending a declined request works
    const { error } = await supabase.from("friend_requests")
      .upsert({ sender_id: sessionUser.id, receiver_id: toUserId as string, status: "pending", updated_at: new Date().toISOString() },
        { onConflict: "sender_id,receiver_id" });
    if (error) return fail(error.message, 500);
    return ok({ success: true });
  }

  // ── accept-request ───────────────────────────────────────────────────────────
  if (action === "accept-request") {
    const { requestId } = body;
    if (!sessionUser || !requestId) return fail("Missing fields", 400);
    const uid = sessionUser.id;

    // Fetch the request first (need sender_id to create the chat)
    const { data: req } = await supabase.from("friend_requests")
      .select("id, sender_id")
      .eq("id", requestId as string).eq("receiver_id", uid).eq("status", "pending")
      .maybeSingle();
    if (!req) return fail("Request not found or already actioned", 404);

    // Mark as accepted
    const { error: updErr } = await supabase.from("friend_requests")
      .update({ status: "accepted", updated_at: new Date().toISOString() })
      .eq("id", req.id);
    if (updErr) return fail(updErr.message, 500);

    // Guard: don't create a duplicate chat
    const { data: myChats }    = await supabase.from("chat_members").select("chat_id").eq("user_id", uid);
    const { data: theirChats } = await supabase.from("chat_members").select("chat_id").eq("user_id", req.sender_id);
    const myIds    = (myChats    ?? []).map((r: any) => r.chat_id as string);
    const theirIds = (theirChats ?? []).map((r: any) => r.chat_id as string);
    const existing = myIds.find((id) => theirIds.includes(id));
    if (existing) return ok({ success: true, chatId: existing });

    // Create the chat room and add both members atomically
    const { data: chat, error: chatErr } = await supabase
      .from("chats").insert({}).select("id").single();
    if (chatErr) return fail(chatErr.message, 500);
    await supabase.from("chat_members").insert([
      { chat_id: chat.id, user_id: uid },
      { chat_id: chat.id, user_id: req.sender_id },
    ]);

    return ok({ success: true, chatId: chat.id });
  }

  // ── decline-request ──────────────────────────────────────────────────────────
  if (action === "decline-request") {
    const { requestId } = body;
    if (!sessionUser || !requestId) return fail("Missing fields", 400);
    const { error } = await supabase.from("friend_requests")
      .update({ status: "declined", updated_at: new Date().toISOString() })
      .eq("id", requestId as string).eq("receiver_id", sessionUser.id).eq("status", "pending");
    if (error) return fail(error.message, 500);
    return ok({ success: true });
  }

  // ── cancel-request ───────────────────────────────────────────────────────────
  if (action === "cancel-request") {
    const { requestId } = body;
    if (!sessionUser || !requestId) return fail("Missing fields", 400);
    const { error } = await supabase.from("friend_requests")
      .delete().eq("id", requestId as string).eq("sender_id", sessionUser.id);
    if (error) return fail(error.message, 500);
    return ok({ success: true });
  }

  // ── remove-friend ────────────────────────────────────────────────────────────
  if (action === "remove-friend") {
    const { peerId } = body;
    if (!sessionUser || !peerId) return fail("Missing fields", 400);
    const uid = sessionUser.id;
    // Delete the accepted friend_request row in whichever direction it exists
    const { error } = await supabase.from("friend_requests").delete()
      .or(`and(sender_id.eq.${uid},receiver_id.eq.${peerId as string}),and(sender_id.eq.${peerId as string},receiver_id.eq.${uid})`);
    if (error) return fail(error.message, 500);
    return ok({ success: true });
  }

  // ── get-requests ─────────────────────────────────────────────────────────────
  if (action === "get-requests") {
    if (!sessionUser) return fail("Unauthorized", 401);
    const uid = sessionUser.id;

    const { data: received } = await supabase.from("friend_requests")
      .select("id, status, created_at, sender:sender_id(id, username)")
      .eq("receiver_id", uid).eq("status", "pending").order("created_at", { ascending: false });

    const { data: sent } = await supabase.from("friend_requests")
      .select("id, status, created_at, receiver:receiver_id(id, username)")
      .eq("sender_id", uid).eq("status", "pending").order("created_at", { ascending: false });

    return ok({ received: received ?? [], sent: sent ?? [] });
  }

  // ── get-group-requests ───────────────────────────────────────────────────
  if (action === "get-group-requests") {
    if (!sessionUser) return fail("Unauthorized", 401);
    const uid = sessionUser.id;

    let groupReqs: any[] | null = null;
    let reqError: any = null;
    let hasAddedBy = true;

    ({ data: groupReqs, error: reqError } = await supabase
      .from("group_join_requests")
      .select("id, group_id, status, created_at, user_id, added_by")
      .eq("user_id", uid)
      .eq("status", "pending")
      .order("created_at", { ascending: false }));

    if (reqError && String(reqError.message ?? "").toLowerCase().includes("added_by")) {
      hasAddedBy = false;
      ({ data: groupReqs, error: reqError } = await supabase
        .from("group_join_requests")
        .select("id, group_id, status, created_at, user_id")
        .eq("user_id", uid)
        .eq("status", "pending")
        .order("created_at", { ascending: false }));
    }

    if (reqError) return fail(reqError.message, 500);
    if (!groupReqs || groupReqs.length === 0) return ok({ groupRequests: [] });

    const groupIds = [...new Set(groupReqs.map((r: any) => r.group_id as string).filter(Boolean))];
    const requesterIds = [...new Set(groupReqs.map((r: any) => r.user_id as string).filter(Boolean))];
    const adderIds = hasAddedBy
      ? [...new Set(groupReqs.map((r: any) => r.added_by as string).filter(Boolean))]
      : [];

    const { data: groups } = groupIds.length > 0
      ? await supabase.from("groups").select("id, name, description").in("id", groupIds)
      : { data: [] };
    const groupMap = new Map<string, { id: string; name: string; description: string | null }>();
    (groups ?? []).forEach((g: any) => {
      groupMap.set(g.id, {
        id: g.id,
        name: g.name ?? "Group",
        description: g.description ?? null,
      });
    });

    const { data: members } = groupIds.length > 0
      ? await supabase.from("group_members").select("group_id, user_id").in("group_id", groupIds)
      : { data: [] };

    const memberIds = [...new Set((members ?? []).map((m: any) => m.user_id as string).filter(Boolean))];
    const allUserIds = [...new Set([...requesterIds, ...adderIds, ...memberIds])];
    const { data: users } = allUserIds.length > 0
      ? await supabase.from("users").select("id, username").in("id", allUserIds)
      : { data: [] };

    const userMap = new Map<string, { id: string; username: string }>();
    (users ?? []).forEach((u: any) => {
      userMap.set(u.id, {
        id: u.id,
        username: u.username ?? "Unknown",
      });
    });

    const groupMemberMap = new Map<string, string[]>();
    (members ?? []).forEach((m: any) => {
      const list = groupMemberMap.get(m.group_id) ?? [];
      list.push(m.user_id);
      groupMemberMap.set(m.group_id, list);
    });

    const payload = groupReqs.map((r: any) => {
      const g = groupMap.get(r.group_id) ?? {
        id: r.group_id,
        name: "Group",
        description: null,
      };
      const reqUser = userMap.get(r.user_id) ?? { id: r.user_id ?? "", username: "Unknown" };
      const addedById = (hasAddedBy ? r.added_by : "") || "";
      const addedByUser = addedById
        ? (userMap.get(addedById) ?? { id: addedById, username: "Unknown" })
        : { id: "", username: "Unknown" };

      return {
        id: r.id,
        group_id: r.group_id,
        status: r.status,
        created_at: r.created_at,
        added_by: addedById,
        group: g,
        user: reqUser,
        added_by_user: addedByUser,
        group_members: (groupMemberMap.get(r.group_id) ?? []).map((memberId) => {
          const member = userMap.get(memberId) ?? { id: memberId, username: "Unknown" };
          return { user: member };
        }),
      };
    });

    return ok({ groupRequests: payload });
  }

  // ── accept-group-request ─────────────────────────────────────────────────
  if (action === "accept-group-request") {
    const { requestId } = body as { requestId?: string };
    if (!sessionUser || !requestId) return fail("Missing fields", 400);
    const uid = sessionUser.id;

    const { data: req } = await supabase
      .from("group_join_requests")
      .select("id, group_id, user_id, status")
      .eq("id", requestId)
      .eq("user_id", uid)
      .eq("status", "pending")
      .maybeSingle();
    if (!req) return fail("Request not found or already actioned", 404);

    const { error: memberError } = await supabase
      .from("group_members")
      .upsert(
        [{ group_id: req.group_id, user_id: uid, role: "member" }],
        { onConflict: "group_id,user_id" },
      );
    if (memberError) return fail(memberError.message, 500);

    const { error: reqError } = await supabase
      .from("group_join_requests")
      .update({ status: "accepted" })
      .eq("id", requestId)
      .eq("user_id", uid);
    if (reqError) return fail(reqError.message, 500);

    return ok({ success: true, groupId: req.group_id });
  }

  // ── decline-group-request ────────────────────────────────────────────────
  if (action === "decline-group-request") {
    const { requestId } = body as { requestId?: string };
    if (!sessionUser || !requestId) return fail("Missing fields", 400);

    const { data: req } = await supabase
      .from("group_join_requests")
      .select("id")
      .eq("id", requestId)
      .eq("user_id", sessionUser.id)
      .eq("status", "pending")
      .maybeSingle();
    if (!req) return fail("Request not found or already actioned", 404);

    const { error } = await supabase
      .from("group_join_requests")
      .update({ status: "declined" })
      .eq("id", requestId)
      .eq("user_id", sessionUser.id);
    if (error) return fail(error.message, 500);

    return ok({ success: true });
  }

  // ── report-group-request ─────────────────────────────────────────────────
  if (action === "report-group-request") {
    const { requestId, groupId, reportedUserId } = body as {
      requestId?: string;
      groupId?: string;
      reportedUserId?: string;
    };
    if (!sessionUser || !requestId || !groupId) return fail("Missing fields", 400);
    const uid = sessionUser.id;

    let reqRow: any = null;
    let reqError: any = null;
    ({ data: reqRow, error: reqError } = await supabase
      .from("group_join_requests")
      .select("id, group_id, user_id, status, added_by")
      .eq("id", requestId)
      .eq("user_id", uid)
      .maybeSingle());

    if (reqError && String(reqError.message ?? "").toLowerCase().includes("added_by")) {
      ({ data: reqRow, error: reqError } = await supabase
        .from("group_join_requests")
        .select("id, group_id, user_id, status")
        .eq("id", requestId)
        .eq("user_id", uid)
        .maybeSingle());
    }

    if (reqError) return fail(reqError.message, 500);
    if (!reqRow) return fail("Request not found", 404);

    const targetUserId = (reportedUserId ?? reqRow.added_by ?? "").trim();
    if (!targetUserId) return fail("Missing reported user", 400);

    const reason = "Added without consent";
    const { error: reportError } = await supabase.from("group_reports").insert([{
      group_id: groupId,
      reporter_id: uid,
      reported_user_id: targetUserId,
      reason,
    }]);
    if (reportError) return fail(reportError.message, 500);

    const { error: declineError } = await supabase
      .from("group_join_requests")
      .update({ status: "declined" })
      .eq("id", requestId)
      .eq("user_id", uid);
    if (declineError) return fail(declineError.message, 500);

    const { count: totalReports } = await supabase
      .from("group_reports")
      .select("id", { count: "exact", head: true })
      .eq("reported_user_id", targetUserId);

    const banned = (totalReports ?? 0) >= 5;
    if (banned) {
      const { data: existingBan } = await supabase
        .from("group_bans")
        .select("id")
        .eq("user_id", targetUserId)
        .eq("group_id", groupId)
        .maybeSingle();
      if (!existingBan) {
        await supabase.from("group_bans").insert([{
          user_id: targetUserId,
          group_id: groupId,
          reason: "Auto-banned: 5+ reports for adding users without consent",
        }]);
      }
    }

    return ok({ success: true, banned });
  }

  // ── update-username ──────────────────────────────────────────────────────────
  if (action === "update-username") {
    const { newUsername } = body;
    if (!sessionUser || !newUsername) return fail("Missing fields", 400);
    const uid = sessionUser.id;
    const uname = (newUsername as string).trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(uname)) return fail("Username must be 3-20 chars, letters/numbers/underscore");
    const { data: current } = await supabase.from("users").select("username").eq("id", uid).maybeSingle();
    if (!current) return fail("User not found", 404);
    if (current.username === uname) return ok({ success: true, user: { id: uid, username: uname } });

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { count: recentCount } = await supabase.from("user_username_history")
      .select("id", { count: "exact", head: true })
      .eq("user_id", uid)
      .gte("changed_at", since);
    if ((recentCount ?? 0) >= 2) return fail("Username can only be changed twice per month", 429);

    const { data: taken } = await supabase.from("users").select("id").eq("username", uname).neq("id", uid).maybeSingle();
    if (taken) return fail("Username already taken", 409);
    const { data: updated, error } = await supabase.from("users")
      .update({ username: uname }).eq("id", uid)
      .select("id, username, created_at, avatar_url").single();
    if (error) return fail(error.message, 500);

    if (authUser?.id) {
      await supabase.auth.admin.updateUserById(uid, { email: emailFromUsername(uname) });
    }

    await supabase.from("user_username_history").insert({
      user_id: uid,
      old_username: current.username,
      new_username: uname,
      changed_at: new Date().toISOString(),
    });

    return ok({ success: true, user: updated });
  }

  // ── get-username-history ───────────────────────────────────────────────────
  if (action === "get-username-history") {
    const { userId, userIds } = body as { userId?: string; userIds?: string[] };
    if (!sessionUser) return fail("Unauthorized", 401);

    const ids = Array.isArray(userIds) && userIds.length > 0 ? userIds : (userId ? [userId] : []);
    if (ids.length === 0) return fail("Missing userId", 400);

    const { data: rows } = await supabase.from("user_username_history")
      .select("user_id, old_username, new_username, changed_at")
      .in("user_id", ids)
      .order("changed_at", { ascending: false });

    const historyMap: Record<string, string[]> = {};
    (rows ?? []).forEach((row: any) => {
      const list = historyMap[row.user_id] ?? [];
      if (!list.includes(row.old_username)) list.push(row.old_username);
      historyMap[row.user_id] = list.slice(0, 3);
    });

    return ok({ history: historyMap });
  }

  // ── update-avatar ────────────────────────────────────────────────────────────
  if (action === "update-avatar") {
    const { avatarUrl } = body;
    if (!sessionUser || !avatarUrl) return fail("Missing fields", 400);
    const { data: updated, error } = await supabase.from("users")
      .update({ avatar_url: avatarUrl as string }).eq("id", sessionUser.id)
      .select("id, username, created_at, avatar_url").single();
    if (error) return fail(error.message, 500);
    return ok({ success: true, user: updated });
  }

  // ── get-settings ───────────────────────────────────────────────────────────
  if (action === "get-settings") {
    if (!sessionUser) return fail("Unauthorized", 401);
    const { data } = await supabase.from("user_settings")
      .select("settings").eq("user_id", sessionUser.id).maybeSingle();
    return ok({ settings: data?.settings ?? null });
  }

  // ── update-settings ────────────────────────────────────────────────────────
  if (action === "update-settings") {
    const { settings } = body;
    if (!sessionUser || !settings) return fail("Missing fields", 400);
    const safe = sanitizeSettings(settings);
    const { error } = await supabase.from("user_settings").upsert({
      user_id: sessionUser.id,
      settings: safe,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) return fail(error.message, 500);
    return ok({ success: true });
  }

  // ── register-push-token ───────────────────────────────────────────────────
  if (action === "register-push-token") {
    const { expoPushToken, platform, deviceId } = body as {
      expoPushToken?: string;
      platform?: string;
      deviceId?: string;
    };
    if (!sessionUser || !expoPushToken) return fail("Missing fields", 400);

    const tokenValue = String(expoPushToken).trim();
    if (!isValidExpoPushToken(tokenValue)) return fail("Invalid push token", 400);

    await supabase
      .from("user_push_tokens")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("expo_push_token", tokenValue)
      .neq("user_id", sessionUser.id);

    const { error } = await supabase.from("user_push_tokens").upsert({
      user_id: sessionUser.id,
      expo_push_token: tokenValue,
      platform: typeof platform === "string" ? platform.slice(0, 20) : null,
      device_id: typeof deviceId === "string" ? deviceId.slice(0, 120) : null,
      is_active: true,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,expo_push_token" });
    if (error) return fail(error.message, 500);

    return ok({ success: true });
  }

  // ── unregister-push-token ─────────────────────────────────────────────────
  if (action === "unregister-push-token") {
    if (!sessionUser) return fail("Unauthorized", 401);
    const tokenValue = typeof body.expoPushToken === "string" ? body.expoPushToken.trim() : "";

    let query = supabase.from("user_push_tokens").update({
      is_active: false,
      updated_at: new Date().toISOString(),
    }).eq("user_id", sessionUser.id);

    if (tokenValue) query = query.eq("expo_push_token", tokenValue);

    const { error } = await query;
    if (error) return fail(error.message, 500);
    return ok({ success: true });
  }

  // ── get-sessions ─────────────────────────────────────────────────────────────
  if (action === "get-sessions") {
    if (!sessionUser) return fail("Unauthorized", 401);
    return ok({ sessions: [] });
  }

  // ── revoke-session ───────────────────────────────────────────────────────────
  if (action === "revoke-session") {
    if (!sessionUser) return fail("Unauthorized", 401);
    return ok({ success: true });
  }

  // ── get-upload-url (signed upload URL for avatar) ────────────────────────────
  if (action === "get-upload-url") {
    if (!sessionUser) return fail("Unauthorized", 401);
    const filePath = `${sessionUser.id}.jpg`;
    const { data, error } = await supabase.storage.from("avatars").createSignedUploadUrl(filePath);
    if (error) return fail(error.message, 500);
    const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(filePath);
    return ok({ signedUrl: data.signedUrl, path: data.path, token: data.token, publicUrl: urlData.publicUrl });
  }

  // ── get-group-upload-url (signed upload URL for group media) ───────────────
  if (action === "get-group-upload-url") {
    const { groupId, kind } = body as { groupId?: string; kind?: string };
    if (!sessionUser || !groupId || !kind) return fail("Missing fields", 400);
    if (!isGroupKind(kind)) return fail("Invalid kind");
    const uid = sessionUser.id;

    const { data: membership } = await supabase.from("group_members")
      .select("role").eq("group_id", groupId as string).eq("user_id", uid).maybeSingle();
    if (!membership || membership.role !== "admin") return fail("Not authorized", 403);

    const filePath = `${groupId}/${kind}.jpg`;
    const { data, error } = await supabase.storage.from("groups").createSignedUploadUrl(filePath);
    if (error) return fail(error.message, 500);
    const { data: urlData } = supabase.storage.from("groups").getPublicUrl(filePath);
    return ok({ signedUrl: data.signedUrl, path: data.path, token: data.token, publicUrl: urlData.publicUrl });
  }

  // ── update-group-media ─────────────────────────────────────────────────────
  if (action === "update-group-media") {
    const { groupId, avatarUrl, bannerUrl } = body as { groupId?: string; avatarUrl?: string; bannerUrl?: string };
    if (!sessionUser || !groupId) return fail("Missing fields", 400);
    const uid = sessionUser.id;

    const { data: membership } = await supabase.from("group_members")
      .select("role").eq("group_id", groupId as string).eq("user_id", uid).maybeSingle();
    if (!membership || membership.role !== "admin") return fail("Not authorized", 403);

    const update: Record<string, string> = {};
    if (avatarUrl) update.avatar_url = avatarUrl;
    if (bannerUrl) update.banner_url = bannerUrl;
    if (Object.keys(update).length === 0) return fail("Missing media", 400);

    const { data: updated, error } = await supabase.from("groups")
      .update(update).eq("id", groupId as string).select("id, name, avatar_url, banner_url").single();
    if (error) return fail(error.message, 500);
    return ok({ group: updated });
  }

  // ── store-public-key ─────────────────────────────────────────────────────────
  if (action === "store-public-key") {
    const { publicKey } = body;
    if (!sessionUser || !publicKey) return fail("Missing fields", 400);
    if (!isValidPublicKey(String(publicKey))) return fail("Invalid public key", 400);
    const { error } = await supabase.from("user_public_keys").upsert({
      user_id:    sessionUser.id,
      public_key: publicKey as string,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) return fail(error.message, 500);
    return ok({ success: true });
  }

  // ── get-public-key ────────────────────────────────────────────────────────────
  if (action === "get-public-key") {
    const { userId } = body;
    if (!sessionUser || !userId) return fail("Missing fields", 400);
    const { data } = await supabase.from("user_public_keys")
      .select("public_key").eq("user_id", userId as string).maybeSingle();
    return ok({ publicKey: data?.public_key ?? null });
  }

  // ── get-chats ─────────────────────────────────────────────────────────────────
  if (action === "get-chats") {
    if (!sessionUser) return fail("Unauthorized", 401);
    const uid = sessionUser.id;

    const { data: myMemberships } = await supabase
      .from("chat_members").select("chat_id, joined_at, last_read_at").eq("user_id", uid);
    const chatIds = (myMemberships ?? []).map((m: any) => m.chat_id as string);
    if (!chatIds.length) return ok({ chats: [] });

    const { data: peerMembers } = await supabase
      .from("chat_members")
      .select("chat_id, user:user_id(id, username, avatar_url, created_at)")
      .in("chat_id", chatIds).neq("user_id", uid);

    const peerIds = [...new Set((peerMembers ?? []).map((p: any) => p.user?.id).filter(Boolean))];
    const { data: publicKeys } = peerIds.length > 0
      ? await supabase.from("user_public_keys").select("user_id, public_key").in("user_id", peerIds)
      : { data: [] };
    const keyMap: Record<string, string> = {};
    (publicKeys ?? []).forEach((k: any) => { keyMap[k.user_id] = k.public_key; });

    // Recent messages for these chats (used for last message + unread approximation)
    const recentLimit = Math.min(1200, Math.max(chatIds.length * 20, 200));
    const { data: allMessages } = await supabase
      .from("messages")
      .select("id, chat_id, sender_id, encrypted_body, msg_type, mime_type, created_at, status")
      .in("chat_id", chatIds)
      .order("created_at", { ascending: false })
      .limit(recentLimit);

    const lastMsgMap: Record<string, any> = {};
    const unreadCounts: Record<string, number> = {};
    const membershipMap: Record<string, any> = {};
    (myMemberships ?? []).forEach((m: any) => { membershipMap[m.chat_id] = m; });
    (allMessages ?? []).forEach((m: any) => {
      if (!lastMsgMap[m.chat_id]) lastMsgMap[m.chat_id] = m;
      if (m.sender_id !== uid) {
        const lr = membershipMap[m.chat_id]?.last_read_at;
        if (!lr || new Date(m.created_at) > new Date(lr))
          unreadCounts[m.chat_id] = (unreadCounts[m.chat_id] ?? 0) + 1;
      }
    });

    const missingChatIds = chatIds.filter((chatId) => !lastMsgMap[chatId]).slice(0, 40);
    if (missingChatIds.length > 0) {
      const fallbackRows = await Promise.all(
        missingChatIds.map((chatId) =>
          supabase
            .from("messages")
            .select("id, chat_id, sender_id, encrypted_body, msg_type, mime_type, created_at, status")
            .eq("chat_id", chatId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ),
      );

      fallbackRows.forEach((row: any, idx: number) => {
        if (row?.error) {
          console.warn("get-chats fallback latest message failed", missingChatIds[idx], row.error?.message ?? row.error);
          return;
        }

        const msg = row?.data;
        if (!msg?.chat_id || lastMsgMap[msg.chat_id]) return;
        lastMsgMap[msg.chat_id] = msg;

        if (msg.sender_id !== uid) {
          const lr = membershipMap[msg.chat_id]?.last_read_at;
          if (!lr || new Date(msg.created_at) > new Date(lr)) {
            unreadCounts[msg.chat_id] = Math.max(1, unreadCounts[msg.chat_id] ?? 0);
          }
        }
      });
    }

    const chats = (peerMembers ?? []).map((p: any) => {
      const ms = membershipMap[p.chat_id];
      const lm = lastMsgMap[p.chat_id] ?? null;
      return {
        chat_id:         p.chat_id,
        joined_at:       ms?.joined_at,
        user:            p.user,
        peer_public_key: keyMap[p.user?.id] ?? null,
        last_message:    lm,
        unread_count:    unreadCounts[p.chat_id] ?? 0,
        last_message_at: lm?.created_at ?? ms?.joined_at,
      };
    }).sort((a: any, b: any) =>
      new Date(b.last_message_at ?? 0).getTime() - new Date(a.last_message_at ?? 0).getTime()
    );

    return ok({ chats });
  }

  // ── send-message ──────────────────────────────────────────────────────────────
  if (action === "send-message") {
    const { chatId, encryptedBody, msgType = "text", fileName, fileSize, mimeType } = body;
    if (!sessionUser || !chatId || !encryptedBody) return fail("Missing fields", 400);
    if (!isEncryptedPayload(String(encryptedBody))) return fail("Invalid encrypted payload", 400);
    const uid = sessionUser.id;
    const normalizedMsgType = String(msgType ?? "text").trim().toLowerCase();

    if (!SUPPORTED_DIRECT_MESSAGE_TYPES.has(normalizedMsgType)) {
      return fail("Unsupported message type", 400);
    }

    if (normalizedMsgType === "text" && (fileName || fileSize || mimeType)) {
      return fail("Invalid text message metadata", 400);
    }

    const { data: membership } = await supabase.from("chat_members")
      .select("chat_id").eq("chat_id", chatId as string).eq("user_id", uid).maybeSingle();
    if (!membership) return fail("Not a member of this chat", 403);

    const { data: msg, error } = await supabase.from("messages").insert({
      chat_id: chatId, sender_id: uid, encrypted_body: encryptedBody,
      msg_type: normalizedMsgType, file_name: fileName ?? null,
      file_size: fileSize ?? null, mime_type: mimeType ?? null, status: "sent",
    }).select().single();
    if (error) return fail(error.message, 500);

    // Keep chat.last_message_at current for sorting
    await supabase.from("chats").update({ last_message_at: msg.created_at }).eq("id", chatId as string);

    try {
      const { data: memberRows } = await supabase
        .from("chat_members")
        .select("user_id, last_read_at")
        .eq("chat_id", chatId as string)
        .neq("user_id", uid);
      const recipients = (memberRows ?? [])
        .map((m: any) => ({
          userId: String(m.user_id ?? "").trim(),
          lastReadAt: typeof m.last_read_at === "string" ? m.last_read_at : "",
        }))
        .filter((m: any) => m.userId);

      const recipientIds = recipients.map((m: any) => m.userId);

      const eligibleIds = await getPushEligibleUserIds(supabase, recipientIds, false);
      const eligibleSet = new Set(eligibleIds);
      const pushTargets = await getActivePushTokensForUsers(supabase, eligibleIds);

      const unreadByUser = new Map<string, number>();
      const unreadResults = await Promise.all(
        recipients
          .filter((recipient) => eligibleSet.has(recipient.userId))
          .map(async (recipient) => {
            let unreadQuery = supabase
              .from("messages")
              .select("id", { count: "exact", head: true })
              .eq("chat_id", chatId as string)
              .neq("sender_id", recipient.userId);

            if (recipient.lastReadAt) {
              unreadQuery = unreadQuery.gt("created_at", recipient.lastReadAt);
            }

            const { count } = await unreadQuery;
            return { userId: recipient.userId, unreadCount: Math.max(1, Number(count ?? 1)) };
          }),
      );
      unreadResults.forEach((entry) => {
        unreadByUser.set(entry.userId, entry.unreadCount);
      });

      if (pushTargets.length > 0) {
        const senderName = String(sessionUser.username ?? "New message");
        const preview = messagePreviewForPush(String(msgType ?? "text"));
        await sendExpoPushNotifications(
          supabase,
          pushTargets.map((target) => {
            const unreadCount = unreadByUser.get(target.userId) ?? 1;
            return {
              to: target.token,
              sound: "default",
              title: "Privy",
              subtitle: senderName,
              body: formatPushBody(preview, unreadCount),
              priority: "high",
              channelId: "default",
              badge: unreadCount,
              data: {
                type: "message",
                chatId: String(chatId),
                peerId: uid,
                peerName: senderName,
                peerAvatar: String(sessionUser.avatar_url ?? ""),
                peerKey: "",
                groupId: "",
                groupName: "",
                unreadCount: String(unreadCount),
                sentAt: String(msg.created_at ?? new Date().toISOString()),
              },
            };
          }),
        );
      }
    } catch (pushError) {
      console.error("send-message push dispatch failed", pushError);
    }

    return ok({ message: msg });
  }

  // ── log-call-event ───────────────────────────────────────────────────────────
  if (action === "log-call-event") {
    const { chatId, callId, status, durationSeconds, encryptedBody } = body as {
      chatId?: string;
      callId?: string;
      status?: string;
      durationSeconds?: number;
      encryptedBody?: string;
    };
    if (!sessionUser || !chatId || !callId || !status || !encryptedBody) return fail("Missing fields", 400);
    if (!isEncryptedPayload(String(encryptedBody))) return fail("Invalid encrypted payload", 400);

    const normalizedStatus = String(status).trim().toLowerCase();
    if (!CALL_EVENT_STATUSES.has(normalizedStatus)) return fail("Invalid call status", 400);

    const uid = sessionUser.id;
    const trimmedCallId = String(callId).trim();
    if (!trimmedCallId) return fail("Invalid call id", 400);

    const { data: membership } = await supabase.from("chat_members")
      .select("chat_id")
      .eq("chat_id", chatId as string)
      .eq("user_id", uid)
      .maybeSingle();
    if (!membership) return fail("Not a member of this chat", 403);

    const eventFileName = `${CALL_EVENT_FILE_PREFIX}${trimmedCallId.slice(0, 120)}`;

    const { data: existing } = await supabase
      .from("messages")
      .select("id, chat_id, sender_id, encrypted_body, msg_type, file_name, file_size, mime_type, status, created_at")
      .eq("chat_id", chatId as string)
      .eq("file_name", eventFileName)
      .eq("mime_type", CALL_EVENT_MIME)
      .maybeSingle();

    if (existing) return ok({ message: existing, alreadyLogged: true });

    const duration = Number.isFinite(Number(durationSeconds))
      ? Math.max(0, Math.min(60 * 60 * 12, Math.floor(Number(durationSeconds))))
      : 0;

    const { data: msg, error } = await supabase
      .from("messages")
      .insert({
        chat_id: chatId,
        sender_id: uid,
        encrypted_body: encryptedBody,
        msg_type: "text",
        file_name: eventFileName,
        file_size: duration,
        mime_type: CALL_EVENT_MIME,
        status: "sent",
      })
      .select()
      .single();
    if (error) return fail(error.message, 500);

    await supabase.from("chats").update({ last_message_at: msg.created_at }).eq("id", chatId as string);

    return ok({ message: msg, alreadyLogged: false });
  }

  // ── send-group-message ─────────────────────────────────────────────────────────
  if (action === "send-group-message") {
    const { groupId, encryptedBody, msgType = "text", fileName, fileSize, mimeType } = body;
    if (!sessionUser || !groupId || !encryptedBody) return fail("Missing fields", 400);
    if (!isEncryptedPayload(String(encryptedBody))) return fail("Invalid encrypted payload", 400);
    const uid = sessionUser.id;

    const { data: groupState } = await supabase
      .from("groups")
      .select("id, is_archived, name, mute_notifications")
      .eq("id", groupId as string)
      .maybeSingle();
    if (!groupState || groupState.is_archived) return fail("Group not found", 404);

    const { data: membership } = await supabase.from("group_members")
      .select("group_id, user_id").eq("group_id", groupId as string).eq("user_id", uid).maybeSingle();
    if (!membership) return fail(`User ${uid} is not a member of group ${groupId}`, 403);

    const { data: msg, error } = await supabase.from("messages").insert({
      sender_id: uid,
      encrypted_body: encryptedBody,
      msg_type: msgType,
      group_id: groupId,
      file_name: fileName ?? null,
      file_size: fileSize ?? null,
      mime_type: mimeType ?? null,
      status: "sent",
    }).select().single();
    if (error) return fail(error.message, 500);

    await supabase.from("groups").update({ last_activity: msg.created_at }).eq("id", groupId as string);

    if (!groupState.mute_notifications) {
      try {
        const { data: memberRows } = await supabase
          .from("group_members")
          .select("user_id, last_read_at")
          .eq("group_id", groupId as string)
          .neq("user_id", uid);
        const recipients = (memberRows ?? [])
          .map((m: any) => ({
            userId: String(m.user_id ?? "").trim(),
            lastReadAt: typeof m.last_read_at === "string" ? m.last_read_at : "",
          }))
          .filter((m: any) => m.userId);
        const recipientIds = recipients.map((m: any) => m.userId);

        const eligibleIds = await getPushEligibleUserIds(supabase, recipientIds, true);
        const eligibleSet = new Set(eligibleIds);
        const pushTargets = await getActivePushTokensForUsers(supabase, eligibleIds);

        const unreadByUser = new Map<string, number>();
        const unreadResults = await Promise.all(
          recipients
            .filter((recipient) => eligibleSet.has(recipient.userId))
            .map(async (recipient) => {
              let unreadQuery = supabase
                .from("messages")
                .select("id", { count: "exact", head: true })
                .eq("group_id", groupId as string)
                .neq("sender_id", recipient.userId);

              if (recipient.lastReadAt) {
                unreadQuery = unreadQuery.gt("created_at", recipient.lastReadAt);
              }

              const { count } = await unreadQuery;
              return { userId: recipient.userId, unreadCount: Math.max(1, Number(count ?? 1)) };
            }),
        );
        unreadResults.forEach((entry) => {
          unreadByUser.set(entry.userId, entry.unreadCount);
        });

        if (pushTargets.length > 0) {
          const senderName = String(sessionUser.username ?? "Someone");
          const groupName = String(groupState.name ?? "Group");
          const preview = `${senderName}: ${messagePreviewForPush(String(msgType ?? "text"))}`;

          await sendExpoPushNotifications(
            supabase,
            pushTargets.map((target) => {
              const unreadCount = unreadByUser.get(target.userId) ?? 1;
              return {
                to: target.token,
                sound: "default",
                title: "Privy",
                subtitle: groupName,
                body: formatPushBody(preview, unreadCount),
                priority: "high",
                channelId: "default",
                badge: unreadCount,
                data: {
                  type: "group_message",
                  groupId: String(groupId),
                  groupName,
                  chatId: "",
                  peerId: uid,
                  peerName: senderName,
                  peerAvatar: String(sessionUser.avatar_url ?? ""),
                  peerKey: "",
                  unreadCount: String(unreadCount),
                  sentAt: String(msg.created_at ?? new Date().toISOString()),
                },
              };
            }),
          );
        }
      } catch (pushError) {
        console.error("send-group-message push dispatch failed", pushError);
      }
    }

    return ok({ message: msg });
  }

  // ── get-groups-overview ──────────────────────────────────────────────────
  if (action === "get-groups-overview") {
    if (!sessionUser) return fail("Unauthorized", 401);
    const uid = sessionUser.id;

    const { data: memberships, error: memberError } = await supabase
      .from("group_members")
      .select("group_id, role")
      .eq("user_id", uid);
    if (memberError) return fail(memberError.message, 500);

    const groupIds = (memberships ?? []).map((m: any) => m.group_id as string).filter(Boolean);
    if (groupIds.length === 0) return ok({ groups: [] });

    const { data: groups, error: groupsError } = await supabase
      .from("groups")
      .select("id, name, description, avatar_url, last_activity, pinned_at")
      .in("id", groupIds)
      .eq("is_archived", false);
    if (groupsError) return fail(groupsError.message, 500);

    const activeGroupIds = (groups ?? []).map((g: any) => g.id as string).filter(Boolean);
    if (activeGroupIds.length === 0) return ok({ groups: [] });

    const recentLimit = Math.min(1200, Math.max(activeGroupIds.length * 12, 200));
    const { data: recentMessages, error: recentMessagesError } = await supabase
      .from("messages")
      .select("id, group_id, sender_id, created_at")
      .in("group_id", activeGroupIds)
      .order("created_at", { ascending: false })
      .limit(recentLimit);
    if (recentMessagesError) return fail(recentMessagesError.message, 500);

    const lastByGroup: Record<string, any> = {};
    (recentMessages ?? []).forEach((m: any) => {
      if (!m.group_id) return;
      if (!lastByGroup[m.group_id]) lastByGroup[m.group_id] = m;
    });

    const missingGroupIds = activeGroupIds.filter((groupId) => !lastByGroup[groupId]).slice(0, 30);
    if (missingGroupIds.length > 0) {
      const fallbackRows = await Promise.all(
        missingGroupIds.map((groupId) =>
          supabase
            .from("messages")
            .select("id, group_id, sender_id, created_at")
            .eq("group_id", groupId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ),
      );

      fallbackRows.forEach((row: any, idx: number) => {
        if (row?.error) {
          console.warn("get-groups-overview fallback latest message failed", missingGroupIds[idx], row.error?.message ?? row.error);
          return;
        }
        if (row?.data?.group_id && !lastByGroup[row.data.group_id]) {
          lastByGroup[row.data.group_id] = row.data;
        }
      });
    }

    const senderIds = [...new Set(Object.values(lastByGroup).map((m: any) => m.sender_id as string).filter(Boolean))];
    const { data: senders } = senderIds.length > 0
      ? await supabase.from("users").select("id, username").in("id", senderIds)
      : { data: [] };
    const senderMap = new Map<string, string>();
    (senders ?? []).forEach((u: any) => senderMap.set(u.id, u.username ?? "Unknown"));

    const { data: allMembers } = await supabase
      .from("group_members")
      .select("group_id")
      .in("group_id", activeGroupIds);
    const memberCountMap: Record<string, number> = {};
    (allMembers ?? []).forEach((m: any) => {
      memberCountMap[m.group_id] = (memberCountMap[m.group_id] ?? 0) + 1;
    });

    const myRoleMap: Record<string, string> = {};
    (memberships ?? []).forEach((m: any) => {
      if (m?.group_id) myRoleMap[String(m.group_id)] = String(m?.role ?? "member");
    });

    const payload = (groups ?? []).map((g: any) => {
      const lastMsg = lastByGroup[g.id] ?? null;
      return {
        id: g.id,
        name: g.name,
        description: g.description,
        avatar_url: g.avatar_url,
        last_activity: g.last_activity,
        last_message: lastMsg
          ? {
              text: "Encrypted message",
              created_at: lastMsg.created_at,
              username: senderMap.get(lastMsg.sender_id) ?? "Unknown",
            }
          : null,
        member_count: memberCountMap[g.id] ?? 0,
        is_pinned: !!g.pinned_at,
        user_role: myRoleMap[g.id] ?? "member",
      };
    }).sort((a: any, b: any) => {
      if (a.is_pinned && !b.is_pinned) return -1;
      if (!a.is_pinned && b.is_pinned) return 1;
      if (a.last_activity && b.last_activity) {
        return new Date(b.last_activity).getTime() - new Date(a.last_activity).getTime();
      }
      if (a.last_activity) return -1;
      if (b.last_activity) return 1;
      return 0;
    });

    return ok({ groups: payload });
  }

  // ── create-group ─────────────────────────────────────────────────────────
  if (action === "create-group") {
    const { name, description } = body as { name?: string; description?: string | null };
    if (!sessionUser || !name) return fail("Missing fields", 400);
    const uid = sessionUser.id;

    const groupName = String(name).trim().slice(0, 50);
    const groupDesc = typeof description === "string" ? description.trim().slice(0, 200) : "";
    if (!groupName) return fail("Group name is required", 400);

    const { data: group, error: groupError } = await supabase
      .from("groups")
      .insert([
        {
          name: groupName,
          description: groupDesc || null,
          created_by: uid,
          last_activity: new Date().toISOString(),
        },
      ])
      .select("id, name, description, avatar_url, last_activity, pinned_at")
      .single();
    if (groupError) return fail(groupError.message, 500);

    const { error: memberError } = await supabase
      .from("group_members")
      .insert([{ group_id: group.id, user_id: uid, role: "admin" }]);
    if (memberError) return fail(memberError.message, 500);

    return ok({ success: true, group });
  }

  // ── get-group-detail ─────────────────────────────────────────────────────
  if (action === "get-group-detail") {
    const { groupId } = body as { groupId?: string };
    if (!sessionUser || !groupId) return fail("Missing fields", 400);
    const uid = sessionUser.id;

    const { data: myMembership } = await supabase
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", uid)
      .maybeSingle();
    if (!myMembership) return fail("Not a group member", 403);

    const { data: group, error: groupError } = await supabase
      .from("groups")
      .select("*")
      .eq("id", groupId)
      .eq("is_archived", false)
      .maybeSingle();
    if (groupError) return fail(groupError.message, 500);
    if (!group) return fail("Group not found", 404);

    const { data: memberRows, error: memberError } = await supabase
      .from("group_members")
      .select("role, user_id")
      .eq("group_id", groupId);
    if (memberError) return fail(memberError.message, 500);

    const memberIds = (memberRows ?? []).map((m: any) => m.user_id as string).filter(Boolean);
    const { data: memberUsers } = memberIds.length > 0
      ? await supabase.from("users").select("id, username, avatar_url").in("id", memberIds)
      : { data: [] };
    const memberUserMap = new Map<string, any>();
    (memberUsers ?? []).forEach((u: any) => memberUserMap.set(u.id, u));

    const members = (memberRows ?? []).map((m: any) => ({
      role: m.role,
      user: memberUserMap.get(m.user_id) ?? { id: m.user_id, username: "Unknown", avatar_url: null },
    }));

    const { data: friendRows } = await supabase
      .from("friend_requests")
      .select("sender_id, receiver_id, status")
      .in("status", ["accepted", "friends"])
      .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`);

    const friendIds = [...new Set((friendRows ?? []).map((f: any) =>
      f.sender_id === uid ? f.receiver_id : f.sender_id,
    ).filter(Boolean))];
    const { data: friendUsers } = friendIds.length > 0
      ? await supabase.from("users").select("id, username, avatar_url").in("id", friendIds)
      : { data: [] };
    const memberIdSet = new Set(memberIds);
    const friends = (friendUsers ?? []).filter((u: any) => !memberIdSet.has(u.id));

    return ok({
      group,
      members,
      userRole: myMembership.role ?? "member",
      friends,
    });
  }

  // ── add-group-member ─────────────────────────────────────────────────────
  if (action === "add-group-member") {
    const { groupId, targetUserId } = body as { groupId?: string; targetUserId?: string };
    if (!sessionUser || !groupId || !targetUserId) return fail("Missing fields", 400);
    const uid = sessionUser.id;

    const { data: membership } = await supabase
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", uid)
      .maybeSingle();
    if (!membership || membership.role !== "admin") return fail("Not authorized", 403);

    const { data: existing } = await supabase
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId)
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (existing) return ok({ success: true, alreadyMember: true });

    const { error } = await supabase
      .from("group_members")
      .insert([{ group_id: groupId, user_id: targetUserId, role: "member" }]);
    if (error) return fail(error.message, 500);

    return ok({ success: true, alreadyMember: false });
  }

  // ── remove-group-member ──────────────────────────────────────────────────
  if (action === "remove-group-member") {
    const { groupId, targetUserId } = body as { groupId?: string; targetUserId?: string };
    if (!sessionUser || !groupId || !targetUserId) return fail("Missing fields", 400);
    const uid = sessionUser.id;

    const { data: actorMembership } = await supabase
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", uid)
      .maybeSingle();
    if (!actorMembership) return fail("Not a group member", 403);
    if (uid !== targetUserId && actorMembership.role !== "admin") return fail("Not authorized", 403);

    const { data: targetMembership } = await supabase
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (!targetMembership) return ok({ success: true });

    if (targetMembership.role === "admin") {
      const { count: adminCount } = await supabase
        .from("group_members")
        .select("user_id", { count: "exact", head: true })
        .eq("group_id", groupId)
        .eq("role", "admin");
      if ((adminCount ?? 0) <= 1) return fail("Group must keep at least one admin", 400);
    }

    const { error } = await supabase
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", targetUserId);
    if (error) return fail(error.message, 500);

    return ok({ success: true });
  }

  // ── update-group-member-role ─────────────────────────────────────────────
  if (action === "update-group-member-role") {
    const { groupId, targetUserId, role } = body as {
      groupId?: string;
      targetUserId?: string;
      role?: string;
    };
    if (!sessionUser || !groupId || !targetUserId || !role) return fail("Missing fields", 400);
    if (role !== "admin" && role !== "member") return fail("Invalid role", 400);
    const uid = sessionUser.id;

    const { data: actorMembership } = await supabase
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", uid)
      .maybeSingle();
    if (!actorMembership || actorMembership.role !== "admin") return fail("Not authorized", 403);

    if (role === "member") {
      const { data: targetMembership } = await supabase
        .from("group_members")
        .select("role")
        .eq("group_id", groupId)
        .eq("user_id", targetUserId)
        .maybeSingle();
      if (targetMembership?.role === "admin") {
        const { count: adminCount } = await supabase
          .from("group_members")
          .select("user_id", { count: "exact", head: true })
          .eq("group_id", groupId)
          .eq("role", "admin");
        if ((adminCount ?? 0) <= 1) return fail("Group must keep at least one admin", 400);
      }
    }

    const { error } = await supabase
      .from("group_members")
      .update({ role })
      .eq("group_id", groupId)
      .eq("user_id", targetUserId);
    if (error) return fail(error.message, 500);

    return ok({ success: true });
  }

  // ── update-group-settings ────────────────────────────────────────────────
  if (action === "update-group-settings") {
    const { groupId, muteNotifications, isPublic } = body as {
      groupId?: string;
      muteNotifications?: boolean;
      isPublic?: boolean;
    };
    if (!sessionUser || !groupId) return fail("Missing fields", 400);
    const uid = sessionUser.id;

    const { data: membership } = await supabase
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", uid)
      .maybeSingle();
    if (!membership || membership.role !== "admin") return fail("Not authorized", 403);

    const update: Record<string, unknown> = {};
    if (typeof muteNotifications === "boolean") update.mute_notifications = muteNotifications;
    if (typeof isPublic === "boolean") update.is_public = isPublic;
    if (Object.keys(update).length === 0) return fail("Missing settings", 400);

    const { data: updated, error } = await supabase
      .from("groups")
      .update(update)
      .eq("id", groupId)
      .eq("is_archived", false)
      .select("*")
      .single();
    if (error) return fail(error.message, 500);

    return ok({ success: true, group: updated });
  }

  // ── delete-group (soft archive) ─────────────────────────────────────────
  if (action === "delete-group") {
    const { groupId } = body as { groupId?: string };
    if (!sessionUser || !groupId) return fail("Missing fields", 400);
    const uid = sessionUser.id;

    const { data: membership } = await supabase
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", uid)
      .maybeSingle();
    if (!membership || membership.role !== "admin") return fail("Not authorized", 403);

    const { data: updated, error } = await supabase
      .from("groups")
      .update({ is_archived: true, last_activity: new Date().toISOString() })
      .eq("id", groupId)
      .select("id")
      .maybeSingle();
    if (error) return fail(error.message, 500);
    if (!updated) return fail("Group not found", 404);

    return ok({ success: true, groupId, archived: true });
  }

  // ── destroy-group (hard delete) ─────────────────────────────────────────
  if (action === "destroy-group" || action === "destrou-group") {
    const { groupId } = body as { groupId?: string };
    if (!sessionUser || !groupId) return fail("Missing fields", 400);
    const uid = sessionUser.id;

    const { data: membership } = await supabase
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", uid)
      .maybeSingle();
    if (!membership || membership.role !== "admin") return fail("Not authorized", 403);

    const { data: deleted, error } = await supabase
      .from("groups")
      .delete()
      .eq("id", groupId)
      .select("id")
      .maybeSingle();
    if (error) return fail(error.message, 500);
    if (!deleted) return fail("Group not found", 404);

    return ok({ success: true, groupId, destroyed: true });
  }

  // ── get-group-search-candidates ──────────────────────────────────────────
  if (action === "get-group-search-candidates") {
    const { groupId, query } = body as { groupId?: string; query?: string };
    if (!sessionUser || !groupId || !query) return fail("Missing fields", 400);
    const uid = sessionUser.id;
    const q = String(query).trim();
    if (q.length < 2) return ok({ users: [] });

    const { data: membership } = await supabase
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", uid)
      .maybeSingle();
    if (!membership) return fail("Not a group member", 403);

    const { data: users } = await supabase
      .from("users")
      .select("id, username, avatar_url")
      .ilike("username", `%${q}%`)
      .limit(10);

    const { data: members } = await supabase
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId);
    const memberIdSet = new Set((members ?? []).map((m: any) => m.user_id as string));

    const { data: pendingReqs } = await supabase
      .from("group_join_requests")
      .select("user_id")
      .eq("group_id", groupId)
      .eq("status", "pending");
    const pendingSet = new Set((pendingReqs ?? []).map((r: any) => r.user_id as string));

    const filtered = (users ?? []).filter((u: any) =>
      u.id !== uid && !memberIdSet.has(u.id) && !pendingSet.has(u.id),
    );
    return ok({ users: filtered });
  }

  // ── get-group-chat-context ───────────────────────────────────────────────
  if (action === "get-group-chat-context") {
    const { groupId } = body as { groupId?: string };
    if (!sessionUser || !groupId) return fail("Missing fields", 400);
    const uid = sessionUser.id;

    const { data: membership } = await supabase
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", uid)
      .maybeSingle();
    if (!membership) return fail("Not a group member", 403);

    const { data: group, error: groupError } = await supabase
      .from("groups")
      .select("id, name, description, avatar_url")
      .eq("id", groupId)
      .eq("is_archived", false)
      .maybeSingle();
    if (groupError) return fail(groupError.message, 500);
    if (!group) return fail("Group not found", 404);

    const { data: memberRows } = await supabase
      .from("group_members")
      .select("role, user_id")
      .eq("group_id", groupId)
      .limit(3);
    const memberIds = (memberRows ?? []).map((m: any) => m.user_id as string).filter(Boolean);
    const { data: users } = memberIds.length > 0
      ? await supabase.from("users").select("id, username, avatar_url").in("id", memberIds)
      : { data: [] };
    const userMap = new Map<string, any>();
    (users ?? []).forEach((u: any) => userMap.set(u.id, u));

    const members = (memberRows ?? []).map((m: any) => ({
      role: m.role,
      user: userMap.get(m.user_id) ?? { id: m.user_id, username: "Unknown", avatar_url: null },
    }));

    return ok({ group, members });
  }

  // ── get-group-key-state ──────────────────────────────────────────────────
  if (action === "get-group-key-state") {
    const { groupId } = body as { groupId?: string };
    if (!sessionUser || !groupId) return fail("Missing fields", 400);
    const uid = sessionUser.id;

    const { data: membership } = await supabase
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", uid)
      .maybeSingle();
    if (!membership) return fail("Not a group member", 403);

    const { data: memberRows } = await supabase
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId);
    const memberIds = (memberRows ?? []).map((m: any) => m.user_id as string).filter(Boolean);

    const { data: existingRows } = memberIds.length > 0
      ? await supabase
          .from("group_keys")
          .select("user_id")
          .eq("group_id", groupId)
          .in("user_id", memberIds)
      : { data: [] };

    const { data: ownKey } = await supabase
      .from("group_keys")
      .select("encrypted_key, sender_id")
      .eq("group_id", groupId)
      .eq("user_id", uid)
      .maybeSingle();

    const senderId = ownKey?.sender_id ? String(ownKey.sender_id) : "";
    const { data: senderKey } = senderId
      ? await supabase
          .from("user_public_keys")
          .select("public_key")
          .eq("user_id", senderId)
          .maybeSingle()
      : { data: null };

    const { data: publicKeys } = memberIds.length > 0
      ? await supabase
          .from("user_public_keys")
          .select("user_id, public_key")
          .in("user_id", memberIds)
      : { data: [] };

    return ok({
      role: membership.role ?? "member",
      memberIds,
      existingKeyUserIds: (existingRows ?? []).map((r: any) => r.user_id as string),
      ownKey: ownKey ?? null,
      senderPublicKey: senderKey?.public_key ?? null,
      publicKeys: publicKeys ?? [],
    });
  }

  // ── upsert-group-keys ────────────────────────────────────────────────────
  if (action === "upsert-group-keys") {
    const { groupId, rows } = body as {
      groupId?: string;
      rows?: Array<{ user_id?: string; sender_id?: string; encrypted_key?: string }>;
    };
    if (!sessionUser || !groupId || !Array.isArray(rows)) return fail("Missing fields", 400);
    const uid = sessionUser.id;

    const { data: membership } = await supabase
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", uid)
      .maybeSingle();
    if (!membership || membership.role !== "admin") return fail("Not authorized", 403);
    if (rows.length === 0) return ok({ success: true, upserted: 0 });

    const { data: memberRows } = await supabase
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId);
    const memberSet = new Set((memberRows ?? []).map((m: any) => m.user_id as string));

    const payload: Array<{ group_id: string; user_id: string; sender_id: string; encrypted_key: string }> = [];
    for (const row of rows) {
      const targetUserId = String(row?.user_id ?? "").trim();
      const senderId = String(row?.sender_id ?? "").trim();
      const encryptedKey = String(row?.encrypted_key ?? "").trim();
      if (!targetUserId || !senderId || !encryptedKey) continue;
      if (senderId !== uid) return fail("Invalid sender", 400);
      if (!memberSet.has(targetUserId)) return fail("Target is not a group member", 400);
      if (!isEncryptedPayload(encryptedKey)) return fail("Invalid encrypted payload", 400);
      payload.push({
        group_id: groupId,
        user_id: targetUserId,
        sender_id: senderId,
        encrypted_key: encryptedKey,
      });
    }

    if (payload.length === 0) return ok({ success: true, upserted: 0 });
    const { error } = await supabase
      .from("group_keys")
      .upsert(payload, { onConflict: "group_id,user_id" });
    if (error) return fail(error.message, 500);

    return ok({ success: true, upserted: payload.length });
  }

  // ── get-group-messages ─────────────────────────────────────────────────────────
  if (action === "get-group-messages") {
    const { groupId, before, after } = body;
    if (!sessionUser || !groupId) return fail("Missing fields", 400);
    const uid = sessionUser.id;

    const { data: membership } = await supabase.from("group_members")
      .select("group_id, user_id").eq("group_id", groupId as string).eq("user_id", uid).maybeSingle();
    
    if (!membership) return fail(`User ${uid} is not a member of group ${groupId}`, 403);

    const { data: groupState } = await supabase
      .from("groups")
      .select("id, is_archived")
      .eq("id", groupId as string)
      .maybeSingle();
    if (!groupState || groupState.is_archived) return fail("Group not found", 404);

    let q = supabase
      .from("messages")
      .select("id, sender_id, encrypted_body, msg_type, file_name, file_size, mime_type, status, created_at")
      .eq("group_id", groupId as string)
      .order("created_at", { ascending: true });

    if (after) {
      q = q.gt("created_at", after as string).limit(200);
    } else {
      q = q.limit(50);
      if (before) q = q.gt("created_at", before as string);
    }

    const { data: messages, error } = await q;
    if (error) return fail(error.message, 500);

    const senderIds = [...new Set((messages ?? []).map((m: any) => m.sender_id as string).filter(Boolean))];
    const { data: senders } = senderIds.length > 0
      ? await supabase.from("users").select("id, username, avatar_url").in("id", senderIds)
      : { data: [] };
    const senderMap = new Map<string, { id: string; username: string; avatar_url: string | null }>();
    (senders ?? []).forEach((u: any) => {
      senderMap.set(u.id, {
        id: u.id,
        username: u.username ?? "Unknown",
        avatar_url: u.avatar_url ?? null,
      });
    });

    const payload = (messages ?? []).map((m: any) => ({
      ...m,
      sender: senderMap.get(m.sender_id) ?? {
        id: m.sender_id,
        username: "Unknown",
        avatar_url: null,
      },
    }));

    return ok({ messages: payload });
  }

  // ── get-group-invite ─────────────────────────────────────────────────────────
  if (action === "get-group-invite") {
    const { groupId } = body;
    if (!sessionUser || !groupId) return fail("Missing fields", 400);
    const uid = sessionUser.id;

    const { data: membership } = await supabase.from("group_members")
      .select("role").eq("group_id", groupId as string).eq("user_id", uid).maybeSingle();
    if (!membership || membership.role !== "admin") return fail("Not authorized", 403);

    const { data: group } = await supabase.from("groups")
      .select("id, is_archived")
      .eq("id", groupId as string)
      .maybeSingle();
    if (!group || group.is_archived) return fail("Group not found", 404);

    const { data: invite } = await supabase.from("group_invite_links")
      .select("*")
      .eq("group_id", groupId as string)
      .eq("created_by", uid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return ok({ invite: invite ?? null });
  }

  // ── create-group-invite ─────────────────────────────────────────────────────
  if (action === "create-group-invite") {
    const { groupId } = body;
    if (!sessionUser || !groupId) return fail("Missing fields", 400);
    const uid = sessionUser.id;

    const { data: membership } = await supabase.from("group_members")
      .select("role").eq("group_id", groupId as string).eq("user_id", uid).maybeSingle();
    if (!membership || membership.role !== "admin") return fail("Not authorized", 403);

    const { data: group } = await supabase.from("groups")
      .select("id, is_archived")
      .eq("id", groupId as string)
      .maybeSingle();
    if (!group || group.is_archived) return fail("Group not found", 404);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    let lastError: any = null;
    for (let i = 0; i < 3; i++) {
      const code = inviteCode();
      const { data, error } = await supabase.from("group_invite_links").insert({
        group_id: groupId,
        created_by: uid,
        code,
        expires_at: expiresAt,
      }).select().single();
      if (!error) return ok({ invite: data });
      lastError = error;
    }
    return fail(lastError?.message ?? "Could not create invite", 500);
  }

  // ── join-group-invite ───────────────────────────────────────────────────────
  if (action === "join-group-invite") {
    const { code } = body;
    if (!sessionUser || !code) return fail("Missing fields", 400);
    const uid = sessionUser.id;

    const normalized = String(code).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!normalized) return fail("Invalid code");

    const { data: invite } = await supabase.from("group_invite_links")
      .select("*")
      .eq("code", normalized)
      .maybeSingle();
    if (!invite) return fail("Invalid code", 404);

    if (invite.expires_at && new Date(invite.expires_at) < new Date()) return fail("Expired", 400);
    if (invite.max_uses && invite.uses_count >= invite.max_uses) return fail("Limit reached", 400);

    const { data: group } = await supabase
      .from("groups")
      .select("id, name, is_archived")
      .eq("id", invite.group_id)
      .maybeSingle();
    if (!group || group.is_archived) return fail("Group is no longer available", 404);

    const { data: existing } = await supabase.from("group_members")
      .select("id").eq("group_id", invite.group_id).eq("user_id", uid).maybeSingle();
    if (existing) return ok({ groupId: invite.group_id, alreadyMember: true });

    const { error: memberError } = await supabase.from("group_members").insert({
      group_id: invite.group_id,
      user_id: uid,
      role: "member",
    });
    if (memberError) return fail(memberError.message, 500);

    await supabase.from("group_invite_links")
      .update({ uses_count: (invite.uses_count ?? 0) + 1 })
      .eq("id", invite.id);

    return ok({ groupId: invite.group_id, groupName: group?.name ?? null, alreadyMember: false });
  }

  // ── get-messages ──────────────────────────────────────────────────────────────
  if (action === "get-messages") {
    const { chatId, before, after } = body;
    if (!sessionUser || !chatId) return fail("Missing fields", 400);
    const uid = sessionUser.id;

    const { data: membership } = await supabase.from("chat_members")
      .select("chat_id").eq("chat_id", chatId as string).eq("user_id", uid).maybeSingle();
    if (!membership) return fail("Not a member of this chat", 403);

    let q = supabase
      .from("messages")
      .select("id, chat_id, sender_id, encrypted_body, msg_type, file_name, file_size, mime_type, status, created_at")
      .eq("chat_id", chatId as string)
      .order("created_at", { ascending: false });
    if (after) q = q.gt("created_at", after as string).limit(100);
    else {
      q = q.limit(50);
      if (before) q = q.lt("created_at", before as string);
    }
    const { data: messages, error } = await q;
    if (error) return fail(error.message, 500);

    // Mark any of peer's messages as delivered
    const toDeliver = (messages ?? []).filter((m: any) => m.sender_id !== uid && m.status === "sent").map((m: any) => m.id);
    if (toDeliver.length > 0)
      await supabase.from("messages").update({ status: "delivered" }).in("id", toDeliver);

    return ok({ messages: messages ?? [] });
  }

  // ── mark-read ─────────────────────────────────────────────────────────────────
  if (action === "mark-read") {
    const { chatId } = body;
    if (!sessionUser || !chatId) return fail("Missing fields", 400);
    const uid = sessionUser.id;
    await supabase.from("chat_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("chat_id", chatId as string).eq("user_id", uid);
    await supabase.from("messages").update({ status: "read" })
      .eq("chat_id", chatId as string).neq("sender_id", uid).in("status", ["sent", "delivered"]);
    return ok({ success: true });
  }

  // ── send-call-signal ─────────────────────────────────────────────────────────
  if (action === "send-call-signal") {
    const { chatId, toUserId, callId, signalType, signalPayload } = body as {
      chatId?: string;
      toUserId?: string;
      callId?: string;
      signalType?: string;
      signalPayload?: string | null;
    };
    if (!sessionUser || !chatId || !toUserId || !callId || !signalType) return fail("Missing fields", 400);
    const uid = sessionUser.id;
    if (uid === toUserId) return fail("Cannot signal yourself", 400);
    if (!CALL_SIGNAL_TYPES.has(signalType)) return fail("Invalid signal type", 400);

    const payload = typeof signalPayload === "string" ? signalPayload.trim() : null;
    if ((signalType === "offer" || signalType === "answer" || signalType === "ice") && !payload) {
      return fail("Missing signal payload", 400);
    }
    if (payload && payload.length > 120000) return fail("Signal payload too large", 413);

    const { count: memberCount } = await supabase
      .from("chat_members")
      .select("user_id", { count: "exact", head: true })
      .eq("chat_id", chatId as string);
    if ((memberCount ?? 0) !== 2) return fail("Voice calls are only available in 1:1 chats", 400);

    const { data: pairMembers } = await supabase
      .from("chat_members")
      .select("user_id")
      .eq("chat_id", chatId as string)
      .in("user_id", [uid, toUserId as string]);
    if ((pairMembers ?? []).length < 2) return fail("Users are not in this chat", 403);

    let recipientPushTargets: Array<{ userId: string; token: string }> = [];
    let recipientReachable = true;
    if (signalType === "offer") {
      recipientPushTargets = await getActivePushTokensForUsers(supabase, [String(toUserId)]);
      const hasActiveSession = await userHasActiveSession(supabase, String(toUserId));
      recipientReachable = hasActiveSession || recipientPushTargets.length > 0;
      if (!recipientReachable) {
        return fail("User is not available at the moment", 409);
      }
    }

    const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    const { data: signal, error } = await supabase
      .from("call_signals")
      .insert({
        call_id: callId,
        chat_id: chatId,
        from_user_id: uid,
        to_user_id: toUserId,
        signal_type: signalType,
        signal_payload: payload,
        expires_at: expiresAt,
      })
      .select("id, call_id, chat_id, from_user_id, to_user_id, signal_type, signal_payload, created_at")
      .single();
    if (error) return fail(error.message, 500);

    if (signalType === "offer" && recipientPushTargets.length > 0) {
      try {
        const { data: senderRow } = await supabase
          .from("users")
          .select("username, avatar_url")
          .eq("id", uid)
          .maybeSingle();

        const senderName = String(senderRow?.username ?? "Someone");
        const senderAvatar = String(senderRow?.avatar_url ?? "");

        await sendExpoPushNotifications(
          supabase,
          recipientPushTargets.map((target) => ({
            to: target.token,
            sound: "default",
            title: "Privy",
            subtitle: senderName,
            body: "Incoming voice call",
            priority: "high",
            channelId: "calls",
            data: {
              type: "call_offer",
              chatId: String(chatId),
              callId: String(callId),
              peerId: uid,
              peerName: senderName,
              peerAvatar: senderAvatar,
            },
          })),
        );
      } catch (pushError) {
        console.error("send-call-signal push dispatch failed", pushError);
      }
    }

    return ok({ signal, recipientReachable });
  }

  // ── get-pending-call-signals ──────────────────────────────────────────────
  if (action === "get-pending-call-signals") {
    const { since } = body as { since?: string };
    if (!sessionUser) return fail("Unauthorized", 401);
    const uid = sessionUser.id;

    let q = supabase
      .from("call_signals")
      .select("id, call_id, chat_id, from_user_id, to_user_id, signal_type, signal_payload, created_at, expires_at")
      .eq("to_user_id", uid)
      .eq("signal_type", "offer")
      .is("consumed_at", null)
      .order("created_at", { ascending: true })
      .limit(100);
    if (since) q = q.gt("created_at", since as string);

    const { data: rows, error } = await q;
    if (error) return fail(error.message, 500);

    const now = Date.now();
    const activeRows = (rows ?? []).filter((row: any) => !row.expires_at || new Date(row.expires_at).getTime() > now);
    if (activeRows.length === 0) return ok({ signals: [] });

    const senderIds = [...new Set(activeRows.map((row: any) => String(row.from_user_id)).filter(Boolean))];
    const { data: senderRows } = senderIds.length > 0
      ? await supabase.from("users").select("id, username, avatar_url").in("id", senderIds)
      : { data: [] };
    const senderMap = new Map<string, { username: string; avatar_url: string | null }>();
    (senderRows ?? []).forEach((row: any) => {
      senderMap.set(String(row.id), {
        username: String(row.username ?? "Unknown"),
        avatar_url: row.avatar_url ?? null,
      });
    });

    const signals = activeRows.map((row: any) => {
      const sender = senderMap.get(String(row.from_user_id));
      return {
        id: row.id,
        call_id: row.call_id,
        chat_id: row.chat_id,
        from_user_id: row.from_user_id,
        to_user_id: row.to_user_id,
        signal_type: row.signal_type,
        signal_payload: row.signal_payload,
        created_at: row.created_at,
        from_username: sender?.username ?? "Unknown",
        from_avatar_url: sender?.avatar_url ?? null,
      };
    });

    return ok({ signals });
  }

  // ── get-call-signals ────────────────────────────────────────────────────────
  if (action === "get-call-signals") {
    const { chatId, callId, since } = body as {
      chatId?: string;
      callId?: string;
      since?: string;
    };
    if (!sessionUser || !chatId) return fail("Missing fields", 400);
    const uid = sessionUser.id;

    const { count: memberCount } = await supabase
      .from("chat_members")
      .select("user_id", { count: "exact", head: true })
      .eq("chat_id", chatId as string);
    if ((memberCount ?? 0) !== 2) return fail("Voice calls are only available in 1:1 chats", 400);

    const { data: membership } = await supabase
      .from("chat_members")
      .select("chat_id")
      .eq("chat_id", chatId as string)
      .eq("user_id", uid)
      .maybeSingle();
    if (!membership) return fail("Not a member of this chat", 403);

    let q = supabase
      .from("call_signals")
      .select("id, call_id, chat_id, from_user_id, to_user_id, signal_type, signal_payload, created_at, expires_at")
      .eq("chat_id", chatId as string)
      .eq("to_user_id", uid)
      .is("consumed_at", null)
      .order("created_at", { ascending: true })
      .limit(100);
    if (callId) q = q.eq("call_id", callId as string);
    if (since) q = q.gt("created_at", since as string);

    const { data: rows, error } = await q;
    if (error) return fail(error.message, 500);

    const now = Date.now();
    const signals = (rows ?? [])
      .filter((row: any) => !row.expires_at || new Date(row.expires_at).getTime() > now)
      .map((row: any) => ({
        id: row.id,
        call_id: row.call_id,
        chat_id: row.chat_id,
        from_user_id: row.from_user_id,
        to_user_id: row.to_user_id,
        signal_type: row.signal_type,
        signal_payload: row.signal_payload,
        created_at: row.created_at,
      }));

    return ok({ signals });
  }

  // ── ack-call-signals ────────────────────────────────────────────────────────
  if (action === "ack-call-signals") {
    const { signalIds } = body as { signalIds?: string[] };
    if (!sessionUser || !Array.isArray(signalIds) || signalIds.length === 0) {
      return fail("Missing signalIds", 400);
    }
    const uid = sessionUser.id;
    const ids = Array.from(new Set(signalIds.filter((id) => typeof id === "string" && id.trim().length > 0))).slice(0, 200);
    if (ids.length === 0) return fail("Missing signalIds", 400);

    const { data, error } = await supabase
      .from("call_signals")
      .update({ consumed_at: new Date().toISOString() })
      .in("id", ids)
      .eq("to_user_id", uid)
      .is("consumed_at", null)
      .select("id");
    if (error) return fail(error.message, 500);

    return ok({ success: true, acked: (data ?? []).length });
  }

  // ── open-chat ──────────────────────────────────────────────────────────────
  // Find-or-create a 1-on-1 chat between two friends.
  // Safe to call even if one side deleted their membership.
  if (action === "open-chat") {
    const { peerId } = body;
    if (!sessionUser || !peerId) return fail("Missing fields", 400);
    const uid = sessionUser.id;
    if (uid === peerId) return fail("Cannot open chat with yourself");

    // Verify they are actually friends
    const { data: rel } = await supabase.from("friend_requests")
      .select("id, status")
      .or(`and(sender_id.eq.${uid},receiver_id.eq.${peerId as string}),and(sender_id.eq.${peerId as string},receiver_id.eq.${uid})`)
      .eq("status", "accepted").maybeSingle();
    if (!rel) return fail("Not friends", 403);

    // Fetch peer's public key (may be null if they haven't uploaded yet)
    const { data: peerKeyRow } = await supabase.from("user_public_keys")
      .select("public_key").eq("user_id", peerId as string).maybeSingle();
    const peerPublicKey = peerKeyRow?.public_key ?? null;

    // Check if a shared chat already exists where BOTH are members
    const { data: myChats }    = await supabase.from("chat_members").select("chat_id").eq("user_id", uid);
    const { data: theirChats } = await supabase.from("chat_members").select("chat_id").eq("user_id", peerId as string);
    const myIds    = (myChats    ?? []).map((r: any) => r.chat_id as string);
    const theirIds = (theirChats ?? []).map((r: any) => r.chat_id as string);
    const existing = myIds.find(id => theirIds.includes(id));
    if (existing) return ok({ chatId: existing, peerPublicKey });

    // No shared chat — create one and add both members
    const { data: chat, error: chatErr } = await supabase.from("chats").insert({}).select("id").single();
    if (chatErr) return fail(chatErr.message, 500);
    await supabase.from("chat_members").insert([
      { chat_id: chat.id, user_id: uid },
      { chat_id: chat.id, user_id: peerId as string },
    ]);
    return ok({ chatId: chat.id, peerPublicKey });
  }

  // ── delete-message ────────────────────────────────────────────────────────────
  if (action === "delete-message") {
    const { messageId, forEveryone } = body;
    if (!sessionUser || !messageId) return fail("Missing fields", 400);
    const uid = sessionUser.id;

    if (forEveryone) {
      // Verify the requester is the sender
      const { data: msg } = await supabase.from("messages")
        .select("sender_id, chat_id").eq("id", messageId as string).maybeSingle();
      if (!msg) return fail("Message not found", 404);
      if (msg.sender_id !== uid) return fail("Cannot delete others' messages", 403);
      await supabase.from("messages").delete().eq("id", messageId as string);
    }
    // "delete for me" is client-side only — no server action needed
    return ok({ success: true });
  }

  // ── delete-chat ───────────────────────────────────────────────────────────────
  if (action === "delete-chat") {
    const { chatId } = body;
    if (!sessionUser || !chatId) return fail("Missing fields", 400);
    const uid = sessionUser.id;

    // Confirm membership before touching anything
    const { data: membership } = await supabase.from("chat_members")
      .select("chat_id").eq("chat_id", chatId as string).eq("user_id", uid).maybeSingle();
    if (!membership) return fail("Not a member of this chat", 403);

    // Remove this user from the chat
    await supabase.from("chat_members").delete()
      .eq("chat_id", chatId as string).eq("user_id", uid);

    // If no members remain, clean up messages + chat row
    const { count } = await supabase.from("chat_members")
      .select("*", { count: "exact", head: true }).eq("chat_id", chatId as string);
    if ((count ?? 0) === 0) {
      await supabase.from("messages").delete().eq("chat_id", chatId as string);
      await supabase.from("chats").delete().eq("id", chatId as string);
    }

    return ok({ success: true });
  }

  // ── create-group ───────────────────────────────────────────────────────────
  if (action === "create-group") {
    const { sessionToken, name, memberIds = [], keyEnvelopes = {}, inviteRequiresApproval = false } = body as any;
    if (!sessionToken || !name) return fail("Missing fields");

    const uid = await sessionUserId(supabase, sessionToken as string);
    if (!uid) return fail("Invalid session", 401);

    const trimmed = String(name).trim();
    if (trimmed.length < 2 || trimmed.length > 80) return fail("Invalid group name");

    const { data: group, error: groupErr } = await supabase
      .from("group_chats")
      .insert({
        name: trimmed,
        created_by: uid,
        invite_requires_approval: Boolean(inviteRequiresApproval),
      })
      .select("id, name, key_version, announcement_mode, invite_requires_approval")
      .single();
    if (groupErr) return fail(groupErr.message, 500);

    const uniqueMembers = Array.from(new Set([uid, ...(memberIds as string[])]));
    const rows = uniqueMembers.map((id) => ({
      group_id: group.id,
      user_id: id,
      role: id === uid ? "super_admin" : "member",
    }));

    const { error: membersErr } = await supabase.from("group_chat_members").insert(rows);
    if (membersErr) return fail(membersErr.message, 500);

    const keyRows = Object.entries(keyEnvelopes as Record<string, string>).map(([memberId, encryptedGroupKey]) => ({
      group_id: group.id,
      user_id: memberId,
      key_version: group.key_version,
      encrypted_group_key: encryptedGroupKey,
    }));
    if (keyRows.length > 0) {
      const { error: keyErr } = await supabase.from("group_member_keys").insert(keyRows);
      if (keyErr) return fail(keyErr.message, 500);
    }

    return ok({ success: true, group });
  }

  // ── list-groups ────────────────────────────────────────────────────────────
  if (action === "list-groups") {
    const { sessionToken } = body as any;
    const uid = await sessionUserId(supabase, sessionToken as string);
    if (!uid) return fail("Invalid session", 401);

    const { data: memberships, error } = await supabase
      .from("group_chat_members")
      .select("group_id, role, joined_at, group:group_chats(id, name, announcement_mode, invite_requires_approval, restrict_forwarding, key_version, created_by)")
      .eq("user_id", uid)
      .order("joined_at", { ascending: false });
    if (error) return fail(error.message, 500);

    const groupIds = (memberships ?? []).map((m: any) => m.group_id);
    const { data: lastMessages } = groupIds.length
      ? await supabase.from("group_messages").select("id, group_id, sender_id, msg_type, created_at").in("group_id", groupIds).order("created_at", { ascending: false })
      : { data: [] as any[] };

    const { data: myReadRows } = await supabase
      .from("group_chat_members")
      .select("group_id, last_read_at")
      .eq("user_id", uid)
      .in("group_id", groupIds);

    const readMap: Record<string, string | null> = {};
    (myReadRows ?? []).forEach((r: any) => { readMap[r.group_id] = r.last_read_at ?? null; });

    const unreadMap: Record<string, number> = {};
    for (const m of (lastMessages ?? [])) {
      if (m.sender_id === uid) continue;
      const lr = readMap[m.group_id];
      if (!lr || new Date(m.created_at) > new Date(lr)) unreadMap[m.group_id] = (unreadMap[m.group_id] ?? 0) + 1;
    }

    const lastByGroup: Record<string, any> = {};
    for (const m of (lastMessages ?? [])) {
      if (!lastByGroup[m.group_id]) lastByGroup[m.group_id] = m;
    }

    const groups = (memberships ?? []).map((m: any) => ({
      id: m.group.id,
      name: m.group.name,
      role: m.role,
      announcement_mode: m.group.announcement_mode,
      invite_requires_approval: m.group.invite_requires_approval,
      restrict_forwarding: m.group.restrict_forwarding,
      key_version: m.group.key_version,
      created_by: m.group.created_by,
      joined_at: m.joined_at,
      unread_count: unreadMap[m.group_id] ?? 0,
      last_message: lastByGroup[m.group_id] ?? null,
      last_message_at: (lastByGroup[m.group_id]?.created_at ?? m.joined_at),
    }));

    return ok({ success: true, groups });
  }

  // ── create-group-invite ───────────────────────────────────────────────────
  if (action === "create-group-invite") {
    const { sessionToken, groupId, expiresInHours = 72, maxUses = null } = body as any;
    const uid = await sessionUserId(supabase, sessionToken as string);
    if (!uid) return fail("Invalid session", 401);

    const member = await groupMembership(supabase, groupId, uid);
    if (!member || !canModerate(member.role)) return fail("Forbidden", 403);

    const raw = crypto.getRandomValues(new Uint8Array(24));
    const inviteToken = Array.from(raw).map((b) => b.toString(16).padStart(2, "0")).join("");
    const expiresAt = new Date(Date.now() + Number(expiresInHours) * 3600000).toISOString();

    const { data, error } = await supabase.from("group_invite_links").insert({
      group_id: groupId,
      invite_token: inviteToken,
      created_by: uid,
      expires_at: expiresAt,
      max_uses: maxUses,
    }).select("id, group_id, invite_token, expires_at, max_uses, uses").single();
    if (error) return fail(error.message, 500);
    return ok({ success: true, invite: data });
  }

  // ── join-group-via-invite ─────────────────────────────────────────────────
  if (action === "join-group-via-invite") {
    const { sessionToken, inviteToken } = body as any;
    const uid = await sessionUserId(supabase, sessionToken as string);
    if (!uid) return fail("Invalid session", 401);

    const { data: invite } = await supabase
      .from("group_invite_links")
      .select("id, group_id, expires_at, max_uses, uses, revoked")
      .eq("invite_token", inviteToken)
      .maybeSingle();
    if (!invite || invite.revoked) return fail("Invalid invite", 404);
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) return fail("Invite expired", 400);
    if (invite.max_uses !== null && invite.uses >= invite.max_uses) return fail("Invite max uses reached", 400);

    const { data: isBanned } = await supabase
      .from("group_bans")
      .select("id")
      .eq("group_id", invite.group_id)
      .eq("user_id", uid)
      .maybeSingle();
    if (isBanned) return fail("You are banned from this group", 403);

    const { data: grp } = await supabase
      .from("group_chats")
      .select("id, invite_requires_approval")
      .eq("id", invite.group_id)
      .maybeSingle();
    if (!grp) return fail("Group not found", 404);

    if (grp.invite_requires_approval) {
      await supabase.from("group_join_requests").upsert({
        group_id: grp.id,
        requester_id: uid,
        invite_link_id: invite.id,
        status: "pending",
      }, { onConflict: "group_id,requester_id,status" });
      return ok({ success: true, pending: true });
    }

    await supabase.from("group_chat_members").upsert({
      group_id: grp.id,
      user_id: uid,
      role: "member",
    }, { onConflict: "group_id,user_id" });

    await supabase.from("group_invite_links").update({ uses: invite.uses + 1 }).eq("id", invite.id);
    return ok({ success: true, pending: false, groupId: grp.id });
  }

  // ── get-group-join-requests ────────────────────────────────────────────────
  if (action === "get-group-join-requests") {
    const { sessionToken, groupId } = body as any;
    const uid = await sessionUserId(supabase, sessionToken as string);
    if (!uid) return fail("Invalid session", 401);

    const member = await groupMembership(supabase, groupId, uid);
    if (!member || !canModerate(member.role)) return fail("Forbidden", 403);

    const { data, error } = await supabase
      .from("group_join_requests")
      .select("id, requester_id, requested_at, status, user:requester_id(id, username, avatar_url)")
      .eq("group_id", groupId)
      .eq("status", "pending")
      .order("requested_at", { ascending: false });
    if (error) return fail(error.message, 500);
    return ok({ success: true, requests: data ?? [] });
  }

  // ── resolve-group-join-request ─────────────────────────────────────────────
  if (action === "resolve-group-join-request") {
    const { sessionToken, requestId, approve = false } = body as any;
    const uid = await sessionUserId(supabase, sessionToken as string);
    if (!uid) return fail("Invalid session", 401);

    const { data: reqRow } = await supabase
      .from("group_join_requests")
      .select("id, group_id, requester_id, status")
      .eq("id", requestId)
      .maybeSingle();
    if (!reqRow || reqRow.status !== "pending") return fail("Request not found", 404);

    const member = await groupMembership(supabase, reqRow.group_id, uid);
    if (!member || !canModerate(member.role)) return fail("Forbidden", 403);

    await supabase.from("group_join_requests").update({
      status: approve ? "approved" : "rejected",
      resolved_at: new Date().toISOString(),
      resolved_by: uid,
    }).eq("id", reqRow.id);

    if (approve) {
      await supabase.from("group_chat_members").upsert({
        group_id: reqRow.group_id,
        user_id: reqRow.requester_id,
        role: "member",
      }, { onConflict: "group_id,user_id" });
    }

    return ok({ success: true });
  }

  // ── list-group-members ─────────────────────────────────────────────────────
  if (action === "list-group-members") {
    const { sessionToken, groupId } = body as any;
    const uid = await sessionUserId(supabase, sessionToken as string);
    if (!uid) return fail("Invalid session", 401);

    const member = await groupMembership(supabase, groupId, uid);
    if (!member) return fail("Not a member", 403);

    const { data, error } = await supabase
      .from("group_chat_members")
      .select("group_id, user_id, role, muted_until, joined_at, user:user_id(id, username, avatar_url)")
      .eq("group_id", groupId)
      .order("joined_at", { ascending: true });
    if (error) return fail(error.message, 500);

    const userIds = (data ?? []).map((m: any) => m.user_id);
    const { data: keys } = userIds.length
      ? await supabase.from("user_public_keys").select("user_id, public_key").in("user_id", userIds)
      : { data: [] as any[] };
    const keyMap = new Map((keys ?? []).map((k: any) => [k.user_id, k.public_key]));

    const members = (data ?? []).map((m: any) => ({
      ...m,
      user: {
        ...(m.user ?? {}),
        public_key: keyMap.get(m.user_id) ?? null,
      },
    }));

    return ok({ success: true, members });
  }

  // ── add-group-member ──────────────────────────────────────────────────────
  if (action === "add-group-member") {
    const { sessionToken, groupId, targetUserId, encryptedGroupKey } = body as any;
    const uid = await sessionUserId(supabase, sessionToken as string);
    if (!uid) return fail("Invalid session", 401);

    const actor = await groupMembership(supabase, groupId, uid);
    if (!actor || !canModerate(actor.role)) return fail("Forbidden", 403);

    const { data: banned } = await supabase
      .from("group_bans")
      .select("id")
      .eq("group_id", groupId)
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (banned) return fail("User is banned", 403);

    const { error: joinErr } = await supabase
      .from("group_chat_members")
      .upsert({ group_id: groupId, user_id: targetUserId, role: "member" }, { onConflict: "group_id,user_id" });
    if (joinErr) return fail(joinErr.message, 500);

    if (encryptedGroupKey) {
      const { data: groupRow } = await supabase
        .from("group_chats")
        .select("key_version")
        .eq("id", groupId)
        .single();
      await supabase.from("group_member_keys").upsert({
        group_id: groupId,
        user_id: targetUserId,
        key_version: Number(groupRow?.key_version ?? 1),
        encrypted_group_key: encryptedGroupKey,
      }, { onConflict: "group_id,user_id,key_version" });
    }

    return ok({ success: true });
  }

  // ── update-group-member ────────────────────────────────────────────────────
  if (action === "update-group-member") {
    const { sessionToken, groupId, targetUserId, operation, role, muteUntil, reason } = body as any;
    const uid = await sessionUserId(supabase, sessionToken as string);
    if (!uid) return fail("Invalid session", 401);

    const actor = await groupMembership(supabase, groupId, uid);
    if (!actor || !canModerate(actor.role)) return fail("Forbidden", 403);

    const target = await groupMembership(supabase, groupId, targetUserId);
    if (!target && operation !== "ban") return fail("Target not in group", 404);
    if (target?.role === "super_admin") return fail("Cannot modify super admin", 403);

    if (operation === "set-role") {
      if (actor.role !== "super_admin") return fail("Only super admin can change roles", 403);
      if (!role || !["member", "admin"].includes(role)) return fail("Invalid role");
      await supabase.from("group_chat_members").update({ role }).eq("group_id", groupId).eq("user_id", targetUserId);
      return ok({ success: true });
    }

    if (operation === "mute") {
      await supabase.from("group_chat_members").update({ muted_until: muteUntil ?? null }).eq("group_id", groupId).eq("user_id", targetUserId);
      return ok({ success: true });
    }

    if (operation === "kick") {
      await supabase.from("group_chat_members").delete().eq("group_id", groupId).eq("user_id", targetUserId);
      return ok({ success: true });
    }

    if (operation === "ban") {
      await supabase.from("group_bans").upsert({
        group_id: groupId,
        user_id: targetUserId,
        banned_by: uid,
        reason: reason ?? null,
      }, { onConflict: "group_id,user_id" });
      await supabase.from("group_chat_members").delete().eq("group_id", groupId).eq("user_id", targetUserId);
      return ok({ success: true });
    }

    return fail("Unknown operation");
  }

  // ── set-group-settings ─────────────────────────────────────────────────────
  if (action === "set-group-settings") {
    const { sessionToken, groupId, announcementMode, inviteRequiresApproval, restrictForwarding } = body as any;
    const uid = await sessionUserId(supabase, sessionToken as string);
    if (!uid) return fail("Invalid session", 401);

    const actor = await groupMembership(supabase, groupId, uid);
    if (!actor || !canModerate(actor.role)) return fail("Forbidden", 403);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof announcementMode === "boolean") patch.announcement_mode = announcementMode;
    if (typeof inviteRequiresApproval === "boolean") patch.invite_requires_approval = inviteRequiresApproval;
    if (typeof restrictForwarding === "boolean") patch.restrict_forwarding = restrictForwarding;

    const { data, error } = await supabase
      .from("group_chats")
      .update(patch)
      .eq("id", groupId)
      .select("id, announcement_mode, invite_requires_approval, restrict_forwarding, key_version")
      .single();
    if (error) return fail(error.message, 500);
    return ok({ success: true, group: data });
  }

  // ── rotate-group-key ───────────────────────────────────────────────────────
  if (action === "rotate-group-key") {
    const { sessionToken, groupId, keyEnvelopes = {}, reason = "manual" } = body as any;
    const uid = await sessionUserId(supabase, sessionToken as string);
    if (!uid) return fail("Invalid session", 401);

    const actor = await groupMembership(supabase, groupId, uid);
    if (!actor || !canModerate(actor.role)) return fail("Forbidden", 403);

    const { data: grp } = await supabase.from("group_chats").select("id, key_version").eq("id", groupId).maybeSingle();
    if (!grp) return fail("Group not found", 404);

    const oldVersion = grp.key_version;
    const newVersion = oldVersion + 1;

    await supabase.from("group_chats").update({ key_version: newVersion, updated_at: new Date().toISOString() }).eq("id", groupId);

    const keyRows = Object.entries(keyEnvelopes as Record<string, string>).map(([memberId, encryptedGroupKey]) => ({
      group_id: groupId,
      user_id: memberId,
      key_version: newVersion,
      encrypted_group_key: encryptedGroupKey,
    }));
    if (keyRows.length > 0) {
      const { error: keyErr } = await supabase.from("group_member_keys").insert(keyRows);
      if (keyErr) return fail(keyErr.message, 500);
    }

    await supabase.from("group_key_rotations").insert({
      group_id: groupId,
      rotated_by: uid,
      old_version: oldVersion,
      new_version: newVersion,
      reason,
    });

    return ok({ success: true, keyVersion: newVersion });
  }

  // ── get-group-state ────────────────────────────────────────────────────────
  if (action === "get-group-state") {
    const { sessionToken, groupId } = body as any;
    const uid = await sessionUserId(supabase, sessionToken as string);
    if (!uid) return fail("Invalid session", 401);

    const member = await groupMembership(supabase, groupId, uid);
    if (!member) return fail("Not a member", 403);

    const { data: grp } = await supabase
      .from("group_chats")
      .select("id, name, created_by, announcement_mode, invite_requires_approval, restrict_forwarding, key_version")
      .eq("id", groupId)
      .maybeSingle();
    if (!grp) return fail("Group not found", 404);

    const { data: keyRow } = await supabase
      .from("group_member_keys")
      .select("encrypted_group_key")
      .eq("group_id", groupId)
      .eq("user_id", uid)
      .eq("key_version", grp.key_version)
      .maybeSingle();

    return ok({ success: true, group: grp, me: member, encryptedGroupKey: keyRow?.encrypted_group_key ?? null });
  }

  // ── send-group-message ─────────────────────────────────────────────────────
  if (action === "send-group-message") {
    const { sessionToken, groupId, encryptedBody, keyVersion, msgType = "text", fileName, fileSize, mimeType, forwardedFrom = null } = body as any;
    const uid = await sessionUserId(supabase, sessionToken as string);
    if (!uid) return fail("Invalid session", 401);

    const member = await groupMembership(supabase, groupId, uid);
    if (!member) return fail("Not a member", 403);
    if (member.muted_until && new Date(member.muted_until) > new Date()) return fail("You are muted", 403);

    const { data: grp } = await supabase
      .from("group_chats")
      .select("announcement_mode, restrict_forwarding, key_version")
      .eq("id", groupId)
      .maybeSingle();
    if (!grp) return fail("Group not found", 404);

    if (grp.announcement_mode && !canModerate(member.role)) {
      return fail("Only admins can send in announcement mode", 403);
    }
    if (grp.restrict_forwarding && forwardedFrom) {
      return fail("Forwarding is restricted in this group", 403);
    }

    const { data: msg, error } = await supabase
      .from("group_messages")
      .insert({
        group_id: groupId,
        sender_id: uid,
        encrypted_body: encryptedBody,
        key_version: keyVersion ?? grp.key_version,
        msg_type: msgType,
        file_name: fileName ?? null,
        file_size: fileSize ?? null,
        mime_type: mimeType ?? null,
        forwarded_from: forwardedFrom,
      })
      .select("id, group_id, sender_id, encrypted_body, key_version, msg_type, file_name, file_size, mime_type, created_at")
      .single();
    if (error) return fail(error.message, 500);

    await supabase.from("group_chat_members").update({ last_delivered_at: new Date().toISOString() }).eq("group_id", groupId).neq("user_id", uid);

    return ok({ success: true, message: msg });
  }

  // ── get-group-messages ─────────────────────────────────────────────────────
  if (action === "get-group-messages") {
    const { sessionToken, groupId, before } = body as any;
    const uid = await sessionUserId(supabase, sessionToken as string);
    if (!uid) return fail("Invalid session", 401);
    const member = await groupMembership(supabase, groupId, uid);
    if (!member) return fail("Not a member", 403);

    let q = supabase
      .from("group_messages")
      .select("id, group_id, sender_id, encrypted_body, key_version, msg_type, file_name, file_size, mime_type, forwarded_from, created_at")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .limit(80);
    if (before) q = q.lt("created_at", before);

    const { data: messages, error } = await q;
    if (error) return fail(error.message, 500);

    const deliverRows = (messages ?? []).filter((m: any) => m.sender_id !== uid).map((m: any) => ({
      message_id: m.id,
      user_id: uid,
      status: "delivered",
    }));
    if (deliverRows.length) {
      await supabase.from("group_message_receipts").upsert(deliverRows, { onConflict: "message_id,user_id,status", ignoreDuplicates: true });
    }

    return ok({ success: true, messages: messages ?? [] });
  }

  // ── set-group-receipt ──────────────────────────────────────────────────────
  if (action === "set-group-receipt") {
    const { sessionToken, groupId, messageId, status } = body as any;
    const uid = await sessionUserId(supabase, sessionToken as string);
    if (!uid) return fail("Invalid session", 401);
    const member = await groupMembership(supabase, groupId, uid);
    if (!member) return fail("Not a member", 403);
    if (!["delivered", "seen"].includes(status)) return fail("Invalid receipt status");

    await supabase.from("group_message_receipts").upsert({
      message_id: messageId,
      user_id: uid,
      status,
    }, { onConflict: "message_id,user_id,status", ignoreDuplicates: true });

    if (status === "seen") {
      await supabase.from("group_chat_members").update({ last_read_at: new Date().toISOString() }).eq("group_id", groupId).eq("user_id", uid);
    }

    return ok({ success: true });
  }

  // ── set-group-typing ───────────────────────────────────────────────────────
  if (action === "set-group-typing") {
    const { sessionToken, groupId, isTyping } = body as any;
    const uid = await sessionUserId(supabase, sessionToken as string);
    if (!uid) return fail("Invalid session", 401);
    const member = await groupMembership(supabase, groupId, uid);
    if (!member) return fail("Not a member", 403);

    await supabase.from("group_typing_presence").upsert({
      group_id: groupId,
      user_id: uid,
      is_typing: Boolean(isTyping),
      updated_at: new Date().toISOString(),
    }, { onConflict: "group_id,user_id" });
    return ok({ success: true });
  }

  // ── report-group-user ──────────────────────────────────────────────────────
  if (action === "report-group-user") {
    const { sessionToken, groupId, reportedUserId, reason, messageId = null } = body as any;
    const uid = await sessionUserId(supabase, sessionToken as string);
    if (!uid) return fail("Invalid session", 401);
    const member = await groupMembership(supabase, groupId, uid);
    if (!member) return fail("Not a member", 403);
    if (!reason || String(reason).trim().length < 3) return fail("Reason required");

    const { error } = await supabase.from("group_reports").insert({
      group_id: groupId,
      reporter_id: uid,
      reported_user_id: reportedUserId,
      reason: String(reason).trim(),
      message_id: messageId,
    });
    if (error) return fail(error.message, 500);
    return ok({ success: true });
  }

  return fail(`Unknown action: ${action}`);
});
