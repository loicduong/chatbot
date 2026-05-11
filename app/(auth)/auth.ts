import { redirect } from "next/navigation";
import type { AppSession } from "@/lib/auth/types";
import { ensureUserProfile } from "@/lib/db/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type { UserType } from "@/lib/auth/types";
export type Session = AppSession;

export async function auth(): Promise<AppSession | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  const isGuest =
    user.is_anonymous === true ||
    user.user_metadata?.is_guest === true ||
    user.email?.startsWith("guest-") === true;

  await ensureUserProfile({
    id: user.id,
    email: user.email,
    isAnonymous: isGuest,
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      name:
        typeof user.user_metadata?.name === "string"
          ? user.user_metadata.name
          : null,
      image:
        typeof user.user_metadata?.avatar_url === "string"
          ? user.user_metadata.avatar_url
          : null,
      type: isGuest ? "guest" : "regular",
    },
  };
}

export async function signOut(options?: { redirectTo?: string }) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });

  if (options?.redirectTo) {
    redirect(options.redirectTo);
  }
}
