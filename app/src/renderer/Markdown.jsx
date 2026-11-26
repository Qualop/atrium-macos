// 마크다운 보기(P6c: 출력 보기 I1, 메모 노드 I3). lib/markdown.js가 만든 나무를 React 요소로 그린다(HTML을 끼워 넣지 않는다).
// 링크는 판 창 안에서 열지 않는다. P283: 누르면 open-link.js 규칙으로 연다(PC 창: 기본 브라우저, 원격 웹: 새 탭, http·https만). 할 일 상자는 onToggle(차례, 참/거짓)을 주면 누를 수 있다(메모 노드, lib/markdown.js toggleTask).
import { useMemo } from 'react';
import { parseMarkdown } from './lib/markdown.js';
import { useT } from './lib/i18n.js';
import { openLink } from './open-link.js';

function Inline({ c }) {
  const t = useT();
  return c.map((n, i) => {
    if (typeof n === 'string') return <span key={i}>{n}</span>;
    if (n.t === 'code') return <code key={i}>{n.text}</code>;
    if (n.t === 'b') return <strong key={i}><Inline c={n.c} /></strong>;
    if (n.t === 'i') return <em key={i}><Inline c={n.c} /></em>;
    if (n.t === 's') return <del key={i}><Inline c={n.c} /></del>;
    if (n.t === 'a') return <a key={i} href={n.href} className="nodrag" data-link="" title={`${n.href}\n${t('markdown.openLink')}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); openLink(n.href); }}><Inline c={n.c} /></a>;
    return null;
  });
}

function Blocks({ blocks, onToggle, ctr, path = '' }) {
  return blocks.map((b, i) => {
    const k = `${path}${i}`;
    if (b.t === 'h') { const H = `h${Math.min(6, b.level)}`; return <H key={k}><Inline c={b.c} /></H>; }
    if (b.t === 'p') return <p key={k}><Inline c={b.c} /></p>;
    if (b.t === 'code') return <pre key={k} className="mt-md-code" data-lang={b.lang || undefined}><code>{b.text}</code></pre>;
    if (b.t === 'hr') return <hr key={k} />;
    if (b.t === 'quote') return <blockquote key={k}><Blocks blocks={b.c} onToggle={onToggle} ctr={ctr} path={`${k}.`} /></blockquote>;
    if (b.t === 'ul' || b.t === 'ol') {
      const L = b.t;
      return (
        <L key={k} start={b.t === 'ol' && b.start !== 1 ? b.start : undefined}>
          {b.items.map((it, j) => {
            const n = it.checked != null ? ctr.n++ : -1; // 할 일 상자의 문서 안 차례(글에서 바꿀 줄을 찾는다)
            return (
              <li key={j} className={it.checked != null ? 'task' : undefined}>
                {it.checked != null && <input type="checkbox" className="nodrag" data-task={n} checked={it.checked} readOnly={!onToggle} onChange={() => onToggle && onToggle(n, !it.checked)} />}
                <Inline c={it.c} />
                {it.sub.length > 0 && <Blocks blocks={it.sub} onToggle={onToggle} ctr={ctr} path={`${k}.${j}.`} />}
              </li>
            );
          })}
        </L>
      );
    }
    if (b.t === 'table') return (
      <table key={k}><thead><tr>{b.head.map((c, j) => <th key={j} style={{ textAlign: b.align[j] || undefined }}><Inline c={c} /></th>)}</tr></thead>
        <tbody>{b.rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j} style={{ textAlign: b.align[j] || undefined }}><Inline c={c} /></td>)}</tr>)}</tbody></table>
    );
    return null;
  });
}

export function Markdown({ text, className = '', onToggle }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className={`mt-md ${className}`}><Blocks blocks={blocks} onToggle={onToggle} ctr={{ n: 0 }} /></div>;
}
