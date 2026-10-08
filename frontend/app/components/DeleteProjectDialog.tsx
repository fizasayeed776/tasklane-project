"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefObject } from "react";
import { useState } from "react";
import { api, errorMessage, Project, Task } from "@/lib/api";
import AccessibleDialog from "./AccessibleDialog";
import { useToast } from "./ToastProvider";

export default function DeleteProjectDialog({
  project,
  taskCount,
  onArchiveInstead,
  onClose,
  returnFocusRef,
}: {
  project: Pick<Project, "id" | "name">;
  taskCount?: number;
  onArchiveInstead?: () => void;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirmation, setConfirmation] = useState("");
  const remove = useMutation({
    mutationFn: () => api(`/api/projects/${project.id}/`, { method: "DELETE" }),
    onSuccess: async () => {
      const taskIds = new Set<number>();
      for (const [, task] of queryClient.getQueriesData<Task>({
        queryKey: ["task"],
      })) {
        if (task?.project === project.id) taskIds.add(task.id);
      }
      for (const [, data] of queryClient.getQueriesData<{ results: Task[] }>({
        queryKey: ["tasks"],
      })) {
        data?.results.forEach((task) => {
          if (task.project === project.id) taskIds.add(task.id);
        });
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["stats"] }),
        queryClient.invalidateQueries({ queryKey: ["activity"] }),
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      ]);

      queryClient.removeQueries({
        queryKey: ["project", String(project.id)],
      });
      queryClient.removeQueries({
        queryKey: ["tasks", String(project.id)],
      });
      queryClient.removeQueries({
        predicate: (query) =>
          query.queryKey[0] === "project-task-summary" &&
          query.queryKey[2] === project.id,
      });
      for (const taskId of taskIds) {
        queryClient.removeQueries({ queryKey: ["task", String(taskId)] });
        queryClient.removeQueries({ queryKey: ["comments", String(taskId)] });
        queryClient.removeQueries({
          queryKey: ["task-activity", String(taskId)],
        });
      }

      toast("success", "Project deleted.");
      onClose();
      router.push("/dashboard");
    },
  });

  return (
    <AccessibleDialog
      labelledBy="delete-project-title"
      className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-xl border border-line bg-surface p-6 shadow-modal"
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      role="alertdialog"
    >
      <h2 id="delete-project-title" className="font-semibold text-danger">
        Delete project?
      </h2>
      <p className="mt-2 text-sm text-muted">
        {taskCount === undefined
          ? `“${project.name}” and its tasks, comments, and activity will be permanently deleted.`
          : `“${project.name}” and its ${taskCount} ${taskCount === 1 ? "task" : "tasks"}, comments, and activity will be permanently deleted.`}{" "}
        Archiving is reversible.
      </p>
      <label className="mt-4 block space-y-1 text-sm">
        <span>
          Type <strong>{project.name}</strong> to confirm
        </span>
        <input
          className="input w-full"
          aria-label="Project name confirmation"
          autoComplete="off"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </label>
      <div className="mt-2 text-sm">
        {onArchiveInstead ? (
          <button
            type="button"
            className="text-accent underline underline-offset-2"
            onClick={onArchiveInstead}
          >
            Archive instead
          </button>
        ) : (
          <Link
            className="text-accent underline underline-offset-2"
            href={`/projects/${project.id}`}
          >
            Open project to archive instead
          </Link>
        )}
      </div>
      {remove.isError && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {errorMessage(remove.error)}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button
          className="min-h-10 rounded-md border border-line px-4"
          type="button"
          disabled={remove.isPending}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="min-h-10 rounded-md bg-danger px-4 font-medium text-white disabled:opacity-50"
          type="button"
          disabled={confirmation !== project.name || remove.isPending}
          onClick={() => remove.mutate()}
        >
          {remove.isPending ? "Deleting…" : "Delete project"}
        </button>
      </div>
    </AccessibleDialog>
  );
}
