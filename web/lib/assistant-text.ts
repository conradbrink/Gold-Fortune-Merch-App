/**
 * The little formatting an answer may carry, read safely.
 *
 * The assistant is told to write short paragraphs, bullet points and the odd
 * **bold** figure. This turns exactly that into blocks the panel renders as
 * React elements, so nothing the model writes is ever treated as HTML.
 */

export type Span = { text: string; bold: boolean };

export type Block =
  | { type: "p"; spans: Span[] }
  | { type: "ul"; items: Span[][] }
  | { type: "ol"; items: Span[][] };

export function spans(text: string): Span[] {
  const out: Span[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      out.push({ text: part.slice(2, -2), bold: true });
    } else {
      out.push({ text: part, bold: false });
    }
  }
  return out;
}

const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

export function parseAnswer(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length) blocks.push({ type: "p", spans: spans(paragraph.join(" ")) });
    paragraph = [];
  };

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const kind = BULLET.test(line) ? "ul" : NUMBERED.test(line) ? "ol" : null;
    if (kind) {
      flush();
      const item = spans(line.replace(kind === "ul" ? BULLET : NUMBERED, ""));
      const last = blocks[blocks.length - 1];
      if (last && last.type === kind) last.items.push(item);
      else blocks.push({ type: kind, items: [item] });
    } else {
      // A heading the model wrote anyway reads as a plain line.
      paragraph.push(line.replace(/^#+\s*/, "").trim());
    }
  }
  flush();
  return blocks;
}
