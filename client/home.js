function ProjectCard({ project, index, onOpen }) {
  const runs = project.runs, latest = runs[0], total = count(runs, 'open') + count(runs, 'needs_info') + count(runs, 'acknowledged');
  const done = count(runs, 'acknowledged');
  return h('button', { key: project.workspace, type: 'button', className: 'hd-project-card', onClick: () => onOpen(project),
    'aria-label': `打开工程 ${project.name}` },
    h(BoardMark, { variant: index }),
    h('div', { className: 'hd-card-body' }, h('div', { className: 'hd-card-heading' }, h('h3', null, project.name), h(Glyph, { name: 'arrow', size: 18 })),
      h('p', { className: 'hd-card-path', title: project.workspace }, project.workspace),
      h('div', { className: 'hd-card-status' }, h('span', { className: `hd-status ${project.status === 'unavailable' ? 'warn' : ''}` },
        project.status === 'unavailable' ? '暂时无法读取' : runs.length ? `${runs.length} 次比较` : '等待导入'),
      h('span', null, total ? `${done} / ${total} 项已阅` : '尚无复核记录')),
      h('div', { className: 'hd-progress', role: 'img', 'aria-label': `${done} / ${total} 项已阅` }, h('i', { style: { width: `${total ? done / total * 100 : 0}%` } })),
      h('div', { className: 'hd-card-footer' }, h('span', null, latest ? `${count(runs, 'open') + count(runs, 'needs_info')} 项待跟进` : 'Telesis / Cadence PST'),
        h('span', null, latest ? date(latest.created_at) : '开始比较'))));
}
function ProjectHome({ projects, loading, error, view, onOpen, onCreate, onRefresh }) {
  const [mode, setMode] = useState(() => { try { return localStorage.getItem('hardwise.home.mode') === 'grid' ? 'grid' : 'scatter'; } catch { return 'scatter'; } });
  const changeMode = value => { setMode(value); try { localStorage.setItem('hardwise.home.mode', value); } catch {} };
  const [query, setQuery] = useState(''), [onlyPending, setOnlyPending] = useState(false);
  const all = projects.flatMap(project => project.runs.map(run => ({ project, run })));
  const filtered = projects.filter(p => `${p.name} ${p.workspace}`.toLowerCase().includes(query.toLowerCase()) &&
    (!onlyPending || p.runs.some(r => pending(r))));
  const rows = all.filter(({ project, run }) => `${project.name} ${run.label}`.toLowerCase().includes(query.toLowerCase()) &&
    (!onlyPending || pending(run)) && (view !== 'history' || run.review_event_count > 0))
    .sort((a, b) => b.run.created_at.localeCompare(a.run.created_at));
  const openCount = all.reduce((sum, x) => sum + pending(x.run), 0);
  if (view === 'projects' && mode === 'scatter') return h(ProjectCanvas, { projects, filtered, loading, error, query, setQuery, onlyPending, setOnlyPending, onOpen, onCreate, onRefresh, onGrid: () => changeMode('grid') });
  return h('div', { className: 'hd-home' },
    h('section', { className: 'hd-hero' },
      h('div', { className: 'hd-eyebrow' }, h('span', { className: 'hd-live-dot' }), 'HARDWISE / ENGINEERING DESK'),
      h('h1', null, view === 'projects' ? '把每一处变化，' : view === 'comparisons' ? '每次改版，都有来处。' : '让复核过程留有记录。',
        view === 'projects' && h('span', null, '变成有据可查的判断。')),
      h('p', null, view === 'projects' ? '从两版工程资料开始。看清变化，追到来源，记下你的复核意见。' :
        view === 'comparisons' ? '按工程查看已保存的版本比较，随时回到对应的来源与处理状态。' : '查看已有处理意见的比较。打开记录，继续补充依据与待办。'),
      h('div', { className: 'hd-hero-stats' }, h('span', null, h('b', null, projects.length), ' 个工程'),
        h('i'), h('span', null, h('b', null, all.length), ' 次比较'), h('i'), h('span', null, h('b', null, openCount), ' 项待跟进'))),
    h('div', { className: 'hd-section-bar' },
      h('div', { className: 'hd-section-title' }, h('h2', null, view === 'projects' ? '我的工程' : view === 'comparisons' ? '比较记录' : '复核记录'),
        h('span', null, view === 'projects' ? '一个工程目录，一份持续积累的证据。' : '每个工程显示最近 100 次比较')),
      h('div', { className: 'hd-toolbar' }, view === 'projects' && button('散落画布', () => changeMode('scatter'), { className: 'hd-btn' }), h('label', { className: 'hd-search' }, h(Glyph, { name: 'search', size: 16 }),
        h('input', { type: 'search', value: query, placeholder: '搜索工程或记录', 'aria-label': '搜索工程或记录', onChange: e => setQuery(e.target.value) })),
        button(onlyPending ? '全部记录' : '仅待跟进', () => setOnlyPending(!onlyPending), { className: `hd-btn ${onlyPending ? 'active' : ''}` }),
        button(h(Glyph, { name: 'plus', size: 17 }), onCreate, { className: 'hd-btn hd-primary', 'aria-label': '关联工程目录', title: '关联工程目录' }))),
    error && h('div', { role: 'alert', className: 'hd-alert' }, error, button('重试', onRefresh, { className: 'hd-btn' })),
    loading ? h('div', { className: 'hd-loading', role: 'status' }, '正在读取工程与评审记录…') :
      view === 'projects' ? h('div', { className: 'hd-project-grid' },
        ...filtered.map((project, index) => {
          return h(ProjectCard, { key: project.workspace, project, index, onOpen });
        }),
        h('button', { type: 'button', className: 'hd-project-card hd-add-card', onClick: onCreate },
          h('span', { className: 'hd-add-icon' }, h(Glyph, { name: 'plus', size: 24 })), h('h3', null, '关联一个工程'),
          h('p', null, '选择本机工程目录', h('br'), '把两版网表与 BOM 带进来'), h('span', { className: 'hd-text-link' }, '从这里开始 →')),
        !filtered.length && projects.length > 0 && h('p', { className: 'hd-empty-message' }, '没有匹配的工程，请调整搜索或筛选。')) :
      h('div', { className: 'hd-record-list' }, rows.length ? rows.map(({ project, run }) =>
        h('button', { key: run.run_id, type: 'button', className: 'hd-record', onClick: () => onOpen(project, run.run_id) },
          h('span', { className: 'hd-record-icon' }, h(Glyph, { name: 'file' })),
          h('span', { className: 'hd-record-title' }, h('b', null, run.label), h('small', null, project.name, ' · ', date(run.created_at))),
          h('span', { className: 'hd-record-meta' }, `${run.summary.changed_components} 个位号变化`, h('small', null, `${run.summary.unresolved} 项来源待确认`)),
          h('span', { className: 'hd-status' }, `${pending(run)} 项待跟进`), h(Glyph, { name: 'arrow', size: 18 }))) :
        h('div', { className: 'hd-empty-message' }, h(Glyph, { name: 'file', size: 28 }), h('h3', null, view === 'history' ? '还没有处理记录' : '还没有比较记录'),
          h('p', null, view === 'history' ? '进入比较详情，填写并保存复核意见后，会在这里出现。' : '打开一个工程，导入两版资料后开始比较。'))),
    h('footer', { className: 'hd-footnote' }, h('span', null, '来源可追溯 · 处理有记录'), h('span', null, '仅比较来源声明，电气正确性未评估')));
}
function AddProject({ onClose, onSubmit }) {
  const [path, setPath] = useState(''), [title, setTitle] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const dialog = useRef(null);
  useEffect(() => { dialog.current.showModal(); }, []);
  return h('dialog', { ref: dialog, className: 'hd-modal', 'aria-label': '关联工程目录', onCancel: e => { if (busy) e.preventDefault(); else onClose(); } },
    h('form', { onSubmit: async e => {
      e.preventDefault(); setBusy(true); setError('');
      try { await onSubmit(path.trim(), title.trim()); onClose(); } catch (e) { setError(e.message); setBusy(false); }
    } }, h('div', { className: 'hd-modal-title' }, h(Glyph, { name: 'folder', size: 24 }), h('h2', null, '关联工程目录')),
      h('p', null, '选择已经存在的本机目录。比较结果和复核记录会保存在这个工程中。'),
      h('label', null, '工程名称', h('input', { value: title, onChange: e => setTitle(e.target.value), placeholder: '例如：公开控制板', maxLength: 80, disabled: busy })),
      h('label', null, '工程目录（绝对路径）', h('input', { value: path, onChange: e => setPath(e.target.value), placeholder: '/Users/…/my-project', required: true, disabled: busy })),
      error && h('p', { role: 'alert', className: 'hd-error' }, error),
      h('div', { className: 'hd-modal-actions' }, button('取消', onClose, { className: 'hd-btn', disabled: busy }),
        h('button', { className: 'hd-btn hd-primary', disabled: busy || !path.trim() }, busy ? '正在关联…' : '关联工程'))));
}
