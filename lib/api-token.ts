import "server-only";
import { verifyToken } from "@/lib/crypto";

/** Resolve a REST API bearer token to a workspace id (HMAC-signed, kind=api). */
export async function workspaceFromBearer(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const payload = await verifyToken(authHeader.slice(7).trim());
  if (!payload || payload.kind !== "api" || !payload.ws) return null;
  return payload.ws;
}
