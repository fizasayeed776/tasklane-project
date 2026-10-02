"use client";

import Link from "next/link";
import { Suspense, FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";

import { api, errorMessage } from "@/lib/api";

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
    <main className="mx-auto mt-24 max-w-sm space-y-4 panel">
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      <form onSubmit={submit} className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span>New password</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Confirm new password</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
          />
        </label>
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
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto mt-24 max-w-sm panel">
          Loading reset form…
        </main>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
