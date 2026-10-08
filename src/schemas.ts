import { z } from "zod";

export const ExperienceSchema = z.object({
  company: z.string(),
  title: z.string(),
  location: z.string().optional(),
  startDate: z.string().optional().describe("YYYY-MM or YYYY"),
  endDate: z.string().optional().describe("YYYY-MM, YYYY, or 'present'"),
  highlights: z.array(z.string()).default([]),
});

export const EducationSchema = z.object({
  institution: z.string(),
  degree: z.string().optional(),
  field: z.string().optional(),
  graduationDate: z.string().optional(),
});

export const ProfileSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  suffix: z.string().optional().describe("Name suffix such as Jr., Sr., III; only used when a form has a suffix field"),
  email: z.string(),
  phone: z.string().optional(),
  location: z.string().optional().describe("City, State/Region, Country"),
  links: z
    .object({
      linkedin: z.string().optional(),
      github: z.string().optional(),
      portfolio: z.string().optional(),
      other: z.array(z.string()).default([]),
    })
    .default({ other: [] }),
  headline: z.string().optional().describe("One-line professional summary"),
  summary: z.string().optional(),
  yearsExperience: z.number().optional(),
  skills: z.array(z.string()).default([]),
  experience: z.array(ExperienceSchema).default([]),
  education: z.array(EducationSchema).default([]),
  certifications: z.array(z.string()).default([]),
  resumePath: z.string().optional().describe("Absolute path to the resume file to upload with applications"),
});
export type Profile = z.infer<typeof ProfileSchema>;

/** Applicant tracking systems whose public job-board APIs JobBot fetches directly. */
export const AtsSourceSchema = z.enum(["greenhouse", "lever", "ashby"]);
export type AtsSource = z.infer<typeof AtsSourceSchema>;

/** Job boards whose listings are imported (e.g. from the Dice/Indeed/ZipRecruiter connectors). Applying on them is manual. */
export const BoardSourceSchema = z.enum(["dice", "indeed", "ziprecruiter", "monster", "other"]);
export type BoardSource = z.infer<typeof BoardSourceSchema>;

export const JobSourceSchema = z.union([AtsSourceSchema, BoardSourceSchema]);
export type JobSource = z.infer<typeof JobSourceSchema>;

export const isAtsSource = (s: JobSource): s is AtsSource => AtsSourceSchema.safeParse(s).success;

export const CompanyBoardSchema = z.object({
  source: AtsSourceSchema,
  slug: z
    .string()
    .describe("Board token, e.g. 'stripe' for boards.greenhouse.io/stripe, 'netflix' for jobs.lever.co/netflix"),
  name: z.string().optional(),
});
export type CompanyBoard = z.infer<typeof CompanyBoardSchema>;

export const CriteriaSchema = z.object({
  titles: z.array(z.string()).default([]).describe("Job title keywords; a job matches if its title contains any of them"),
  includeKeywords: z.array(z.string()).default([]).describe("Description must contain at least one (if any given)"),
  excludeKeywords: z.array(z.string()).default([]).describe("Reject a job whose title/description contains any of these"),
  locations: z.array(z.string()).default([]).describe("Acceptable location substrings, e.g. 'Seattle', 'United States'"),
  remoteOk: z.boolean().default(true).describe("Remote jobs pass the location filter"),
  remoteOnly: z.boolean().default(false),
  minSalary: z.number().optional().describe("Annual; jobs that publish a max below this are rejected"),
  maxAgeDays: z.number().optional().describe("Skip postings last updated more than N days ago (when known)"),
  companies: z.array(CompanyBoardSchema).default([]),
});
export type Criteria = z.infer<typeof CriteriaSchema>;

export interface Job {
  id: string; // `${source}:${slug}:${externalId}`
  source: JobSource;
  company: string;
  companySlug: string;
  externalId: string;
  title: string;
  location: string;
  remote: boolean;
  url: string;
  applyUrl: string;
  description: string;
  salaryMin?: number;
  salaryMax?: number;
  updatedAt?: string;
  firstSeenAt: string;
  employmentType?: string;
  /** Board-reported: Easy Apply / 1-click available on the board. */
  easyApply?: boolean;
  /** Board-reported: e.g. "Recruiter" or "Direct Hire". */
  employerType?: string;
  score?: number;
  scoreReasoning?: string;
  dismissed?: boolean;
}

export const ApplicationStatusSchema = z.enum([
  "prepared",
  "submitted",
  "skipped",
  "rejected",
  "interviewing",
  "offer",
  "withdrawn",
]);
export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>;

export interface Application {
  id: string;
  jobId: string;
  status: ApplicationStatus;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  coverLetter?: string;
  filledFields: Record<string, string>;
  screenshotPath?: string;
  notes?: string;
}
