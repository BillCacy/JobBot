#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { planAutofill } from "./browser/autofill.js";
import { CONFIRMATION_RE, fillField, findSubmitButton, scanFields, screenshotForm, type FormField } from "./browser/fields.js";
import type { Page } from "playwright";
import { closeApplicationPage, closePage, getApplicationPage, openApplicationPage, openPage, probeUrl, shutdownBrowser } from "./browser/session.js";
import { BOARDS, LoginBoardSchema, looksSignedOut } from "./boards.js";
import { extractResumeText } from "./resume.js";
import {
  ApplicationStatusSchema,
  BoardSourceSchema,
  CompanyBoardSchema,
  CriteriaSchema,
  ProfileSchema,
  isAtsSource,
  type Application,
  type Job,
  type Profile,
} from "./schemas.js";
import { fetchBoards, rejectReason } from "./sources/index.js";
import { parseSalaryRange } from "./sources/util.js";
import { DATA_DIR, SCREENSHOT_DIR, store } from "./store.js";

const server = new McpServer(
  { name: "jobbot", version: "0.1.0" },
  {
    instructions: [
      "JobBot turns a resume into a stored profile, finds matching jobs on Greenhouse/Lever/Ashby boards (and imports jobs found on Dice/Indeed/ZipRecruiter via jobs_import), and pre-fills applications in a visible browser.",
      "Job-board jobs (Dice/Indeed/ZipRecruiter/Monster): application_prepare opens the posting and the user clicks Apply themselves; application_autofill can then fill an employer form they land on. Sign-in is done by the user via board_login; never ask for passwords.",
      "Typical flow: resume_read -> profile_save -> answers_set -> criteria_set/boards_add -> jobs_search -> job_get + job_score -> application_prepare -> application_fill -> application_submit.",
      "Never invent facts about the candidate. If a form question isn't covered by the profile or stored answers, ask the user, then store the answer with answers_set for next time.",
      "Applications are only submitted after the user explicitly approves in the approval prompt, or by the user clicking Submit in the browser themselves.",
    ].join("\n"),
  },
);

const json = (data: unknown): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });

const jobSummary = (j: Job) => ({
  jobId: j.id,
  source: j.source,
  company: j.company,
  title: j.title,
  location: j.location,
  remote: j.remote,
  salary: j.salaryMin || j.salaryMax ? `${j.salaryMin ?? "?"}-${j.salaryMax ?? "?"}` : undefined,
  score: j.score,
  updatedAt: j.updatedAt?.slice(0, 10),
  url: j.url,
  easyApply: j.easyApply,
  employerType: j.employerType,
  application: store.findApplicationForJob(j.id)?.status,
});

// ---------- Profile ----------

server.registerTool(
  "resume_read",
  {
    title: "Read resume",
    description:
      "Extract text from a resume file (.pdf, .docx, .txt, .md). Then build a profile from the text and save it with profile_save (include resumePath so it can be uploaded to applications).",
    inputSchema: { path: z.string().describe("Absolute path to the resume file") },
  },
  async ({ path }) => {
    const full = resolve(path);
    const text = await extractResumeText(full);
    return json({ resumePath: full, characters: text.length, text });
  },
);

server.registerTool(
  "profile_save",
  {
    title: "Save profile",
    description: "Save (replace) the candidate profile. Show the user the extracted profile and fix anything they correct.",
    inputSchema: { profile: ProfileSchema },
  },
  async ({ profile }) => {
    if (profile.resumePath && !existsSync(profile.resumePath)) throw new Error(`resumePath not found: ${profile.resumePath}`);
    store.setProfile(profile);
    return json({ saved: true, profile });
  },
);

server.registerTool(
  "profile_get",
  {
    title: "Get profile",
    description: "Get the stored profile, the answer bank for common application questions, and the search criteria.",
    inputSchema: {},
  },
  async () => json({ profile: store.getProfile() ?? null, answers: store.getAnswers(), criteria: store.getCriteria() ?? null }),
);

