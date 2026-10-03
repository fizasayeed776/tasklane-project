"use client";

import Link from "next/link";

export default function AppError({
  error,
  reset,
}: {
  error: Error & {
    digest?: string;
    status?: number;
    statusCode?: number;
  };
  reset: () => void;
}) {
  const code = error.status ?? error.statusCode;
  const unavailable = code === 403 || code === 404;
  const retryable =
    (code !== undefined && code >= 500) || error instanceof TypeError;

  return (
    <main className="grid min-h-[60vh] place-items-center px-4 py-12">
      <section className="panel w-full max-w-md text-center">
        <h1 className="page-title text-[28px] font-semibold">
          {unavailable ? "Page is unavailable" : "We hit a snag"}
        </h1>
        <p className="my-3 text-sm text-muted">
          {unavailable
            ? "It may have been removed, or your access may have changed."
            : "Something went wrong while loading this page. Your work is still here."}
        </p>
        {retryable ? (
          <button className="btn" type="button" onClick={reset}>
            Retry
          </button>
        ) : (
          <Link className="btn" href="/dashboard">
            Back to dashboard
          </Link>
        )}
      </section>
    </main>
  );
}
