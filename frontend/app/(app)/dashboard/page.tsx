import { Suspense } from "react";
import type { Metadata } from "next";
import DashboardClient from "./DashboardClient";
import DashboardLoading from "./loading";

export const metadata: Metadata = {
  title: "Dashboard | Tasklane",
};

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardClient />
    </Suspense>
  );
}
