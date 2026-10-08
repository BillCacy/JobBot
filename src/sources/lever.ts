import type { CompanyBoard, Job } from "../schemas.js";
import { REMOTE_RE, fetchJson, htmlToText, parseSalaryRange } from "./util.js";

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl: string;
  createdAt?: number;
  workplaceType?: string;
  categories?: { location?: string; allLocations?: string[]; commitment?: string; team?: string };
  descriptionPlain?: string;
  additionalPlain?: string;
  lists?: { text: string; content: string }[];
  salaryRange?: { min?: number; max?: number; interval?: string };
}

export async function fetchLever(board: CompanyBoard): Promise<Job[]> {
  const postings = await fetchJson<LeverPosting[]>(
    `https://api.lever.co/v0/postings/${encodeURIComponent(board.slug)}?mode=json`,
  );
  const now = new Date().toISOString();
  return postings.map((p) => {
    const lists = (p.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`).join("\n\n");
    const description = [p.descriptionPlain, lists, p.additionalPlain].filter(Boolean).join("\n\n").trim();
    const location = p.categories?.allLocations?.join(" / ") ?? p.categories?.location ?? "";
    const annual = p.salaryRange && (!p.salaryRange.interval || /year|annual/i.test(p.salaryRange.interval));
    const salary = annual ? { min: p.salaryRange!.min, max: p.salaryRange!.max } : parseSalaryRange(description);
    return {
      id: `lever:${board.slug}:${p.id}`,
      source: "lever",
      company: board.name ?? board.slug,
      companySlug: board.slug,
      externalId: p.id,
      title: p.text,
      location,
      remote: p.workplaceType === "remote" || REMOTE_RE.test(location),
      url: p.hostedUrl,
      applyUrl: p.applyUrl,
      description,
      salaryMin: salary.min,
      salaryMax: salary.max,
      updatedAt: p.createdAt ? new Date(p.createdAt).toISOString() : undefined,
      firstSeenAt: now,
    } satisfies Job;
  });
}
