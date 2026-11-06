const React = require('react');
const { useState, useEffect, useRef, useSyncExternalStore } = React;
const h = React.createElement;
const PANEL = 'hardwise-desk';
const button = (label, onClick, props = {}) => h('button', { type: 'button', onClick, ...props }, label);
const date = value => value ? new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : '—';
const pending = run => (run?.review_counts.open || 0) + (run?.review_counts.needs_info || 0);
const count = (runs, field) => runs.reduce((sum, run) => sum + (run.review_counts[field] || 0), 0);
async function fetchJSON(url, signal) {
  const response = await fetch(url, { signal }); const data = await response.json();
  if (!response.ok) throw new Error(data.detail || '暂时无法连接，请重试。'); return data;
}
function Glyph({ name = 'chip', size = 20 }) {
  const paths = {
    chip: 'M8 8h8v8H8z M9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3',
    arrow: 'M5 12h14m-5-5 5 5-5 5', folder: 'M3 7V5h6l2 2h10v12H3z',
    plus: 'M12 5v14M5 12h14', back: 'm10 5-7 7 7 7M3 12h18',
    chat: 'M4 4h16v12H9l-5 4z', check: 'm5 12 4 4 10-10',
    search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6',
    close: 'm6 6 12 12M6 18 18 6', file: 'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 4v5l3 2',
  };
  return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5,
    strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: paths[name] || paths.chip }));
}
function BoardMark({ variant = 0 }) {
  return h('div', { className: `hd-board hd-board-${variant % 3}`, 'aria-hidden': true },
    h('svg', { viewBox: '0 0 400 180', fill: 'none' },
      h('path', { d: 'M0 46h82l30 30h60M0 140h68l36-36h68M400 36H300l-40 40h-32M400 142h-92l-36-38h-44M202 0v50M202 130v50', stroke: 'currentColor', strokeWidth: 1.4 }),
      h('rect', { x: 172, y: 50, width: 56, height: 80, rx: 5, stroke: 'currentColor', strokeWidth: 1.4 }),
      ...[63, 77, 91, 105, 119].flatMap(y => [h('path', { key: `a${y}`, d: `M160 ${y}h12M228 ${y}h12`, stroke: 'currentColor', strokeWidth: 2 })]),
      ...[[82,46],[68,140],[300,36],[308,142]].map(([cx,cy]) => h('circle', { key: `${cx}`, cx, cy, r: 4, fill: 'currentColor' })),
      h('path', { d: 'M192 68h16v44h-16z', fill: 'currentColor', opacity: .16 })),
    h('span', null, 'SOURCE / EVIDENCE'));
}