server.registerTool(
  "answers_set",
  {
    title: "Set common answers",
    description:
      "Store reusable answers to common application questions, keyed by a short question label that will be matched against form labels. " +
      "Examples: 'legally authorized to work': 'Yes', 'require sponsorship': 'No', 'salary expectations': '$150,000', 'how did you hear': 'Company website', " +
      "'gender': 'Decline to self-identify'. Only store answers the user has given you.",
    inputSchema: {
      answers: z.record(z.string(), z.string()),
      replace: z.boolean().default(false).describe("Replace the whole bank instead of merging"),
    },
  },
  async ({ answers, replace }) => json({ answers: store.setAnswers(answers, replace) }),
);

// ---------- Criteria & boards ----------

server.registerTool(
  "criteria_set",
  {
    title: "Set search criteria",
    description: "Update job search criteria. Only the fields you pass are changed.",
    inputSchema: CriteriaSchema.partial().shape,
  },
  async (patch) => {
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const criteria = CriteriaSchema.parse({ ...(store.getCriteria() ?? {}), ...defined });
    store.setCriteria(criteria);
    return json({ criteria });
  },
);

server.registerTool(
  "boards_add",
  {
    title: "Add company job boards",
    description:
      "Validate and add company job boards to search. The slug is the company's board token, e.g. greenhouse 'airbnb' (job-boards.greenhouse.io/airbnb), " +
      "lever 'spotify' (jobs.lever.co/spotify), ashby 'ramp' (jobs.ashbyhq.com/ramp). Invalid boards are reported, not added.",
    inputSchema: { boards: z.array(CompanyBoardSchema).min(1) },
  },
  async ({ boards }) => {
    const criteria = CriteriaSchema.parse(store.getCriteria() ?? {});
    const results = await Promise.all(
      boards.map(async (b) => {
        const { jobs, errors } = await fetchBoards([b]);
        return { board: b, ok: errors.length === 0, jobCount: jobs.length, error: errors[0] };
      }),
    );
    const key = (b: { source: string; slug: string }) => `${b.source}:${b.slug.toLowerCase()}`;
    const existing = new Set(criteria.companies.map(key));
    for (const r of results) if (r.ok && !existing.has(key(r.board))) criteria.companies.push(r.board);
    store.setCriteria(criteria);
    return json({ results, companies: criteria.companies });
  },
);

// ---------- Jobs ----------

server.registerTool(
  "jobs_search",
  {
    title: "Search jobs",
    description:
      "Fetch postings from the configured boards (refresh=true) and return the ones that pass the criteria filters, best-scored first. " +
      "Unscored jobs should be read with job_get and scored with job_score against the profile.",
    inputSchema: {
      refresh: z.boolean().default(true).describe("Re-fetch boards; false lists stored jobs only"),
      minScore: z.number().optional().describe("Only jobs scored at least this"),
      unscoredOnly: z.boolean().default(false),
      includeApplied: z.boolean().default(false),
      limit: z.number().int().min(1).max(200).default(50),
    },
  },
  async ({ refresh, minScore, unscoredOnly, includeApplied, limit }) => {
    const criteria = store.getCriteria();
    if (!criteria) throw new Error("No criteria yet. Call criteria_set and boards_add first.");
    let fetched: { added: number; total: number; errors: string[] } | undefined;
    if (refresh) {
      if (!criteria.companies.length) throw new Error("No company boards configured. Call boards_add first.");
      const { jobs, errors } = await fetchBoards(criteria.companies);
      fetched = { added: store.upsertJobs(jobs), total: jobs.length, errors };
    }
    const rejected: Record<string, number> = {};
    const matches = store.listJobs().filter((j) => {
      if (j.dismissed) return false;
      if (!includeApplied && store.findApplicationForJob(j.id)) return false;
      if (unscoredOnly && j.score !== undefined) return false;
      if (minScore !== undefined && (j.score ?? -1) < minScore) return false;
      const reason = rejectReason(j, criteria);
      if (reason) rejected[reason] = (rejected[reason] ?? 0) + 1;
      return !reason;
    });
    matches.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    return json({ fetched, matched: matches.length, rejectedByFilter: rejected, jobs: matches.slice(0, limit).map(jobSummary) });
  },
);

server.registerTool(
  "job_get",
  {
    title: "Get job details",
    description: "Full job posting including description.",
    inputSchema: { jobId: z.string() },
  },
  async ({ jobId }) => {
    const job = store.getJob(jobId);
    if (!job) throw new Error(`Unknown job ${jobId}`);
    return json({ ...jobSummary(job), applyUrl: job.applyUrl, scoreReasoning: job.scoreReasoning, description: job.description.slice(0, 20_000) });
  },
);

