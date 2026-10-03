export default function Loading() {
  return (
    <main
      aria-label="Loading page"
      className="mx-auto max-w-7xl space-y-5 px-4 py-8 sm:px-6"
    >
      <div className="h-8 w-48 animate-pulse rounded bg-line motion-reduce:animate-none" />
      <div className="h-28 animate-pulse rounded-xl bg-line motion-reduce:animate-none" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className="h-48 animate-pulse rounded-xl bg-line motion-reduce:animate-none"
          />
        ))}
      </div>
    </main>
  );
}
