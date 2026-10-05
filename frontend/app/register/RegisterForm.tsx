"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import {
  ApiError,
  api,
  apiFieldErrors,
  apiFormErrorMessage,
  setOrganization,
  setSession,
} from "@/lib/api";
import PasswordField from "../components/PasswordField";

const THROTTLE_MESSAGE =
  "Too many attempts. Please wait a minute and try again.";
const INVITE_HINT = "Ask the organization owner to send you a new invitation.";
// Fields rendered explicitly in the form; all others go to the form-level error.
const RENDERED_FIELDS = ["first_name", "email", "password"];

function isInviteError(message: string): boolean {
  return (
    message.includes("invitation") ||
    message.includes("invite") ||
    message.includes("expired") ||
    message.includes("invalid") ||
    message.includes("already been used")
  );
}

export default function RegisterForm({ invitation }: { invitation?: string }) {
  const router = useRouter();
  const [f, setF] = useState({ first_name: "", email: "", password: "" }),
    [err, setErr] = useState(""),
    [inviteError, setInviteError] = useState(false),
    [fieldErrors, setFieldErrors] = useState<Record<string, string>>({}),
    [submitting, setSubmitting] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setInviteError(false);
    setFieldErrors({});
    setSubmitting(true);
    try {
      const registered = await api<{ organization_id?: number | null }>(
        "/api/auth/register/",
        {
          method: "POST",
          json: invitation ? { ...f, invite: invitation } : f,
        },
      );
      // Activate the joined organization before auto-login so the dashboard
      // opens on the correct workspace immediately.
      if (registered.organization_id) {
        setOrganization(String(registered.organization_id));
      }
    } catch (x: unknown) {
      if (x instanceof ApiError && x.status === 429) {
        setErr(THROTTLE_MESSAGE);
        setSubmitting(false);
        return;
      }
      const errors = apiFieldErrors(x);
      setFieldErrors({
        name: errors.first_name?.[0] ?? "",
        email: errors.email?.[0] ?? "",
        password: errors.password?.[0] ?? "",
      });
      const formMessage = apiFormErrorMessage(x, RENDERED_FIELDS);
      const isInvite = formMessage ? isInviteError(formMessage) : false;
      setInviteError(isInvite);
      setErr(formMessage);
      setSubmitting(false);
      return;
    }

    // Registration succeeded — attempt automatic login.
    try {
      const d = await api("/api/auth/login/", {
        method: "POST",
        json: { email: f.email, password: f.password },
      });
      setSession(d.access, d.refresh);
      router.push("/dashboard");
    } catch {
      // Automatic login failed (e.g. throttled).  Send the user to /login
      // with a notice instead of leaving them on a blank screen.
      router.push("/login?registered=1");
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1 text-sm">
        <label className="block space-y-1">
          <span>Name</span>
          <input
            className="input"
            placeholder="Name"
            autoComplete="name"
            value={f.first_name}
            aria-invalid={fieldErrors.name ? true : undefined}
            aria-describedby={
              fieldErrors.name ? "register-name-error" : undefined
            }
            onChange={(e) => {
              setF({ ...f, first_name: e.target.value });
              setFieldErrors({ ...fieldErrors, name: "" });
            }}
          />
        </label>
        {fieldErrors.name && (
          <p id="register-name-error" role="alert" className="text-danger">
            {fieldErrors.name}
          </p>
        )}
      </div>
      <div className="space-y-1 text-sm">
        <label className="block space-y-1">
          <span>Email</span>
          <input
            className="input"
            type="email"
            placeholder="Email"
            autoComplete="email"
            value={f.email}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={
              fieldErrors.email ? "register-email-error" : undefined
            }
            onChange={(e) => {
              setF({ ...f, email: e.target.value });
              setFieldErrors({ ...fieldErrors, email: "" });
            }}
            required
          />
        </label>
        {fieldErrors.email && (
          <p id="register-email-error" role="alert" className="text-danger">
            {fieldErrors.email}{" "}
            {fieldErrors.email.includes(
              "An account with this email already exists",
            ) && (
              <Link className="underline" href="/login">
                Log in
              </Link>
            )}
          </p>
        )}
      </div>
      <PasswordField
        id="register-password"
        label="Password"
        autoComplete="new-password"
        minLength={8}
        value={f.password}
        error={fieldErrors.password}
        onChange={(password) => {
          setF({ ...f, password });
          setFieldErrors({ ...fieldErrors, password: "" });
        }}
      />
      {err && (
        <p role="alert" className="text-sm text-warn">
          {err}
          {inviteError && <> {INVITE_HINT}</>}
        </p>
      )}
      <button className="btn w-full" disabled={submitting}>
        {submitting ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
