import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Application, Criteria, Job, Profile } from "./schemas.js";

export const DATA_DIR = resolve(
  process.env.JOBBOT_DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", "data"),
);
export const SCREENSHOT_DIR = join(DATA_DIR, "screenshots");
export const BROWSER_PROFILE_DIR = join(DATA_DIR, "browser-profile");
const DB_PATH = join(DATA_DIR, "db.json");

interface Db {
  profile?: Profile;
  /** Reusable answers to common application questions, keyed by a short question label. */
  answers: Record<string, string>;
  criteria?: Criteria;
  jobs: Record<string, Job>;
  applications: Record<string, Application>;
  /** Secret the bookmarklet sends to read live fill data from the local server. */
  fillToken?: string;
}

function load(): Db {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  if (!existsSync(DB_PATH)) return { answers: {}, jobs: {}, applications: {} };
  return JSON.parse(readFileSync(DB_PATH, "utf8")) as Db;
}

let db = load();

function save() {
  const tmp = `${DB_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, DB_PATH);
}

export const store = {
  getProfile: () => db.profile,
  setProfile(profile: Profile) {
    db.profile = profile;
    save();
  },

  getAnswers: () => db.answers,
  setAnswers(answers: Record<string, string>, replace = false) {
    db.answers = replace ? answers : { ...db.answers, ...answers };
    save();
    return db.answers;
  },

  getFillToken() {
    if (!db.fillToken) {
      db.fillToken = randomBytes(24).toString("base64url");
      save();
    }
    return db.fillToken;
  },

  getCriteria: () => db.criteria,
  setCriteria(criteria: Criteria) {
    db.criteria = criteria;
    save();
  },

  getJob: (id: string) => db.jobs[id],
  listJobs: () => Object.values(db.jobs),
  /** Inserts new jobs and refreshes existing ones, keeping score/dismissed state. */
  upsertJobs(jobs: Job[]) {
    let added = 0;
    for (const job of jobs) {
      const existing = db.jobs[job.id];
      if (!existing) added++;
      db.jobs[job.id] = existing
        ? { ...job, firstSeenAt: existing.firstSeenAt, score: existing.score, scoreReasoning: existing.scoreReasoning, dismissed: existing.dismissed }
        : job;
    }
    save();
    return added;
  },
  updateJob(id: string, patch: Partial<Job>) {
    const job = db.jobs[id];
    if (!job) throw new Error(`Unknown job ${id}`);
    Object.assign(job, patch);
    save();
    return job;
  },

  getApplication: (id: string) => db.applications[id],
  listApplications: () => Object.values(db.applications),
  findApplicationForJob: (jobId: string) => Object.values(db.applications).find((a) => a.jobId === jobId),
  upsertApplication(app: Application) {
    app.updatedAt = new Date().toISOString();
    db.applications[app.id] = app;
    save();
    return app;
  },
};
