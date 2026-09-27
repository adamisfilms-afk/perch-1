import { redirect } from "next/navigation";

/** The metrics moved to the dashboard in the new workspace. */
export default async function Metrics({ searchParams }: PageProps<"/metrics">) {
  const { days } = await searchParams;
  redirect(typeof days === "string" ? `/dashboard?days=${encodeURIComponent(days)}` : "/dashboard");
}