server.registerTool(
  "job_score",
  {
    title: "Score jobs",
    description:
      "Record how well jobs fit the candidate (0-100) with a one-to-two sentence reason. Base it on the profile: skills, seniority, domain, and stated criteria.",
    inputSchema: {
      scores: z.array(z.object({ jobId: z.string(), score: z.number().min(0).max(100), reasoning: z.string() })).min(1),
    },
  },
  async ({ scores }) => {
    for (const s of scores) store.updateJob(s.jobId, { score: s.score, scoreReasoning: s.reasoning });
    return json({ updated: scores.length });
  },
);

server.registerTool(
  "job_dismiss",
  {
    title: "Dismiss job",
    description: "Hide a job from future searches.",
    inputSchema: { jobId: z.string(), reason: z.string().optional() },
  },
  async ({ jobId, reason }) => {
    store.updateJob(jobId, { dismissed: true, scoreReasoning: reason ?? store.getJob(jobId)?.scoreReasoning });
    return json({ dismissed: jobId });
  },
);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

server.registerTool(
  "jobs_import",
  {
    title: "Import jobs from a job board",
    description:
      "Add jobs found with the Dice, Indeed, or ZipRecruiter connectors (or pasted from Monster/elsewhere) to JobBot so they're filtered, scored and tracked " +
      "with the rest. Map each result's fields; use the board's job id as externalId and its posting URL as url. Include the full description when you have it " +
      "(e.g. from the connector's get_job_details) so scoring is accurate. Returns which imported jobs pass the criteria filters.",
    inputSchema: {
      jobs: z
        .array(
          z.object({
            source: BoardSourceSchema,
            externalId: z.string(),
            title: z.string(),
            company: z.string(),
            location: z.string().default(""),
            remote: z.boolean().default(false),
            url: z.string().describe("The posting's page on the board"),
            applyUrl: z.string().optional().describe("Direct apply link if the board gives one"),
            description: z.string().default(""),
            salaryText: z.string().optional().describe("Salary as shown, e.g. '$190000 - $230000'; hourly rates are ignored"),
            salaryMin: z.number().optional(),
            salaryMax: z.number().optional(),
            postedAt: z.string().optional(),
            employmentType: z.string().optional(),
            employerType: z.string().optional(),
            easyApply: z.boolean().optional(),
          }),
        )
        .min(1),
    },
  },
  async ({ jobs }) => {
    const now = new Date().toISOString();
    const existing = store.listJobs();
    const duplicates: { title: string; company: string; existingJobId: string }[] = [];
    const incoming: Job[] = [];
    for (const j of jobs) {
      const id = `${j.source}:${j.externalId}`;
      // The same role is often on several boards (or the employer's own ATS); keep one copy.
      const dup = [...existing, ...incoming].find((e) => e.id !== id && norm(e.company) === norm(j.company) && norm(e.title) === norm(j.title));
      if (dup) {
        duplicates.push({ title: j.title, company: j.company, existingJobId: dup.id });
        continue;
      }
      const parsed = j.salaryText ? parseSalaryRange(j.salaryText) : {};
      incoming.push({
        id,
        source: j.source,
        company: j.company,
        companySlug: norm(j.company).replace(/ /g, "-"),
        externalId: j.externalId,
        title: j.title,
        location: j.location || (j.remote ? "Remote" : ""),
        remote: j.remote,
        url: j.url,
        applyUrl: j.applyUrl ?? j.url,
        description: j.description,
        salaryMin: j.salaryMin ?? parsed.min,
        salaryMax: j.salaryMax ?? parsed.max,
        updatedAt: j.postedAt,
        firstSeenAt: now,
        employmentType: j.employmentType,
        employerType: j.employerType,
        easyApply: j.easyApply,
      });
    }
    const added = store.upsertJobs(incoming);
    const criteria = store.getCriteria();
    const results = incoming.map((j) => ({ ...jobSummary(store.getJob(j.id)!), rejectedBy: criteria ? rejectReason(j, criteria) ?? undefined : undefined }));
    return json({ added, updated: incoming.length - added, duplicates, jobs: results });
  },
);

// ---------- Job board sign-in ----------

