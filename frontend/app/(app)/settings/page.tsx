import type { Metadata } from "next";
import { Suspense } from "react";
import SettingsClient from "./SettingsClient";

export const metadata: Metadata = {
  title: "Account settings | Tasklane",
};

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
          <p role="status" className="text-sm text-muted">
            Loading account settings…
          </p>
        </main>
      }
    >
      <SettingsClient />
    </Suspense>
  );
}
