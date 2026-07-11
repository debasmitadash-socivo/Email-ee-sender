// Shared domain types. Regenerate DB types with `supabase gen types` once a
// project is linked; these hand-written types mirror the migrations exactly.

export type MailboxProvider = "google" | "microsoft";
export type VerifyStatus = "unverified" | "valid" | "invalid" | "risky" | "unknown";
export type ClState =
  | "queued"
  | "researching"
  | "drafted"
  | "awaiting_approval"
  | "approved"
  | "scheduled"
  | "in_sequence"
  | "replied"
  | "positive"
  | "bounced"
  | "unsubscribed"
  | "finished"
  | "paused"
  | "failed";
export type ReplyCategory =
  | "interested"
  | "info_request"
  | "not_now"
  | "not_interested"
  | "ooo"
  | "wrong_person"
  | "bounce"
  | "unsubscribe"
  | "other";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface WorkspaceMember {
  workspace_id: string;
  user_id: string;
  role: "admin" | "member" | "viewer";
}

export interface Mailbox {
  id: string;
  workspace_id: string;
  provider: MailboxProvider;
  email: string;
  display_name: string | null;
  refresh_token_enc: string | null;
  access_token_enc: string | null;
  access_token_expires_at: string | null;
  status: "active" | "paused" | "auth_error";
  daily_cap: number;
  ramp_started_at: string;
  sent_today: number;
  sent_date: string;
  health_score: number;
  consecutive_failures: number;
  poll_cursor: string | null;
  signature_html: string | null;
  created_at: string;
}

export interface Lead {
  id: string;
  workspace_id: string;
  list_id: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  domain: string | null;
  title: string | null;
  linkedin_url: string | null;
  timezone: string | null;
  custom: Record<string, unknown>;
  tags: string[];
  verify_status: VerifyStatus;
  verify_provider: string | null;
  created_at: string;
}

export interface SendWindow {
  start: string; // "08:30"
  end: string; // "17:30"
  days: number[]; // 1=Mon .. 7=Sun
}

export interface CampaignSettings {
  plain_text?: boolean;
  track_opens?: boolean;
  track_clicks?: boolean;
  approve_first_n?: number;
  send_window?: SendWindow;
  timezone_mode?: "lead" | "fixed";
  fixed_tz?: string;
  linkedin_enrichment?: boolean;
  daily_domain_cap?: number;
  allow_free_domains?: boolean;
  us_targeting?: boolean;
}

export interface Campaign {
  id: string;
  workspace_id: string;
  name: string;
  status: "draft" | "running" | "paused" | "done";
  settings: CampaignSettings;
  created_at: string;
}

export interface SequenceStep {
  id: string;
  campaign_id: string;
  step_no: number;
  variant: string;
  delay_days: number;
  subject: string | null;
  body: string;
}

export interface CampaignLead {
  id: string;
  campaign_id: string;
  lead_id: string;
  mailbox_id: string | null;
  state: ClState;
  current_step: number;
  variant: string;
  next_send_at: string | null;
  approved_count: number;
  stop_reason: string | null;
  created_at: string;
}

export interface Draft {
  id: string;
  campaign_lead_id: string;
  step_no: number;
  subject: string | null;
  body: string;
  qa: Record<string, unknown> | null;
  status: "pending" | "approved" | "rejected";
  edited_body: string | null;
  edited_subject: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  workspace_id: string;
  mailbox_id: string | null;
  campaign_lead_id: string | null;
  direction: "outbound" | "inbound";
  step_no: number | null;
  provider_message_id: string | null;
  provider_thread_id: string | null;
  internet_message_id: string | null;
  in_reply_to: string | null;
  from_email: string | null;
  to_email: string | null;
  subject: string | null;
  snippet: string | null;
  body: string | null;
  category: ReplyCategory | null;
  is_seed: boolean;
  is_internal: boolean;
  occurred_at: string;
  created_at: string;
}

export interface KnowledgeProfile {
  what_we_sell?: string;
  offer?: string;
  icp?: string;
  pains?: string[];
  proof_points?: string[];
  tone_rules?: string;
  banned_phrases?: string[];
  sender_name?: string;
  footer_identity?: string;
  postal_address?: string;
  seed_emails?: string[];
}

export interface Brief {
  person: string;
  company_summary: string;
  recent_specifics: { fact: string; source_url: string }[];
  likely_pain: string;
  angle: string;
}

export interface AiSlot {
  instruction: string;
  max_words?: number;
}
