import "server-only";
import { SupabaseClient } from "@supabase/supabase-js";
import { decrypt, encrypt } from "@/lib/crypto";
import { refreshGoogleToken } from "@/lib/gmail";
import { refreshMsToken } from "@/lib/graph";
import type { Mailbox } from "@/lib/types";

/**
 * Return a valid access token for a mailbox, refreshing (and persisting)
 * if the cached one expires within 10 minutes. On refresh failure the
 * mailbox is marked auth_error.
 */
export async function getAccessToken(admin: SupabaseClient, mailbox: Mailbox): Promise<string> {
  const expiresAt = mailbox.access_token_expires_at ? new Date(mailbox.access_token_expires_at) : null;
  if (mailbox.access_token_enc && expiresAt && expiresAt.getTime() - Date.now() > 10 * 60_000) {
    return decrypt(mailbox.access_token_enc);
  }
  if (!mailbox.refresh_token_enc) throw new Error(`Mailbox ${mailbox.email} has no refresh token`);
  const refreshToken = await decrypt(mailbox.refresh_token_enc);

  try {
    const tokens =
      mailbox.provider === "google"
        ? await refreshGoogleToken(refreshToken)
        : await refreshMsToken(refreshToken);

    const update: Record<string, unknown> = {
      access_token_enc: await encrypt(tokens.access_token),
      access_token_expires_at: new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString(),
    };
    // Microsoft rotates refresh tokens
    if (tokens.refresh_token) update.refresh_token_enc = await encrypt(tokens.refresh_token);
    await admin.from("mailboxes").update(update).eq("id", mailbox.id);
    return tokens.access_token;
  } catch (err) {
    await admin.from("mailboxes").update({ status: "auth_error" }).eq("id", mailbox.id);
    throw err;
  }
}
