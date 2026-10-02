"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  canManage,
  clearSession,
  errorMessage,
  Org,
  OrgMember,
  setOrganization,
} from "@/lib/api";

export default function Dashboard() {
  const qc = useQueryClient(),
    router = useRouter();
  const [org, setOrg] = useState<string>(""),
    [name, setName] = useState(""),
    [pname, setPname] = useState(""),
    [inviteEmail, setInviteEmail] = useState(""),
    [inviteRole, setInviteRole] = useState<"ADMIN" | "MEMBER" | "VIEWER">(
      "MEMBER",
    ),
    [memberFeedback, setMemberFeedback] = useState("");
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
  const projects = useQuery({
    queryKey: ["projects", org],
    queryFn: () => api("/api/projects/?ordering=-created_at"),
    enabled: !!org,
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
      qc.invalidateQueries({ queryKey: ["projects"] });
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
      await qc.invalidateQueries({ queryKey: ["members", org] });
    },
  });
  const s = stats.data;
  const cards: [string, number | undefined][] = [
    ["Projects", s?.total_projects],
    ["Tasks", s?.total_tasks],
    ["Assigned to me", s?.assigned_to_me],
    ["Completed", s?.completed],
    ["Overdue", s?.overdue],
  ];
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <select
          aria-label="Organization"
          className="input w-auto"
          value={org}
          onChange={(e) => pick(e.target.value)}
        >
          {orgs.data?.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} ({o.role.toLowerCase()})
            </option>
          ))}
        </select>
        <button
          className="btn ml-auto"
          onClick={() => {
            clearSession();
            router.push("/login");
          }}
        >
          Log out
        </button>
      </header>
      {orgs.data && (orgs.data.length === 0 || (!!org && canManage(role))) && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            createOrg.mutate();
          }}
        >
          <input
            className="input max-w-xs"
            placeholder="New organization name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <button className="btn" disabled={createOrg.isPending}>
            Create organization
          </button>
          {createOrg.isError && (
            <p role="alert" className="text-sm text-warn">
              {errorMessage(createOrg.error)}
            </p>
          )}
        </form>
      )}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {cards.map(([l, v]) => (
          <div key={l} className="panel">
            <p className="text-2xl font-semibold">{v ?? "–"}</p>
            <p className="text-sm">{l}</p>
          </div>
        ))}
      </section>
      <div className="grid gap-6 md:grid-cols-2">
        <section className="panel">
          <h2 className="mb-3 font-semibold">Projects</h2>
          {canManage(role) && (
            <form
              className="mb-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                createProject.mutate();
              }}
            >
              <input
                className="input"
                placeholder="New project name"
                value={pname}
                onChange={(e) => setPname(e.target.value)}
                required
              />
              <button className="btn">Add project</button>
            </form>
          )}
          {createProject.isError && (
            <p role="alert" className="text-sm text-warn">
              {errorMessage(createProject.error)}
            </p>
          )}
          <ul className="space-y-1">
            {projects.data?.results.map((p: any) => (
              <li key={p.id}>
                <Link className="underline" href={`/projects/${p.id}`}>
                  {p.name}
                </Link>
              </li>
            ))}
            {projects.data?.results.length === 0 && (
              <li className="text-sm">
                No projects yet.{" "}
                {canManage(role)
                  ? "Add your first one above."
                  : "Ask an admin to add one."}
              </li>
            )}
          </ul>
        </section>
        <section className="panel">
          <h2 className="mb-3 font-semibold">Recent activity</h2>
          <ul className="space-y-1 text-sm">
            {activity.data?.map((a: any) => (
              <li key={a.id}>{a.message}</li>
            ))}
            {activity.data?.length === 0 && <li>Nothing has happened yet.</li>}
          </ul>
        </section>
      </div>
      {org && (
        <section className="panel space-y-3">
          <h2 className="font-semibold">
            Organization members ({members.data?.length ?? 0})
          </h2>
          {members.data?.length ? (
            <ul className="space-y-2">
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
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <span className="font-medium">{member.name}</span>
                    <span className="text-muted">{member.email}</span>
                    <span className="rounded-full bg-line px-2 py-0.5 text-xs font-medium">
                      {member.role}
                    </span>
                    {manageable && (
                      <>
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
                          onChange={(event) =>
                            changeMemberRole.mutate({
                              id: member.id,
                              role: event.target.value as OrgMember["role"],
                            })
                          }
                        >
                          {role === "OWNER" && (
                            <option value="ADMIN">ADMIN</option>
                          )}
                          <option value="MEMBER">MEMBER</option>
                          <option value="VIEWER">VIEWER</option>
                        </select>
                        <button
                          className="rounded-md border border-line px-3 py-1.5"
                          type="button"
                          onClick={() => removeMember.mutate(member.id)}
                          disabled={removeMember.isPending}
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm">No members yet.</p>
          )}
          {canManage(role) && (
            <form
              className="flex flex-wrap items-end gap-2"
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
                  {role === "OWNER" && <option value="ADMIN">ADMIN</option>}
                  <option value="MEMBER">MEMBER</option>
                  <option value="VIEWER">VIEWER</option>
                </select>
              </label>
              <button className="btn" disabled={inviteMember.isPending}>
                {inviteMember.isPending ? "Inviting…" : "Invite member"}
              </button>
              {inviteMember.isError && (
                <p role="alert" className="w-full text-sm text-warn">
                  {errorMessage(inviteMember.error)}
                </p>
              )}
            </form>
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
    </main>
  );
}
