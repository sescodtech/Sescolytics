import { NextRequest, NextResponse } from "next/server";

interface EmailPayload {
  to: string;
  subject: string;
  message: string;
  customer_name?: string;
  loan_id?: string;
}

interface BulkEmailPayload {
  recipients: EmailPayload[];
}

async function sendSingleEmail(payload: EmailPayload) {
  const apiKey = process.env.RESEND_API_KEY;
  // Resend rejects the whole call if the `from` header isn't a clean
  // "Name <email@domain>" — a stray quote, trailing space, or missing
  // "@domain" in RESEND_FROM_EMAIL (easy to introduce when pasting into
  // Vercel's env var UI) is enough to fail with "Invalid `from` field".
  // Trim + validate so a bad env var falls back to the safe default instead
  // of silently breaking every send.
  const emailRegex = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
  const rawFromEmail = (process.env.RESEND_FROM_EMAIL || "noreply@charisbank.com").trim().replace(/^["']|["']$/g, "");
  const fromEmail = emailRegex.test(rawFromEmail) ? rawFromEmail : "noreply@charisbank.com";
  const fromName = (process.env.RESEND_FROM_NAME || "Charis Microfinance Bank").trim().replace(/["'<>]/g, "");

  if (!apiKey) {
    throw new Error("RESEND_API_KEY not configured");
  }

  // Build HTML email
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${payload.subject}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#0A2540 0%,#1a3a5c 100%);border-radius:12px 12px 0 0;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px;">
                Charis Microfinance Bank
              </h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.65);font-size:12px;">
                ILRMS — Loan Recovery Management
              </p>
              <div style="height:3px;background:linear-gradient(90deg,#C9A227,#e8c04a);border-radius:2px;margin-top:20px;"></div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:40px;border-left:1px solid #e5e9f0;border-right:1px solid #e5e9f0;">
              <h2 style="margin:0 0 16px;color:#0A2540;font-size:18px;font-weight:600;">
                ${payload.subject}
              </h2>
              <div style="color:#4a5568;font-size:14px;line-height:1.7;white-space:pre-line;">
                ${payload.message.replace(/\n/g, "<br>")}
              </div>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="background:#ffffff;padding:0 40px 40px;border-left:1px solid #e5e9f0;border-right:1px solid #e5e9f0;">
              <div style="background:#f8f9fc;border:1px solid #e5e9f0;border-radius:8px;padding:16px;text-align:center;">
                <p style="margin:0 0 8px;color:#6b7280;font-size:12px;">
                  To make payment or enquire, contact us:
                </p>
                <p style="margin:0;color:#0A2540;font-size:13px;font-weight:600;">
                  ${process.env.BANK_PHONE ?? "08000000000"} &nbsp;|&nbsp; ${process.env.BANK_EMAIL ?? "info@charisbank.com"}
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8f9fc;border:1px solid #e5e9f0;border-radius:0 0 12px 12px;padding:20px 40px;text-align:center;">
              <p style="margin:0;color:#9ca3af;font-size:11px;line-height:1.6;">
                This is an automated message from Charis Microfinance Bank.<br>
                If you believe you received this in error, please contact us immediately.<br>
                © ${new Date().getFullYear()} Charis Microfinance Bank Limited. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [payload.to],
      subject: payload.subject,
      html,
      text: payload.message, // plain text fallback
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || `Resend error: ${response.status}`);
  }

  return { success: true, emailId: data.id };
}

export async function POST(request: NextRequest) {
  try {
    const body: BulkEmailPayload = await request.json();
    const { recipients } = body;

    if (!recipients || recipients.length === 0) {
      return NextResponse.json({ error: "No recipients provided" }, { status: 400 });
    }

    const results = await Promise.allSettled(
      recipients.map(r => sendSingleEmail(r))
    );

    const sent: string[] = [];
    const failed: { to: string; error: string }[] = [];

    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        sent.push(recipients[i].to);
      } else {
        failed.push({
          to: recipients[i].to,
          error: result.reason?.message ?? "Unknown error",
        });
      }
    });

    return NextResponse.json({
      success: true,
      sent: sent.length,
      failed: failed.length,
      details: { sent, failed },
    });
  } catch (error) {
    console.error("Email route error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
