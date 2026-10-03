"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";

import { api, errorMessage, setSession } from "@/lib/api";
import PasswordField from "../../components/PasswordField";

type PasswordChangeResponse = {
  success: boolean;
  access: string;
  refresh: string;
};

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailSuccess, setEmailSuccess] = useState("");

  const passwordMutation = useMutation({
    mutationFn: () =>
      api<PasswordChangeResponse>("/api/auth/password/change/", {
        method: "POST",
        json: {
          old_password: currentPassword,
          new_password: newPassword,
        },
      }),
    onSuccess: (result) => {
      setSession(result.access, result.refresh);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSuccess("Your password has been changed.");
    },
  });

  const emailMutation = useMutation({
    mutationFn: () =>
      api("/api/auth/email/change/", {
        method: "POST",
        json: {
          new_email: newEmail,
          current_password: emailPassword,
        },
      }),
    onSuccess: async () => {
      setNewEmail("");
      setEmailPassword("");
      setEmailSuccess("Your email address has been changed.");
      await queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");
    if (newPassword !== confirmPassword) {
      setPasswordError("The new passwords do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError(
        "New password must be different from the current password.",
      );
      return;
    }
    try {
      await passwordMutation.mutateAsync();
    } catch (error) {
      setPasswordError(errorMessage(error));
    }
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailError("");
    setEmailSuccess("");
    try {
      await emailMutation.mutateAsync();
    } catch (error) {
      setEmailError(errorMessage(error));
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <header>
        <h1 className="page-title text-3xl font-semibold">Account settings</h1>
        <p className="mt-2 text-sm text-muted">
          Update your account email address and password.
        </p>
      </header>

      <section className="panel space-y-4" aria-labelledby="password-heading">
        <h2 id="password-heading" className="text-lg font-semibold">
          Change password
        </h2>
        <form className="max-w-xl space-y-3" onSubmit={submitPassword}>
          <PasswordField
            id="current-password"
            label="Current password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={setCurrentPassword}
          />
          <PasswordField
            id="new-password"
            label="New password"
            autoComplete="new-password"
            minLength={8}
            value={newPassword}
            onChange={setNewPassword}
          />
          <PasswordField
            id="confirm-new-password"
            label="Confirm new password"
            autoComplete="new-password"
            minLength={8}
            value={confirmPassword}
            onChange={setConfirmPassword}
          />
          {passwordError && (
            <p role="alert" className="text-sm text-warn">
              {passwordError}
            </p>
          )}
          {passwordSuccess && (
            <p role="status" className="text-sm">
              {passwordSuccess}
            </p>
          )}
          <button
            className="btn"
            disabled={passwordMutation.isPending}
            type="submit"
          >
            {passwordMutation.isPending ? "Changing…" : "Change password"}
          </button>
        </form>
      </section>

      <section className="panel space-y-4" aria-labelledby="email-heading">
        <h2 id="email-heading" className="text-lg font-semibold">
          Change email
        </h2>
        <form className="max-w-xl space-y-3" onSubmit={submitEmail}>
          <label className="block space-y-1 text-sm" htmlFor="new-email">
            <span>New email</span>
            <input
              id="new-email"
              className="input"
              type="email"
              autoComplete="email"
              required
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
            />
          </label>
          <PasswordField
            id="email-current-password"
            label="Current password"
            autoComplete="current-password"
            value={emailPassword}
            onChange={setEmailPassword}
          />
          {emailError && (
            <p role="alert" className="text-sm text-warn">
              {emailError}
            </p>
          )}
          {emailSuccess && (
            <p role="status" className="text-sm">
              {emailSuccess}
            </p>
          )}
          <button
            className="btn"
            disabled={emailMutation.isPending}
            type="submit"
          >
            {emailMutation.isPending ? "Changing…" : "Change email"}
          </button>
        </form>
      </section>
    </main>
  );
}
