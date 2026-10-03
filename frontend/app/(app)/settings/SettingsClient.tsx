"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useCallback, useEffect, useState } from "react";

import { api, errorMessage, Org, setOrganization, setSession } from "@/lib/api";
import AccessibleDialog from "../../components/AccessibleDialog";
import PasswordField from "../../components/PasswordField";
import { useToast } from "../../components/ToastProvider";

type PasswordChangeResponse = {
  success: boolean;
  access: string;
  refresh: string;
};

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailSuccess, setEmailSuccess] = useState("");

  // Organization danger zone state
  const [org, setOrg] = useState<string>(() => localStorage.getItem("org") ?? "");
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteNameInput, setDeleteNameInput] = useState("");

  const orgs = useQuery<Org[]>({
    queryKey: ["orgs"],
    queryFn: () => api("/api/organizations/"),
  });

  useEffect(() => {
    const saved = localStorage.getItem("org");
    if (saved && orgs.data?.some((o) => String(o.id) === saved)) {
      setOrg(saved);
    } else if (orgs.data?.[0]) {
      setOrg(String(orgs.data[0].id));
    }
    const sync = () => setOrg(localStorage.getItem("org") ?? "");
    window.addEventListener("tasklane:organization", sync);
    return () => window.removeEventListener("tasklane:organization", sync);
  }, [orgs.data]);

  const role = orgs.data?.find((o) => String(o.id) === org)?.role;
  const orgName = orgs.data?.find((o) => String(o.id) === org)?.name ?? "";

  const switchAwayFrom = useCallback(
    (removedId: string) => {
      const next = orgs.data?.find((o) => String(o.id) !== removedId);
      if (next) {
        setOrganization(String(next.id));
        setOrg(String(next.id));
      } else {
        setOrganization("");
        setOrg("");
      }
      queryClient.invalidateQueries();
    },
    [orgs.data, queryClient],
  );

  const leaveOrganization = useMutation({
    mutationFn: () =>
      api(`/api/organizations/${org}/leave/`, { method: "POST" }),
    onSuccess: async () => {
      setLeaveConfirmOpen(false);
      const left = org;
      await queryClient.invalidateQueries({ queryKey: ["orgs"] });
      switchAwayFrom(left);
      toast("success", "You have left the organization.");
    },
    onError: (error) => {
      setLeaveConfirmOpen(false);
      toast("error", errorMessage(error));
    },
  });

  const deleteOrganization = useMutation({
    mutationFn: () =>
      api(`/api/organizations/${org}/`, {
        method: "DELETE",
        json: { name: deleteNameInput },
      }),
    onSuccess: async () => {
      setDeleteConfirmOpen(false);
      setDeleteNameInput("");
      const deleted = org;
      await queryClient.invalidateQueries({ queryKey: ["orgs"] });
      switchAwayFrom(deleted);
      toast("success", "Organization deleted.");
    },
    onError: (error) => toast("error", errorMessage(error)),
  });

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

      {org && role && (
        <section
          className="panel space-y-4 border-danger/30"
          aria-labelledby="org-danger-heading"
        >
          <h2
            id="org-danger-heading"
            className="text-lg font-semibold text-danger"
          >
            Organization — danger zone
          </h2>
          <p className="text-sm text-muted">
            These actions affect <strong>{orgName}</strong> and cannot be
            undone.
          </p>
          {role !== "OWNER" ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/30 p-4">
              <div>
                <p className="text-sm font-medium">Leave organization</p>
                <p className="text-xs text-muted">
                  You will lose access to all projects in this workspace. Your
                  assigned tasks will be unassigned.
                </p>
              </div>
              <button
                type="button"
                className="min-h-10 rounded-md border border-danger/40 px-4 text-sm font-medium text-danger"
                onClick={() => setLeaveConfirmOpen(true)}
              >
                Leave organization
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/30 p-4">
              <div>
                <p className="text-sm font-medium">Delete organization</p>
                <p className="text-xs text-muted">
                  Permanently deletes all projects, tasks, comments, and
                  activity. Transfer ownership first if you want someone else
                  to manage it.
                </p>
              </div>
              <button
                type="button"
                className="min-h-10 rounded-md bg-danger px-4 text-sm font-medium text-white"
                onClick={() => setDeleteConfirmOpen(true)}
              >
                Delete organization
              </button>
            </div>
          )}
        </section>
      )}

      {/* Leave confirmation */}
      {leaveConfirmOpen && (
        <AccessibleDialog
          labelledBy="settings-leave-org-title"
          className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-xl border border-line bg-surface p-6 shadow-modal"
          onClose={() => setLeaveConfirmOpen(false)}
          role="alertdialog"
        >
          <h2 id="settings-leave-org-title" className="font-semibold">
            Leave {orgName}?
          </h2>
          <p className="mt-2 text-sm text-muted">
            You will lose access to all projects and tasks in this organization.
            Your assigned tasks will be unassigned.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              className="min-h-10 rounded-md border border-line px-4"
              type="button"
              onClick={() => setLeaveConfirmOpen(false)}
            >
              Cancel
            </button>
            <button
              className="min-h-10 rounded-md bg-danger-surface px-4 font-medium text-on-danger"
              type="button"
              disabled={leaveOrganization.isPending}
              onClick={() => leaveOrganization.mutate()}
            >
              {leaveOrganization.isPending
                ? "Leaving…"
                : "Leave organization"}
            </button>
          </div>
        </AccessibleDialog>
      )}

      {/* Delete confirmation */}
      {deleteConfirmOpen && (
        <AccessibleDialog
          labelledBy="settings-delete-org-title"
          className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-xl border border-line bg-surface p-6 shadow-modal"
          onClose={() => {
            setDeleteConfirmOpen(false);
            setDeleteNameInput("");
          }}
          role="alertdialog"
        >
          <h2
            id="settings-delete-org-title"
            className="font-semibold text-danger"
          >
            Delete {orgName}?
          </h2>
          <p className="mt-2 text-sm text-muted">
            This will permanently delete the organization and all its projects,
            tasks, comments, and activity. This action cannot be undone.
          </p>
          <label className="mt-4 block space-y-1 text-sm">
            <span>
              Type <strong>{orgName}</strong> to confirm
            </span>
            <input
              className="input w-full"
              aria-label="Organization name confirmation"
              value={deleteNameInput}
              onChange={(e) => setDeleteNameInput(e.target.value)}
              autoComplete="off"
            />
          </label>
          {deleteOrganization.isError && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {errorMessage(deleteOrganization.error)}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button
              className="min-h-10 rounded-md border border-line px-4"
              type="button"
              onClick={() => {
                setDeleteConfirmOpen(false);
                setDeleteNameInput("");
              }}
            >
              Cancel
            </button>
            <button
              className="min-h-10 rounded-md bg-danger px-4 font-medium text-white disabled:opacity-50"
              type="button"
              disabled={
                deleteNameInput !== orgName || deleteOrganization.isPending
              }
              onClick={() => deleteOrganization.mutate()}
            >
              {deleteOrganization.isPending
                ? "Deleting…"
                : "Delete organization"}
            </button>
          </div>
        </AccessibleDialog>
      )}
    </main>
  );
}
