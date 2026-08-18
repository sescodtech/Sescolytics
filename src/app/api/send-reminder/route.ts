import { NextRequest, NextResponse } from "next/server";

const TERMII_BASE = "https://api.ng.termii.com/api";

interface SMSPayload {
  to: string;
  message: string;
  loan_id?: string;
  customer_id?: string;
  template_id?: string;
  channel?: "sms" | "whatsapp";
}

interface BulkSMSPayload {
  recipients: SMSPayload[];
}

async function sendSingleSMS(to: string, message: string, channel: "sms" | "whatsapp" = "sms") {
  const apiKey = process.env.TERMII_API_KEY;
  const senderId = process.env.TERMII_SENDER_ID || "CHARISMFB";

  if (!apiKey) {
    throw new Error("TERMII_API_KEY not configured");
  }

  // Format Nigerian phone number
  let phone = to.replace(/\s+/g, "").replace(/[^0-9+]/g, "");
  if (phone.startsWith("0")) phone = "234" + phone.slice(1);
  if (phone.startsWith("+")) phone = phone.slice(1);
  if (!phone.startsWith("234")) phone = "234" + phone;

  const body = {
    to: phone,
    from: senderId,
    sms: message,
    type: "plain",
    api_key: apiKey,
    channel: channel === "whatsapp" ? "whatsapp" : "generic",
  };

  const response = await fetch(`${TERMII_BASE}/sms/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok || data.code === "error") {
    throw new Error(data.message || "Termii SMS failed");
  }

  return { success: true, messageId: data.message_id, data };
}

export async function POST(request: NextRequest) {
  try {
    const body: BulkSMSPayload = await request.json();
    const { recipients } = body;

    if (!recipients || recipients.length === 0) {
      return NextResponse.json({ error: "No recipients provided" }, { status: 400 });
    }

    const results = await Promise.allSettled(
      recipients.map(async (r) => {
        const channel = r.channel ?? "sms";
        const result = await sendSingleSMS(r.to, r.message, channel);
        return { ...result, loan_id: r.loan_id, customer_id: r.customer_id, to: r.to };
      })
    );

    const sent: string[] = [];
    const failed: { to: string; error: string }[] = [];

    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        sent.push(recipients[i].to);
      } else {
        failed.push({ to: recipients[i].to, error: result.reason?.message ?? "Unknown error" });
      }
    });

    return NextResponse.json({
      success: true,
      sent: sent.length,
      failed: failed.length,
      details: { sent, failed },
    });
  } catch (error) {
    console.error("SMS route error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
