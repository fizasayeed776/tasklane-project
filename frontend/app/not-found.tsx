import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-[70vh] place-items-center px-4 py-12">
      <section className="panel w-full max-w-md text-center">
        <p className="text-sm font-medium text-accent">404</p>
        <h1 className="page-title mt-2 text-2xl font-semibold">
          This page wandered off
        </h1>
        <p className="my-3 text-sm text-muted">
          The link may be out of date, or the page may have moved.
        </p>
        <Link className="btn" href="/dashboard">
          Back to dashboard
        </Link>
      </section>
    </main>
  );
}
