"use client";

import Link from "next/link";
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
  const status = error instanceof ApiError ? error.status : undefined;
  const unavailable = status === 403 || status === 404;
  const retryable =
    (status !== undefined && status >= 500) || error instanceof TypeError;
  const resourceTitle = resource.charAt(0).toUpperCase() + resource.slice(1);
  return (
    <section
      role="alert"
      className="mx-auto max-w-xl rounded-xl border border-line bg-surface p-6"
    >
      <h2 className="font-semibold">
        {unavailable
          ? `${resourceTitle} is unavailable`
          : `Couldn't load ${resource}`}
      </h2>
      <p className="mt-2 text-sm text-muted">
        {unavailable
          ? "It may have been removed, or your access may have changed."
          : errorMessage(error)}
      </p>
      {retryable ? (
        <button className="btn mt-4" type="button" onClick={onRetry}>
          Retry
        </button>
      ) : (
        <Link className="btn mt-4" href="/dashboard">
          Back to dashboard
        </Link>
      )}
    </section>
  );
}
