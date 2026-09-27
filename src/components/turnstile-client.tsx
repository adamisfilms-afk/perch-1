"use client";

import Script from "next/script";

/** Cloudflare Turnstile widget (spam protection). Renders nothing when not configured. */
export function TurnstileClient() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!siteKey) return null;
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      <div className="cf-turnstile" data-sitekey={siteKey} data-size="flexible" />
    </>
  );
}
