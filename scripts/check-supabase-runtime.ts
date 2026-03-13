import { createClient } from "@supabase/supabase-js";

function required(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

async function main() {
  const url = required("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const table = process.env.SUPABASE_RUNTIME_STORE_TABLE?.trim() || "runtime_store";
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "limerence-uploads";
  const key = process.env.SUPABASE_RUNTIME_STORE_KEY?.trim() || "default";

  const client = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const [bucketResult, rowResult] = await Promise.all([
    client.storage.listBuckets(),
    client.from(table).select("store_key, revision").eq("store_key", key).maybeSingle(),
  ]);

  if (bucketResult.error) {
    throw new Error(`Supabase Storage check failed: ${bucketResult.error.message}`);
  }

  if (rowResult.error) {
    throw new Error(`Runtime store query failed: ${rowResult.error.message}`);
  }

  const hasBucket = bucketResult.data.some((entry) => entry.name === bucket);

  console.log("Supabase runtime check");
  console.log(`- table: ${table}`);
  console.log(`- store key: ${key}`);
  console.log(`- storage bucket: ${bucket}`);
  console.log(`- bucket present: ${hasBucket ? "yes" : "no"}`);
  console.log(
    `- runtime row present: ${rowResult.data ? `yes (revision ${rowResult.data.revision})` : "no"}`,
  );

  if (!hasBucket) {
    console.log(
      "Bucket is missing. Run supabase/schema.sql or create the bucket manually before sharing uploads.",
    );
  }

  if (!rowResult.data) {
    console.log(
      "Runtime store row is missing. This is okay before first app boot; the app will seed it on first write.",
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
