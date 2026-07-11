// The tick engine (build brief §6). Invoked every minute by pg_cron via
// pg_net. Each step is bounded so the whole invocation stays well under the
// edge time limit; long work chunks across ticks.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { serviceClient, queueNotification, onceToday } from "../_shared/db.ts";
import { decrypt, encrypt, signToken, hmacHex } from "../_shared/crypto.ts";
import {
  effectiveCap,
  freeDomains,
  DEFAULT_DAILY_DOMAIN_CAP,
  BREAKER_TRAILING_SENDS,
  BREAKER_BOUNCE_RATE,
  BREAKER_MAILBOX_FAILURES,
} from "../_shared/config.ts";
import {
  refreshGoogleToken,
  refreshMsToken,
  buildMime,
  base64UrlEncode,
  generateMessageId,
  gmailSend,
  gmailHistoryList,
  gmailListRecent,
  gmailGetMessage,
  gmailProfile,
  gmailHeader,
  gmailPlainText,
  graphSendMail,
  graphReply,
  graphInboxDelta,
  graphGetMessage,
  runChain,
  aiComplete,
  parseJson,
  ChainExhaustedError,
} from "../_shared/providers.ts";
import { computeNextSendAt, addBusinessDays, inComplianceHours, snapIntoWindow } from "../_shared/schedule.ts";
import { spin, leadVars, renderVars, assembleBody } from "../_shared/render.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const SEND_BATCH = 20;
const POLL_MAILBOXES = 10;
const RESEARCH_BATCH = 5;

// Auth for cron-invoked calls: prefer a dedicated CRON_SECRET (deterministic,
// independent of Supabase's key-injection quirks), fall back to the service role.
const CRON_AUTH = Deno.env.get("CRON_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "___never___";

Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.includes(CRON_AUTH)) {
    return new Response("unauthorized", { status: 401 });
  }
  const db = serviceClient();
  const report: Record<string, unknown> = {};

  // Steps run in brief §6 order; each is individually fenced so one failure
  // never blocks the rest of the tick.
  const steps: [string, () => Promise<unknown>][] = [
    ["rollover", () => dayRollover(db)],
    ["token_refresh", () => tokenRefresh(db)],
    ["send_due", () => sendDue(db)],
    ["reply_poll", () => replyPoll(db)],
    ["research", () => invokeResearch()],
    ["breakers", () => breakers(db)],
    ["warmup", () => warmup(db)],
    ["notifications", () => flushNotifications(db)],
    ["digests", () => dailyDigests(db)],
  ];
  for (const [name, fn] of steps) {
    try {
      report[name] = (await fn()) ?? "ok";
    } catch (err) {
      console.error(`[tick:${name}]`, err);
      report[name] = `error: ${String(err).slice(0, 300)}`;
    }
  }
  return Response.json(report);
});

// ── 1. Day rollover ──────────────────────────────────────────────────────────
async function dayRollover(db: SupabaseClient) {
  await db
    .from("mailboxes")
    .update({ sent_today: 0, sent_date: new Date().toISOString().slice(0, 10) })
    .neq("sent_date", new Date().toISOString().slice(0, 10));
}

// ── 2. Proactive token refresh ───────────────────────────────────────────────
async function tokenRefresh(db: SupabaseClient) {
  const soon = new Date(Date.now() + 10 * 60_000).toISOString();
  const { data: due } = await db
    .from("mailboxes")
    .select("*")
    .eq("status", "active")
    .or(`access_token_expires_at.is.null,access_token_expires_at.lt.${soon}`)
    .limit(10);

  let refreshed = 0;
  for (const mb of due ?? []) {
    if (!mb.refresh_token_enc) continue;
    try {
      const rt = await decrypt(mb.refresh_token_enc);
      const tokens = mb.provider === "google" ? await refreshGoogleToken(rt) : await refreshMsToken(rt);
      const update: Row = {
        access_token_enc: await encrypt(tokens.access_token),
        access_token_expires_at: new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString(),
      };
      if (tokens.refresh_token) update.refresh_token_enc = await encrypt(tokens.refresh_token);
      await db.from("mailboxes").update(update).eq("id", mb.id);
      refreshed++;
    } catch (err) {
      console.error(`token refresh failed for ${mb.email}:`, err);
      await db.from("mailboxes").update({ status: "auth_error" }).eq("id", mb.id);
      await queueNotification(db, mb.workspace_id, "mailbox_disconnected", {
        mailbox: mb.email,
        error: String(err).slice(0, 200),
      });
    }
  }
  return { refreshed };
}

async function accessTokenFor(db: SupabaseClient, mailbox: Row): Promise<string> {
  const expiresAt = mailbox.access_token_expires_at ? new Date(mailbox.access_token_expires_at) : null;
  if (mailbox.access_token_enc && expiresAt && expiresAt.getTime() - Date.now() > 5 * 60_000) {
    return decrypt(mailbox.access_token_enc);
  }
  const rt = await decrypt(mailbox.refresh_token_enc);
  const tokens = mailbox.provider === "google" ? await refreshGoogleToken(rt) : await refreshMsToken(rt);
  const update: Row = {
    access_token_enc: await encrypt(tokens.access_token),
    access_token_expires_at: new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString(),
  };
  if (tokens.refresh_token) update.refresh_token_enc = await encrypt(tokens.refresh_token);
  await db.from("mailboxes").update(update).eq("id", mailbox.id);
  return tokens.access_token;
}

