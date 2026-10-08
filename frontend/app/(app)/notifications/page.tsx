import type { Metadata } from "next";
import { Suspense } from "react";

import NotificationsClient from "./NotificationsClient";
import NotificationsLoading from "./loading";

export const metadata: Metadata = {
  title: "Notifications | Tasklane",
};

export default function NotificationsPage() {
  return (
    <Suspense fallback={<NotificationsLoading />}>
      <NotificationsClient />
    </Suspense>
  );
}
