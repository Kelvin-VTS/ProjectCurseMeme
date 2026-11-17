/**
 * 极简 Markdown 渲染器。
 *
 * 为什么自己写而不引入 marked + DOMPurify：
 *   正文来自投稿（不可信）。marked 默认**原样透传 HTML**，必须再配 DOMPurify 消毒，
 *   两个依赖、两层配置，配错一次就是存储型 XSS。这里的策略更简单也更安全：
 *   **先把所有文本转义，再只生成白名单标签** —— 输入里的 `<script>` 永远只是文字。
 *
 * 支持的语法（够日常用）：
 *   标题 #/##/###、粗体 **x**、斜体 *x*、删除线 ~~x~~、
 *   行内代码 `x`、代码块 ```、链接 [文本](http/https)、
 *   无序/有序列表、引用 >、分隔线 ---、段落与换行。
 */

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPE_MAP[char] ?? char);
}

/** 只放行 http/https 链接，挡掉 javascript: 之类 */
function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (!/^https?:\/\//i.test(url)) return null;
  // 尖括号和引号已经在转义阶段处理过，这里只是双保险
  if (/["'<>\s]/.test(url)) return null;
  return url;
}

function inline(text: string): string {
  let out = escapeHtml(text);

  // 行内代码先抽出来占位，避免里面的 * 和 [ 被当成其它语法
  const codes: string[] = [];
  out = out.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });

  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    const safe = safeHref(href);
    if (!safe) return match;
    return `<a href="${safe}" target="_blank" rel="noreferrer noopener">${label}</a>`;
  });

  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  // 斜体：前后不能紧挨着字母，避免把 2*3*4 这种算式吃掉
  out = out.replace(/(^|[^\w*])\*([^*\n]+)\*(?![\w*])/g, '$1<em>$2</em>');

  out = out.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => `<code>${codes[Number(index)]}</code>`);

  return out;
}

/** 把连续的普通行合成一段，行间用 <br> 保留换行（笔记类内容很依赖换行） */
function paragraph(lines: string[]): string {
  const html = lines.map((line) => inline(line.trim())).join('<br>');
  return `<p>${html}</p>`;
}

export function renderMarkdown(source: string): string {
  const text = (source ?? '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return '';

  const lines = text.split('\n');
  const out: string[] = [];
  let index = 0;

  const isFence = (line: string) => /^\s*```/.test(line);
  const isHeading = (line: string) => /^\s{0,3}(#{1,6})\s+/.test(line);
  const isHr = (line: string) => /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line);
  const isQuote = (line: string) => /^\s{0,3}>\s?/.test(line);
  const isUl = (line: string) => /^\s{0,3}[-*+]\s+/.test(line);
  const isOl = (line: string) => /^\s{0,3}\d+[.)]\s+/.test(line);

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    // ---- 代码块
    if (isFence(line)) {
      index += 1;
      const body: string[] = [];
      while (index < lines.length && !isFence(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1; // 吃掉收尾 ```
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    // ---- 标题
    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(6, Math.max(2, heading[1].length + 1)); // # → h2，# 以上的不再出现 h1
      out.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      index += 1;
      continue;
    }

    // ---- 分隔线
    if (isHr(line)) {
      out.push('<hr>');
      index += 1;
      continue;
    }

    // ---- 引用
    if (isQuote(line)) {
      const body: string[] = [];
      while (index < lines.length && isQuote(lines[index])) {
        body.push(lines[index].replace(/^\s{0,3}>\s?/, ''));
        index += 1;
      }
      out.push(`<blockquote>${paragraph(body)}</blockquote>`);
      continue;
    }

    // ---- 无序列表
    if (isUl(line)) {
      const items: string[] = [];
      while (index < lines.length && isUl(lines[index])) {
        items.push(lines[index].replace(/^\s{0,3}[-*+]\s+/, ''));
        index += 1;
      }
      out.push(`<ul>${items.map((item) => `<li>${inline(item.trim())}</li>`).join('')}</ul>`);
      continue;
    }

    // ---- 有序列表
    if (isOl(line)) {
      const items: string[] = [];
      while (index < lines.length && isOl(lines[index])) {
        items.push(lines[index].replace(/^\s{0,3}\d+[.)]\s+/, ''));
        index += 1;
      }
      out.push(`<ol>${items.map((item) => `<li>${inline(item.trim())}</li>`).join('')}</ol>`);
      continue;
    }

    // ---- 段落：吃到空行或下一个块级语法为止
    const body: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isFence(lines[index]) &&
      !isHeading(lines[index]) &&
      !isHr(lines[index]) &&
      !isQuote(lines[index]) &&
      !isUl(lines[index]) &&
      !isOl(lines[index])
    ) {
      body.push(lines[index]);
      index += 1;
    }
    out.push(paragraph(body));
  }

  return out.join('\n');
}

/**
 * 把 Markdown 压成一行纯文本，用于卡片摘要与搜索匹配。
 * 只做「去标记」，不追求还原语义。
 */
export function plainText(source: string): string {
  return (source ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}([-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/gm, ' ')
    .replace(/(\*\*|~~|\*|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 截断到 max 个字符，尽量在标点处断开 */
export function excerpt(source: string, max: number): string {
  const text = plainText(source);
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const cut = Math.max(
    slice.lastIndexOf('。'),
    slice.lastIndexOf('！'),
    slice.lastIndexOf('？'),
    slice.lastIndexOf('.'),
  );
  if (cut > max * 0.6) return `${slice.slice(0, cut + 1)}…`;
  return `${slice}…`;
}
