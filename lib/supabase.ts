export function getSupabaseStatus() {
  return {
    urlConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    anonKeyConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    serviceRoleConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  };
}
