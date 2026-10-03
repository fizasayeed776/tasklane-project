export default function ProjectLoading() {
  return (
    <main
      aria-label="Loading project board"
      className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:py-8"
    >
      <div className="h-5 w-44 animate-pulse rounded bg-line motion-reduce:animate-none" />
      <div className="h-16 w-full animate-pulse rounded-lg bg-line motion-reduce:animate-none" />
      <div className="flex gap-3 overflow-hidden" aria-hidden="true">
        {Array.from({ length: 4 }, (_, column) => (
          <section
            key={column}
            className="min-w-64 flex-1 space-y-3 rounded-xl border border-line p-3"
          >
            <div className="h-8 animate-pulse rounded bg-line motion-reduce:animate-none" />
            {Array.from({ length: 3 }, (_, card) => (
              <div
                key={card}
                className="h-28 animate-pulse rounded-lg bg-line motion-reduce:animate-none"
              />
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
