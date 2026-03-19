import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getSupabaseAdminClient } from "@/lib/supabase";

export async function DELETE() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const adminClient = getSupabaseAdminClient();

    if (!adminClient) {
      return NextResponse.json(
        { error: "Account deletion is not available in this environment" },
        { status: 503 }
      );
    }

    // Delete user from Supabase Auth (this will cascade to related data if configured)
    const { error } = await adminClient.auth.admin.deleteUser(user.id);

    if (error) {
      console.error("Failed to delete user:", error);
      return NextResponse.json(
        { error: "Failed to delete account. Please try again." },
        { status: 500 }
      );
    }

    // Sign out the current session
    await supabase.auth.signOut();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete account error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
