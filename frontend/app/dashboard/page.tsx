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
  setOrganization,
} from "@/lib/api";

export default function Dashboard() {
  const qc = useQueryClient(),
    router = useRouter();
  const [org, setOrg] = useState<string>(""),
    [name, setName] = useState(""),
    [pname, setPname] = useState("");
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
    if (saved) setOrg(saved);
    else if (orgs.data?.[0]) pick(String(orgs.data[0].id));
  }, [orgs.data, pick]);
  const role = orgs.data?.find((o) => String(o.id) === org)?.role;
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
      <form
        className="flex gap-2"
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
        <button className="btn">Create organization</button>
        {createOrg.isError && (
          <p role="alert" className="text-sm text-warn">
            {errorMessage(createOrg.error)}
          </p>
        )}
      </form>
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
              {createProject.isError && (
                <p role="alert" className="text-sm text-warn">
                  {errorMessage(createProject.error)}
                </p>
              )}
            </form>
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
    </main>
  );
}
