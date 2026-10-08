"use client";

export default function NotificationsError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <section role="alert" className="panel">
        <h1 className="text-xl font-semibold">
          Couldn&apos;t load notifications
        </h1>
        <p className="mt-2 text-sm text-muted">
          Please try again. If the problem continues, return to the dashboard.
        </p>
        <button className="btn mt-4" type="button" onClick={reset}>
          Retry
        </button>
      </section>
    </main>
  );
}
