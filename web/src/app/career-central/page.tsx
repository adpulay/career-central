import { readCareerCentralOverview } from "@/lib/career-central/server";
import { CareerCentralOverview } from "@/components/career-central/overview";
import { JobMonitor } from "@/components/career-central/job-monitor";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function CareerCentralPage() {
  return <><CareerCentralOverview overview={await readCareerCentralOverview()} /><JobMonitor /></>;
}
