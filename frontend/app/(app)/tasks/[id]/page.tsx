import type { Metadata } from "next";
import { Suspense } from "react";
import TaskClient from "./TaskClient";
import TaskLoading from "./loading";

type TaskPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: TaskPageProps): Promise<Metadata> {
  await params;
  return { title: "Task | Tasklane" };
}

export default async function TaskPage({ params }: TaskPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<TaskLoading />}>
      <TaskClient id={id} />
    </Suspense>
  );
}
