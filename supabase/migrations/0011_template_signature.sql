-- Template-level closing line + signature (overrides mailbox signature when set)
alter table templates add column if not exists closing_line text;
alter table templates add column if not exists signature_html text;

comment on column templates.closing_line is 'Optional closing line (e.g. "Best," or "Looking forward to hearing from you,")';
comment on column templates.signature_html is 'Template-level email signature (overrides mailbox signature if present)';
