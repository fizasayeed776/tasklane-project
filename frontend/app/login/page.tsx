"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage, setSession } from "@/lib/api";
import AuthCard from "../components/AuthCard";
import PasswordField from "../components/PasswordField";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [err, setErr] = useState(""),
    [submitting, setSubmitting] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setSubmitting(true);
    try {
      const d = await api("/api/auth/login/", {
        method: "POST",
        json: { email, password },
      });
      setSession(d.access, d.refresh);
      router.push("/dashboard");
    } catch (x: unknown) {
      const message = errorMessage(x);
      setErr(
        message.includes("credentials")
          ? "Email or password is wrong."
          : message,
      );
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to return to your team's workspace."
    >
      <form onSubmit={submit} className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span>Email</span>
          <input
            className="input"
            type="email"
            placeholder="Email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <PasswordField
          id="login-password"
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
        />
        {err && (
          <p role="alert" className="text-sm text-warn">
            {err}
          </p>
        )}
        <button className="btn w-full" disabled={submitting}>
          {submitting ? "Signing in…" : "Log in"}
        </button>
      </form>
      <p className="text-sm">
        <Link className="underline" href="/forgot-password">
          Forgot password?
        </Link>
      </p>
      <p className="text-sm">
        New here?{" "}
        <Link className="underline" href="/register">
          Create an account
        </Link>
      </p>
    </AuthCard>
  );
}
