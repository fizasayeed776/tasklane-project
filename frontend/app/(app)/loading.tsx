export default function AppLoading() {
  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-8 sm:px-6">
      <div
        aria-label="Loading page"
        className="h-9 w-48 animate-pulse rounded-md bg-line motion-reduce:animate-none"
      />
      <div
        aria-hidden="true"
        className="h-48 animate-pulse rounded-lg bg-line motion-reduce:animate-none"
      />
    </main>
  );
}
