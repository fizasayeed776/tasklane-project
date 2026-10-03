"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage, setSession } from "@/lib/api";
import PasswordField from "../components/PasswordField";

export default function RegisterForm({ invitation }: { invitation?: string }) {
  const router = useRouter();
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
  );
}