server.registerTool(
  "board_login",
  {
    title: "Sign in to a job board",
    description:
      "Open a job board's sign-in page in JobBot's browser so the user can sign in themselves (including two-factor). Passwords are never stored or seen; " +
      "the board's session cookie stays in JobBot's browser profile so later postings open signed in. LinkedIn isn't supported. " +
      "Tell the user to sign in in the window, then call board_session_check.",
    inputSchema: { board: LoginBoardSchema },
  },
  async ({ board }) => {
    const b = BOARDS[board];
    const page = await openPage(`login:${board}`, b.loginUrl);
    return json({ board: b.name, openedUrl: page.url(), next: `Ask the user to sign in to ${b.name} in the JobBot browser window, then call board_session_check.` });
  },
);

server.registerTool(
  "board_session_check",
  {
    title: "Check job board sign-in",
    description: "Check whether JobBot's browser is signed in to job boards (loads each account page and sees whether it bounces to a login page).",
    inputSchema: { boards: z.array(LoginBoardSchema).optional().describe("Defaults to all supported boards") },
  },
  async ({ boards }) => {
    const list = boards ?? LoginBoardSchema.options;
    const results = [];
    for (const board of list) {
      try {
        const { finalUrl } = await probeUrl(BOARDS[board].accountUrl);
        results.push({ board, signedIn: !looksSignedOut(finalUrl), finalUrl });
      } catch (e) {
        results.push({ board, signedIn: false, error: (e as Error).message });
      }
    }
    for (const board of list) await closePage(`login:${board}`);
    return json({ results, note: "Heuristic check; if a board shows signed in here but asks to log in later, run board_login again." });
  },
);

// ---------- Applications ----------

const isRequiredOpen = (f: FormField) => f.required && !f.filled;

const PLACEHOLDER_OPTION = /^(select|choose|please select|--)/i;
const MAX_OPTIONS = 40;

/** Trims long option lists (e.g. every university) so reports stay readable; fills still fuzzy-match the full list. */
const compactField = (f: FormField) => {
  if (!f.options) return f;
  const options = f.options.filter((o) => !PLACEHOLDER_OPTION.test(o));
  return options.length > MAX_OPTIONS
    ? { ...f, options: options.slice(0, MAX_OPTIONS), optionCount: options.length, note: "Options truncated; pass the exact text you want" }
    : { ...f, options };
};

async function snapshot(app: Application) {
  const page = getApplicationPage(app.id);
  const fields = await scanFields(page);
  const shotPath = join(SCREENSHOT_DIR, `${app.id}.jpg`);
  const image = await screenshotForm(page, shotPath);
  app.screenshotPath = shotPath;
  store.upsertApplication(app);
  const open = fields.filter((f) => !f.filled);
  return {
    fields,
    image,
    report: {
      applicationId: app.id,
      status: app.status,
      screenshotPath: shotPath,
      requiredUnfilled: open.filter((f) => f.required).map(compactField),
      optionalUnfilled: open.filter((f) => !f.required).map(compactField),
      filled: fields.filter((f) => f.filled).map((f) => ({ id: f.id, label: f.label, value: f.kind === "textarea" ? `${f.value?.slice(0, 80)}…` : f.value })),
    },
  };
}

function withImage(data: unknown, image: Buffer): CallToolResult {
  const result = json(data);
  // Skip very large captures; the path is always in the report.
  if (image.length < 1_500_000) result.content.push({ type: "image", data: image.toString("base64"), mimeType: "image/jpeg" });
  return result;
}

const BOARD_HOST_RE = /(^|\.)(dice|indeed|ziprecruiter|monster|linkedin)\.com$/i;
const onBoardSite = (page: Page) => {
  try {
    return BOARD_HOST_RE.test(new URL(page.url()).hostname);
  } catch {
    return false;
  }
};

