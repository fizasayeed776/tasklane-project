import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import AuthCard from "../components/AuthCard";
import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "Log in | Tasklane",
};

export default function LoginPage() {
  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to return to your team's workspace."
    >
      <Suspense
        fallback={
          <p role="status" className="text-sm text-muted">
            Loading sign-in form…
          </p>
        }
      >
        <LoginForm />
      </Suspense>
      <p className="text-sm">
        <Link
          className="inline-flex min-h-10 items-center underline"
          href="/forgot-password"
        >
          Forgot password?
        </Link>
      </p>
      <p className="text-sm">
        New here?{" "}
        <Link
          className="inline-flex min-h-10 items-center underline"
          href="/register"
        >
          Create an account
        </Link>
      </p>
    </AuthCard>
  );
}
