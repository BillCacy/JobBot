import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { PLANNER_SOURCE } from "./browser/autofill.js";
import { SCAN_SCRIPT } from "./browser/fields.js";
import { DATA_DIR, store } from "./store.js";

/**
 * The bookmarklet fills application forms in the user's everyday browser, where sites' bot checks see a normal
 * browser because it is one. It carries a snapshot of the profile and answers, and first tries the live copy
 * served by this process so edits show up without re-saving the bookmark.
 */

export const BOOKMARKLET_PATH = join(DATA_DIR, "bookmarklet.html");
export const FILL_PORT = Number(process.env.JOBBOT_FILL_PORT ?? 47321);

/** Only what the planner reads: no work history beyond the latest role, no summary or skills. */
function fillData() {
  const p = store.getProfile();
  if (!p) return undefined;
  const latest = p.experience[0];
  const body = {
    profile: {
      firstName: p.firstName,
      lastName: p.lastName,
      suffix: p.suffix,
      email: p.email,
      phone: p.phone,
      location: p.location,
      links: p.links,
      experience: latest ? [{ company: latest.company, title: latest.title, endDate: latest.endDate }] : [],
    },
    answers: store.getAnswers(),
    resumeFile: p.resumePath?.split(/[\\/]/).pop(),
  };
  const version = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 12);
  return { ...body, version, generatedAt: new Date().toISOString() };
}

