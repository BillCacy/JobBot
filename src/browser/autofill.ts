import type { JobSource, Profile } from "../schemas.js";
import { bestOption, type FormField } from "./fields.js";

interface AutofillInput {
  profile: Profile;
  answers: Record<string, string>;
  resumePath?: string;
  coverLetterPath?: string;
  coverLetter?: string;
  /** Where the job came from; drives the default "How did you hear about us?" answer. */
  source?: JobSource;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Rules for standard fields, checked in order against the field label. */
function standardValue(field: FormField, i: AutofillInput): string | undefined {
  const l = field.label.toLowerCase();
  const p = i.profile;
  // Only a role without an end date counts as current; otherwise "current company/title" stay blank.
  const latest = p.experience[0];
  const current = latest && (!latest.endDate || /present|current/i.test(latest.endDate)) ? latest : undefined;

  if (field.kind === "file") {
    const hint = `${l} ${field.name ?? ""}`.toLowerCase();
    if (/cover/.test(hint)) return i.coverLetterPath;
    if (/resume|cv\b|curriculum/.test(hint)) return i.resumePath;
    return undefined;
  }
  if (field.kind === "textarea" && /cover letter/.test(l)) return i.coverLetter;
  if (/^(name )?suffix$/.test(norm(l))) return p.suffix;
  if (field.kind !== "text" && field.kind !== "combobox") return undefined;

  if (/preferred (first )?name/.test(l)) return undefined; // optional and personal; leave for the user
  if (/first name|given name/.test(l)) return p.firstName;
  if (/last name|family name|surname/.test(l)) return p.lastName;
  if (/^(full |legal )?name$|^your name$/.test(norm(l))) return `${p.firstName} ${p.lastName}`;
  if (/e-?mail/.test(l)) return p.email;
  if (/phone|mobile/.test(l) && !/country|type/.test(l)) return p.phone;
  if (/linkedin/.test(l)) return p.links.linkedin;
  if (/github/.test(l)) return p.links.github;
  if (/portfolio|personal (web)?site|^website$|other website/.test(l)) return p.links.portfolio ?? p.links.github;
  if (/current (company|employer)|^company$|^employer$/.test(norm(l))) return current?.company;
  if (/current (job )?title|^title$/.test(norm(l))) return current?.title;
  if (/^(location|city|current location)( city)?$|where are you (currently )?(based|located)/.test(norm(l))) return p.location;
  return undefined;
}

/** Answer-bank lookup: a stored key matches when either contains the other as whole words; the longest key wins. */
export function answerFor(label: string, answers: Record<string, string>): string | undefined {
  const l = norm(label);
  if (!l) return undefined;
  let best: { key: string; value: string } | undefined;
  for (const [key, value] of Object.entries(answers)) {
    const k = norm(key);
    if (!k) continue;
    if (l === k) return value;
    const contains = (a: string, b: string) => ` ${a} `.includes(` ${b} `);
    if ((contains(l, k) || contains(k, l)) && (!best || k.length > norm(best.key).length)) best = { key, value };
  }
  return best?.value;
}

const HEARD_ABOUT_RE = /how did you (hear|find|learn)|where did you (hear|find|learn)|(hear|heard|learned|learn) about (us|this|the)|referral source|source of (application|referral)/i;

const BOARD_NAMES: Partial<Record<JobSource, string>> = { dice: "Dice", indeed: "Indeed", ziprecruiter: "ZipRecruiter", monster: "Monster" };

/** Default "How did you hear about us?" answers, best first: the board's name for imported jobs, else the company's own site. */
function heardAboutCandidates(source?: JobSource): string[] {
  const board = source && BOARD_NAMES[source];
  return board
    ? [board, "Job board", "Online job board", "Job Board", "Internet", "Other"]
    : ["Company website", "Company careers page", "Careers page", "Career site", "Website", "Internet", "Other"];
}

function heardAbout(field: FormField, source?: JobSource): string | undefined {
  const candidates = heardAboutCandidates(source);
  if (field.options) {
    for (const c of candidates) {
      const option = bestOption(field.options, c);
      if (option) return option;
    }
    return undefined;
  }
  return candidates[0];
}

/** Plans values for fields that are empty and that we can fill confidently. */
export function planAutofill(fields: FormField[], input: AutofillInput): Map<string, string> {
  const plan = new Map<string, string>();
  for (const f of fields) {
    if (f.filled) continue;
    const heard = HEARD_ABOUT_RE.test(f.label)
      ? answerFor(f.label, input.answers) ?? heardAbout(f, input.source)
      : undefined;
    const value = heard ?? standardValue(f, input) ?? answerFor(f.label, input.answers);
    if (value) plan.set(f.id, value);
  }
  return plan;
}

/**
 * The planner as source text, for running inside a page (the bookmarklet). It must list every function and
 * constant planAutofill reaches, since each is serialized on its own.
 */
export const PLANNER_SOURCE = [
  `const norm = ${norm};`,
  `const HEARD_ABOUT_RE = ${HEARD_ABOUT_RE};`,
  `const BOARD_NAMES = ${JSON.stringify(BOARD_NAMES)};`,
  bestOption,
  standardValue,
  answerFor,
  heardAboutCandidates,
  heardAbout,
  planAutofill,
]
  .map(String)
  .join("\n");
