"use client";

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="grid min-h-[60vh] place-items-center px-4 py-12">
      <section className="panel w-full max-w-md text-center">
        <h1 className="page-title text-[28px] font-semibold">We hit a snag</h1>
        <p className="my-3 text-sm text-muted">
          Something went wrong while loading this page. Your work is still here.
        </p>
        <button className="btn" type="button" onClick={reset}>
          Retry
        </button>
      </section>
    </main>
  );
}
