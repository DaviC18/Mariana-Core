import { Suspense } from "react";
import { ConversationsPage } from "@/components/conversations/conversations-page";
import { LoadingState } from "@/components/ui/states";

export default function Page() {
  return (
    <Suspense fallback={<LoadingState rows={6} />}>
      <ConversationsPage />
    </Suspense>
  );
}
