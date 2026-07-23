-- Global template library (workspace_id = null → visible to every workspace).
-- Proven cold/warm frameworks: PAS, value-first, question-led, referral,
-- case-study, follow-up bump, breakup, warm intro, revival, direct meeting ask.
-- Fixed UUIDs so re-running this migration never duplicates rows.

insert into templates (id, workspace_id, name, subject, body, ai_slots) values

('a0000000-0000-4000-8000-000000000001', null,
 'Cold · Problem-Agitate-Solve',
 'quick question about {{company}}',
 E'Hi {{first_name}},\n\n{{ai_icebreaker}}\n\nMost teams like yours lose hours every week to this — and it compounds quietly.\n\nWe help companies fix it without adding headcount. Worth a 15-minute look next week?',
 '{"ai_icebreaker":{"instruction":"One specific, sourced opening line about this lead or their company.","max_words":30}}'),

('a0000000-0000-4000-8000-000000000002', null,
 'Cold · Value-first',
 'an idea for {{company}}',
 E'Hi {{first_name}},\n\n{{ai_icebreaker}}\n\nOne idea: {companies your size|teams at your stage} usually see the fastest wins from fixing this one workflow first. Happy to share exactly how — takes 10 minutes.\n\nOpen to it?',
 '{"ai_icebreaker":{"instruction":"One specific, sourced opening line referencing something real about the company.","max_words":30}}'),

('a0000000-0000-4000-8000-000000000003', null,
 'Cold · Question-led',
 'how is {{company}} handling this?',
 E'Hi {{first_name}},\n\n{{ai_icebreaker}}\n\nCurious — how are you handling this today? Most {{title}}s I speak to say it''s either manual or it''s ignored.\n\nIf it''s on your list, I can show you what''s working for similar teams.',
 '{"ai_icebreaker":{"instruction":"One sharp, factual observation about the lead''s company that sets up the question.","max_words":30}}'),

('a0000000-0000-4000-8000-000000000004', null,
 'Cold · Referral / right person',
 'right person at {{company}}?',
 E'Hi {{first_name}},\n\nI''m looking for whoever owns this at {{company}} — is that you, or someone else on the team?\n\nOne line on why it matters: {{ai_icebreaker}}\n\nIf it''s not you, a quick point in the right direction would be appreciated.',
 '{"ai_icebreaker":{"instruction":"One line tying our offer to something specific about this company.","max_words":25}}'),

('a0000000-0000-4000-8000-000000000005', null,
 'Cold · Case-study proof',
 'how {a similar team|one company} did it',
 E'Hi {{first_name}},\n\n{{ai_icebreaker}}\n\nWe recently helped a company much like {{company}} get a measurable result here — happy to send the one-pager.\n\nWant it?',
 '{"ai_icebreaker":{"instruction":"One specific, sourced line connecting this lead to the case study topic.","max_words":30}}'),

('a0000000-0000-4000-8000-000000000006', null,
 'Follow-up · Short bump',
 '',
 E'Hi {{first_name}} — floating this back up.\n\nNo pressure either way; if the timing''s wrong, tell me and I''ll close the loop.',
 '{}'),

('a0000000-0000-4000-8000-000000000007', null,
 'Follow-up · New angle',
 '',
 E'Hi {{first_name}},\n\nOne more thought since my last note: the teams that move on this early usually avoid the expensive version of the problem later.\n\nIf that resonates, 15 minutes is all I need. If not, I''ll leave you be.',
 '{}'),

('a0000000-0000-4000-8000-000000000008', null,
 'Breakup · Close the loop',
 '',
 E'Hi {{first_name}},\n\nI''ll take the silence as "not now" and stop here.\n\nIf this becomes a priority later, my door''s open — just reply to this thread and it''ll reach me.',
 '{}'),

('a0000000-0000-4000-8000-000000000009', null,
 'Warm · Intro after connection',
 'good to connect, {{first_name}}',
 E'Hi {{first_name}},\n\nGood to connect {recently|the other day}. You mentioned things were busy on your side — one thing we do that might genuinely help: {{ai_icebreaker}}\n\nIf useful, I''ll send over a short overview. No meeting needed.',
 '{"ai_icebreaker":{"instruction":"One line linking our offer to what this person/company is doing right now.","max_words":30}}'),

('a0000000-0000-4000-8000-000000000010', null,
 'Revival · Old lead re-engage',
 'is this still on the radar?',
 E'Hi {{first_name}},\n\nWe spoke a while back about this and the timing wasn''t right.\n\nThings have moved on our side since — {{ai_icebreaker}}\n\nWorth a fresh look, or shall I close the file?',
 '{"ai_icebreaker":{"instruction":"One line on what is new or improved that is relevant to this lead.","max_words":25}}'),

('a0000000-0000-4000-8000-000000000011', null,
 'Direct · Specific meeting ask',
 '15 minutes {this week|next week}?',
 E'Hi {{first_name}},\n\n{{ai_icebreaker}}\n\nI''ll keep it simple: 15 minutes, I''ll show you exactly what this looks like for {{company}}, and you decide if it''s worth continuing.\n\nDoes {Tuesday|Thursday} morning work?',
 '{"ai_icebreaker":{"instruction":"One specific, sourced opening line about this lead.","max_words":30}}')

on conflict (id) do nothing;
