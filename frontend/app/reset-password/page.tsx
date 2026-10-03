"use client";

import Link from "next/link";
import { Suspense, FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";

import { api, errorMessage } from "@/lib/api";
import AuthCard from "../components/AuthCard";
import PasswordField from "../components/PasswordField";

function ResetPasswordForm() {
  const params = useSearchParams();
  const uid = params.get("uid") ?? "";
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    if (!uid || !token) {
      setError("This reset link is incomplete. Request a new link.");
      return;
    }

    setSubmitting(true);
    try {
      await api("/api/auth/password/reset/", {
        method: "POST",
        json: { uid, token, new_password: password },
      });
      setMessage("Your password has been reset. You can now log in.");
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={submit} className="space-y-3">
        <PasswordField
          id="reset-password"
          label="New password"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={setPassword}
        />
        <PasswordField
          id="confirm-reset-password"
          label="Confirm new password"
          autoComplete="new-password"
          minLength={8}
          value={confirmation}
          onChange={setConfirmation}
        />
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-warn">
            {error}
          </p>
        )}
        {message ? (
          <Link className="btn block text-center" href="/login">
            Log in
          </Link>
        ) : (
          <button className="btn w-full" disabled={submitting}>
            {submitting ? "Resetting…" : "Reset password"}
          </button>
        )}
      </form>
      <Link className="text-sm underline" href="/forgot-password">
        Request another reset link
      </Link>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-[calc(100vh-2rem)] place-items-center px-4 py-12">
          <section className="panel w-full max-w-md">
            Loading reset form…
          </section>
        </main>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
