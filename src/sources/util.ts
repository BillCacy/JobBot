const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/** Best-effort annual salary range from free text like "$150,000 - $190,000" or "$211.4K – $290.6K". */
export function parseSalaryRange(text: string): { min?: number; max?: number } {
  const amount = String.raw`\$\s?(\d{2,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?\s?[kK]|\d{5,7}(?:\.\d+)?)`;
  const m = new RegExp(`${amount}\\s*(?:-|–|—|to)\\s*${amount}`).exec(text);
  if (!m) return {};
  const toNum = (s: string) => {
    const clean = s.replace(/[\s,]/g, "");
    return /k$/i.test(clean) ? Math.round(parseFloat(clean) * 1000) : Number(clean);
  };
  const min = toNum(m[1]);
  const max = toNum(m[2]);
  // Ignore hourly ranges and other noise.
  if (min < 20000 || max < min) return {};
  return { min, max };
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`);
  return (await res.json()) as T;
}

export const REMOTE_RE = /\bremote\b/i;
