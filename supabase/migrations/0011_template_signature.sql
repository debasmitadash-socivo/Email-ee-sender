-- Add signature and closing_line to templates for better email template management
alter table templates add column if not exists closing_line text;
-- closing_line: optional custom sign-off (e.g. "Best," or "Thanks,")
alter table templates add column if not exists signature_html text;
-- signature_html: template-level signature (overrides mailbox signature when present)

create comment on column templates.closing_line is 'Optional closing line (e.g. "Best," or "Looking forward to hearing from you,")';
create comment on column templates.signature_html is 'Template-level email signature (overwrites mailbox signature if present)';
