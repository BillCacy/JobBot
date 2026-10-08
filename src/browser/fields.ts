import type { Page } from "playwright";

export type FieldKind = "text" | "textarea" | "select" | "file" | "radio" | "checkbox" | "combobox";

export interface FormField {
  id: string;
  kind: FieldKind;
  label: string;
  required: boolean;
  filled: boolean;
  value?: string;
  /** Choices for select/radio/checkbox groups. */
  options?: string[];
  inputType?: string;
  /** The element's name/id, a fallback hint when the visible label is generic (e.g. "Attach"). */
  name?: string;
}

// In-page code is kept as a plain string so bundlers/transpilers can't inject helpers
// that don't exist in the browser.
const SCAN_SCRIPT = String.raw`(() => {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const strip = (s) => s.replace(/\s*[*✱]\s*$/, "").trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
  };
  const textOfIds = (ids) => ids.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ");
  const labelFor = (el) => {
    if (el.labels && el.labels.length) {
      const t = clean([...el.labels].map((l) => l.innerText).join(" "));
      if (t) return t;
    }
    const lb = el.getAttribute("aria-labelledby");
    if (lb) { const t = clean(textOfIds(lb)); if (t) return t; }
    const al = el.getAttribute("aria-label");
    if (al) return clean(al);
    let node = el.parentElement;
    for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
      const cand = node.querySelector(":scope > label, :scope > legend, :scope > .application-label, :scope > [class*='label' i], :scope > [class*='question' i]");
      if (cand && !cand.contains(el)) { const t = clean(cand.innerText); if (t) return t; }
    }
    return clean(el.getAttribute("placeholder") || el.getAttribute("name") || el.id || "");
  };
  const groupLabel = (el) => {
    const fs = el.closest("fieldset");
    const legend = fs && fs.querySelector("legend");
    if (legend) return clean(legend.innerText);
    const rg = el.closest("[role=radiogroup],[role=group]");
    if (rg) {
      const lb = rg.getAttribute("aria-labelledby");
      if (lb) return clean(textOfIds(lb));
      if (rg.getAttribute("aria-label")) return clean(rg.getAttribute("aria-label"));
    }
    let node = el.parentElement;
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      if (node.querySelectorAll("input[type=radio],input[type=checkbox]").length < 2 && depth < 2) continue;
      const cand = node.querySelector(":scope > label, :scope > .application-label, :scope > [class*='label' i], :scope > [class*='question' i], :scope > div > label:not(:has(input))");
      if (cand && !cand.contains(el)) { const t = clean(cand.innerText); if (t) return t; }
    }
    return clean(el.getAttribute("name") || "");
  };
  const optionLabel = (el) => strip(clean((el.labels && el.labels[0] && el.labels[0].innerText) || el.getAttribute("aria-label") || el.value));
  const isRequired = (el, label) => el.required || el.getAttribute("aria-required") === "true" || /[*✱]\s*$/.test(label) ||
    [...(el.labels || [])].some((l) => /required/i.test(l.className));

  let counter = Number(document.body.dataset.jobbotCounter || 0);
  const tag = (el) => {
    if (!el.dataset.jobbotId) el.dataset.jobbotId = "f" + (++counter);
    return el.dataset.jobbotId;
  };

  const fields = [];
  const groups = new Map();
  const controls = document.querySelectorAll("input, textarea, select");
  for (const el of controls) {
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (el.tagName === "INPUT" && ["hidden", "submit", "button", "reset", "image", "search"].includes(type)) continue;
    if (el.disabled || el.closest("[aria-hidden=true]")) continue;
    if (type === "file") {
      const label = labelFor(el);
      fields.push({ id: tag(el), kind: "file", label: strip(label), required: isRequired(el, label), filled: el.files.length > 0,
        value: el.files.length ? el.files[0].name : undefined, inputType: el.accept || undefined, name: el.name || el.id || undefined });
      continue;
    }
    if (type === "radio" || type === "checkbox") {
      if (!visible(el) && !(el.labels && el.labels[0] && visible(el.labels[0]))) continue;
      const container = el.closest("fieldset,[role=radiogroup],[role=group]");
      const key = type + ":" + (el.name || (container && tag(container)) || tag(el));
      let g = groups.get(key);
      if (!g) {
        g = { kind: type, els: [] };
        groups.set(key, g);
      }
      g.els.push(el);
      continue;
    }
    if (!visible(el)) continue;
    const label = labelFor(el);
    const base = { id: tag(el), label: strip(label), required: isRequired(el, label) };
    if (el.tagName === "SELECT") {
      const opts = [...el.options].map((o) => clean(o.text)).filter(Boolean);
      const sel = el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
      const filled = !!(sel && sel.value && !/^(select|choose|--)/i.test(clean(sel.text)));
      fields.push({ ...base, kind: "select", filled, value: filled ? clean(sel.text) : undefined, options: opts });
    } else if (el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete") === "list" ||
        el.parentElement.querySelector(":scope > [class*='dropdown' i]")) {
      // react-select shows the choice in a single-value node; Lever-style autocompletes store it in a hidden input.
      let shown = null;
      for (let n = el.parentElement, d = 0; n && d < 5 && !shown; n = n.parentElement, d++) {
        shown = n.querySelector("[class*='single-value' i], [class*='multi-value' i]");
      }
      const hidden = el.parentElement.querySelector(":scope > input[type=hidden]");
      const filled = shown ? true : hidden ? !!hidden.value : false;
      fields.push({ ...base, kind: "combobox", filled, value: shown ? clean(shown.innerText) : filled ? el.value : undefined });
    } else {
      fields.push({ ...base, kind: el.tagName === "TEXTAREA" ? "textarea" : "text", filled: !!el.value.trim(),
        value: el.value || undefined, inputType: type || undefined });
    }
  }
  for (const g of groups.values()) {
    const first = g.els[0];
    const id = tag(first);
    for (const el of g.els) el.dataset.jobbotGroup = id;
    const single = g.kind === "checkbox" && g.els.length === 1;
    const rawLabel = single ? (groupLabel(first) || optionLabel(first)) : groupLabel(first);
    const label = strip(rawLabel);
    const checked = g.els.filter((e) => e.checked).map(optionLabel);
    fields.push({ id, kind: g.kind, label: single && label !== optionLabel(first) ? label + " — " + optionLabel(first) : label,
      required: g.els.some((e) => isRequired(e, rawLabel)), filled: checked.length > 0,
      value: checked.length ? checked.join(", ") : undefined, options: single ? undefined : g.els.map(optionLabel) });
  }
  document.body.dataset.jobbotCounter = String(counter);
  return fields;
})()`;

