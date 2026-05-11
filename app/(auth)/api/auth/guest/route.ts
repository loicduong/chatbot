import { NextResponse } from "next/server";
import { ensureUserProfile } from "@/lib/db/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function safeRedirectUrl(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawRedirect = searchParams.get("redirectUrl") || "/";

  return rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")
    ? rawRedirect
    : "/";
}

export async function GET(request: Request) {
  const redirectUrl = safeRedirectUrl(request);
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: existingUser },
  } = await supabase.auth.getUser();

  if (existingUser) {
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    return NextResponse.redirect(new URL(`${base}/`, request.url));
  }

  const anonymous = await supabase.auth.signInAnonymously();

  if (anonymous.error || !anonymous.data.user) {
    return NextResponse.json(
      {
        error:
          anonymous.error?.code === "anonymous_provider_disabled"
            ? "Anonymous sign-ins are disabled in Supabase Auth. Enable Anonymous Sign-Ins in your Supabase project settings."
            : "Guest auth failed",
      },
      { status: 500 }
    );
  }

  await ensureUserProfile({
    id: anonymous.data.user.id,
    email: anonymous.data.user.email,
    isAnonymous: true,
  });

  return NextResponse.redirect(new URL(redirectUrl, request.url));
}
