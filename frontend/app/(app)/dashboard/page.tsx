"use client";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  canManage,
  errorMessage,
  Org,
  OrgMember,
  Project,
  setOrganization,
} from "@/lib/api";
import { initials, relativeTime, roleLabel } from "@/lib/format";

type ProjectTaskPage = {
  count: number;
  next: string | null;
  results: { updated_at: string; created_at: string }[];
};

async function projectTaskSummary(projectId: number) {
  let nextPath: string | null = `/api/tasks/?project=${projectId}`;
  let count = 0;
  let latestTaskChange: string | undefined;
  while (nextPath) {
    const response: ProjectTaskPage = await api<ProjectTaskPage>(nextPath);
    count = response.count;
    for (const task of response.results) {
      const changed = task.updated_at || task.created_at;
      if (
        changed &&
        (!latestTaskChange ||
          new Date(changed).getTime() > new Date(latestTaskChange).getTime())
      ) {
        latestTaskChange = changed;
      }
    }
    if (response.next) {
      const url = new URL(
        response.next,
        process.env.NEXT_PUBLIC_API_URL ?? window.location.origin,
      );
      nextPath = `${url.pathname}${url.search}`;
    } else {
      nextPath = null;
    }
  }
  return { count, latestTaskChange };
}

function activityGlyph(verb: string) {
  if (verb.includes("assigned")) return "↗";
  if (verb.includes("status")) return "↻";
  if (verb.includes("comment")) return "“";
  return "＋";
}

