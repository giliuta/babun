// P2 #42 (CRM Core brief) — POST /api/sms/test
//
// Forwards a single test SMS to the send_sms Edge Function in
// `mode: "test"`. Server-side wrapper so the browser doesn't carry
// the edge function's bearer token — the route reads the current
// user's tenant from RLS-aware Supabase and proxies the call with
// the service-role-equivalent token already configured.
//
// Body: { to_phone: string, body: string }
// Response: { ok: true, sid: string } on success.

import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { isSameOriginRequest } from "@/lib/http/csrf";

// Pull the test endpoint URL from env when set, otherwise derive from
// the public Supabase URL. Edge Functions live at <project>/functions/v1/<name>.
function resolveEdgeUrl(): string | null {
  const explicit = process.env.SEND_SMS_FUNCTION_URL;
  if (explicit) return explicit;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/functions/v1/send_sms`;
}

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await getSupabaseServer();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  type Body = { to_phone?: unknown; body?: unknown };
  let payload: Body;
  try {
    payload = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const toPhone =
    typeof payload.to_phone === "string" ? payload.to_phone.trim() : "";
  const messageBody =
    typeof payload.body === "string" ? payload.body.trim() : "";
  if (!toPhone || !messageBody) {
    return NextResponse.json(
      { error: "to_phone and body are required" },
      { status: 400 },
    );
  }
  if (messageBody.length > 1000) {
    return NextResponse.json(
      { error: "body too long (>1000 chars)" },
      { status: 400 },
    );
  }

  // RLS surface — pull the tenant for the current user. Cast to
  // `any` for the from(...) chain because the `profiles` table
  // isn't in the generated Database type yet; same pattern other
  // routes in this app use (see settings/account/personal/page.tsx).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile, error: profErr } = await (supabase as any)
    .from("profiles")
    .select("tenant_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const tenantId: string | null =
    (profile as { tenant_id?: string } | null | undefined)?.tenant_id ?? null;
  if (profErr || !tenantId) {
    return NextResponse.json(
      { error: "no_tenant_for_user", detail: profErr?.message },
      { status: 400 },
    );
  }

  const url = resolveEdgeUrl();
  if (!url) {
    return NextResponse.json(
      { error: "edge_url_not_configured" },
      { status: 500 },
    );
  }
  const fnResponse = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      mode: "test",
      tenant_id: tenantId,
      to_phone: toPhone,
      body: messageBody,
    }),
  });

  const text = await fnResponse.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return NextResponse.json(parsed, { status: fnResponse.status });
}
