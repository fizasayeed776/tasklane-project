import type { Metadata } from "next";
import { Suspense } from "react";
import ProjectClient from "./ProjectClient";
import ProjectLoading from "./loading";

type ProjectPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: ProjectPageProps): Promise<Metadata> {
  await params;
  return { title: "Project | Tasklane" };
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<ProjectLoading />}>
      <ProjectClient id={id} />
    </Suspense>
  );
}
