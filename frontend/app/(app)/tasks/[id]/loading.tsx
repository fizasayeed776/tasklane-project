export default function TaskLoading() {
  return (
    <main
      aria-label="Loading task"
      className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:py-8"
    >
      <div className="h-5 w-52 animate-pulse rounded bg-line motion-reduce:animate-none" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-5">
          <section className="panel space-y-4" aria-hidden="true">
            <div className="h-8 w-3/4 animate-pulse rounded bg-line motion-reduce:animate-none" />
            <div className="h-24 animate-pulse rounded bg-line motion-reduce:animate-none" />
          </section>
          <section className="panel space-y-4" aria-hidden="true">
            <div className="h-6 w-28 animate-pulse rounded bg-line motion-reduce:animate-none" />
            {Array.from({ length: 3 }, (_, index) => (
              <div
                key={index}
                className="h-14 animate-pulse rounded bg-line motion-reduce:animate-none"
              />
            ))}
          </section>
        </div>
        <aside className="panel space-y-4" aria-hidden="true">
          <div className="h-6 w-32 animate-pulse rounded bg-line motion-reduce:animate-none" />
          {Array.from({ length: 5 }, (_, index) => (
            <div
              key={index}
              className="h-12 animate-pulse rounded bg-line motion-reduce:animate-none"
            />
          ))}
        </aside>
      </div>
    </main>
  );
}
