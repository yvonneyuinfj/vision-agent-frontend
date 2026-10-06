/** 轻量、零依赖、XSS 安全的 Markdown 渲染器。
 *  用于渲染 AI 回答与知识库引用片段（内容来自模型/文档，不可信）。
 *  策略：先按块解析（围栏代码 / 标题 / 引用 / 表格 / 列表 / 段落），
 *  文本一律先 HTML 转义再生成受控标签；不支持原始 HTML 注入，链接仅放行安全协议。 */

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESC[c]);
}

/** 仅放行 http(s)/mailto/tel/相对路径/锚点，其余（如 javascript:）返回空串。 */
function safeUrl(u: string): string {
  const url = u.trim();
  if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(url)) return url;
  if (/^[\w./?=&%#-]+$/.test(url)) return url; // 无协议相对路径
  return '';
}

/** 行内语法：入参必须是「已 HTML 转义」的文本。 */
function renderInline(escaped: string): string {
  const codes: string[] = [];
  // 先摘出行内代码，避免其内部的 * _ 等被当作强调
  let s = escaped.replace(/`([^`\n]+)`/g, (_m, code) => {
    const idx = codes.length;
    codes.push(`<code class="md-code">${code}</code>`);
    return `\u0001${idx}\u0001`;
  });
  // 图片 ![alt](url)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, url) => {
    const u = safeUrl(url);
    return u ? `<img src="${u}" alt="${alt}" class="md-img" loading="lazy">` : alt;
  });
  // 链接 [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, url) => {
    const u = safeUrl(url);
    return u ? `<a href="${u}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
  });
  // 粗斜体 / 粗体 / 斜体 / 删除线
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\s](?:[^_]*[^_\s])?)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\\])\*(?!\s)([^*\n]+?)\*/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');
  // 还原行内代码
  s = s.replace(/\u0001(\d+)\u0001/g, (_m, i) => codes[Number(i)]);
  return s;
}

const inline = (raw: string): string => renderInline(escapeHtml(raw));

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function cellAlign(cell: string): string {
  const c = cell.trim();
  if (/^:-+:$/.test(c)) return 'center';
  if (/^-+:$/.test(c)) return 'right';
  if (/^:-+/.test(c)) return 'left';
  return '';
}

function alignAttr(a: string): string {
  return a ? ` style="text-align:${a}"` : '';
}