export default function Dashboard() {
  const qc = useQueryClient();
  const [org, setOrg] = useState<string>(""),
    [name, setName] = useState(""),
    [pname, setPname] = useState(""),
    [inviteEmail, setInviteEmail] = useState(""),
    [inviteRole, setInviteRole] = useState<"ADMIN" | "MEMBER" | "VIEWER">(
      "MEMBER",
    ),
    [memberFeedback, setMemberFeedback] = useState("");
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [invitePanelOpen, setInvitePanelOpen] = useState(false);
  const [memberPendingRemoval, setMemberPendingRemoval] =
    useState<OrgMember | null>(null);
  const orgs = useQuery<Org[]>({
    queryKey: ["orgs"],
    queryFn: () => api("/api/organizations/"),
  });
  const pick = useCallback(
    (id: string) => {
      setOrganization(id);
      setOrg(id);
      qc.invalidateQueries();
    },
    [qc],
  );
  useEffect(() => {
    const saved = localStorage.getItem("org");
    if (
      saved &&
      orgs.data?.some((organization) => String(organization.id) === saved)
    ) {
      setOrg(saved);
    } else if (orgs.data?.[0]) {
      pick(String(orgs.data[0].id));
    }
  }, [orgs.data, pick]);
  useEffect(() => {
    const syncOrganization = () => setOrg(localStorage.getItem("org") ?? "");
    window.addEventListener("tasklane:organization", syncOrganization);
    return () =>
      window.removeEventListener("tasklane:organization", syncOrganization);
  }, []);
  const role = orgs.data?.find((o) => String(o.id) === org)?.role;
  const members = useQuery<OrgMember[]>({
    queryKey: ["members", org],
    queryFn: () => api(`/api/organizations/${org}/members/`),
    enabled: !!org,
  });
  const stats = useQuery({
    queryKey: ["stats", org],
    queryFn: () => api("/api/dashboard/"),
    enabled: !!org,
  });
  const projects = useQuery<{ results: (Project & { created_at?: string })[] }>(
    {
      queryKey: ["projects", org],
      queryFn: () => api("/api/projects/?ordering=-created_at"),
      enabled: !!org,
    },
  );
  const projectSummaries = useQueries({
    queries: (projects.data?.results ?? []).map((project) => ({
      queryKey: ["project-task-summary", org, project.id],
      queryFn: () => projectTaskSummary(project.id),
      enabled: !!org,
    })),
  });
  const activity = useQuery({
    queryKey: ["activity", org],
    queryFn: () => api("/api/activity/"),
    enabled: !!org,
  });
  const createOrg = useMutation({
    mutationFn: () =>
      api("/api/organizations/", { method: "POST", json: { name } }),
    onSuccess: (o) => {
      setName("");
      qc.invalidateQueries({ queryKey: ["orgs"] });
      pick(String(o.id));
    },
  });
  const createProject = useMutation({
    mutationFn: () =>
      api("/api/projects/", {
        method: "POST",
        json: { name: pname, organization_id: Number(org) },
      }),
    onSuccess: () => {
      setPname("");
      setProjectModalOpen(false);
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["stats", org] });
    },
  });
  const inviteMember = useMutation({
    mutationFn: () =>
      api<{ email: string; pending: boolean }>(
        `/api/organizations/${org}/members/`,
        {
          method: "POST",
          json: { email: inviteEmail, role: inviteRole },
        },
      ),
    onSuccess: async (result) => {
      setInviteEmail("");
      setMemberFeedback(
        result.pending
          ? `Invitation sent to ${result.email}. They can register to join.`
          : `${result.email} was added to this organization.`,
      );
      await qc.invalidateQueries({ queryKey: ["members", org] });
    },
  });
  const changeMemberRole = useMutation({
    mutationFn: ({ id, role }: { id: number; role: OrgMember["role"] }) =>
      api(`/api/organizations/${org}/members/${id}/`, {
        method: "PATCH",
        json: { role },
      }),
    onSuccess: async () => {
      setMemberFeedback("Member role updated.");
      await qc.invalidateQueries({ queryKey: ["members", org] });
    },
  });
  const removeMember = useMutation({
    mutationFn: (id: number) =>
      api(`/api/organizations/${org}/members/${id}/`, { method: "DELETE" }),
    onSuccess: async () => {
      setMemberFeedback("Member removed from this organization.");
      setMemberPendingRemoval(null);
      await qc.invalidateQueries({ queryKey: ["members", org] });
    },
  });
  const s = stats.data;
  const statsRow: [string, number | undefined][] = [
    ["Projects", s?.total_projects],
    ["Tasks", s?.total_tasks],
    ["Assigned to you", s?.assigned_to_me],
    ["Completed", s?.completed],
    ["Overdue", s?.overdue],
  ];
  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
      <h1 className="page-title text-2xl font-semibold">Dashboard</h1>
      {orgs.data && (orgs.data.length === 0 || (!!org && canManage(role))) && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            createOrg.mutate();
          }}
        >
          <label className="block min-w-0 flex-1 space-y-1 text-sm sm:flex-none">
            <span>Organization name</span>
            <input
              className="input max-w-xs"
              placeholder="New organization name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <button
            className="btn shrink-0 whitespace-nowrap"
            disabled={createOrg.isPending}
          >
            Create organization
          </button>
          {createOrg.isError && (
            <p role="alert" className="text-sm text-warn">
              {errorMessage(createOrg.error)}
            </p>
          )}
        </form>
      )}
      <section
        aria-label="Workspace statistics"
        className="grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-5"
      >
        {statsRow.map(([label, value], index) => (
          <div
            key={label}
            className={`px-4 py-3 ${index >= 2 ? "sm:border-t-0" : ""} ${index >= 3 ? "lg:border-t-0" : ""}`}
          >
            <p
              className={`text-xl font-semibold tabular-nums ${label === "Overdue" && (value ?? 0) > 0 ? "text-danger" : ""}`}
            >
              {value ?? "–"}
            </p>
            <p className="text-xs text-muted">{label}</p>
          </div>
        ))}
      </section>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
        <section className="panel space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Projects</h2>
              <p className="mt-1 text-sm text-muted">
                A simple view of what your team is working on.
              </p>
            </div>
            {canManage(role) && (
              <button
                type="button"
                className="btn shrink-0 whitespace-nowrap"
                onClick={() => setProjectModalOpen(true)}
              >
                New project
              </button>
            )}
          </div>
          <ul className="divide-y divide-line">
            {projects.data?.results.map((project, index) => {
              const summary = projectSummaries[index]?.data;
              const lastChanged =
                summary?.latestTaskChange || project.created_at;
              return (
                <li key={project.id}>
                  <Link
                    className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 py-3 hover:text-accent"
                    href={`/projects/${project.id}`}
                  >
                    <span className="min-w-0 flex-1 font-medium">
                      {project.name}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${project.status === "ACTIVE" ? "bg-accent-soft text-ink" : "bg-line text-muted"}`}
                    >
                      {project.status === "ACTIVE" ? "Active" : "Archived"}
                    </span>
                    <span className="text-sm text-muted">
                      {summary ? summary.count : "–"} tasks
                    </span>
                    <span className="text-xs text-muted">
                      {summary?.latestTaskChange
                        ? `Updated ${relativeTime(lastChanged)}`
                        : project.created_at
                          ? `Created ${relativeTime(project.created_at)}`
                          : "No recent activity"}
                    </span>
                  </Link>
                </li>
              );
            })}
            {projects.data?.results.length === 0 && (
              <li className="py-8 text-center">
                <p className="font-medium">A quiet start is a good start.</p>
                <p className="mt-1 text-sm text-muted">
                  {canManage(role)
                    ? "Create a project to give your team a place to begin."
                    : "Ask an organization admin to create the first project."}
                </p>
                {canManage(role) && (
                  <button
                    type="button"
                    className="btn mt-4"
                    onClick={() => setProjectModalOpen(true)}
                  >
                    Create your first project
                  </button>
                )}
              </li>
            )}
          </ul>
        </section>
        <section className="panel">
          <h2 className="font-semibold">Recent activity</h2>
          <ul className="mt-4 space-y-4 text-sm">
            {activity.data?.map((item: any) => (
              <li key={item.id} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"
                >
                  {activityGlyph(item.verb)}
                </span>
                <div className="min-w-0">
                  <p className="leading-5">{item.message}</p>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                    <time dateTime={item.created_at}>
                      {relativeTime(item.created_at)}
                    </time>
                    {item.task && (
                      <Link
                        href={`/tasks/${item.task}`}
                        className="underline underline-offset-2"
                      >
                        View task
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            ))}
            {activity.data?.length === 0 && (
              <li className="py-6 text-sm text-muted">
                Activity will appear here as your team gets moving.
              </li>
            )}
          </ul>
        </section>
      </div>
      {org && (
        <section className="panel space-y-3">
          <div>
            <h2 className="font-semibold">
              Organization members ({members.data?.length ?? 0})
            </h2>
            <p className="mt-1 text-sm text-muted">
              People and access levels for this workspace.
            </p>
          </div>
          {members.data?.length ? (
            <ul className="divide-y divide-line">
              {members.data.map((member) => {
                const manageable =
                  canManage(role) &&
                  member.role !== "OWNER" &&
                  (role === "OWNER" ||
                    member.role === "MEMBER" ||
                    member.role === "VIEWER");
                return (
                  <li
                    key={member.id}
                    className="flex flex-wrap items-center gap-3 py-3 text-sm"
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent"
                    >
                      {initials(member.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{member.name}</p>
                      <p className="break-all text-xs text-muted">
                        {member.email}
                      </p>
                    </div>
                    <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-ink">
                      {roleLabel(member.role)}
                    </span>
                    {manageable && (
                      <div className="flex items-center gap-2">
                        <label
                          className="sr-only"
                          htmlFor={`member-role-${member.id}`}
                        >
                          {member.name} role
                        </label>
                        <select
                          id={`member-role-${member.id}`}
                          className="input ml-auto w-auto"
                          value={member.role}
                          disabled={changeMemberRole.isPending}
                          onChange={(event) =>
                            changeMemberRole.mutate({
                              id: member.id,
                              role: event.target.value as OrgMember["role"],
                            })
                          }
                        >
                          {role === "OWNER" && (
                            <option value="ADMIN">Admin</option>
                          )}
                          <option value="MEMBER">Member</option>
                          <option value="VIEWER">Viewer</option>
                        </select>
                        <button
                          className="min-h-10 rounded-md border border-line px-3 py-1.5"
                          type="button"
                          onClick={() => setMemberPendingRemoval(member)}
                          disabled={removeMember.isPending}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm">No members yet.</p>
          )}
          {canManage(role) && (
            <div className="border-t border-line pt-3">
              <button
                type="button"
                className="min-h-10 rounded-md px-2 font-medium text-accent underline-offset-4 hover:underline"
                aria-expanded={invitePanelOpen}
                aria-controls="invite-member-form"
                onClick={() => setInvitePanelOpen((open) => !open)}
              >
                {invitePanelOpen ? "Close invitation form" : "Invite member"}
              </button>
              {invitePanelOpen && (
                <form
                  id="invite-member-form"
                  className="mt-3 flex flex-wrap items-end gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setMemberFeedback("");
                    inviteMember.mutate();
                  }}
                >
                  <label className="block space-y-1 text-sm">
                    <span>Email</span>
                    <input
                      className="input"
                      type="email"
                      placeholder="Member email"
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      required
                    />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>Role</span>
                    <select
                      aria-label="Invitation role"
                      className="input w-auto"
                      value={inviteRole}
                      onChange={(event) =>
                        setInviteRole(
                          event.target.value as "ADMIN" | "MEMBER" | "VIEWER",
                        )
                      }
                    >
                      {role === "OWNER" && <option value="ADMIN">Admin</option>}
                      <option value="MEMBER">Member</option>
                      <option value="VIEWER">Viewer</option>
                    </select>
                  </label>
                  <button
                    className="btn shrink-0 whitespace-nowrap"
                    disabled={inviteMember.isPending}
                  >
                    {inviteMember.isPending ? "Inviting…" : "Send invitation"}
                  </button>
                  {inviteMember.isError && (
                    <p role="alert" className="w-full text-sm text-danger">
                      {errorMessage(inviteMember.error)}
                    </p>
                  )}
                </form>
              )}
            </div>
          )}
          {memberFeedback && (
            <p role="status" className="text-sm text-green-700">
              {memberFeedback}
            </p>
          )}
          {(changeMemberRole.isError || removeMember.isError) && (
            <p role="alert" className="text-sm text-warn">
              {errorMessage(changeMemberRole.error || removeMember.error)}
            </p>
          )}
        </section>
      )}
      {projectModalOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink/35 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setProjectModalOpen(false);
            }
          }}
        >
          <section
            aria-labelledby="new-project-title"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-modal"
            role="dialog"
          >
            <h2
              id="new-project-title"
              className="page-title text-xl font-semibold"
            >
              New project
            </h2>
            <form
              className="mt-4 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                createProject.mutate();
              }}
            >
              <label className="block space-y-1 text-sm">
                <span>Project name</span>
                <input
                  autoFocus
                  className="input w-full"
                  placeholder="Project name"
                  value={pname}
                  onChange={(event) => setPname(event.target.value)}
                  required
                />
              </label>
              {createProject.isError && (
                <p role="alert" className="text-sm text-danger">
                  {errorMessage(createProject.error)}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  className="min-h-10 rounded-md border border-line px-4"
                  type="button"
                  onClick={() => setProjectModalOpen(false)}
                >
                  Cancel
                </button>
                <button className="btn" disabled={createProject.isPending}>
                  {createProject.isPending ? "Creating…" : "Create project"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {memberPendingRemoval && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/35 p-4">
          <section
            aria-labelledby="remove-member-title"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-modal"
            role="alertdialog"
          >
            <h2 id="remove-member-title" className="font-semibold">
              Remove {memberPendingRemoval.name}?
            </h2>
            <p className="mt-2 text-sm text-muted">
              They will lose access to this organization and its projects.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="min-h-10 rounded-md border border-line px-4"
                type="button"
                onClick={() => setMemberPendingRemoval(null)}
              >
                Cancel
              </button>
              <button
                className="min-h-10 rounded-md bg-danger px-4 font-medium text-white"
                type="button"
                disabled={removeMember.isPending}
                onClick={() => removeMember.mutate(memberPendingRemoval.id)}
              >
                {removeMember.isPending ? "Removing…" : "Remove member"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
