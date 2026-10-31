import { Suspense } from "react";
import { SettingsPage } from "@/components/settings/settings-page";
import { LoadingState } from "@/components/ui/states";

export default function Page() {
  return (
    <Suspense fallback={<LoadingState rows={6} />}>
      <SettingsPage />
    </Suspense>
  );
}
