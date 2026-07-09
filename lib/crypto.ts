// AES-256-GCM encryption for OAuth tokens and provider keys at rest.
// Uses WebCrypto so the same code shape works in Node (Next.js) and Deno
// (a copy lives in supabase/functions/_shared/crypto.ts).
import { webcrypto } from "node:crypto";

const subtle = webcrypto.subtle;

function keyBytes(): Uint8Array {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32)");
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function importKey(): Promise<CryptoKey> {
  return subtle.importKey("raw", keyBytes() as unknown as ArrayBuffer, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encrypt(plaintext: string): Promise<string> {
  const key = await importKey();
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as ArrayBuffer },
    key,
    new TextEncoder().encode(plaintext)
  );
  const buf = new Uint8Array(12 + ct.byteLength);
  buf.set(iv, 0);
  buf.set(new Uint8Array(ct), 12);
  return Buffer.from(buf).toString("base64");
}

export async function decrypt(payload: string): Promise<string> {
  const buf = new Uint8Array(Buffer.from(payload, "base64"));
  const iv = buf.slice(0, 12);
  const ct = buf.slice(12);
  const key = await importKey();
  const pt = await subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as ArrayBuffer },
    key,
    ct as unknown as ArrayBuffer
  );
  return new TextDecoder().decode(pt);
}

/** HMAC-SHA256 signed token for tracking/unsubscribe URLs: base64url(payload).base64url(sig) */
export async function signToken(payload: Record<string, string>): Promise<string> {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const key = await subtle.importKey(
    "raw",
    keyBytes() as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${Buffer.from(sig).toString("base64url")}`;
}

export async function verifyToken(token: string): Promise<Record<string, string> | null> {
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  const key = await subtle.importKey(
    "raw",
    keyBytes() as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  let sigBytes: Buffer;
  try {
    sigBytes = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  const ok = await subtle.verify(
    "HMAC",
    key,
    sigBytes as unknown as ArrayBuffer,
    new TextEncoder().encode(data)
  );
  if (!ok) return null;
  try {
    return JSON.parse(Buffer.from(data, "base64url").toString());
  } catch {
    return null;
  }
}
