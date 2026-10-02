"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, setSession } from "@/lib/api";

export default function Register() {
  const router = useRouter();
  const [f, setF] = useState({ first_name: "", email: "", password: "" }),
    [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/auth/register/", { method: "POST", json: f });
      const d = await api("/api/auth/login/", {
        method: "POST",
        json: { email: f.email, password: f.password },
      });
      setSession(d.access, d.refresh);
      router.push("/dashboard");
    } catch (x: any) {
      setErr(
        "Could not register. Use a unique email and a password of 8+ characters.",
      );
    }
  }
  return (
    <main className="mx-auto mt-24 max-w-sm panel">
      <h1 className="mb-4 text-xl font-semibold">Create your account</h1>
      <form onSubmit={submit} className="space-y-3">
        <input
          className="input"
          placeholder="Name"
          value={f.first_name}
          onChange={(e) => setF({ ...f, first_name: e.target.value })}
        />
        <input
          className="input"
          type="email"
          placeholder="Email"
          value={f.email}
          onChange={(e) => setF({ ...f, email: e.target.value })}
          required
        />
        <input
          className="input"
          type="password"
          placeholder="Password"
          value={f.password}
          onChange={(e) => setF({ ...f, password: e.target.value })}
          required
        />
        {err && (
          <p role="alert" className="text-sm text-warn">
            {err}
          </p>
        )}
        <button className="btn w-full">Create account</button>
      </form>
      <p className="mt-3 text-sm">
        Have an account?{" "}
        <Link className="underline" href="/login">
          Log in
        </Link>
      </p>
    </main>
  );
}
