"use client";
import Link from "next/link";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api, errorMessage, setSession } from "@/lib/api";
import AuthCard from "../components/AuthCard";
import PasswordField from "../components/PasswordField";

function RegisterForm() {
  const router = useRouter();
  const invitation = useSearchParams().get("invite");
  const [f, setF] = useState({ first_name: "", email: "", password: "" }),
    [err, setErr] = useState(""),
    [submitting, setSubmitting] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setSubmitting(true);
    try {
      await api("/api/auth/register/", {
        method: "POST",
        json: invitation ? { ...f, invite: invitation } : f,
      });
      const d = await api("/api/auth/login/", {
        method: "POST",
        json: { email: f.email, password: f.password },
      });
      setSession(d.access, d.refresh);
      router.push("/dashboard");
    } catch (x: unknown) {
      setErr(errorMessage(x));
    } finally {
      setSubmitting(false);
    }
  }
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
      <form onSubmit={submit} className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span>Name</span>
          <input
            className="input"
            placeholder="Name"
            autoComplete="name"
            value={f.first_name}
            onChange={(e) => setF({ ...f, first_name: e.target.value })}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Email</span>
          <input
            className="input"
            type="email"
            placeholder="Email"
            autoComplete="email"
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
            required
          />
        </label>
        <PasswordField
          id="register-password"
          label="Password"
          autoComplete="new-password"
          minLength={8}
          value={f.password}
          onChange={(password) => setF({ ...f, password })}
        />
        {err && (
          <p role="alert" className="text-sm text-warn">
            {err}
          </p>
        )}
        <button className="btn w-full" disabled={submitting}>
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p className="text-sm">
        Have an account?{" "}
        <Link className="underline" href="/login">
          Log in
        </Link>
      </p>
    </AuthCard>
  );
}

export default function Register() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-[calc(100vh-2rem)] place-items-center px-4 py-12">
          <section className="panel w-full max-w-md">
            Loading registration form…
          </section>
        </main>
      }
    >
      <RegisterForm />
    </Suspense>
  );
}
