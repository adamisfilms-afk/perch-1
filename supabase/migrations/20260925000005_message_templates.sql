-- Default message templates. Admins edit these in Settings → Messages.
-- Placeholders use {{name}}. Besides the values each event stores, every message can use
-- {{app_url}}, {{portal_url}}, {{intake_booking_url}}, {{offer_url}}, {{documents_url}},
-- {{first_session_url}} and friendly labels such as {{credential_label}} (see src/lib/notifications/render.ts).
-- SMS is kept for time-sensitive messages only.

insert into public.message_templates (key, channel, subject, body, description) values

('enquiry_received', 'email', 'Thanks for getting in touch about {{child_first_name}}',
'Hi {{parent_first_name}},

Thanks for telling us about {{child_first_name}}. The next step is a free 15-minute call with our intake team so we can understand what {{child_first_name}} needs and find the right clinician.

Book a time that suits you: {{intake_booking_url}}

If you have any questions, just reply to this email.

The Switchboard team', 'Family: confirmation after the enquiry form'),

('enquiry_received', 'sms', null,
'Hi {{parent_first_name}}, thanks for your enquiry about {{child_first_name}}. Book your free intake call here: {{intake_booking_url}}',
'Family: confirmation after the enquiry form'),

('new_enquiry', 'email', 'New enquiry: {{suburb}} ({{funding_label}})',
'A new family enquiry has come in from {{suburb}}.

Service: {{service_label}}
Funding: {{funding_label}}
{{geocode_note}}

Open it: {{app_url}}/families/{{family_id}}', 'Staff: new enquiry'),

('new_enquiry', 'slack', null,
':wave: New enquiry from *{{suburb}}* ({{service_label}}, {{funding_label}}). {{app_url}}/families/{{family_id}}',
'Staff: new enquiry'),

('intake_reminder', 'sms', null,
'Reminder: your intake call with The Switchboard is at {{starts_at_local}}. Need to change it? Use the link in your booking email.',
'Family: intake call reminder (24h and 1h before)'),

('not_suitable', 'email', 'Following up on your enquiry',
'Hi {{parent_first_name}},

Thanks again for talking with us. We don''t think we''re the right service for your family at the moment.

{{reason}}

If anything changes, please get in touch again.

The Switchboard team', 'Family: not suitable, with signposting'),

('offer_sent', 'email', 'New referral: {{child_age}}-year-old in {{suburb}}',
'Hi {{clinician_first_name}},

We have a new referral that looks like a good fit for you: a {{child_age}}-year-old in {{suburb}}.

See the details and accept or decline here: {{offer_url}}

Please respond within {{response_hours}} hours. Declining is completely fine and has no effect on future referrals.

The Switchboard team', 'Clinician: referral offered'),

('offer_sent', 'sms', null,
'New referral: {{child_age}}yo in {{suburb}}. Accept or decline within {{response_hours}}h: {{offer_url}}',
'Clinician: referral offered'),

('offer_nudge', 'sms', null,
'Reminder: a referral is waiting for your answer. It closes {{offer_expires_at_local}}. {{offer_url}}',
'Clinician: unanswered offer nudge'),

('offer_withdrawn', 'email', 'A referral is no longer available',
'Hi {{clinician_first_name}},

A referral we offered you has now been placed elsewhere, so there''s nothing more you need to do. Thanks for considering it.

The Switchboard team', 'Clinician: offer withdrawn (another clinician accepted, or the family withdrew)'),

('match_confirmed', 'email', 'We''ve found a clinician for {{child_first_name}}',
'Hi {{parent_first_name}},

Good news: {{clinician_name}} would love to work with {{child_first_name}}.

The next step is a free intro call so you can meet and make sure it feels right. Book a time here: {{calcom_intro_url}}

The Switchboard team', 'Family: match confirmed, with the clinician''s intro-call link'),

('match_confirmed', 'sms', null,
'Good news! {{clinician_name}} can see {{child_first_name}}. Book your free intro call: {{calcom_intro_url}}',
'Family: match confirmed'),

('offer_accepted', 'email', 'Referral accepted: {{child_first_name}} → {{clinician_name}}',
'{{clinician_name}} accepted the referral for {{child_first_name}}. {{app_url}}/families/{{family_id}}', 'Staff: offer accepted'),

('offer_accepted', 'slack', null,
':white_check_mark: {{clinician_name}} accepted {{child_first_name}}. {{app_url}}/families/{{family_id}}', 'Staff: offer accepted'),

('shortlist_exhausted', 'email', 'Shortlist exhausted for {{child_first_name}} ({{suburb}})',
'Nobody left on the shortlist for {{child_first_name}} in {{suburb}} has accepted. Re-run matching or move the family to the waitlist: {{app_url}}/families/{{family_id}}',
'Staff: no clinician left on the shortlist'),

('shortlist_exhausted', 'slack', null,
':warning: Shortlist exhausted for {{child_first_name}} ({{suburb}}). {{app_url}}/families/{{family_id}}', 'Staff: no clinician left on the shortlist'),

('intro_reminder', 'sms', null,
'Reminder: your intro call is at {{starts_at_local}}.', 'Family: intro call reminder'),

('intro_reminder_clinician', 'sms', null,
'Reminder: intro call with a new family at {{starts_at_local}}. Details: {{portal_url}}/families', 'Clinician: intro call reminder'),

('intro_not_going_ahead', 'email', 'Intro call: not going ahead',
'A family''s intro call didn''t go ahead ({{reason}}). They''re back in Ready to match: {{app_url}}/families/{{family_id}}',
'Staff: intro call not going ahead'),

('first_session_check', 'email', 'Did the first session get booked?',
'Hi {{clinician_first_name}},

Did the first session with your new family get booked? One click and tell us the date: {{first_session_url}}

Thanks!', 'Clinician: one-click first session confirmation'),

('credential_expiring', 'email', 'Your {{credential_label}} expires on {{expires_at_local}}',
'Hi {{clinician_first_name}},

Your {{credential_label}} expires on {{expires_at_local}} ({{days_left}} days from now). Upload the new one here so your referrals keep flowing: {{documents_url}}

The Switchboard team', 'Clinician: credential expiring (60/30/7 days)'),

('credential_expiring', 'sms', null,
'Your {{credential_label}} expires in {{days_left}} days. Upload the new one: {{documents_url}}', 'Clinician: credential expiring'),

('credential_expiring_staff', 'email', '{{clinician_name}}: {{credential_label}} expires {{expires_at_local}}',
'{{clinician_name}}''s {{credential_label}} expires on {{expires_at_local}} and no replacement has been uploaded yet. {{app_url}}/clinicians/{{clinician_id}}',
'Staff: credential expiring in 7 days'),

('credential_expired_staff', 'email', '{{clinician_name}}: {{credential_label}} has expired',
'{{clinician_name}}''s {{credential_label}} has expired. If it was required they have been paused automatically, so no new referrals will be offered. Existing families stay with them. {{app_url}}/clinicians/{{clinician_id}}',
'Staff: credential expired'),

('credential_expired_staff', 'slack', null,
':rotating_light: {{clinician_name}}: {{credential_label}} expired. {{app_url}}/clinicians/{{clinician_id}}', 'Staff: credential expired'),

('credential_rejected', 'email', 'We couldn''t accept your {{credential_label}}',
'Hi {{clinician_first_name}},

We couldn''t accept the {{credential_label}} you uploaded: {{reason}}

Please upload a new copy here: {{documents_url}}', 'Clinician: document rejected'),

('clinician_paused', 'email', 'New referrals are paused',
'Hi {{clinician_first_name}},

We''ve paused new referrals for now ({{pause_label}}). {{reason}}

Families you''re already seeing stay with you. {{documents_url}}', 'Clinician: paused'),

('clinician_paused_staff', 'email', '{{clinician_name}} paused ({{pause_label}})',
'{{clinician_name}} has been paused: {{pause_label}}. {{reason}} Follow up: {{app_url}}/clinicians/{{clinician_id}}',
'Staff: clinician paused'),

('clinician_paused_staff', 'slack', null,
':double_vertical_bar: {{clinician_name}} paused ({{pause_label}}). {{app_url}}/clinicians/{{clinician_id}}', 'Staff: clinician paused'),

('clinician_reactivated', 'email', 'You''re active again',
'Hi {{clinician_first_name}},

Thanks, everything is up to date and you''re active again, so new referrals can come through.', 'Clinician: reactivated'),

('clinician_reactivated_staff', 'email', '{{clinician_name}} is active again',
'{{clinician_name}} is active again. {{app_url}}/clinicians/{{clinician_id}}', 'Staff: clinician reactivated'),

('waitlist_recheck', 'email', 'Capacity freed up: re-check the waitlist',
'{{clinician_name}} now has capacity. There are {{waitlist_count}} families on the waitlist: {{app_url}}/waitlist',
'Staff: re-run matching for waitlisted families'),

('waitlist_recheck', 'slack', null,
':seedling: {{clinician_name}} has capacity. {{waitlist_count}} waitlisted families to re-check: {{app_url}}/waitlist', 'Staff: waitlist re-check'),

('application_received', 'email', 'Thanks for applying to join the network',
'Hi {{clinician_first_name}},

Thanks for applying to join our clinician network. We''ll be in touch within a few business days to book a short screening call.

The Switchboard team', 'Applicant: application received'),

('new_application', 'email', 'New clinician application: {{clinician_name}}',
'{{clinician_name}} ({{profession_label}}) has applied to join the network. {{app_url}}/clinicians/{{clinician_id}}',
'Staff: new clinician application'),

('new_application', 'slack', null,
':tada: New application: {{clinician_name}} ({{profession_label}}). {{app_url}}/clinicians/{{clinician_id}}', 'Staff: new application'),

('recredential_prompt', 'email', 'Time for your yearly check-in',
'Hi {{clinician_first_name}},

It''s been a year, so please take two minutes to confirm your profile, capacity and insurance are still right: {{portal_url}}/profile', 'Clinician: annual re-credentialing'),

('satisfaction_check', 'sms', null,
'Hi {{parent_first_name}}, how are the first couple of weeks going? Reply with a number from 1 (poor) to 5 (great). Thanks!',
'Family: 2-week satisfaction check'),

('satisfaction_check', 'email', 'How is it going?',
'Hi {{parent_first_name}},

How are the first couple of weeks going? Just reply to this email with a number from 1 (poor) to 5 (great) and anything you''d like us to know.

The Switchboard team', 'Family: 2-week satisfaction check'),

('clinician_checkin', 'email', 'Checking in',
'Hi {{clinician_first_name}},

It''s been about six weeks since you started with a family we referred. Is everything going well? Just reply to this email.', 'Clinician: 6-week check-in');
