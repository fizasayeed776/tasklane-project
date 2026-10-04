"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ApiError,
  api,
  apiFieldErrors,
  apiFormErrorMessage,
  setSession,
} from "@/lib/api";
import PasswordField from "../components/PasswordField";

const THROTTLE_MESSAGE =
  "Too many attempts. Please wait a minute and try again.";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [err, setErr] = useState(""),
    [fieldErrors, setFieldErrors] = useState<Record<string, string>>({}),
    [submitting, setSubmitting] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setFieldErrors({});
    setSubmitting(true);
    try {
      const d = await api("/api/auth/login/", {
        method: "POST",
        json: { email, password },
      });
      setSession(d.access, d.refresh);
      router.push("/dashboard");
    } catch (x: unknown) {
      if (x instanceof ApiError && x.status === 429) {
        setErr(THROTTLE_MESSAGE);
      } else {
        const errors = apiFieldErrors(x);
        setFieldErrors({
          email: errors.email?.[0] ?? "",
          password: errors.password?.[0] ?? "",
        });
        const message = apiFormErrorMessage(x, ["email", "password"]);
        setErr(
          message.includes("credentials") || message.includes("No active")
            ? "Email or password is wrong."
            : message,
        );
      }
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1 text-sm">
        <label className="block space-y-1">
          <span>Email</span>
          <input
            className="input"
            type="email"
            placeholder="Email"
            autoComplete="email"
            value={email}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={
              fieldErrors.email ? "login-email-error" : undefined
            }
            onChange={(e) => {
              setEmail(e.target.value);
              setFieldErrors({ ...fieldErrors, email: "" });
            }}
            required
          />
        </label>
        {fieldErrors.email && (
          <p id="login-email-error" role="alert" className="text-danger">
            {fieldErrors.email}
          </p>
        )}
      </div>
      <PasswordField
        id="login-password"
        label="Password"
        autoComplete="current-password"
        value={password}
        error={fieldErrors.password}
        onChange={(value) => {
          setPassword(value);
          setFieldErrors({ ...fieldErrors, password: "" });
        }}
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
  );
}
