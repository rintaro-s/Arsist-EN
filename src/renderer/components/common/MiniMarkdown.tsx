/**
 * 拡張機能の README を画面に出すための、小さな Markdown 表示。
 *
 * 依存を足さずに、README で使っている書き方だけを扱う: 見出し・段落・箇条書き (入れ子・番号つき)・
 * コードブロック・表・引用・区切り線、行の中の `コード` / **太字** / [リンク](url)。
 * HTML としては一切解釈しない (React の要素だけで組む)。拡張機能は他人が書いたものかもしれないので。
 */
import type { ReactNode } from 'react';

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: Array<{ text: string; depth: number }> }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'quote'; text: string }
  | { kind: 'rule' };

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const splitRow = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = /^\s*(```|~~~)\s*(\S*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      blocks.push({ kind: 'code', lang: fence[2], text: body.join('\n') });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ kind: 'rule' });
      i++;
      continue;
    }
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(splitRow(lines[i++]));
      blocks.push({ kind: 'table', header, rows });
      continue;
    }
    if (line.trim().startsWith('>')) {
      const body: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) body.push(lines[i++].trim().replace(/^>\s?/, ''));
      blocks.push({ kind: 'quote', text: body.join(' ') });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const ordered = /\d/.test(item[2]);
      const items: Array<{ text: string; depth: number }> = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i]);
        if (m) {
          items.push({ text: m[3], depth: Math.min(3, Math.floor(m[1].replace(/\t/g, '  ').length / 2)) });
          i++;
        } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length > 0) {
          // 箇条の続きの行
          items[items.length - 1].text += ` ${lines[i].trim()}`;
          i++;
        } else {
          break;
        }
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() && !LIST_ITEM.test(lines[i]) && !/^(#{1,6}\s|```|~~~|\s*\|)/.test(lines[i])) {
      body.push(lines[i++].trim());
    }
    if (body.length === 0) { i++; continue; }
    blocks.push({ kind: 'paragraph', text: body.join(' ') });
  }
  return blocks;
}

/** 行の中: `コード`、**太字**、[文字](url) (url は title に出すだけ。勝手に開かない) */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = pattern.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${n++}`;
    if (m[1] !== undefined) out.push(<code key={key} className="px-1 py-px rounded bg-arsist-bg/70 font-mono text-[0.92em]">{m[1]}</code>);
    else if (m[2] !== undefined) out.push(<strong key={key} className="font-semibold text-arsist-text">{inline(m[2], key)}</strong>);
    else out.push(<span key={key} className="text-arsist-accent" title={m[4]}>{inline(m[3], key)}</span>);
    last = pattern.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function MiniMarkdown({ source, className = '' }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className={`text-xs leading-relaxed text-arsist-text/90 space-y-2.5 ${className}`}>
      {blocks.map((b, i) => {
        const key = `b${i}`;
        switch (b.kind) {
          case 'heading': {
            const size = b.level <= 1 ? 'text-base' : b.level === 2 ? 'text-sm' : 'text-xs';
            return <p key={key} className={`${size} font-semibold text-arsist-text ${b.level <= 2 ? 'pt-2' : 'pt-1'}`}>{inline(b.text, key)}</p>;
          }
          case 'paragraph':
            return <p key={key}>{inline(b.text, key)}</p>;
          case 'list': {
            const Tag = b.ordered ? 'ol' : 'ul';
            return (
              <Tag key={key} className={`space-y-1 ${b.ordered ? 'list-decimal' : 'list-disc'} pl-5`}>
                {b.items.map((it, j) => (
                  <li key={j} style={{ marginLeft: it.depth * 14 }}>{inline(it.text, `${key}-${j}`)}</li>
                ))}
              </Tag>
            );
          }
          case 'code':
            return <pre key={key} className="font-mono text-[11px] bg-arsist-bg/70 rounded-md p-2.5 overflow-x-auto whitespace-pre">{b.text}</pre>;
          case 'table':
            return (
              <div key={key} className="overflow-x-auto">
                <table className="text-[11px] border-collapse">
                  <thead>
                    <tr>{b.header.map((h, j) => <th key={j} className="text-left font-semibold text-arsist-text px-2 py-1 hairline-b">{inline(h, `${key}-h${j}`)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j} className={j % 2 ? 'bg-arsist-bg/30' : ''}>
                        {r.map((c, k) => <td key={k} className="px-2 py-1 align-top">{inline(c, `${key}-${j}-${k}`)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'quote':
            return <p key={key} className="pl-3 text-arsist-muted" style={{ borderLeft: '2px solid rgb(var(--arsist-divider) / var(--arsist-divider-alpha))' }}>{inline(b.text, key)}</p>;
          case 'rule':
            return <div key={key} className="hairline-b" />;
          default:
            return null;
        }
      })}
    </div>
  );
}
