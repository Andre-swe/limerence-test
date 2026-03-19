import { redirect } from "next/navigation";
import { SettingsClient } from "./settings-client";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return <SettingsClient user={{ id: user.id, email: user.email ?? "" }} />;
}
