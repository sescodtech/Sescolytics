import { NextResponse } from "next/server";

// Lets the UI warn upfront if a reminder channel has no provider configured,
// instead of the person only finding out after a "failed" send with no
// visible reason. Never returns the actual key values.
export async function GET() {
  return NextResponse.json({
    smsConfigured: Boolean(process.env.TERMII_API_KEY),
    emailConfigured: Boolean(process.env.RESEND_API_KEY),
  });
}
