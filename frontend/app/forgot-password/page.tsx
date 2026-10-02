"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { api } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSubmitting(true);
    try {
      await api("/api/auth/password/forgot/", {
        method: "POST",
        json: { email },
      });
      setMessage(
        "If an account exists for that email, a password-reset link has been sent.",
      );
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto mt-24 max-w-sm space-y-4 panel">
      <h1 className="text-xl font-semibold">Reset your password</h1>
      <p className="text-sm">
        Enter your account email and we’ll send a reset link if it exists.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span>Email</span>
          <input
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
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
        <button className="btn w-full" disabled={submitting}>
          {submitting ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <Link className="text-sm underline" href="/login">
        Back to log in
      </Link>
    </main>
  );
}
