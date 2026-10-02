"use client";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-md p-8 text-center">
      <p className="mb-3">Something went wrong loading this page.</p>
      <button className="btn" onClick={reset}>Try again</button>
    </main>
  );
}
