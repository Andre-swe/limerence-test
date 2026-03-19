import { MessageListSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="app-shell min-h-screen">
      <MessageListSkeleton count={6} />
    </div>
  );
}
