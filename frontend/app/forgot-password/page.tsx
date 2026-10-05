"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { api, apiFieldErrors, apiFormErrorMessage } from "@/lib/api";
import AuthCard from "../components/AuthCard";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setEmailError("");
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
      const fields = apiFieldErrors(requestError);
      setEmailError(fields.email?.[0] ?? "");
      setError(apiFormErrorMessage(requestError, ["email"]));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your account email and we’ll send a reset link if it exists."
    >
      <form onSubmit={submit} className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span>Email</span>
          <input
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? "forgot-email-error" : undefined}
            onChange={(event) => {
              setEmail(event.target.value);
              setEmailError("");
            }}
            required
          />
        </label>
        {emailError && (
          <p id="forgot-email-error" role="alert" className="text-danger">
            {emailError}
          </p>
        )}
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
      <Link
        className="inline-flex min-h-10 items-center text-sm underline"
        href="/login"
      >
        Back to log in
      </Link>
    </AuthCard>
  );
}
