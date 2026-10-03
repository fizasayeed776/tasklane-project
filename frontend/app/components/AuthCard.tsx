import Link from "next/link";

export default function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="grid min-h-[calc(100vh-2rem)] place-items-center px-4 py-12">
      <section className="panel w-full max-w-md space-y-5 p-6 sm:p-8">
        <header className="space-y-2">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-muted"
          >
            <span
              aria-hidden="true"
              className="grid size-8 place-items-center rounded-md bg-accent text-white"
            >
              T
            </span>
            Tasklane
          </Link>
          <h1 className="page-title text-2xl font-semibold">{title}</h1>
          {description && <p className="text-sm text-muted">{description}</p>}
        </header>
        {children}
      </section>
    </main>
  );
}
