import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

/** Extracts plain text from a PDF, DOCX, TXT, or MD resume. */
export async function extractResumeText(path: string): Promise<string> {
  const ext = extname(path).toLowerCase();
  const buffer = await readFile(path);
  switch (ext) {
    case ".pdf": {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractText(pdf, { mergePages: true });
      return text.trim();
    }
    case ".docx": {
      const { value } = await mammoth.extractRawText({ buffer });
      return value.trim();
    }
    case ".txt":
    case ".md":
      return buffer.toString("utf8").trim();
    default:
      throw new Error(`Unsupported resume format "${ext}". Use .pdf, .docx, .txt, or .md`);
  }
}
