"use client";

import { ApiError, errorMessage } from "@/lib/api";

export default function QueryError({
  error,
  onRetry,
  resource,
}: {
  error: unknown;
  onRetry: () => void;
  resource: string;
}) {
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <section
      role="alert"
      className="mx-auto max-w-xl rounded-xl border border-line bg-surface p-6"
    >
      <h2 className="font-semibold">
        {notFound ? `${resource} is unavailable` : `Couldn't load ${resource}`}
      </h2>
      <p className="mt-2 text-sm text-muted">
        {notFound
          ? "It may have been removed, or your access may have changed."
          : errorMessage(error)}
      </p>
      <button className="btn mt-4" type="button" onClick={onRetry}>
        Retry
      </button>
    </section>
  );
}
