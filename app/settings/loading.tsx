import { SettingsSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="app-shell min-h-screen px-4 py-6 sm:px-6 lg:px-10">
      <main className="mx-auto max-w-2xl">
        <SettingsSkeleton />
      </main>
    </div>
  );
}
