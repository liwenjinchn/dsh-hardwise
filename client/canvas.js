// Original engineering canvas implementation, inspired by dsh-media-desk's spatial homepage.
const CANVAS_STORAGE = 'hardwise.canvas.positions.v1';
const clampZoom = value => Math.min(1.6, Math.max(.25, value));
function canvasSlot(index) {
  const row = Math.floor(index / 2), side = index % 2 ? 1 : -1;
  return { x: side * (430 + (row % 2 ? 24 : 0)), y: -180 + row * 350, r: side * (row % 2 ? -3 : 4) };
}
function readCanvasPositions() {
  try {
    const data = JSON.parse(localStorage.getItem(CANVAS_STORAGE) || '{}');
    return Object.fromEntries(Object.entries(data).filter(([, p]) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) < 100000 && Math.abs(p.y) < 100000 && (p.r === undefined || Number.isFinite(p.r))));
  } catch { return {}; }
}
function canvasFit(width, height, points) {
  const left = Math.min(-245, ...points.map(p => p.x - 155));
  const right = Math.max(245, ...points.map(p => p.x + 155));
  const top = Math.min(-185, ...points.map(p => p.y - 168));
  const bottom = Math.max(185, ...points.map(p => p.y + 168));
  const z = clampZoom(Math.min(1, (width - 64) / (right - left), (height - 64) / (bottom - top)));
  return { x: -(left + right) / 2 * z, y: -(top + bottom) / 2 * z, z };
}
function ProjectCanvas({ projects, filtered, loading, error, query, setQuery, onlyPending, setOnlyPending, onOpen, onCreate, onRefresh, onGrid }) {
  const stage = useRef(null), gesture = useRef(null), dragged = useRef(false);
  const [positions, setPositions] = useState(readCanvasPositions);
  const [camera, setCamera] = useState({ x: 0, y: 0, z: 1 });
  const [moving, setMoving] = useState(false);
  const [size, setSize] = useState({ width: 1200, height: 720 });
  const latest = useRef(null);
  const ordered = [...projects].sort((a, b) => a.workspace.localeCompare(b.workspace));
  const point = project => positions[project.workspace] || canvasSlot(ordered.findIndex(p => p.workspace === project.workspace));
  const all = projects.flatMap(p => p.runs);
  const fit = () => setCamera(canvasFit(size.width, size.height, filtered.map(point)));
  latest.current = { camera, positions, size, filtered, point };
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(stage.current); return () => observer.disconnect();
  }, []);
  const visibleKey = filtered.map(p => p.workspace).join('\n');
  useEffect(() => { fit(); }, [size.width, size.height, visibleKey]);
  const zoom = (factor, anchor = { x: 0, y: 0 }) => setCamera(c => {
    const z = clampZoom(c.z * factor), ratio = z / c.z;
    return { z, x: anchor.x - (anchor.x - c.x) * ratio, y: anchor.y - (anchor.y - c.y) * ratio };
  });
  useEffect(() => {
    const el = stage.current;
    const wheel = e => {
      if (e.target.closest('[data-canvas-ui]')) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        zoom(Math.exp(-e.deltaY * .008), { x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 });
      } else setCamera(c => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  const finish = e => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    if (dragged.current && g.key) {
      try { localStorage.setItem(CANVAS_STORAGE, JSON.stringify(latest.current.positions)); } catch {}
    }
    gesture.current = null; setMoving(false);
    if (g.capture.hasPointerCapture(e.pointerId)) g.capture.releasePointerCapture(e.pointerId);
  };
  const keyMove = e => {
    if (e.target !== e.currentTarget) return;
    const deltas = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] };
    if (deltas[e.key]) { e.preventDefault(); const [x, y] = deltas[e.key]; setCamera(c => ({ ...c, x: c.x + x, y: c.y + y })); }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(1.2); }
    if (e.key === '-') { e.preventDefault(); zoom(1 / 1.2); }
    if (e.key === 'Home') { e.preventDefault(); fit(); }
  };
  return h('div', { className: 'hd-canvas-home' },
    h('div', { className: 'hd-canvas-toolbar' },
      h('div', null, h('b', null, '工程空间'), h('span', null, '把线索铺开，让判断有据可依。')),
      h('div', { className: 'hd-toolbar' },
        h('label', { className: 'hd-search' }, h(Glyph, { name: 'search', size: 16 }), h('input', { type: 'search', value: query, placeholder: '搜索工程', 'aria-label': '搜索工程', onChange: e => setQuery(e.target.value) })),
        button(onlyPending ? '全部工程' : '仅待跟进', () => setOnlyPending(!onlyPending), { className: `hd-btn ${onlyPending ? 'active' : ''}`, 'aria-pressed': onlyPending }),
        button('关联工程', onCreate, { className: 'hd-btn hd-primary' }))),
    error && h('div', { role: 'alert', className: 'hd-alert' }, error, button('重试', onRefresh, { className: 'hd-btn' })),
    h('div', { className: `hd-canvas-stage${moving ? ' is-moving' : ''}`, ref: stage, tabIndex: 0, role: 'region', 'aria-label': '工程画布：方向键移动，加减键缩放，Home 键总览', onKeyDown: keyMove,
      onPointerDown: e => {
        if (e.button !== 0 || gesture.current) return;
        dragged.current = false;
        if (e.target.closest('[data-canvas-ui]')) return;
        const card = e.target.closest('[data-hd-card]'), key = card?.dataset.hdCard;
        const capture = card?.querySelector('button') || e.currentTarget;
        gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, camera, key, point: key ? point(projects.find(p => p.workspace === key)) : null, capture };
        dragged.current = false; capture.setPointerCapture(e.pointerId);
      },
      onPointerMove: e => {
        const g = gesture.current; if (!g || g.id !== e.pointerId) return;
        const dx = e.clientX - g.x, dy = e.clientY - g.y;
        if (!dragged.current && Math.hypot(dx, dy) < 5) return;
        dragged.current = true; setMoving(true);
        if (g.key) setPositions(p => ({ ...p, [g.key]: { ...g.point, x: g.point.x + dx / g.camera.z, y: g.point.y + dy / g.camera.z } }));
        else setCamera({ ...g.camera, x: g.camera.x + dx, y: g.camera.y + dy });
      }, onPointerUp: finish, onPointerCancel: finish,
      onClickCapture: e => { if (dragged.current) { e.preventDefault(); e.stopPropagation(); dragged.current = false; } } },
      h('div', { className: 'hd-canvas-world', style: { transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})` } },
        h('section', { className: 'hd-canvas-hero', 'data-canvas-ui': true },
          h('div', { className: 'hd-eyebrow' }, h('span', { className: 'hd-live-dot' }), 'HARDWISE / ENGINEERING DESK'),
          h('div', { className: 'hd-canvas-symbol', 'aria-hidden': true }, h(Glyph, { name: 'chip', size: 32 })),
          h('h1', null, '每一处变化，', h('span', null, '都有迹可循。')),
          h('p', null, '从两版工程资料开始，', h('br'), '把变化、来源与判断，放在同一张桌上。'),
          button(h(React.Fragment, null, h(Glyph, { name: 'plus', size: 16 }), '关联一个工程'), onCreate, { className: 'hd-btn hd-primary' }),
          h('div', { className: 'hd-canvas-stats' }, h('span', null, h('b', null, projects.length), ' 工程'), h('i'), h('span', null, h('b', null, all.length), ' 比较'), h('i'), h('span', null, h('b', null, all.reduce((n, r) => n + pending(r), 0)), ' 待跟进')),
          loading && h('p', { role: 'status' }, '正在读取工程…'),
          !loading && !filtered.length && h('p', { role: 'status' }, projects.length ? '没有匹配的工程，请调整筛选。' : '第一份工程，将从这里展开。')),
        ...filtered.map(project => {
          const index = ordered.findIndex(p => p.workspace === project.workspace), p = point(project);
          return h('div', { key: project.workspace, className: 'hd-spatial-card', 'data-hd-card': project.workspace,
            style: { left: p.x, top: p.y, '--card-turn': `${p.r || 0}deg`, '--card-delay': `${Math.min(index, 8) * 70}ms` },
            onFocus: e => { if (e.target.matches(':focus-visible')) setCamera(c => ({ ...c, x: -p.x * c.z, y: -p.y * c.z })); } },
            h('div', { className: 'hd-spatial-card-enter' }, h(ProjectCard, { project, index, onOpen })));
        })),
      h('div', { className: 'hd-canvas-compass', 'aria-hidden': true }, h('span', null, 'N'), h('i'), 'LOCAL / ENGINEERING'),
      h('div', { className: 'hd-canvas-dock', 'data-canvas-ui': true },
        h('div', { className: 'hd-view-switch', role: 'group', 'aria-label': '工程视图' },
          button('散落', () => {}, { className: 'hd-btn active', 'aria-pressed': true }), button('网格', onGrid, { className: 'hd-btn', 'aria-pressed': false })),
        h('i'), button('−', () => zoom(1 / 1.2), { className: 'hd-btn hd-zoom', 'aria-label': '缩小', disabled: camera.z <= .25 }),
        h('output', { 'aria-label': '当前缩放' }, `${Math.round(camera.z * 100)}%`),
        button('+', () => zoom(1.2), { className: 'hd-btn hd-zoom', 'aria-label': '放大', disabled: camera.z >= 1.6 }),
        button('总览', fit, { className: 'hd-btn' }),
        button('重排', () => { setPositions({}); try { localStorage.removeItem(CANVAS_STORAGE); } catch {} setCamera(canvasFit(size.width, size.height, filtered.map(p => canvasSlot(ordered.findIndex(a => a.workspace === p.workspace))))); }, { className: 'hd-btn', title: '恢复工程卡片的默认位置' }))),
    h('footer', { className: 'hd-canvas-foot' }, h('span', null, '拖动卡片整理 · 拖动画布漫游 · ⌘ / Ctrl + 滚轮缩放'), h('span', null, '仅比较来源声明，电气正确性未评估')));
}
