import { readCareerCentralOverview } from "@/lib/career-central/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const overview = await readCareerCentralOverview();
  return Response.json(overview, {
    status: overview.available ? 200 : 503,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