function renderTable(header: string[], aligns: string[], rows: string[][]): string {
  const th = header.map((h, idx) => `<th${alignAttr(aligns[idx])}>${inline(h)}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${header.map((_h, idx) => `<td${alignAttr(aligns[idx])}>${inline(r[idx] ?? '')}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}

const isBlank = (l: string): boolean => !l || !l.trim();
const headingRe = /^(#{1,6})\s+(.*)$/;
const fenceRe = /^\s*```([\w-]*)\s*$/;
const fenceEndRe = /^\s*```\s*$/;
const quoteRe = /^\s*>\s?/;
const hrRe = /^\s*([-*_])[ \t]*(\1[ \t]*){2,}$/;
const itemRe = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;
const indentOf = (l: string): number => (/^\s*/.exec(l)?.[0] || '').length;

/** 解析一个列表块（支持按缩进嵌套、有序/无序）。返回 HTML 与下一行下标。 */
function parseList(lines: string[], start: number): { html: string; next: number } {
  const baseIndent = indentOf(lines[start]);
  const tag = /^\s*\d+\./.test(lines[start]) ? 'ol' : 'ul';
  const items: string[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      // 空行：若后续仍有同缩进列表项则视为松散列表续接，否则结束
      let j = i + 1;
      while (j < lines.length && isBlank(lines[j])) j += 1;
      const nm = j < lines.length ? itemRe.exec(lines[j]) : null;
      if (nm && indentOf(lines[j]) === baseIndent) { i = j; continue; }
      break;
    }
    const m = itemRe.exec(line);
    if (m && indentOf(line) === baseIndent) {
      // 标记类型变化（有序<->无序）视为新列表，交回外层重新解析
      if ((tag === 'ol') !== /^\d/.test(m[2])) break;
      const parts: string[] = [inline(m[3])];
      i += 1;
      while (i < lines.length) {
        const nl = lines[i];
        if (isBlank(nl)) break;
        const ni = indentOf(nl);
        const nmi = itemRe.exec(nl);
        if (nmi && ni <= baseIndent) break; // 同级或更外层，交回上层循环
        if (nmi && ni > baseIndent) {
          const sub = parseList(lines, i);
          parts.push(sub.html);
          i = sub.next;
          continue;
        }
        if (ni > baseIndent) { parts.push(inline(nl.trim())); i += 1; continue; } // 续行
        break;
      }
      items.push(`<li>${parts.join(' ').trim()}</li>`);
      continue;
    }
    // 更深层缩进的普通段落行：并入上一项
    if (indentOf(line) > baseIndent && items.length) {
      items[items.length - 1] = items[items.length - 1].replace(/<\/li>$/, ` ${inline(line.trim())}</li>`);
      i += 1;
      continue;
    }
    break;
  }
  return { html: `<${tag} class="md-list">${items.join('')}</${tag}>`, next: i };
}

/** 主入口：把 Markdown 文本渲染为安全的 HTML 字符串。 */
export function renderMarkdown(src: string): string {
  if (!src) return '';
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i += 1; continue; }

    const fence = fenceRe.exec(line);
    if (fence) {
      const lang = fence[1];
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !fenceEndRe.test(lines[i])) { buf.push(lines[i]); i += 1; }
      i += 1; // 跳过结束围栏
      out.push(`<pre class="md-pre"${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    const h = headingRe.exec(line);
    if (h) {
      const lvl = h[1].length;
      out.push(`<h${lvl} class="md-h">${inline(h[2].replace(/\s+#+\s*$/, ''))}</h${lvl}>`);
      i += 1;
      continue;
    }

    if (hrRe.test(line)) { out.push('<hr class="md-hr">'); i += 1; continue; }

    if (quoteRe.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && quoteRe.test(lines[i])) { buf.push(lines[i].replace(quoteRe, '')); i += 1; }
      out.push(`<blockquote class="md-quote">${renderMarkdown(buf.join('\n'))}</blockquote>`);
      continue;
    }

    // 表格：本行含 | 且下一行是分隔行
    if (line.includes('|') && i + 1 < lines.length && /-/.test(lines[i + 1]) && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const header = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map(cellAlign);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && !isBlank(lines[i])) { rows.push(splitRow(lines[i])); i += 1; }
      out.push(renderTable(header, aligns, rows));
      continue;
    }

    if (itemRe.test(line)) {
      const res = parseList(lines, i);
      out.push(res.html);
      i = res.next;
      continue;
    }

    // 段落：收集连续普通行
    const para: string[] = [];
    while (
      i < lines.length && !isBlank(lines[i]) &&
      !fenceRe.test(lines[i]) && !headingRe.test(lines[i]) &&
      !quoteRe.test(lines[i]) && !itemRe.test(lines[i]) && !hrRe.test(lines[i])
    ) {
      para.push(lines[i]); i += 1;
    }
    if (para.length) out.push(`<p class="md-p">${para.map((l) => inline(l.trim())).join('<br>')}</p>`);
  }
  return out.join('\n');
}

/** 从文本中剥离  /  思维链（含流式未闭合的情况）。 */
export function extractThink(src: string): { think: string; body: string } {
  let think = '';
  let body = src || '';
  body = body.replace(/<(think|thinking)>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) => {
    think += (think ? '\n\n' : '') + String(inner).trim();
    return '';
  });
  // 未闭合的尾部  / （流式生成中）
  const open = /<(think|thinking)>([\s\S]*)$/i.exec(body);
  if (open) {
    think += (think ? '\n\n' : '') + open[2].trim();
    body = body.replace(/<(think|thinking)>[\s\S]*$/i, '');
  }
  return { think: think.trim(), body: body.trim() };
}
