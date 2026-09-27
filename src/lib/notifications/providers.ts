import "server-only";

// Email (Resend), SMS (Twilio, Australian sender) and Slack (incoming webhook).
// When a provider isn't configured the message is marked "skipped" rather than failing,
// so local development and previews work without real credentials.

export type SendResult =
  | { status: "sent"; providerRef?: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

export async function sendEmail(to: string, subject: string, text: string): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { status: "skipped", reason: "Email not configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text, reply_to: process.env.EMAIL_REPLY_TO || undefined }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    return res.ok ? { status: "sent", providerRef: body.id } : { status: "failed", error: body.message ?? `HTTP ${res.status}` };
  } catch (e) {
    return { status: "failed", error: (e as Error).message };
  }
}

export async function sendSms(to: string, body: string): Promise<SendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM; // Australian number or Messaging Service SID (MG…)
  if (!sid || !token || !from) return { status: "skipped", reason: "SMS not configured" };
  const form = new URLSearchParams({ To: to, Body: body });
  form.set(from.startsWith("MG") ? "MessagingServiceSid" : "From", from);
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    return res.ok ? { status: "sent", providerRef: data.sid } : { status: "failed", error: data.message ?? `HTTP ${res.status}` };
  } catch (e) {
    return { status: "failed", error: (e as Error).message };
  }
}

export async function sendSlack(text: string): Promise<SendResult> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return { status: "skipped", reason: "Slack not configured" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? { status: "sent" } : { status: "failed", error: `HTTP ${res.status}` };
  } catch (e) {
    return { status: "failed", error: (e as Error).message };
  }
}