// ── 3. Send due ──────────────────────────────────────────────────────────────
async function sendDue(db: SupabaseClient) {
  const { data: claimed, error } = await db.rpc("claim_due_sends", { batch: SEND_BATCH });
  if (error) throw new Error(error.message);
  if (!claimed?.length) return { sent: 0 };

  let sent = 0;
  const usedMailboxes = new Set<string>(); // ≤1 send per mailbox per tick preserves spacing
  for (const cl of claimed as Row[]) {
    try {
      const outcome = await sendOne(db, cl, usedMailboxes);
      if (outcome === "sent") sent++;
    } catch (err) {
      console.error(`send failed for campaign_lead ${cl.id}:`, err);
      await handleSendFailure(db, cl, String(err));
    }
  }
  return { sent, claimed: claimed.length };
}

async function sendOne(db: SupabaseClient, cl: Row, usedMailboxes: Set<string>): Promise<string> {
  const [{ data: campaign }, { data: lead }, { data: mailbox }] = await Promise.all([
    db.from("campaigns").select("*").eq("id", cl.campaign_id).single(),
    db.from("leads").select("*").eq("id", cl.lead_id).single(),
    cl.mailbox_id
      ? db.from("mailboxes").select("*").eq("id", cl.mailbox_id).single()
      : Promise.resolve({ data: null }),
  ]);
  if (!campaign || campaign.status !== "running") return "campaign_not_running";
  if (!lead) return "no_lead";
  if (!mailbox) {
    await stopLead(db, cl.id, "failed", "no mailbox assigned");
    return "no_mailbox";
  }
  const settings = campaign.settings ?? {};
  const stepNo = cl.current_step + 1;

  // one send per mailbox per tick → later leads just come due next tick
  if (usedMailboxes.has(mailbox.id)) return "mailbox_used_this_tick";

  // ── guards, re-checked at send time ──
  const email = lead.email.toLowerCase();
  const domain = email.split("@")[1];

  // suppression: email + domain, workspace + global (§14)
  const { data: suppressed } = await db
    .from("suppression")
    .select("id")
    .or(`workspace_id.eq.${campaign.workspace_id},workspace_id.is.null`)
    .or(`and(kind.eq.email,value.eq.${email}),and(kind.eq.domain,value.eq.${domain})`)
    .limit(1);
  if (suppressed?.length) {
    await stopLead(db, cl.id, "unsubscribed", "suppressed at send time");
    return "suppressed";
  }

  // free consumer domains blocked unless explicitly allowed (§14)
  if (freeDomains.has(domain) && !settings.allow_free_domains) {
    await stopLead(db, cl.id, "failed", "free consumer domain blocked");
    return "free_domain_blocked";
  }

  // mailbox status + ramped budget
  if (mailbox.status !== "active") return "mailbox_not_active";
  const cap = effectiveCap(mailbox.ramp_started_at, mailbox.daily_cap);
  const sentToday = mailbox.sent_date === new Date().toISOString().slice(0, 10) ? mailbox.sent_today : 0;
  if (sentToday >= cap) {
    // budget exhausted → push to tomorrow's window
    const tz = tzFor(settings, lead);
    const tomorrow = snapIntoWindow(new Date(Date.now() + 12 * 3600_000), settings.send_window ?? {}, tz);
    await db.from("campaign_leads").update({ next_send_at: tomorrow.toISOString() }).eq("id", cl.id);
    return "mailbox_budget_exhausted";
  }

  // per-recipient-domain daily cap per campaign (§10)
  const domainCap = settings.daily_domain_cap ?? DEFAULT_DAILY_DOMAIN_CAP;
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { count: domainSends } = await db
    .from("messages")
    .select("id, campaign_leads!inner(campaign_id)", { count: "exact", head: true })
    .eq("direction", "outbound")
    .eq("campaign_leads.campaign_id", campaign.id)
    .like("to_email", `%@${domain}`)
    .gte("occurred_at", dayStart.toISOString());
  if ((domainSends ?? 0) >= domainCap) {
    const tz = tzFor(settings, lead);
    const tomorrow = snapIntoWindow(new Date(Date.now() + 12 * 3600_000), settings.send_window ?? {}, tz);
    await db.from("campaign_leads").update({ next_send_at: tomorrow.toISOString() }).eq("id", cl.id);
    return "domain_cap_reached";
  }

  // absolute compliance hours re-check (§14)
  const tz = tzFor(settings, lead);
  if (!inComplianceHours(new Date(), tz)) {
    const next = snapIntoWindow(new Date(Date.now() + 15 * 60_000), settings.send_window ?? {}, tz);
    await db.from("campaign_leads").update({ next_send_at: next.toISOString() }).eq("id", cl.id);
    return "outside_compliance_hours";
  }

  // ── content: approved draft (AI path) or rendered template ──
  const { data: step } = await db
    .from("sequence_steps")
    .select("*")
    .eq("campaign_id", campaign.id)
    .eq("step_no", stepNo)
    .eq("variant", cl.variant ?? "A")
    .maybeSingle();
  const { data: fallbackStep } = step
    ? { data: null }
    : await db
        .from("sequence_steps")
        .select("*")
        .eq("campaign_id", campaign.id)
        .eq("step_no", stepNo)
        .eq("variant", "A")
        .maybeSingle();
  const stepRow = step ?? fallbackStep;
  if (!stepRow) {
    await stopLead(db, cl.id, "finished", "no more steps");
    return "no_step";
  }

  const { data: draft } = await db
    .from("drafts")
    .select("*")
    .eq("campaign_lead_id", cl.id)
    .eq("step_no", stepNo)
    .eq("status", "approved")
    .maybeSingle();

  const vars = leadVars(lead);
  let subject: string;
  let bodyCore: string;
  if (draft) {
    subject = draft.edited_subject ?? draft.subject ?? renderVars(spin(stepRow.subject ?? ""), vars).rendered;
    bodyCore = draft.edited_body ?? draft.body;
  } else {
    subject = renderVars(spin(stepRow.subject ?? ""), vars).rendered;
    const r = renderVars(spin(stepRow.body), vars);
    // AI slots but no approved draft → this lead should be in the approval
    // pipeline, not sending. Guard against misconfiguration.
    if (r.missing.some((m) => m.startsWith("ai_"))) {
      await db.from("campaign_leads").update({ state: "queued", next_send_at: null }).eq("id", cl.id);
      return "requeued_for_ai";
    }
    bodyCore = r.rendered;
  }

  // threading context (step > 1 → same thread, Re: subject)
  let thread: Row | null = null;
  if (stepNo > 1) {
    const { data: firstMsg } = await db
      .from("messages")
      .select("*")
      .eq("campaign_lead_id", cl.id)
      .eq("direction", "outbound")
      .order("occurred_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    thread = firstMsg;
  }

  // compliance assembly: footer identity + unsubscribe + optional tracking
  const { data: knowledge } = await db
    .from("knowledge")
    .select("profile")
    .eq("workspace_id", campaign.workspace_id)
    .maybeSingle();
  const profile = knowledge?.profile ?? {};
  const trackingDomain = Deno.env.get("TRACKING_DOMAIN") ?? "";
  const unsubToken = await signToken({ e: email, w: campaign.workspace_id, cl: cl.id });
  const unsubscribeUrl = `https://${trackingDomain}/u/${unsubToken}`;
  const plainText = settings.plain_text !== false;
  const msgToken = await signToken({ w: campaign.workspace_id, cl: cl.id, m: "" });
  const assembled = assembleBody({
    body: bodyCore,
    footerIdentity: profile.footer_identity,
    postalAddress: profile.postal_address,
    unsubscribeUrl,
    usTargeting: settings.us_targeting,
    signatureHtml: mailbox.signature_html,
    plainText,
    trackingPixelUrl:
      settings.track_opens && !plainText ? `https://${trackingDomain}/o/${msgToken}.gif` : undefined,
    clickWrapper:
      settings.track_clicks && !plainText
        ? (url: string) => `https://${trackingDomain}/r/${msgToken}?to=${encodeURIComponent(url)}`
        : undefined,
  });

  // ── send (provider-correct threading, §8) ──
  const accessToken = await accessTokenFor(db, mailbox);
  let providerMessageId: string | null = null;
  let providerThreadId: string | null = null;
  let internetMessageId: string | null = null;
  const sendSubject = stepNo > 1 && thread?.subject ? `Re: ${thread.subject.replace(/^Re:\s*/i, "")}` : subject;

  if (mailbox.provider === "google") {
    const msgId = generateMessageId(mailbox.email.split("@")[1] ?? "mail");
    const raw = buildMime({
      from: { name: mailbox.display_name ?? undefined, email: mailbox.email },
      to: email,
      subject: sendSubject,
      text: assembled.text,
      html: assembled.html,
      messageId: msgId,
      inReplyTo: thread?.internet_message_id ?? undefined,
      references: thread?.internet_message_id ? [thread.internet_message_id] : undefined,
      listUnsubscribe: unsubscribeUrl,
    });
    const res = await gmailSend(accessToken, base64UrlEncode(raw), thread?.provider_thread_id ?? undefined);
    providerMessageId = res.id;
    providerThreadId = res.threadId;
    internetMessageId = msgId;
  } else {
    if (stepNo > 1 && thread?.provider_message_id) {
      const res = await graphReply(accessToken, thread.provider_message_id, {
        to: email,
        text: assembled.text,
        html: assembled.html,
      });
      providerMessageId = res.id;
      providerThreadId = res.conversationId ?? null;
      internetMessageId = res.internetMessageId ?? null;
    } else {
      const res = await graphSendMail(accessToken, {
        to: email,
        subject: sendSubject,
        text: assembled.text,
        html: assembled.html,
      });
      providerMessageId = res?.id ?? null;
      providerThreadId = res?.conversationId ?? null;
      internetMessageId = res?.internetMessageId ?? null;
    }
  }
  usedMailboxes.add(mailbox.id);

  // ── record + advance ──
  await db.from("messages").insert({
    workspace_id: campaign.workspace_id,
    mailbox_id: mailbox.id,
    campaign_lead_id: cl.id,
    direction: "outbound",
    step_no: stepNo,
    provider_message_id: providerMessageId,
    provider_thread_id: providerThreadId,
    internet_message_id: internetMessageId,
    from_email: mailbox.email,
    to_email: email,
    subject: sendSubject,
    snippet: assembled.text.slice(0, 200),
    body: bodyCore,
    occurred_at: new Date().toISOString(),
  });
  await db.rpc("bump_mailbox_sent", { mb: mailbox.id });

  // next step or finish
  const { data: nextSteps } = await db
    .from("sequence_steps")
    .select("step_no, delay_days")
    .eq("campaign_id", campaign.id)
    .eq("step_no", stepNo + 1)
    .limit(1);
  if (nextSteps?.length) {
    const next = computeNextSendAt({
      base: new Date(),
      delayDays: nextSteps[0].delay_days ?? 3,
      window: settings.send_window ?? {},
      timeZone: tz,
    });
    await db
      .from("campaign_leads")
      .update({ state: "in_sequence", current_step: stepNo, next_send_at: next.toISOString() })
      .eq("id", cl.id);
  } else {
    await db
      .from("campaign_leads")
      .update({ state: "finished", current_step: stepNo, next_send_at: null })
      .eq("id", cl.id);
    await queueNotification(db, campaign.workspace_id, "sequence_finished", {
      campaign: campaign.name,
      lead: email,
    });
  }
  return "sent";
}

// deno-lint-ignore no-explicit-any
function tzFor(settings: any, lead: Row): string {
  return settings.timezone_mode === "lead"
    ? (lead.timezone ?? settings.fixed_tz ?? "Europe/London")
    : (settings.fixed_tz ?? "Europe/London");
}

async function stopLead(db: SupabaseClient, clId: string, state: string, reason: string) {
  await db
    .from("campaign_leads")
    .update({ state, next_send_at: null, stop_reason: reason })
    .eq("id", clId);
}

async function handleSendFailure(db: SupabaseClient, cl: Row, error: string) {
  const { data: campaign } = await db.from("campaigns").select("workspace_id, name").eq("id", cl.campaign_id).single();
  if (campaign) {
    await db.from("events").insert({
      workspace_id: campaign.workspace_id,
      campaign_lead_id: cl.id,
      type: "send_fail",
      meta: { error: error.slice(0, 300) },
    });
  }
  // retry in ~30 min
  await db
    .from("campaign_leads")
    .update({ next_send_at: new Date(Date.now() + 30 * 60_000).toISOString() })
    .eq("id", cl.id);

  if (cl.mailbox_id) {
    const { data: mb } = await db.from("mailboxes").select("*").eq("id", cl.mailbox_id).single();
    if (mb) {
      const failures = (mb.consecutive_failures ?? 0) + 1;
      const authError = /401|invalid_grant|unauthorized/i.test(error);
      const update: Row = {
        consecutive_failures: failures,
        health_score: Math.max(0, (mb.health_score ?? 100) - 10),
      };
      if (authError) update.status = "auth_error";
      else if (failures >= BREAKER_MAILBOX_FAILURES) update.status = "paused";
      await db.from("mailboxes").update(update).eq("id", mb.id);
      if (authError || failures >= BREAKER_MAILBOX_FAILURES) {
        await queueNotification(db, mb.workspace_id, authError ? "mailbox_disconnected" : "breaker_tripped", {
          mailbox: mb.email,
          reason: authError ? "auth error" : `${failures} consecutive send failures`,
        });
      }
    }
  }
}

// ── 4. Reply poll ────────────────────────────────────────────────────────────
async function replyPoll(db: SupabaseClient) {
  const { data: mailboxes } = await db
    .from("mailboxes")
    .select("*")
    .eq("status", "active")
    .order("last_polled_at", { ascending: true, nullsFirst: true })
    .limit(POLL_MAILBOXES);

  let processed = 0;
  for (const mb of mailboxes ?? []) {
    try {
      processed += await pollMailbox(db, mb);
    } catch (err) {
      console.error(`poll failed for ${mb.email}:`, err);
    }
    await db.from("mailboxes").update({ last_polled_at: new Date().toISOString() }).eq("id", mb.id);
  }
  return { processed };
}

async function pollMailbox(db: SupabaseClient, mb: Row): Promise<number> {
  const accessToken = await accessTokenFor(db, mb);
  let count = 0;

  if (mb.provider === "google") {
    let ids: string[] = [];
    let newCursor: string | undefined;
    if (mb.poll_cursor) {
      try {
        const hist = await gmailHistoryList(accessToken, mb.poll_cursor);
        ids = (hist.history ?? []).flatMap((h) => (h.messagesAdded ?? []).map((m) => m.message.id));
        newCursor = hist.historyId ?? mb.poll_cursor;
      } catch (err) {
        // deno-lint-ignore no-explicit-any
        if ((err as any).code !== "HISTORY_EXPIRED") throw err;
        const recent = await gmailListRecent(accessToken);
        ids = (recent.messages ?? []).map((m) => m.id);
      }
    } else {
      const recent = await gmailListRecent(accessToken);
      ids = (recent.messages ?? []).map((m) => m.id);
    }
    if (!newCursor) {
      const profile = await gmailProfile(accessToken);
      newCursor = profile.historyId;
    }
    for (const id of ids.slice(0, 15)) {
      const msg = await gmailGetMessage(accessToken, id);
      const from = parseAddr(gmailHeader(msg, "From") ?? "");
      if (!from || from === mb.email.toLowerCase()) continue;
      const dedup = await alreadyStored(db, gmailHeader(msg, "Message-ID") ?? msg.id);
      if (dedup) continue;
      await handleInbound(db, mb, {
        from,
        subject: gmailHeader(msg, "Subject") ?? "",
        body: gmailPlainText(msg).slice(0, 8000),
        snippet: msg.snippet ?? "",
        inReplyTo: gmailHeader(msg, "In-Reply-To") ?? null,
        references: gmailHeader(msg, "References") ?? "",
        internetMessageId: gmailHeader(msg, "Message-ID") ?? msg.id,
        providerMessageId: msg.id,
        providerThreadId: msg.threadId,
        occurredAt: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : new Date().toISOString(),
      });
      count++;
    }
    await db.from("mailboxes").update({ poll_cursor: newCursor }).eq("id", mb.id);
  } else {
    let delta;
    try {
      delta = await graphInboxDelta(accessToken, mb.poll_cursor ?? undefined);
    } catch (err) {
      // deno-lint-ignore no-explicit-any
      if ((err as any).code !== "DELTA_EXPIRED") throw err;
      delta = await graphInboxDelta(accessToken, undefined);
    }
    for (const m of delta.messages.slice(0, 15)) {
      const from = m.from?.emailAddress.address?.toLowerCase();
      if (!from || from === mb.email.toLowerCase()) continue;
      if (!m.internetMessageId) continue;
      if (await alreadyStored(db, m.internetMessageId)) continue;
      const full = await graphGetMessage(accessToken, m.id);
      const bodyText =
        full.body?.contentType?.toLowerCase() === "html"
          ? (full.body.content ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
          : (full.body?.content ?? full.bodyPreview ?? "");
      await handleInbound(db, mb, {
        from,
        subject: m.subject ?? "",
        body: bodyText.slice(0, 8000),
        snippet: m.bodyPreview ?? "",
        inReplyTo: null,
        references: "",
        internetMessageId: m.internetMessageId,
        providerMessageId: m.id,
        providerThreadId: m.conversationId ?? null,
        occurredAt: m.receivedDateTime ?? new Date().toISOString(),
      });
      count++;
    }
    if (delta.deltaLink) await db.from("mailboxes").update({ poll_cursor: delta.deltaLink }).eq("id", mb.id);
  }
  return count;
}

function parseAddr(header: string): string | null {
  const m = header.match(/<([^>]+)>/);
  const addr = (m ? m[1] : header).trim().toLowerCase();
  return addr.includes("@") ? addr : null;
}

async function alreadyStored(db: SupabaseClient, internetMessageId: string): Promise<boolean> {
  const { data } = await db
    .from("messages")
    .select("id")
    .eq("internet_message_id", internetMessageId)
    .eq("direction", "inbound")
    .limit(1);
  return !!data?.length;
}

interface Inbound {
  from: string;
  subject: string;
  body: string;
  snippet: string;
  inReplyTo: string | null;
  references: string;
  internetMessageId: string;
  providerMessageId: string;
  providerThreadId: string | null;
  occurredAt: string;
}

async function handleInbound(db: SupabaseClient, mb: Row, msg: Inbound) {
  const isBounceSender = /mailer-daemon|postmaster|mail delivery/i.test(msg.from) ||
    /delivery status notification|undeliverable|delivery has failed|returned mail/i.test(msg.subject);

  // match to a campaign_lead: In-Reply-To / References against stored
  // internet_message_id, else sender email within campaigns on this mailbox
  let campaignLead: Row | null = null;
  const refIds = [msg.inReplyTo, ...msg.references.split(/\s+/)].filter(Boolean) as string[];
  if (refIds.length) {
    const { data } = await db
      .from("messages")
      .select("campaign_lead_id")
      .in("internet_message_id", refIds)
      .eq("direction", "outbound")
      .not("campaign_lead_id", "is", null)
      .limit(1);
    if (data?.length) {
      const { data: cl } = await db.from("campaign_leads").select("*").eq("id", data[0].campaign_lead_id).single();
      campaignLead = cl;
    }
  }
  if (!campaignLead && !isBounceSender) {
    const { data: leadRows } = await db.from("leads").select("id").eq("email", msg.from);
    if (leadRows?.length) {
      const { data: cl } = await db
        .from("campaign_leads")
        .select("*")
        .in("lead_id", leadRows.map((l) => l.id))
        .eq("mailbox_id", mb.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      campaignLead = cl;
    }
  }
  if (!campaignLead && isBounceSender) {
    // DSN content: find the bounced recipient in the body
    const emailsInBody = msg.body.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];
    const candidates = emailsInBody.map((e) => e.toLowerCase()).filter((e) => e !== mb.email.toLowerCase());
    if (candidates.length) {
      const { data: leadRows } = await db.from("leads").select("id").in("email", candidates);
      if (leadRows?.length) {
        const { data: cl } = await db
          .from("campaign_leads")
          .select("*")
          .in("lead_id", leadRows.map((l) => l.id))
          .eq("mailbox_id", mb.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        campaignLead = cl;
      }
    }
  }

  // Only record inbound mail that belongs to our outreach (a matched
  // campaign_lead, or an attributable bounce). General inbox mail —
  // newsletters, notifications — is skipped so the master inbox stays clean.
  if (!campaignLead) return;
  const { data: stored } = await db
    .from("messages")
    .insert({
      workspace_id: mb.workspace_id,
      mailbox_id: mb.id,
      campaign_lead_id: campaignLead.id,
      direction: "inbound",
      provider_message_id: msg.providerMessageId,
      provider_thread_id: msg.providerThreadId,
      internet_message_id: msg.internetMessageId,
      in_reply_to: msg.inReplyTo,
      from_email: msg.from,
      to_email: mb.email,
      subject: msg.subject,
      snippet: msg.snippet.slice(0, 300),
      body: msg.body,
      occurred_at: msg.occurredAt,
    })
    .select()
    .single();
  if (!stored) return;

  // classify (§9.3): heuristics for bounce/OOO/unsubscribe, AI chain for the rest.
  // Also scores buying signal 0-10 (urgency/budget/timeline language) so warm
  // replies can be triaged fast.
  let category = "other";
  let buyingSignal: number | null = null;
  if (isBounceSender) {
    category = "bounce";
  } else if (/out of (the )?office|annual leave|on holiday|maternity|paternity|auto-?reply|automatic reply/i.test(`${msg.subject} ${msg.body.slice(0, 500)}`)) {
    category = "ooo";
  } else if (/\b(unsubscribe|remove me|stop emailing|take me off|opt me out|do not contact)\b/i.test(msg.body)) {
    category = "unsubscribe";
  } else {
    try {
      const { result } = await runChain(db, "ai_classify", async (provider, apiKey) => {
        const raw = await aiComplete(
          provider,
          apiKey,
          `You classify replies to cold outreach emails. Respond with strict JSON only: {"category":"<one of interested|info_request|not_now|not_interested|ooo|wrong_person|bounce|unsubscribe|other>","confidence":<0-1>,"buying_signal":<0-10>}. Any request to stop emailing or remove from lists is "unsubscribe" regardless of wording. buying_signal: 0 for negative/neutral replies; for interested/info_request, score strength of intent from language like urgency ("this week", "call me"), budget mentions, timelines, or specific questions — a polite "tell me more" is ~4, "can we talk Thursday, we have budget" is ~9.`,
          `Subject: ${msg.subject}\n\nBody:\n${msg.body.slice(0, 2000)}`
        );
        try {
          return parseJson<{ category: string; buying_signal?: number }>(raw);
        } catch {
          // reject and retry once on parse failure (§9)
          const retry = await aiComplete(provider, apiKey, "Respond with strict JSON only.", raw);
          return parseJson<{ category: string; buying_signal?: number }>(retry);
        }
      });
      const valid = [
        "interested", "info_request", "not_now", "not_interested", "ooo", "wrong_person",
        "bounce", "unsubscribe", "other",
      ];
      if (valid.includes(result.category)) category = result.category;
      if (typeof result.buying_signal === "number") {
        buyingSignal = Math.max(0, Math.min(10, Math.round(result.buying_signal)));
      }
    } catch (err) {
      if (err instanceof ChainExhaustedError && (await onceToday(db, "chain:ai_classify"))) {
        await queueNotification(db, mb.workspace_id, "provider_quota_exhausted", { capability: "ai_classify" });
      }
    }
  }
  await db.from("messages").update({ category }).eq("id", stored.id);

  // ── state transitions ──
  const positive = category === "interested" || category === "info_request";
  const { data: lead } = await db.from("leads").select("email").eq("id", campaignLead.lead_id).single();
  const { data: campaign } = await db
    .from("campaigns")
    .select("name, workspace_id, settings")
    .eq("id", campaignLead.campaign_id)
    .single();

  if (category === "ooo") {
    // keep the sequence, push +3 business days (§6.4)
    if (campaignLead.next_send_at) {
      const pushed = addBusinessDays(new Date(campaignLead.next_send_at), 3, "Europe/London");
      await db.from("campaign_leads").update({ next_send_at: pushed.toISOString() }).eq("id", campaignLead.id);
    }
  } else if (category === "bounce") {
    await stopLead(db, campaignLead.id, "bounced", "bounce detected");
    await db.from("events").insert({
      workspace_id: mb.workspace_id,
      message_id: stored.id,
      campaign_lead_id: campaignLead.id,
      type: "bounce",
      meta: {},
    });
    await db
      .from("mailboxes")
      .update({ health_score: Math.max(0, (mb.health_score ?? 100) - 5) })
      .eq("id", mb.id);
  } else if (category === "unsubscribe") {
    await stopLead(db, campaignLead.id, "unsubscribed", "asked to stop");
    if (lead) {
      await db.from("suppression").upsert(
        { workspace_id: null, value: lead.email.toLowerCase(), kind: "email", reason: "reply: asked to stop" },
        { onConflict: "workspace_id,value,kind", ignoreDuplicates: true }
      );
    }
    await db.from("events").insert({
      workspace_id: mb.workspace_id,
      message_id: stored.id,
      campaign_lead_id: campaignLead.id,
      type: "unsubscribe",
      meta: {},
    });
  } else {
    // genuine reply → stop pending sends
    await stopLead(db, campaignLead.id, positive ? "positive" : "replied", `reply: ${category}`);
    await db.from("events").insert({
      workspace_id: mb.workspace_id,
      message_id: stored.id,
      campaign_lead_id: campaignLead.id,
      type: "reply",
      meta: { category, ...(buyingSignal !== null ? { buying_signal: buyingSignal } : {}) },
    });
    await queueNotification(db, mb.workspace_id, positive ? "positive_reply" : "reply", {
      campaign: campaign?.name,
      lead: lead?.email,
      category,
      ...(buyingSignal !== null ? { buying_signal: `${buyingSignal}/10` } : {}),
      snippet: msg.snippet.slice(0, 200),
    });
  }

  // webhooks for reply/positive_reply/bounce/unsubscribe
  const webhookEvent =
    category === "bounce" ? "bounce" : category === "unsubscribe" ? "unsubscribe" : positive ? "positive_reply" : "reply";
  await deliverWebhooks(db, mb.workspace_id, webhookEvent, {
    lead: lead?.email,
    campaign: campaign?.name,
    category,
    subject: msg.subject,
    snippet: msg.snippet.slice(0, 200),
  });
}

// ── 5. Research/draft queue ──────────────────────────────────────────────────
async function invokeResearch() {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/research`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CRON_AUTH}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ batch: RESEARCH_BATCH }),
  });
  return { status: res.status, body: (await res.text()).slice(0, 300) };
}

// ── 6. Breakers ──────────────────────────────────────────────────────────────
async function breakers(db: SupabaseClient) {
  const { data: running } = await db.from("campaigns").select("*").eq("status", "running");
  let tripped = 0;
  for (const c of running ?? []) {
    // trailing-50 bounce rate > 3% → pause + notify (§10)
    const { data: last } = await db
      .from("messages")
      .select("campaign_lead_id, campaign_leads!inner(campaign_id)")
      .eq("direction", "outbound")
      .eq("is_seed", false)
      .eq("campaign_leads.campaign_id", c.id)
      .order("occurred_at", { ascending: false })
      .limit(BREAKER_TRAILING_SENDS);
    const clIds = [...new Set((last ?? []).map((m) => m.campaign_lead_id).filter(Boolean))];
    if ((last?.length ?? 0) < 10 || !clIds.length) continue; // too few sends to judge
    const { count: bounced } = await db
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("type", "bounce")
      .in("campaign_lead_id", clIds);
    const rate = (bounced ?? 0) / (last?.length ?? 1);
    if (rate > BREAKER_BOUNCE_RATE) {
      await db.from("campaigns").update({ status: "paused" }).eq("id", c.id);
      await queueNotification(db, c.workspace_id, "breaker_tripped", {
        campaign: c.name,
        reason: `bounce rate ${(rate * 100).toFixed(1)}% over trailing ${last?.length} sends`,
      });
      tripped++;
    }
  }
  return { tripped };
}

// ── 6b. Peer warmup (Phase 7, jugaad version) ────────────────────────────────
// Your own connected inboxes send each other short, human-looking notes a
// couple of times a day, building sending history. Honest caveat: this is a
// weak version of a paid shared warmup pool — real strangers' inboxes vouch
// harder than your own. Enabled per workspace via knowledge.profile
// .warmup_enabled; needs ≥2 active mailboxes. Messages are tagged
// is_seed + is_internal so they never touch analytics.
const WARMUP_SUBJECTS = [
  "Notes from this morning",
  "That doc we discussed",
  "Following on from earlier",
  "Small update",
  "Before I forget",
];
const WARMUP_BODIES = [
  "Sending over the summary we talked about — will add the rest tomorrow once I've been through the numbers.",
  "Had another look at this after our chat. Broadly agree with your take; a couple of details worth going over when you have ten minutes.",
  "Sharing so it's in both our inboxes — flag anything that looks off and I'll fix it before the end of the week.",
  "This is roughly where things landed. Nothing urgent, just keeping you in the loop.",
];
const WARMUP_PER_DAY = 2;

async function warmup(db: SupabaseClient) {
  // fire only twice a day (minute 15 of 09:00 and 13:00 UTC)
  const now = new Date();
  if (now.getUTCMinutes() !== 15 || ![9, 13].includes(now.getUTCHours())) return { skipped: "not a warmup slot" };

  const { data: enabled } = await db.from("knowledge").select("workspace_id, profile").limit(50);
  let sent = 0;
  for (const k of enabled ?? []) {
    if (!k.profile?.warmup_enabled) continue;
    const { data: mbs } = await db
      .from("mailboxes")
      .select("*")
      .eq("workspace_id", k.workspace_id)
      .eq("status", "active");
    if (!mbs || mbs.length < 2) continue;

    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    for (let i = 0; i < mbs.length; i++) {
      const from = mbs[i];
      const to = mbs[(i + 1) % mbs.length];
      const { count } = await db
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("mailbox_id", from.id)
        .eq("direction", "outbound")
        .eq("is_seed", true)
        .eq("is_internal", true)
        .gte("occurred_at", dayStart.toISOString());
      if ((count ?? 0) >= WARMUP_PER_DAY) continue;

      try {
        const accessToken = await accessTokenFor(db, from);
        const subject = WARMUP_SUBJECTS[Math.floor(Math.random() * WARMUP_SUBJECTS.length)];
        const body = WARMUP_BODIES[Math.floor(Math.random() * WARMUP_BODIES.length)];
        if (from.provider === "google") {
          const raw = buildMime({
            from: { email: from.email },
            to: to.email,
            subject,
            text: body,
            messageId: generateMessageId(from.email.split("@")[1] ?? "mail"),
          });
          await gmailSend(accessToken, base64UrlEncode(raw));
        } else {
          await graphSendMail(accessToken, { to: to.email, subject, text: body });
        }
        await db.from("messages").insert({
          workspace_id: k.workspace_id,
          mailbox_id: from.id,
          direction: "outbound",
          from_email: from.email,
          to_email: to.email,
          subject,
          snippet: body.slice(0, 200),
          is_seed: true,
          is_internal: true,
        });
        await db.rpc("bump_mailbox_sent", { mb: from.id }); // warmup counts against the ramp budget
        sent++;
      } catch (err) {
        console.error(`warmup send failed ${from.email} → ${to.email}:`, err);
      }
    }
  }
  return { warmup_sent: sent };
}

// ── 7. Notification flush ────────────────────────────────────────────────────
async function flushNotifications(db: SupabaseClient) {
  const { data: pending } = await db
    .from("notification_queue")
    .select("*")
    .eq("status", "pending")
    .lt("attempts", 3)
    .limit(20);

  let dispatched = 0;
  for (const n of pending ?? []) {
    const { data: settings } = await db
      .from("notification_settings")
      .select("*")
      .eq("workspace_id", n.workspace_id)
      .maybeSingle();
    const instant = settings?.instant_events ?? ["positive_reply", "breaker_tripped", "mailbox_disconnected"];
    if (!instant.includes(n.event)) {
      await db.from("notification_queue").update({ status: "digest" }).eq("id", n.id);
      continue;
    }
    const ok = await dispatchNotification(db, n, settings);
    await db
      .from("notification_queue")
      .update({ status: ok ? "sent" : "pending", attempts: (n.attempts ?? 0) + 1 })
      .eq("id", n.id);
    if (ok) dispatched++;
  }
  return { dispatched };
}

// deno-lint-ignore no-explicit-any
async function dispatchNotification(db: SupabaseClient, n: Row, settings: any): Promise<boolean> {
  const text = `[Socivo] ${n.event}: ${JSON.stringify(n.payload)}`;
  let anyOk = false;

  // Telegram
  const tgToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const tgChat = Deno.env.get("TELEGRAM_CHAT_ID");
  if (settings?.telegram && tgToken && tgChat) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: tgChat, text }),
      });
      anyOk = anyOk || res.ok;
    } catch (err) {
      console.error("telegram notify failed:", err);
    }
  }

  // n8n
  const n8nUrl = Deno.env.get("N8N_WEBHOOK_URL");
  if (settings?.n8n && n8nUrl) {
    try {
      const res = await fetch(n8nUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: n.event, workspace_id: n.workspace_id, payload: n.payload }),
      });
      anyOk = anyOk || res.ok;
    } catch (err) {
      console.error("n8n notify failed:", err);
    }
  }

  // Email via a connected mailbox through the normal send path, flagged internal
  if (settings?.email_to && settings?.email_from_mailbox) {
    try {
      const { data: mb } = await db.from("mailboxes").select("*").eq("id", settings.email_from_mailbox).single();
      if (mb && mb.status === "active") {
        const accessToken = await accessTokenFor(db, mb);
        const subject = `[Socivo] ${n.event.replace(/_/g, " ")}`;
        const body = `Event: ${n.event}\n\n${JSON.stringify(n.payload, null, 2)}`;
        if (mb.provider === "google") {
          const raw = buildMime({
            from: { email: mb.email },
            to: settings.email_to,
            subject,
            text: body,
            messageId: generateMessageId(mb.email.split("@")[1] ?? "mail"),
          });
          await gmailSend(accessToken, base64UrlEncode(raw));
        } else {
          await graphSendMail(accessToken, { to: settings.email_to, subject, text: body });
        }
        await db.from("messages").insert({
          workspace_id: n.workspace_id,
          mailbox_id: mb.id,
          direction: "outbound",
          from_email: mb.email,
          to_email: settings.email_to,
          subject,
          snippet: body.slice(0, 200),
          is_internal: true,
        });
        anyOk = true;
      }
    } catch (err) {
      console.error("email notify failed:", err);
    }
  }

  // if no channel is configured, don't spin forever
  return anyOk || (!settings?.telegram && !settings?.n8n && !settings?.email_to);
}

async function deliverWebhooks(
  db: SupabaseClient,
  workspaceId: string,
  event: string,
  payload: Record<string, unknown>
) {
  const { data: hooks } = await db
    .from("webhooks")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("active", true)
    .contains("events", [event]);
  for (const hook of hooks ?? []) {
    try {
      const body = JSON.stringify({ event, workspace_id: workspaceId, payload, ts: Date.now() });
      const sig = await hmacHex(hook.secret, body);
      await fetch(hook.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Socivo-Signature": sig },
        body,
      });
    } catch (err) {
      console.error(`webhook delivery failed (${hook.url}):`, err);
    }
  }
}

// ── 8. Daily digests ─────────────────────────────────────────────────────────
async function dailyDigests(db: SupabaseClient) {
  const today = new Date().toISOString().slice(0, 10);
  const hour = new Date().getUTCHours(); // digest_hour interpreted as UTC for v1
  const { data: due } = await db
    .from("notification_settings")
    .select("*")
    .eq("digest_hour", hour)
    .or(`last_digest_date.is.null,last_digest_date.lt.${today}`)
    .limit(5);

  let sent = 0;
  for (const s of due ?? []) {
    try {
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const [{ count: sentCount }, { data: replies }, { count: bounces }, { count: drafts }, { data: mbs }, { data: digestItems }] =
        await Promise.all([
          db.from("messages").select("id", { count: "exact", head: true })
            .eq("workspace_id", s.workspace_id).eq("direction", "outbound")
            .eq("is_seed", false).eq("is_internal", false).gte("occurred_at", since),
          db.from("messages").select("category")
            .eq("workspace_id", s.workspace_id).eq("direction", "inbound")
            .not("category", "is", null).gte("occurred_at", since),
          db.from("events").select("id", { count: "exact", head: true })
            .eq("workspace_id", s.workspace_id).eq("type", "bounce").gte("created_at", since),
          db.from("drafts")
            .select("id, campaign_leads!inner(campaigns!inner(workspace_id))", { count: "exact", head: true })
            .eq("status", "pending").eq("campaign_leads.campaigns.workspace_id", s.workspace_id),
          db.from("mailboxes").select("email, status, health_score, sent_today").eq("workspace_id", s.workspace_id),
          db.from("notification_queue").select("event, payload").eq("workspace_id", s.workspace_id).eq("status", "digest").limit(50),
        ]);

      const byCategory: Record<string, number> = {};
      for (const r of replies ?? []) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
      const lines = [
        `Socivo daily digest`,
        ``,
        `Sent (24h): ${sentCount ?? 0}`,
        `Replies by category: ${Object.entries(byCategory).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
        `Bounces: ${bounces ?? 0}`,
        `Drafts awaiting approval: ${drafts ?? 0}`,
        ``,
        `Mailboxes:`,
        ...(mbs ?? []).map((m) => `  ${m.email} — ${m.status}, health ${m.health_score}, sent today ${m.sent_today}`),
        ``,
        ...(digestItems?.length ? [`Other events:`, ...digestItems.map((d) => `  ${d.event}: ${JSON.stringify(d.payload)}`)] : []),
      ];
      await dispatchNotification(db, { workspace_id: s.workspace_id, event: "daily_digest", payload: { text: lines.join("\n") } }, s);
      await db.from("notification_queue").update({ status: "sent" }).eq("workspace_id", s.workspace_id).eq("status", "digest");
      await db.from("notification_settings").update({ last_digest_date: today }).eq("workspace_id", s.workspace_id);
      sent++;
    } catch (err) {
      console.error(`digest failed for workspace ${s.workspace_id}:`, err);
    }
  }
  return { digests: sent };
}