export async function scanFields(page: Page): Promise<FormField[]> {
  return (await page.evaluate(SCAN_SCRIPT)) as FormField[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Picks the option that best matches the wanted value: exact, then leading words, then whole-word containment. */
export function bestOption(options: string[], wanted: string): string | undefined {
  const w = norm(wanted);
  return (
    options.find((o) => norm(o) === w) ??
    options.find((o) => norm(o).startsWith(`${w} `)) ??
    options.find((o) => ` ${norm(o)} `.includes(` ${w} `)) ??
    options.find((o) => norm(o).length > 1 && ` ${w} `.includes(` ${norm(o)} `))
  );
}

/** Fills one field. Returns a short description of what happened. */
export async function fillField(page: Page, field: FormField, value: string): Promise<string> {
  const loc = page.locator(`[data-jobbot-id="${field.id}"]`).first();
  switch (field.kind) {
    case "text":
    case "textarea":
      await loc.fill(value);
      return "filled";
    case "file":
      await loc.setInputFiles(value);
      return `attached ${value}`;
    case "select": {
      const opt = bestOption(field.options ?? [], value);
      if (!opt) throw new Error(`No option matching "${value}". Options: ${field.options?.join(" | ")}`);
      await loc.selectOption({ label: opt });
      return `selected "${opt}"`;
    }
    case "radio":
    case "checkbox": {
      const wanted =
        field.kind === "checkbox" && !field.options
          ? [] // single checkbox: value is true/false
          : value.split(/\s*[,;|]\s*/).filter(Boolean);
      const picks =
        field.options === undefined
          ? []
          : wanted.map((w) => {
              const o = bestOption(field.options!, w);
              if (!o) throw new Error(`No option matching "${w}". Options: ${field.options!.join(" | ")}`);
              return o;
            });
      const singleOn = /^(true|yes|y|1|checked|on|agree|i agree)$/i.test(value.trim());
      const args = JSON.stringify({ group: field.id, picks, single: field.options === undefined, singleOn });
      await page.evaluate(String.raw`((a) => {
        const els = [...document.querySelectorAll('[data-jobbot-group="' + a.group + '"]')];
        const label = (e) => ((e.labels && e.labels[0] && e.labels[0].innerText) || e.getAttribute("aria-label") || e.value)
          .replace(/\s+/g, " ").replace(/\s*[*✱]\s*$/, "").trim();
        for (const e of els) {
          const want = a.single ? a.singleOn : a.picks.includes(label(e));
          if (e.checked !== want) ((e.labels && e.labels[0]) || e).click();
        }
      })(${args})`);
      return field.options === undefined ? (singleOn ? "checked" : "unchecked") : `chose ${picks.join(", ")}`;
    }
    case "combobox": {
      // Type the full value first, then just the part before the first comma ("Seattle, WA" -> "Seattle").
      const queries = [...new Set([value, value.split(",")[0].trim()])];
      let seen: string[] = [];
      for (const q of queries) {
        await loc.click();
        await loc.fill("");
        await loc.pressSequentially(q, { delay: 25 });
        const listId = await loc.getAttribute("aria-controls");
        const options = (listId ? page.locator(`[id="${listId}"] [role=option]`) : page.locator("[role=option]:visible"))
          .or(page.locator("[class*='dropdown-results' i] > *:visible"));
        await options.first().waitFor({ timeout: 5000 }).catch(() => {});
        seen = (await options.allInnerTexts()).map((t) => t.trim()).filter(Boolean);
        const opt = bestOption(seen, value) ?? bestOption(seen, q);
        if (opt) {
          await options.filter({ hasText: opt }).first().click();
          return `selected "${opt}"`;
        }
      }
      await loc.press("Escape").catch(() => {});
      await loc.fill("");
      throw new Error(seen.length ? `No option matching "${value}". Options: ${seen.slice(0, 40).join(" | ")}` : `No options appeared for "${value}"`);
    }
  }
}

/** Screenshot of the application form (or full page if the form can't be isolated). */
export async function screenshotForm(page: Page, path: string): Promise<Buffer> {
  const form = page.locator("form:has([data-jobbot-id])").last();
  if ((await form.count()) > 0) {
    try {
      return await form.screenshot({ path, type: "jpeg", quality: 60 });
    } catch {
      // fall through to full page
    }
  }
  return page.screenshot({ path, type: "jpeg", quality: 60, fullPage: true });
}

const SUBMIT_TEXT = /^(submit( application| your application)?|apply|send application|apply now)$/i;

export async function findSubmitButton(page: Page) {
  const buttons = page.locator("button, input[type=submit]");
  const n = await buttons.count();
  for (let i = n - 1; i >= 0; i--) {
    const b = buttons.nth(i);
    if (!(await b.isVisible())) continue;
    const text = ((await b.innerText().catch(() => "")) || (await b.getAttribute("value")) || "").trim();
    if (SUBMIT_TEXT.test(text)) return b;
  }
  const typed = page.locator("form button[type=submit], form input[type=submit]").last();
  return (await typed.count()) > 0 ? typed : undefined;
}

export const CONFIRMATION_RE =
  /thank(s| you) for (applying|your (application|interest))|application (has been |was )?(received|submitted)|we('ve| have) received your application|successfully submitted/i;
