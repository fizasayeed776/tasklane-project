"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, setSession } from "@/lib/api";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const d = await api("/api/auth/login/", {
        method: "POST",
        json: { email, password },
      });
      setSession(d.access, d.refresh);
      router.push("/dashboard");
    } catch (x: any) {
      setErr(
        x.message.includes("credentials")
          ? "Email or password is wrong."
          : x.message,
      );
    }
  }
  return (
    <main className="mx-auto mt-24 max-w-sm panel">
      <h1 className="mb-4 text-xl font-semibold">Log in to Tasklane</h1>
      <form onSubmit={submit} className="space-y-3">
        <input
          className="input"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="input"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {err && (
          <p role="alert" className="text-sm text-warn">
            {err}
          </p>
        )}
        <button className="btn w-full">Log in</button>
      </form>
      <p className="mt-3 text-sm">
        <Link className="underline" href="/forgot-password">
          Forgot password?
        </Link>
      </p>
      <p className="mt-3 text-sm">
        New here?{" "}
        <Link className="underline" href="/register">
          Create an account
        </Link>
      </p>
    </main>
  );
}
