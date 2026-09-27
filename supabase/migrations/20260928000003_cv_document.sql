-- Clinicians can upload a CV with their application. Optional: it isn't part of the go-live gate
-- and has no expiry. It goes through the verification queue like any other upload.
alter type public.credential_type add value if not exists 'cv';
