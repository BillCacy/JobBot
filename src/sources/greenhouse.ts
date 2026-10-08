import type { CompanyBoard, Job } from "../schemas.js";
import { REMOTE_RE, fetchJson, htmlToText, parseSalaryRange } from "./util.js";

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  updated_at?: string;
  company_name?: string;
  location?: { name?: string };
  content?: string;
}

export async function fetchGreenhouse(board: CompanyBoard): Promise<Job[]> {
  const data = await fetchJson<{ jobs: GreenhouseJob[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.slug)}/jobs?content=true`,
  );
  const now = new Date().toISOString();
  return data.jobs.map((j) => {
    const description = htmlToText(j.content ?? "");
    const location = j.location?.name ?? "";
    const salary = parseSalaryRange(description);
    // absolute_url often redirects to the company site with the form in an iframe; the embed URL is the bare form.
    const applyUrl = `https://job-boards.greenhouse.io/embed/job_app?for=${board.slug}&token=${j.id}`;
    return {
      id: `greenhouse:${board.slug}:${j.id}`,
      source: "greenhouse",
      company: board.name ?? j.company_name ?? board.slug,
      companySlug: board.slug,
      externalId: String(j.id),
      title: j.title,
      location,
      remote: REMOTE_RE.test(location) || REMOTE_RE.test(j.title),
      url: j.absolute_url,
      applyUrl,
      description,
      salaryMin: salary.min,
      salaryMax: salary.max,
      updatedAt: j.updated_at,
      firstSeenAt: now,
    } satisfies Job;
  });
}