// Plain-string page code, like SCAN_SCRIPT, so nothing gets transpiled into it. No template literals inside.
const RUNTIME = String.raw`
const BOARD_HOST_RE = /(^|\.)(dice|indeed|ziprecruiter|monster|linkedin)\.com$/i;
const scan = () => SCAN_SCRIPT_HERE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadData() {
  try {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(LIVE_URL, { signal: ctl.signal, cache: "no-store" });
    if (r.ok) return { data: await r.json(), live: true };
  } catch (e) {
    // JobBot isn't running, or the site's security policy blocks local requests.
  }
  return { data: SNAPSHOT, live: false };
}

function sourceFromReferrer() {
  try {
    const m = new URL(document.referrer).hostname.match(/(dice|indeed|ziprecruiter|monster)\.com$/i);
    return m ? m[1].toLowerCase() : undefined;
  } catch (e) {
    return undefined;
  }
}

const el = (id) => document.querySelector('[data-jobbot-id="' + id + '"]');

function setText(input, value) {
  const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  input.focus();
  // The native setter, so React and similar frameworks notice the change.
  Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.blur();
}

function clickLike(target) {
  for (const type of ["mousedown", "mouseup", "click"]) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
}

async function fill(field, value) {
  const node = el(field.id);
  switch (field.kind) {
    case "text":
    case "textarea":
      setText(node, value);
      return "filled";
    case "select": {
      const opt = [...node.options].find((o) => o.text.replace(/\s+/g, " ").trim() === bestOption(field.options || [], value));
      if (!opt) throw new Error('No option matching "' + value + '"');
      node.value = opt.value;
      node.dispatchEvent(new Event("change", { bubbles: true }));
      return 'selected "' + opt.text.trim() + '"';
    }
    case "radio":
    case "checkbox": {
      const single = field.options === undefined;
      const singleOn = /^(true|yes|y|1|checked|on|agree|i agree)$/i.test(value.trim());
      const picks = single ? [] : value.split(/\s*[,;|]\s*/).filter(Boolean).map((w) => {
        const o = bestOption(field.options, w);
        if (!o) throw new Error('No option matching "' + w + '"');
        return o;
      });
      const label = (e) => ((e.labels && e.labels[0] && e.labels[0].innerText) || e.getAttribute("aria-label") || e.value)
        .replace(/\s+/g, " ").replace(/\s*[*✱]\s*$/, "").trim();
      for (const e of document.querySelectorAll('[data-jobbot-group="' + field.id + '"]')) {
        const want = single ? singleOn : picks.includes(label(e));
        if (e.checked !== want) ((e.labels && e.labels[0]) || e).click();
      }
      return single ? (singleOn ? "checked" : "unchecked") : "chose " + picks.join(", ");
    }
    case "combobox": {
      // Type the full value, then just the part before the first comma ("Seattle, WA" -> "Seattle").
      for (const q of [...new Set([value, value.split(",")[0].trim()])]) {
        node.focus();
        clickLike(node);
        setText(node, q);
        node.focus();
        const listId = node.getAttribute("aria-controls");
        for (let waited = 0; waited < 3000; waited += 150) {
          await sleep(150);
          const opts = [...document.querySelectorAll(listId ? '[id="' + listId + '"] [role=option]' : "[role=option]")]
            .filter((o) => o.getBoundingClientRect().height > 0);
          const texts = opts.map((o) => o.innerText.trim());
          const pick = bestOption(texts, value) || bestOption(texts, q);
          if (pick) {
            clickLike(opts[texts.indexOf(pick)]);
            return 'selected "' + pick + '"';
          }
        }
      }
      setText(node, "");
      throw new Error('No option matching "' + value + '"');
    }
  }
  throw new Error("Can't fill a " + field.kind + " field");
}

function showPanel(lines, flagged) {
  const old = document.getElementById("jobbot-panel");
  if (old) old.remove();
  const host = document.createElement("div");
  host.id = "jobbot-panel";
  host.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647";
  const root = host.attachShadow({ mode: "open" });
  const box = document.createElement("div");
  box.style.cssText = "font:14px/1.45 system-ui,sans-serif;background:#fff;color:#1a1a1a;border:1px solid #ccc;border-radius:8px;" +
    "box-shadow:0 4px 16px rgba(0,0,0,.2);padding:12px 14px;max-width:340px;max-height:70vh;overflow:auto";
  const close = document.createElement("button");
  close.textContent = "×";
  close.setAttribute("aria-label", "Close");
  close.style.cssText = "float:right;border:0;background:none;font-size:20px;line-height:1;cursor:pointer;color:#555";
  close.onclick = () => {
    host.remove();
    for (const n of flagged) n.style.outline = "";
  };
  box.append(close);
  for (const [kind, text] of lines) {
    const p = document.createElement(kind === "item" ? "li" : "div");
    p.textContent = text;
    if (kind === "title") p.style.cssText = "font-weight:600;margin-bottom:6px";
    if (kind === "head") p.style.cssText = "font-weight:600;margin-top:8px";
    if (kind === "item") p.style.cssText = "margin-left:18px";
    if (kind === "note") p.style.cssText = "margin-top:8px;color:#555;font-size:12px";
    if (kind === "warn") p.style.cssText = "margin-top:8px;color:#8a4b00";
    box.append(p);
  }
  root.append(box);
  document.body.append(host);
}

async function main() {
  if (BOARD_HOST_RE.test(location.hostname)) {
    showPanel([["title", "JobBot"], ["text", "This is a job board's own page. Easy Apply stays manual here. Use JobBot Fill on the employer's application form."]], []);
    return;
  }
  const { data, live } = await loadData();
  const input = { profile: data.profile, answers: data.answers, source: sourceFromReferrer() };
  const fields = scan();
  const plan = planAutofill(fields, input);

  // Choice fields first: some forms re-render after a selection and wipe text typed earlier.
  const order = ["combobox", "select", "radio", "checkbox", "file", "text", "textarea"];
  const planned = fields.filter((f) => plan.has(f.id))
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    .map((f) => ({ field: f, value: plan.get(f.id) }));
  let filled = 0;
  const errors = [];
  for (const { field, value } of planned) {
    try {
      await fill(field, value);
      filled++;
    } catch (e) {
      errors.push(field.label + ": " + e.message);
    }
  }
  // Refill anything that got cleared (matched by label, since re-rendered fields get new ids).
  await sleep(300);
  for (const { field, value } of planned) {
    const now = scan().find((f) => f.label === field.label && f.kind === field.kind && !f.filled);
    if (now) await fill(now, value).catch(() => {});
  }

  const after = scan();
  const open = after.filter((f) => f.required && !f.filled);
  const flagged = [];
  for (const f of open) {
    const n = el(f.id) || document.querySelector('[data-jobbot-group="' + f.id + '"]');
    const target = n && (n.offsetParent ? n : (n.labels && n.labels[0]) || n);
    if (target) {
      target.style.outline = "2px solid #e8a33d";
      flagged.push(target);
    }
  }

  const lines = [["title", fields.length ? "JobBot filled " + filled + " field" + (filled === 1 ? "" : "s") : "JobBot found no form fields"]];
  if (!fields.length) lines.push(["text", "If the form is inside a frame, open the frame in its own tab and try again."]);
  const resume = open.find((f) => f.kind === "file") || after.find((f) => f.kind === "file" && !f.filled && /resume|cv\b|curriculum/i.test(f.label + " " + (f.name || "")));
  if (resume) lines.push(["warn", "Attach your résumé yourself" + (data.resumeFile ? ": " + data.resumeFile : "") + "."]);
  const rest = open.filter((f) => f !== resume);
  if (rest.length) {
    lines.push(["head", "Still needed (outlined):"]);
    for (const f of rest) lines.push(["item", f.label || "(unlabeled " + f.kind + ")"]);
  }
  if (errors.length) {
    lines.push(["head", "Couldn't fill:"]);
    for (const e of errors) lines.push(["item", e]);
  }
  lines.push(["note", "Check every field, complete any verification, then submit yourself."]);
  const asOf = new Date(data.generatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  lines.push(["note", live ? "Profile: live from JobBot." : "Profile as of " + asOf + " (JobBot not reachable, used the copy saved in this bookmark)."]);
  if (live && data.version !== SNAPSHOT.version) {
    lines.push(["warn", "Your bookmark's saved copy is out of date. Drag the new JobBot Fill link from bookmarklet.html to replace it."]);
  }
  showPanel(lines, flagged);
}

main().catch((e) => alert("JobBot Fill failed: " + e.message));
`;

