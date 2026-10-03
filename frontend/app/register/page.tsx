import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import AuthCard from "../components/AuthCard";
import RegisterForm from "./RegisterForm";

export const metadata: Metadata = {
  title: "Register | Tasklane",
};

type RegisterPageProps = {
  searchParams: Promise<{ invite?: string | string[] }>;
};

export default async function RegisterPage({
  searchParams,
}: RegisterPageProps) {
  const search = await searchParams;
  const invitation = Array.isArray(search.invite)
    ? search.invite[0]
    : search.invite;

  return (
    <AuthCard
      title="Create your account"
      description="A clear place for your team's next project."
    >
      {invitation && (
        <p className="rounded-md bg-accent-soft p-3 text-sm">
          You’ve been invited to join an organization. Register using the
          invited email address.
        </p>
      )}
      <Suspense
        fallback={
          <p role="status" className="text-sm text-muted">
            Loading registration form…
          </p>
        }
      >
        <RegisterForm invitation={invitation} />
      </Suspense>
      <p className="text-sm">
        Have an account?{" "}
        <Link
          className="inline-flex min-h-10 items-center underline"
          href="/login"
        >
          Log in
        </Link>
      </p>
    </AuthCard>
  );
}