function writeCoverLetter(app: Application, job: Job, profile: Profile): string | undefined {
  if (!app.coverLetter) return undefined;
  const dir = join(DATA_DIR, "cover-letters");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${profile.firstName}_${profile.lastName}_Cover_Letter_${job.company}.txt`.replace(/[^\w.-]+/g, "_"));
  writeFileSync(path, app.coverLetter);
  return path;
}

/** Fills what the profile and answer bank cover on the page currently open for the application. */
async function autofillPage(app: Application, job: Job, profile: Profile, page: Page, resumePath?: string) {
  let fields = await scanFields(page);
  if (fields.length < 2) {
    // Some pages show the description first and reveal the form behind an Apply button.
    const apply = page.getByRole("button", { name: /^apply/i }).or(page.getByRole("link", { name: /^apply/i })).first();
    if (await apply.isVisible().catch(() => false)) {
      await apply.click();
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      fields = await scanFields(page);
    }
  }

  const plan = planAutofill(fields, {
    profile,
    answers: store.getAnswers(),
    resumePath: resumePath ?? profile.resumePath,
    coverLetter: app.coverLetter,
    coverLetterPath: writeCoverLetter(app, job, profile),
    source: job.source,
  });
  const autofilled: { label: string; result: string }[] = [];
  const errors: { label: string; error: string }[] = [];
  // Choice fields first: some forms re-render after a selection and wipe text typed earlier.
  const order: FormField["kind"][] = ["combobox", "select", "radio", "checkbox", "file", "text", "textarea"];
  const planned = fields
    .filter((f) => plan.has(f.id))
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    .map((f) => ({ field: f, value: plan.get(f.id)! }));
  for (const { field, value } of planned) {
    try {
      autofilled.push({ label: field.label, result: await fillField(page, field, value) });
      app.filledFields[field.label] = value;
    } catch (e) {
      errors.push({ label: field.label, error: (e as Error).message });
    }
  }
  // Verify: refill anything that got cleared (matched by label, since re-rendered fields get new ids).
  const failed = new Set(errors.map((e) => e.label));
  const after = await scanFields(page);
  for (const { field, value } of planned) {
    if (failed.has(field.label)) continue;
    const now = after.find((f) => f.label === field.label && f.kind === field.kind && !f.filled);
    if (now) await fillField(page, now, value).catch(() => {});
  }
  return { autofilled, errors };
}

const BOARD_INSTRUCTIONS =
  "The posting is open in JobBot's browser window. The user clicks Apply / Easy Apply themselves (board Easy Apply is not automated). " +
  "If Apply leads to an employer's own application form, call application_autofill to fill it, then application_fill for the rest. " +
  "The user submits; afterwards call application_mark with status 'submitted'. If the board asks the user to sign in, use board_login.";

server.registerTool(
  "application_prepare",
  {
    title: "Prepare application",
    description:
      "For Greenhouse/Lever/Ashby jobs: open the application form in a visible browser window and auto-fill what the profile and answer bank cover " +
      "(name, contact, links, resume upload, cover letter, known questions), returning the remaining fields with ids and a screenshot. " +
      "For jobs imported from Dice/Indeed/ZipRecruiter/Monster: open the posting for the user to click Apply themselves. Never submits.",
    inputSchema: {
      jobId: z.string(),
      coverLetter: z.string().optional().describe("Tailored cover letter text; uploaded as a file or pasted into a cover-letter box"),
      resumePath: z.string().optional().describe("Override the profile's resume file for this application"),
    },
  },
  async ({ jobId, coverLetter, resumePath }) => {
    const job = store.getJob(jobId);
    if (!job) throw new Error(`Unknown job ${jobId}`);
    const profile = store.getProfile();
    if (!profile) throw new Error("No profile yet. Call resume_read and profile_save first.");
    const prior = store.findApplicationForJob(jobId);
    if (prior && prior.status !== "prepared") throw new Error(`Already ${prior.status} (application ${prior.id}).`);

    const now = new Date().toISOString();
    const app: Application = prior ?? { id: `app_${randomUUID().slice(0, 8)}`, jobId, status: "prepared", createdAt: now, updatedAt: now, filledFields: {} };
    if (coverLetter) app.coverLetter = coverLetter;

    if (!isAtsSource(job.source)) {
      const page = await openApplicationPage(app.id, job.url);
      store.upsertApplication(app);
      const shotPath = join(SCREENSHOT_DIR, `${app.id}.jpg`);
      const image = await page.screenshot({ path: shotPath, type: "jpeg", quality: 60 });
      return withImage({ applicationId: app.id, job: jobSummary(job), openedUrl: page.url(), next: BOARD_INSTRUCTIONS }, image);
    }

    const page = await openApplicationPage(app.id, job.applyUrl);
    const { autofilled, errors } = await autofillPage(app, job, profile, page, resumePath);
    const { report, image } = await snapshot(app);
    return withImage({ job: jobSummary(job), applyUrl: job.applyUrl, autofilled, errors, ...report }, image);
  },
);

server.registerTool(
  "application_autofill",
  {
    title: "Autofill current form",
    description:
      "Auto-fill the form currently showing in an application's browser tab (e.g. the employer form the user reached after clicking Apply on a job board; " +
      "new tabs opened from it are followed). Refuses on job-board sites themselves, where Easy Apply stays manual. Never submits.",
    inputSchema: {
      applicationId: z.string(),
      coverLetter: z.string().optional(),
      resumePath: z.string().optional(),
    },
  },
  async ({ applicationId, coverLetter, resumePath }) => {
    const app = store.getApplication(applicationId);
    if (!app) throw new Error(`Unknown application ${applicationId}`);
    const job = store.getJob(app.jobId)!;
    const profile = store.getProfile();
    if (!profile) throw new Error("No profile yet.");
    const page = getApplicationPage(applicationId);
    if (onBoardSite(page)) {
      return json({
        autofilled: false,
        currentUrl: page.url(),
        reason: "This is the job board's own page. Easy Apply / 1-click apply is left to the user. Autofill works once Apply leads to the employer's form.",
      });
    }
    if (coverLetter) app.coverLetter = coverLetter;
    const { autofilled, errors } = await autofillPage(app, job, profile, page, resumePath);
    const { report, image } = await snapshot(app);
    return withImage({ currentUrl: page.url(), autofilled, errors, ...report }, image);
  },
);

server.registerTool(
  "application_fill",
  {
    title: "Fill application fields",
    description:
      "Fill specific fields by id (from application_prepare/application_review). For select/radio/combobox give the option text; " +
      "for multi-choice checkboxes give comma-separated options; for a single checkbox give 'true' or 'false'; for file fields give an absolute path.",
    inputSchema: {
      applicationId: z.string(),
      values: z.array(z.object({ fieldId: z.string(), value: z.string() })).min(1),
    },
  },
  async ({ applicationId, values }) => {
    const app = store.getApplication(applicationId);
    if (!app) throw new Error(`Unknown application ${applicationId}`);
    const page = getApplicationPage(applicationId);
    const fields = new Map((await scanFields(page)).map((f) => [f.id, f]));
    const results: { fieldId: string; label?: string; result?: string; error?: string }[] = [];
    for (const { fieldId, value } of values) {
      const field = fields.get(fieldId);
      if (!field) {
        results.push({ fieldId, error: "No such field (the form may have changed; call application_review)" });
        continue;
      }
      try {
        results.push({ fieldId, label: field.label, result: await fillField(page, field, value) });
        app.filledFields[field.label] = value;
      } catch (e) {
        results.push({ fieldId, label: field.label, error: (e as Error).message });
      }
    }
    const { report, image } = await snapshot(app);
    return withImage({ results, ...report }, image);
  },
);

server.registerTool(
  "application_review",
  {
    title: "Review application",
    description: "Re-scan the open form and return all fields (filled and unfilled) plus a fresh screenshot. Use after the user edits the form by hand.",
    inputSchema: { applicationId: z.string() },
  },
  async ({ applicationId }) => {
    const app = store.getApplication(applicationId);
    if (!app) throw new Error(`Unknown application ${applicationId}`);
    const { report, image } = await snapshot(app);
    return withImage(report, image);
  },
);

server.registerTool(
  "application_submit",
  {
    title: "Submit application (asks the user)",
    description:
      "Ask the user to approve, then click the form's Submit button. The user gets an approval prompt directly; if the client can't show one, " +
      "the user must review the browser window and click Submit themselves, then you call application_mark with status 'submitted'.",
    inputSchema: { applicationId: z.string() },
  },
  async ({ applicationId }) => {
    const app = store.getApplication(applicationId);
    if (!app) throw new Error(`Unknown application ${applicationId}`);
    if (app.status !== "prepared") throw new Error(`Application is ${app.status}, not prepared.`);
    const job = store.getJob(app.jobId)!;
    if (!isAtsSource(job.source)) {
      return json({
        submitted: false,
        reason: `Jobs from ${job.source} are submitted by the user in the browser. Once they have, call application_mark with status 'submitted'.`,
      });
    }
    const page = getApplicationPage(applicationId);
    const fields = await scanFields(page);
    const missing = fields.filter(isRequiredOpen);
    if (missing.length) {
      return json({ submitted: false, reason: "Required fields are still empty", requiredUnfilled: missing.map(compactField) });
    }

    if (!server.server.getClientCapabilities()?.elicitation) {
      await page.bringToFront();
      return json({
        submitted: false,
        reason:
          "This MCP client can't show an approval prompt. Ask the user to review the form in the open browser window and click Submit themselves, then call application_mark with status 'submitted'.",
      });
    }

    const lines = fields.filter((f) => f.filled).map((f) => `• ${f.label}: ${f.kind === "textarea" ? (f.value ?? "").slice(0, 60) + "…" : f.value}`);
    const answer = await server.server.elicitInput({
      mode: "form",
      message: `Submit application to ${job.company} — ${job.title}?\n\nReview the form in the browser window. Filled fields:\n${lines.join("\n")}`,
      requestedSchema: {
        type: "object",
        properties: { approve: { type: "boolean", title: "Submit this application", description: "Check to submit now" } },
        required: ["approve"],
      },
    });
    if (answer.action !== "accept" || answer.content?.approve !== true) {
      return json({ submitted: false, reason: `User did not approve (${answer.action}). The form is still open for edits.` });
    }

    const button = await findSubmitButton(page);
    if (!button) {
      return json({ submitted: false, reason: "Couldn't find the Submit button. Ask the user to click it in the browser, then call application_mark." });
    }
    await button.click();
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const confirmed = CONFIRMATION_RE.test(bodyText);
    const shotPath = join(SCREENSHOT_DIR, `${app.id}-after-submit.jpg`);
    const image = await page.screenshot({ path: shotPath, type: "jpeg", quality: 60 });
    if (confirmed) {
      app.status = "submitted";
      app.submittedAt = new Date().toISOString();
      store.upsertApplication(app);
    }
    return withImage(
      {
        submitted: confirmed,
        screenshotPath: shotPath,
        note: confirmed
          ? "Confirmation page detected."
          : "Clicked Submit but no confirmation was detected. There may be a CAPTCHA or validation error; check the browser. Once it's through, call application_mark with status 'submitted'.",
      },
      image,
    );
  },
);

server.registerTool(
  "application_mark",
  {
    title: "Update application status",
    description: "Record an application's status (e.g. after the user submits manually, or when they hear back).",
    inputSchema: { applicationId: z.string(), status: ApplicationStatusSchema, notes: z.string().optional() },
  },
  async ({ applicationId, status, notes }) => {
    const app = store.getApplication(applicationId);
    if (!app) throw new Error(`Unknown application ${applicationId}`);
    app.status = status;
    if (status === "submitted" && !app.submittedAt) app.submittedAt = new Date().toISOString();
    if (notes) app.notes = notes;
    store.upsertApplication(app);
    return json(app);
  },
);

server.registerTool(
  "applications_list",
  {
    title: "List applications",
    description: "All tracked applications with job info, newest first.",
    inputSchema: { status: ApplicationStatusSchema.optional() },
  },
  async ({ status }) => {
    const apps = store
      .listApplications()
      .filter((a) => !status || a.status === status)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((a) => {
        const j = store.getJob(a.jobId);
        return { applicationId: a.id, status: a.status, company: j?.company, title: j?.title, submittedAt: a.submittedAt, updatedAt: a.updatedAt, url: j?.url, notes: a.notes };
      });
    return json(apps);
  },
);

server.registerTool(
  "application_close",
  {
    title: "Close application tab",
    description: "Close the browser tab for an application (its record is kept).",
    inputSchema: { applicationId: z.string() },
  },
  async ({ applicationId }) => {
    await closeApplicationPage(applicationId);
    return json({ closed: applicationId });
  },
);

// ---------- Start ----------

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await shutdownBrowser();
    process.exit(0);
  });
}
process.stdin.on("close", () => void shutdownBrowser());

await server.connect(new StdioServerTransport());
console.error(`jobbot MCP server running (data: ${DATA_DIR})`);
