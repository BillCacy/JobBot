import type { CompanyBoard, Job } from "../schemas.js";
import { REMOTE_RE, fetchJson, parseSalaryRange } from "./util.js";

interface AshbyComponent {
  compensationType: string;
  interval?: string;
  minValue?: number | null;
  maxValue?: number | null;
}

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  secondaryLocations?: { location?: string }[];
  isRemote?: boolean;
  workplaceType?: string;
  isListed?: boolean;
  publishedAt?: string;
  jobUrl: string;
  applyUrl: string;
  descriptionPlain?: string;
  compensation?: {
    scrapeableCompensationSalarySummary?: string;
    compensationTiers?: { components?: AshbyComponent[] }[];
  };
}

function ashbySalary(job: AshbyJob): { min?: number; max?: number } {
  const salaries = (job.compensation?.compensationTiers ?? [])
    .flatMap((t) => t.components ?? [])
    .filter((c) => c.compensationType === "Salary" && /year/i.test(c.interval ?? ""));
  const mins = salaries.map((c) => c.minValue).filter((v): v is number => typeof v === "number");
  const maxes = salaries.map((c) => c.maxValue).filter((v): v is number => typeof v === "number");
  if (mins.length || maxes.length) {
    return { min: mins.length ? Math.min(...mins) : undefined, max: maxes.length ? Math.max(...maxes) : undefined };
  }
  return parseSalaryRange(job.compensation?.scrapeableCompensationSalarySummary ?? "");
}

export async function fetchAshby(board: CompanyBoard): Promise<Job[]> {
  const data = await fetchJson<{ jobs: AshbyJob[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.slug)}?includeCompensation=true`,
  );
  const now = new Date().toISOString();
  return data.jobs
    .filter((j) => j.isListed !== false)
    .map((j) => {
      const location = [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)]
        .filter(Boolean)
        .join(" / ");
      const salary = ashbySalary(j);
      return {
        id: `ashby:${board.slug}:${j.id}`,
        source: "ashby",
        company: board.name ?? board.slug,
        companySlug: board.slug,
        externalId: j.id,
        title: j.title,
        location,
        remote: Boolean(j.isRemote) || j.workplaceType === "Remote" || REMOTE_RE.test(location),
        url: j.jobUrl,
        applyUrl: j.applyUrl,
        description: j.descriptionPlain ?? "",
        salaryMin: salary.min,
        salaryMax: salary.max,
        updatedAt: j.publishedAt,
        firstSeenAt: now,
      } satisfies Job;
    });
}
