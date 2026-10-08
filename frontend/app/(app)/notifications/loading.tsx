export default function NotificationsLoading() {
  return (
    <main
      aria-label="Loading notifications"
      className="mx-auto max-w-4xl space-y-5 px-4 py-8 sm:px-6"
    >
      <div className="h-9 w-52 animate-pulse rounded bg-line motion-reduce:animate-none" />
      <section className="panel space-y-4" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            className="h-16 animate-pulse rounded bg-line motion-reduce:animate-none"
          />
        ))}
      </section>
    </main>
  );
}
