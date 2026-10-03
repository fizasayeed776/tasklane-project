export default function DashboardLoading() {
  return (
    <main
      aria-label="Loading dashboard"
      className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:py-8"
    >
      <div className="h-9 w-40 animate-pulse rounded-md bg-line motion-reduce:animate-none" />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            className="h-20 animate-pulse bg-surface motion-reduce:animate-none"
          />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
        <section className="panel space-y-4" aria-hidden="true">
          <div className="h-6 w-32 animate-pulse rounded bg-line motion-reduce:animate-none" />
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="h-14 animate-pulse rounded-md bg-line motion-reduce:animate-none"
            />
          ))}
        </section>
        <section className="panel space-y-4" aria-hidden="true">
          <div className="h-6 w-40 animate-pulse rounded bg-line motion-reduce:animate-none" />
          {Array.from({ length: 3 }, (_, index) => (
            <div
              key={index}
              className="h-12 animate-pulse rounded-md bg-line motion-reduce:animate-none"
            />
          ))}
        </section>
      </div>
    </main>
  );
}
