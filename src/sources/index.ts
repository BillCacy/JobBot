import type { CompanyBoard, Criteria, Job } from "../schemas.js";
import { fetchAshby } from "./ashby.js";
import { fetchGreenhouse } from "./greenhouse.js";
import { fetchLever } from "./lever.js";

const FETCHERS = { greenhouse: fetchGreenhouse, lever: fetchLever, ashby: fetchAshby } as const;

export async function fetchBoards(boards: CompanyBoard[]) {
  const results = await Promise.allSettled(boards.map((b) => FETCHERS[b.source](b)));
  const jobs: Job[] = [];
  const errors: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") jobs.push(...r.value);
    else errors.push(`${boards[i].source}/${boards[i].slug}: ${(r.reason as Error).message}`);
  });
  return { jobs, errors };
}

const includesAny = (haystack: string, needles: string[]) => {
  const h = haystack.toLowerCase();
  return needles.some((n) => h.includes(n.toLowerCase()));
};

const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
/** Whole-word match, so "US" matches "Remote, US" but not "Austin". */
const includesWords = (haystack: string, needles: string[]) => needles.some((n) => words(haystack).includes(words(n)));

/** Applies the hard filters from the criteria. Returns the reason a job was rejected, or null if it passes. */
export function rejectReason(job: Job, c: Criteria): string | null {
  if (c.titles.length && !includesAny(job.title, c.titles)) return "title";
  if (c.excludeKeywords.length && includesAny(`${job.title}\n${job.description}`, c.excludeKeywords)) return "excluded keyword";
  if (c.includeKeywords.length && !includesAny(`${job.title}\n${job.description}`, c.includeKeywords)) return "missing keyword";
  if (c.remoteOnly && !job.remote) return "not remote";
  if (c.locations.length) {
    const locOk = includesWords(job.location, c.locations);
    if (c.remoteOnly) {
      // A bare "Remote" passes; "Remote - UK" must still match an acceptable location.
      const beyondRemote = job.location.replace(/remote/gi, "").replace(/[^a-z0-9]/gi, "");
      if (beyondRemote && !locOk) return "location";
    } else if (!locOk && !(c.remoteOk && job.remote)) return "location";
  }
  if (c.minSalary && job.salaryMax && job.salaryMax < c.minSalary) return "salary";
  if (c.maxAgeDays && job.updatedAt) {
    const ageDays = (Date.now() - Date.parse(job.updatedAt)) / 86_400_000;
    if (ageDays > c.maxAgeDays) return "too old";
  }
  return null;
}