/** Builds the javascript: URL. Returns undefined when there's no profile yet. */
function bookmarkletUrl(): { href: string; generatedAt: string } | undefined {
  const data = fillData();
  if (!data) return undefined;
  const liveUrl = `http://127.0.0.1:${FILL_PORT}/fill-data?token=${encodeURIComponent(store.getFillToken())}`;
  const code = [
    "(() => {",
    // tsx (dev mode) wraps functions in __name(); this keeps the serialized planner working in the page.
    "var __name = (f) => f;",
    `const SNAPSHOT = ${JSON.stringify(data)};`,
    `const LIVE_URL = ${JSON.stringify(liveUrl)};`,
    PLANNER_SOURCE,
    RUNTIME.replace("SCAN_SCRIPT_HERE", () => SCAN_SCRIPT),
    "})();",
  ].join("\n");
  return { href: `javascript:${encodeURIComponent(code)}`, generatedAt: data.generatedAt };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Writes data/bookmarklet.html with a fresh snapshot. Call after the profile or answers change. */
export function writeBookmarkletPage(): { path: string; generatedAt: string } | undefined {
  const built = bookmarkletUrl();
  if (!built) return undefined;
  const asOf = new Date(built.generatedAt).toLocaleString();
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>JobBot Fill</title>
<style>
  :root { color-scheme: light dark; --bg: #fafafa; --fg: #1a1a1a; --muted: #555; --accent: #1d5fd1; }
  @media (prefers-color-scheme: dark) { :root { --bg: #18181b; --fg: #ececec; --muted: #a1a1aa; --accent: #6ea0ff; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.55 system-ui, sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 32px 16px; }
  .drag { display: inline-block; margin: 8px 0 4px; padding: 10px 18px; border-radius: 8px; background: var(--accent);
    color: #fff; font-weight: 600; text-decoration: none; cursor: grab; }
  .muted { color: var(--muted); font-size: 14px; }
  li { margin: 4px 0; }
</style>
</head>
<body>
<main>
<h1>JobBot Fill</h1>
<p>Drag this button to your browser's bookmarks bar:</p>
<a class="drag" href="${escapeHtml(built.href)}" onclick="event.preventDefault(); alert('Drag this to your bookmarks bar, then click it on an application form.');">JobBot Fill</a>
<p class="muted">Saved copy of your profile: ${escapeHtml(asOf)}. If you already have the bookmark, drag this one over it.</p>
<h2>Using it</h2>
<ol>
  <li>Open an employer's application form in this browser.</li>
  <li>Click <b>JobBot Fill</b> in your bookmarks bar. It fills what your profile and saved answers cover and outlines what's left.</li>
  <li>Attach your résumé, answer anything outlined, complete any verification, and submit yourself.</li>
  <li>Tell Claude you applied so JobBot tracks it.</li>
</ol>
<h2>Good to know</h2>
<ul>
  <li>While JobBot is running in Claude, the bookmark uses your current profile. Otherwise it uses the saved copy from the date above.</li>
  <li>It doesn't work on Dice, Indeed, ZipRecruiter, Monster or LinkedIn pages. Easy Apply there stays manual.</li>
  <li>Your profile and saved answers are inside this bookmark. Don't share it, and only use it on application forms.</li>
</ul>
</main>
</body>
</html>
`;
  writeFileSync(BOOKMARKLET_PATH, html);
  return { path: BOOKMARKLET_PATH, generatedAt: built.generatedAt };
}

let fillServerUp = false;
export const fillServerRunning = () => fillServerUp;

/**
 * Serves live fill data to the bookmarklet on 127.0.0.1 only. The token keeps other sites from reading it;
 * CORS is open because the request comes from whatever site the form is on.
 */
export function startFillServer() {
  const server = createServer((req, res) => {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET",
      // Chrome/Edge ask before letting a public site reach a local address.
      "Access-Control-Allow-Private-Network": "true",
      "Cache-Control": "no-store",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, headers).end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const data = req.method === "GET" && url.pathname === "/fill-data" && url.searchParams.get("token") === store.getFillToken() ? fillData() : undefined;
    if (!data) {
      res.writeHead(404, headers).end();
      return;
    }
    res.writeHead(200, { ...headers, "Content-Type": "application/json" }).end(JSON.stringify(data));
  });
  server.on("listening", () => (fillServerUp = true));
  // Usually another JobBot session already has the port; the bookmarklet will read from that one.
  server.on("error", (e) => console.error(`jobbot: bookmarklet live data not served on port ${FILL_PORT}: ${e.message}`));
  server.listen(FILL_PORT, "127.0.0.1");
  server.unref();
}
