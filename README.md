# JobBot

JobBot helps you find jobs that fit your resume and fills in the applications for you. **It never submits
anything without your approval.**

You use it by chatting with Claude. JobBot is an [MCP](https://modelcontextprotocol.io) server, a plug-in
that gives Claude new tools. Claude reads your resume, searches for jobs, ranks them against your
experience, and opens application forms in a browser window already filled in. You review each form and
decide whether it gets sent.

**What it searches**

| Source | How jobs are found | How you apply |
|---|---|---|
| Companies using **Greenhouse, Lever or Ashby** (many tech companies) | JobBot reads their public job lists directly | JobBot fills in the form, you approve, JobBot submits |
| **Dice, Indeed, ZipRecruiter** | Claude's job-board connectors | JobBot opens the posting and **you click Apply**. If that leads to the employer's own form, JobBot fills it in |
| **Monster** | Paste listings to Claude | Same as above |
| **LinkedIn** | Not supported | LinkedIn bans accounts it catches using automation |

---

## 1. One-time setup

### What you need

- **Windows, macOS or Linux**
- **[Node.js](https://nodejs.org) 22 or newer**. Check with `node -v`.
- **[Claude Code](https://claude.com/claude-code)** (terminal, VS Code extension or desktop app) or **Claude Desktop**
- Optional: **Microsoft Edge** or **Google Chrome**. JobBot uses an installed browser when it finds one (Edge on
  Windows, Chrome elsewhere) and falls back to a bundled one.
- Optional: the **Dice, Indeed and ZipRecruiter connectors** turned on in your Claude account
  (claude.ai → Settings → Connectors), if you want to search those sites.

### Install

Open a terminal in the JobBot folder and run:

```sh
npm install
npx playwright install chromium
npm run build
```

### Connect it to Claude

**Claude Code:** start Claude Code in the JobBot folder (`cd JobBot`, then `claude`, or open the folder in VS
Code). The included `.mcp.json` registers JobBot. Approve the `jobbot` server when asked. Type `/mcp` to check
that it shows as connected.

**Claude Desktop:** open Settings → Developer → Edit Config and add the following, using the full path to your
JobBot folder. Then restart Claude Desktop.

```json
{
  "mcpServers": {
    "jobbot": { "command": "node", "args": ["C:/path/to/JobBot/dist/index.js"] }
  }
}
```

---

## 2. Set up your profile (once)

Do these steps in order. Each one is a message you send to Claude.

### a. Your resume

> Read my resume at C:\Users\me\Documents\Resume.docx and set up my profile.

Claude extracts your contact details, work history, skills, education and certifications. **Check what it
shows you** and correct anything it got wrong. The resume file you name is the one uploaded with your
applications. PDF, DOCX, TXT and MD files work.

Things to mention if they apply:
- A name suffix (Jr., III). It's only used when a form has a suffix field.
- Whether you're currently employed. "Current company" questions are left blank when your latest role has an end date.

### b. Answers to common questions

Most applications ask the same questions. Give your answers once:

> Save these answers: I'm authorized to work in the US. I won't need visa sponsorship. My salary expectation is
> $150,000. I'm not willing to relocate; remote only. I can start immediately. For the voluntary EEO questions:
> gender Male, race White, not Hispanic or Latino, not a veteran, disability: decline to answer.

JobBot matches these to form questions automatically, even when forms word them differently. "How did you hear
about us?" is answered automatically from where the job came from ("Dice", "Indeed", "Company website", …).
Tell Claude if you'd rather give one fixed answer.

### c. What you're looking for

> Set my search criteria: titles containing "Senior Software Engineer", "Full Stack", ".NET", or "Software
> Architect". Remote only, United States. Minimum salary $150,000. Exclude "clearance" and "PHP". Skip postings
> older than 30 days.

| Setting | Meaning |
|---|---|
| Titles | A job must have one of these words or phrases in its title |
| Include keywords | The description must mention at least one |
| Exclude keywords | Skip jobs whose title or description mention any of these |
| Locations / remote | Where you'll work. "Remote only" still drops jobs limited to another country, like "Remote – UK" |
| Minimum salary | Drops jobs whose listed **yearly** maximum is lower. Jobs without a salary, or with an hourly rate, are kept |
| Max age | Drops postings older than this many days |

### d. Which companies to watch (Greenhouse / Lever / Ashby)

> Add these companies to my job search: Discord, Ramp, Plaid.

Claude works out each company's job board and checks it before adding it. If it can't find one, open the
company's careers page and look at where the **Apply** links go:

- `job-boards.greenhouse.io/`**`discord`** → Greenhouse, `discord`
- `jobs.lever.co/`**`plaid`** → Lever, `plaid`
- `jobs.ashbyhq.com/`**`ramp`** → Ashby, `ramp`

Companies that use Workday, iCIMS or Taleo aren't supported yet.

### e. Sign in to job sites (optional)

> Sign me in to Dice.

A browser window opens on Dice's sign-in page. **Sign in yourself**, including any verification code, then tell
Claude you're done. JobBot never sees or stores your password. The browser stays signed in for next time.
Repeat for Indeed, ZipRecruiter or Monster as needed. Searching works without signing in. Signing in helps
when you click Apply.

---

## 3. Search and review (each time)

### Run the search

> Run my job search. Also search Dice, Indeed and ZipRecruiter for remote senior .NET / React roles posted in
> the last week.

What happens:
1. JobBot fetches every job from the companies you added and applies your criteria.
2. Claude searches the job sites with its connectors and imports the results. Duplicates of jobs it already
   has are skipped.
3. Claude reads each new job and **scores it 0–100** against your profile, with a short reason.
4. You get a ranked list: score, title, company, salary, where it came from, and a link.

Jobs you've already applied to or dismissed don't come back.

### Review

Useful follow-ups:

> Show me the top 10.
> Tell me more about the Ramp job. Does it need anything I don't have?
> Dismiss the jobs at staffing agencies and anything that's contract-only.
> Only show jobs scored 75 or higher.

Dismissed jobs are hidden from future searches.

---

## 4. Apply

> Apply to the Discord Senior Data Engineer job. Write a short cover letter that highlights my Azure and
> Next.js work.

**Greenhouse / Lever / Ashby jobs:**
1. A browser window opens on the application form. JobBot uploads your resume (and the cover letter, if any),
   then fills in your contact details, links and every question your saved answers cover.
2. Claude lists what's still empty and asks you about anything it doesn't know. It never makes up answers.
   Answers you give can be saved for next time.
3. **Look over the form in the browser window.** You can edit anything there directly. Tell Claude when you're
   done so it re-checks the form.
4. When you say to submit, an **approval prompt** shows every filled-in field. Only after you approve does
   JobBot click Submit and check for a confirmation page.
   If your Claude app can't show approval prompts, JobBot won't submit. Click **Submit** in the browser
   yourself, then tell Claude it's done.

**Dice / Indeed / ZipRecruiter / Monster jobs:**
1. The posting opens in the browser window. **You click Apply** (or Easy Apply).
2. If you end up on the employer's own application form, ask Claude to **"fill in this form"**. It works the
   same way as above.
3. You submit, then tell Claude ("I submitted it") so it's tracked.

If a CAPTCHA appears, solve it in the browser window. If it says the browser check failed, use JobBot Fill
(below) in your everyday browser instead.

### JobBot Fill: fill forms in your own browser

Some sites' bot checks reject JobBot's browser window because it's automated. JobBot Fill is a bookmark that
fills the form in the browser you normally use, so those checks pass.

> Give me the JobBot Fill bookmark.

Claude opens `data/bookmarklet.html`. Drag the **JobBot Fill** button to your bookmarks bar (once). Then, on any
employer application form:

1. Click **JobBot Fill**. It fills what your profile and saved answers cover, and a small panel lists what's left.
   Required fields it couldn't fill are outlined.
2. Attach your resume yourself. Browsers don't let a bookmark pick files from your computer.
3. Answer anything outlined, complete the verification, and click Submit yourself.
4. Tell Claude you applied so it's tracked.

While JobBot is running in Claude, the bookmark reads your current profile from it. Otherwise it uses the copy
saved inside the bookmark, and the panel shows the date of that copy. The page is refreshed whenever your profile or
answers change. Drag the new button over the old one to update the saved copy. The panel reminds you when it's
out of date.

Like JobBot's own window, it doesn't fill anything on Dice, Indeed, ZipRecruiter, Monster or LinkedIn pages.

---

## 5. Track your applications

> Show my applications.
> Mark the Ramp application as interviewing.
> I got rejected by Plaid.

Statuses: prepared, submitted, skipped, rejected, interviewing, offer, withdrawn.

---

## Example prompts

| You want to… | Say |
|---|---|
| See your saved profile, answers and criteria | "Show my JobBot profile" |
| Change a saved answer | "Change my salary expectation to $160,000" |
| Change search criteria | "Also include 'Platform Engineer' titles" |
| Add companies | "Add Stripe and Figma to my job search" |
| Daily routine | "Run my job search and show only new jobs scored 70+" |
| Check job-site sign-ins | "Am I still signed in to Dice and Indeed?" |
| Fill a form in your own browser | "Give me the JobBot Fill bookmark" |
| Close a finished browser tab | "Close the Discord application tab" |

---

## Your data and privacy

Everything stays on your computer in the `data/` folder:

| Path | Contents |
|---|---|
| `data/db.json` | Profile, saved answers, criteria, jobs, applications |
| `data/screenshots/` | Screenshots of filled-in forms |
| `data/cover-letters/` | Cover letters generated for applications |
| `data/browser-profile/` | JobBot's browser profile, including job-site sign-ins. **Treat it like a saved password**: don't share it |
| `data/bookmarklet.html` | The JobBot Fill bookmark, with your contact details and saved answers inside. Don't share it or the bookmark |

`data/` is excluded from git. To start over, delete it. Your profile and job details are sent to Claude
during your conversations so it can read, score and fill. Passwords are never stored or sent.

While it runs, JobBot serves your contact details and saved answers to the JobBot Fill bookmark at
`127.0.0.1:47321`. Only your own computer can reach that address, and requests need the secret key stored in
your bookmark. A page you run the bookmark on can see the data it fills in, so use it only on application forms.
Chrome or Edge may ask whether the site can access devices on your local network. Allow it to get live data, or
block it and the bookmark uses its saved copy.

Settings (environment variables, all optional):

| Variable | Default | Purpose |
|---|---|---|
| `JOBBOT_DATA_DIR` | `./data` | Where data is stored |
| `JOBBOT_BROWSER_CHANNEL` | `msedge` on Windows, otherwise `chrome` | Browser to use. `chromium` uses the bundled one |
| `JOBBOT_HEADLESS` | unset | `1` hides the browser. For testing only, since you can't review a hidden form |
| `JOBBOT_FILL_PORT` | `47321` | Local port that serves live data to the JobBot Fill bookmark. Changing it needs a new bookmark |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Claude doesn't seem to know about JobBot | In Claude Code run `/mcp` and check `jobbot` is connected. Run `npm run build` again, then restart Claude |
| A company won't add | Check the board name on its careers page (see 2d). It may use an unsupported system |
| Dice/Indeed/ZipRecruiter searches don't work | Turn those connectors on in claude.ai → Settings → Connectors |
| A field didn't fill, or filled wrong | Fix it in the browser window, then say "re-check the form" |
| A job site keeps asking you to sign in | Say "sign me in to Dice" again. Sessions expire |
| "No open browser tab for application" | The window was closed. Ask Claude to prepare the application again |
| Submit didn't confirm | Usually a CAPTCHA or a field error. Check the browser, submit yourself, then say "mark it submitted" |
| "Browser check failed" or the CAPTCHA keeps rejecting JobBot's window | Open the form in your everyday browser and use JobBot Fill |
| JobBot Fill says it found no form fields | The form is probably inside a frame. Open the frame in its own tab, or fill it in JobBot's window |

## Limitations

- Supported application forms: Greenhouse, Lever, Ashby, and similar standard forms. Workday, iCIMS and Taleo are not.
- Job-site Easy Apply / 1-click apply is deliberately manual: those sites prohibit automation.
- Cover letters are uploaded as `.txt` files when a form asks for a file.
- Apply selectively. Score first and apply to good fits. Mass applications hurt response rates.

---

## For developers

```sh
npm run dev        # run from source with tsx
npm run typecheck
npm run build
```

| Path | What's there |
|---|---|
| `src/index.ts` | MCP server and tool definitions |
| `src/store.ts` | JSON storage in `data/db.json` |
| `src/resume.ts` | PDF/DOCX text extraction |
| `src/sources/` | Greenhouse, Lever and Ashby job-list fetchers; criteria filters |
| `src/boards.ts` | Job-site sign-in URLs |
| `src/browser/` | Browser session, form scanning and filling, autofill rules |
| `src/bookmarklet.ts` | JobBot Fill: bookmark page generator, in-page filler and the local live-data server |

The server makes no AI calls itself. The connected Claude client does the reading, scoring and writing.
Tools: `resume_read`, `profile_save`, `profile_get`, `answers_set`, `criteria_set`, `boards_add`,
`jobs_search`, `jobs_import`, `job_get`, `job_score`, `job_dismiss`, `board_login`, `board_session_check`,
`application_prepare`, `application_autofill`, `application_fill`, `application_review`, `application_submit`,
`application_mark`, `applications_list`, `application_close`, `bookmarklet_get`.
