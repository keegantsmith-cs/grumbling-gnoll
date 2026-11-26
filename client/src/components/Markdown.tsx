// A tiny, safe Markdown renderer (no raw HTML allowed) for AI output and notes.
import { useMemo } from "react";

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function inline(s: string) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      const lvl = Math.min(4, m[1].length + 1);
      out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`);
      i++;
    } else if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      out.push("<hr/>"); i++;
    } else if (line.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${buf.map(inline).join("<br/>")}</blockquote>`);
    } else if (/^\s*[-*+]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) buf.push(`<li>${inline(lines[i++].replace(/^\s*[-*+]\s+/, ""))}</li>`);
      out.push(`<ul>${buf.join("")}</ul>`);
    } else if (/^\s*\d+[.)]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) buf.push(`<li>${inline(lines[i++].replace(/^\s*\d+[.)]\s+/, ""))}</li>`);
      out.push(`<ol>${buf.join("")}</ol>`);
    } else if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i++].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells);
      }
      const [head, ...body] = rows;
      out.push(`<table><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</table>`);
    } else {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|>|\s*[-*+]\s|\s*\d+[.)]\s|\s*\|)/.test(lines[i])) buf.push(inline(lines[i++]));
      out.push(`<p>${buf.join("<br/>")}</p>`);
    }
  }
  return out.join("\n");
}

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text || ""), [text]);
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
