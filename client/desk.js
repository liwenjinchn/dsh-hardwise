function createDesk(ctx) {
  return function Desk({ useWorkspaces, SessionProvider, renderSlot }) {
    const workspaces = useWorkspaces(s => s.items);
    const [projects, setProjects] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
    const [view, setView] = useState('projects'), [adding, setAdding] = useState(false), [refresh, setRefresh] = useState(0);
    const [target, setTarget] = useState(null), [bridge, setBridge] = useState(null), [reference, setReference] = useState(null);
    const [detailError, setDetailError] = useState(''), [assistant, setAssistant] = useState(() => window.innerWidth >= 1100), [runId, setRunId] = useState('');
    const [runs, setRuns] = useState([]), [frameUrl, setFrameUrl] = useState('');
    const frame = useRef(null);
    useEffect(() => {
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/api/hardwise.style';
      document.head.appendChild(link); return () => { link.remove(); publishContext(null); };
    }, []);
    useEffect(() => {
      const abort = new AbortController(); setLoading(true); setError('');
      fetchJSON('/api/hardwise.projects', abort.signal).then(data => { if (!abort.signal.aborted) setProjects(data.projects); })
        .catch(e => { if (!abort.signal.aborted) setError(e.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
      return () => abort.abort();
    }, [refresh]);
    useEffect(() => {
      const open = () => { if (pendingTarget) { setTarget(pendingTarget); pendingTarget = null; } };
      open(); window.addEventListener('hardwise:navigate', open);
      return () => window.removeEventListener('hardwise:navigate', open);
    }, []);
    useEffect(() => {
      const abort = new AbortController(); let retained;
      setBridge(null); setReference(null); setDetailError(''); setFrameUrl(''); setRuns([]); setRunId(''); publishContext(null);
      if (target) (async () => {
        try {
          const data = await fetchJSON(`/api/hardwise.workspace?session_id=${encodeURIComponent(target.session_id)}`, abort.signal);
          if (abort.signal.aborted) return;
          retained = ctx.sessions.retain(target.session_id, { source: 'hardwise-desk', signal: abort.signal });
          await retained.ready;
          if (abort.signal.aborted) return;
          const id = target.run_id || data.runs[0]?.run_id || '';
          setBridge(data); setReference(retained); setRuns(data.runs); setRunId(id);
          setFrameUrl(`${data.review_url}${id ? `&run=${id}` : ''}`);
        } catch (e) { if (!abort.signal.aborted) setDetailError(e.message); }
      })();
      return () => { abort.abort(); retained?.release(); publishContext(null); };
    }, [target]);
    useEffect(() => {
      const receive = event => {
        if (!bridge || event.origin !== bridge.origin || event.source !== frame.current?.contentWindow) return;
        const data = event.data;
        if (data?.type === 'hardwise.clear') publishContext(null);
        if (data?.type === 'hardwise.selection' && /^[a-f0-9]{32}$/.test(data.run_id)) publishContext({ ...data, sessionId: target.session_id });
        if (data?.type === 'hardwise.runs' && Array.isArray(data.runs)) {
          setRuns(data.runs); setProjects(old => old.map(p => p.workspace === bridge.workspace ? { ...p, runs: data.runs } : p));
        }
        if (data?.type === 'hardwise.active' && /^[a-f0-9]{32}$/.test(data.run_id)) setRunId(data.run_id);
      };
      window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
    }, [bridge, target]);
    const home = next => { setTarget(null); setView(next); setRefresh(x => x + 1); };
    const command = (type, id) => { publishContext(null); frame.current?.contentWindow.postMessage({ type, run_id: id }, bridge.origin); };
    const named = projects.map(p => {
      const title = workspaces.find(w => w.path === p.workspace)?.title;
      return { ...p, name: title && title !== 'default-workspace' ? title : p.name };
    });
    const project = named.find(p => p.session_id === target?.session_id);
    const projectName = project?.name || target?.name || bridge?.workspace.split('/').pop() || '工程评审';
    const addProject = async (path, title) => {
      if (!path.startsWith('/')) throw new Error('请输入本机目录的绝对路径。');
      const workspace = await ctx.workspaces.create({ path });
      if (title) await ctx.workspaces.rename(workspace.workspaceId, title);
      const session_id = await ctx.sessions.create({ workspaceId: workspace.workspaceId });
      setRefresh(x => x + 1); setTarget({ session_id, name: title || path.split('/').pop() });
    };
    return h('div', { className: 'hd-app', 'data-hardwise-desk': true },
      h('header', { className: 'hd-top' },
        button(h(React.Fragment, null, h('span', { className: 'hd-logo' }, h(Glyph, { size: 22 })), h('b', null, 'Hardwise'), h('span', null, '工程工作台')),
          () => home('projects'), { className: 'hd-wordmark', 'aria-label': 'Hardwise 工程首页' }),
        h('nav', { className: 'hd-tabs', 'aria-label': '工作台导航' }, ...[['projects','工程'],['comparisons','比较记录'],['history','复核记录']].map(([key,label]) =>
          button(label, () => home(key), { key, className: !target && view === key ? 'active' : '', 'aria-current': !target && view === key ? 'page' : undefined }))),
        h('span', { className: 'hd-host-label' }, 'DEEPSEEK HARNESS')),
      !target ? h(ProjectHome, { projects: named, loading, error, view, onOpen: (p, run_id) => setTarget({ ...p, run_id }),
        onCreate: () => setAdding(true), onRefresh: () => setRefresh(x => x + 1) }) :
        h('div', { className: 'hd-detail-page' },
          h('div', { className: 'hd-detail-bar' },
            h('div', { className: 'hd-breadcrumb' }, button(h(Glyph, { name: 'back', size: 18 }), () => home('projects'), { className: 'hd-btn hd-icon-btn', 'aria-label': '返回工程首页' }),
              h('span', null, projectName), h('i', null, '/'), h('b', null, '改版评审')),
            h('div', { className: 'hd-detail-actions' },
              h('select', { 'aria-label': '选择比较记录', value: runId, disabled: !bridge || !runs.length, onChange: e => command('hardwise.open', e.target.value) },
                !runs.length && h('option', { value: '' }, '尚无比较记录'), ...runs.map(r => h('option', { key: r.run_id, value: r.run_id }, r.label))),
              button(assistant ? '收起助手' : '打开助手', () => setAssistant(!assistant), { className: 'hd-btn', 'aria-pressed': assistant }),
              button('新建比较', () => command('hardwise.new'), { className: 'hd-btn hd-primary', disabled: !bridge }))),
          detailError ? h('div', { className: 'hd-loading', role: 'alert' }, h('h2', null, '工程暂时无法打开'), h('p', null, detailError),
            button('重新连接', () => setTarget({ ...target }), { className: 'hd-btn' })) :
          !bridge ? h('div', { className: 'hd-loading', role: 'status' }, '正在打开工程与来源记录…') :
          h('div', { className: `hd-workspace ${assistant ? '' : 'hd-no-assistant'}` },
            assistant && h('aside', { className: 'hd-assistant', 'aria-label': '工程助手' },
              h('div', { className: 'hd-assistant-title' }, h('span', { className: 'hd-assistant-icon' }, h(Glyph, { name: 'chat', size: 18 })), h('div', null, h('b', null, '工程助手'), h('small', null, '和证据一起，理清每处变化'))),
              h('div', { className: 'hd-assistant-hint' }, '选择右侧条目，点击「带入提问」，把对应来源交给助手。'),
              reference && h(SessionProvider, { session: reference }, renderSlot('hardwise.assistant', {}))),
            h('section', { className: 'hd-evidence-workspace', 'aria-label': '工程证据与复核' },
              h('iframe', { ref: frame, src: frameUrl, title: 'Hardwise 工程证据与复核', className: 'hd-review-frame' })))),
      adding && h(AddProject, { onClose: () => setAdding(false), onSubmit: addProject }));
  };
}
