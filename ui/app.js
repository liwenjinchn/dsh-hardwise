import { h, S, button, api, states, kinds, time } from './api.js';
import { Detail } from './detail.js';
import { Intake } from './intake.js';
import { embedded, notify, listenCommands } from './embed.js';
const { useState, useEffect } = window.React;

function App() {
  const [runs, setRuns] = useState([]), [run, setRun] = useState(null);
  const [selected, setSelected] = useState(null), [filter, setFilter] = useState('all');
  const [query, setQuery] = useState(''), [limit, setLimit] = useState(50);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true), [importing, setImporting] = useState(false);
  async function refreshList() { const values = (await api('/api/runs')).runs; setRuns(values); notify('hardwise.runs', { runs: values }); }
  function show(value) {
    setRun(value); setSelected(value.items[0]?.id || null); setImporting(false);
    setFilter('all'); setQuery(''); setLimit(50); setError('');
    notify('hardwise.active', { run_id: value.run_id });
    const url = new URL(location.href); url.searchParams.set('run', value.run_id); history.replaceState(null, '', url);
  }
  async function open(id) {
    setLoading(true); setError(''); setMessage('');
    try { show(await api(`/api/runs/${id}`)); } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    (async () => {
      try {
        await refreshList();
        const id = new URL(location.href).searchParams.get('run');
        if (id) show(await api(`/api/runs/${id}`));
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, []);
  useEffect(() => listenCommands(command => {
    if (command.type === 'hardwise.open') { open(command.run_id); return; }
    setImporting(true); setError(''); setMessage('');
  }), []);
  async function imported(value) { show(value); setMessage('比较已保存。请逐项查看来源证据。'); await refreshList(); }
  async function saved(value) { setRun(value); setError(''); setMessage('处理记录已保存。'); await refreshList(); }
  function download() {
    const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `hardwise-${run.run_id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const visible = run?.items.filter(item => (filter === 'all' ||
    (filter === 'issue' ? item.category === 'issue' : item.review.state === filter)) &&
    (!query || `${item.data.refdes || ''} ${item.data.field || ''} ${item.data.code || ''}`.toLowerCase().includes(query.toLowerCase()))) || [];
  const active = run?.items.find(item => item.id === selected);
  useEffect(() => {
    if (!run || !active || importing) { notify('hardwise.clear'); return; }
    notify('hardwise.selection', { run_id: run.run_id, item_id: active.id, refdes: active.data.refdes,
      field: active.data.field || active.data.code, evidence: { before: active.data.before, after: active.data.after, explanation: active.data.explanation } });
  }, [run, selected, importing]);
  return h(S.Provider, { locale: 'zh-CN', colorScheme: 'light', background: 'base' },
    h('div', { className: `shell ${run && !importing ? 'has-review' : ''}` },
      h('header', { className: 'header' }, h('div', null,
        h('span', { className: 'brand' }, 'HARDWISE'), h('span', { className: 'muted' }, ' / 工程改版评审')),
        button('新建比较', { onPress: () => { setImporting(true); setError(''); setMessage(''); }, variant: 'secondary' })),
      h('main', null,
        h('div', { className: 'page-heading' }, h('span', { className: 'eyebrow' }, embedded ? 'REVISION REVIEW / 来源比对' : 'DSH · 硬件工程插件'),
          h('h1', null, run && !importing ? run.label : '让每一处变化，都有据可查。'),
          h('p', { className: 'muted' }, '比较导出文件中的器件、属性与连接声明，保留证据和处理记录。电气正确性未评估。')),
        error && h('div', { role: 'alert', className: 'alert' }, error,
          run && button('刷新当前记录', { onPress: () => open(run.run_id), variant: 'secondary' })),
        message && h('p', { role: 'status', className: 'message' }, message),
        loading ? h('p', { role: 'status' }, '正在读取本机记录…') :
          (importing || !run) && h(Intake, { onImported: imported, onError: setError }),
        runs.length > 0 && h('section', { className: 'saved-runs' },
          h(S.Picker, { label: '已保存的比较', value: run?.run_id || null,
            onChange: open, isDisabled: loading },
            ...runs.map(r => h(S.PickerItem, { id: r.run_id, key: r.run_id, textValue: `${r.label} ${time(r.created_at)}` },
              `${r.label} · ${time(r.created_at)}`)))),
        run && !importing && h(window.React.Fragment, null,
          h('section', { className: 'metrics', 'aria-label': '比较概况' },
            ...[[run.result.summary.changed_components, '位号有变化'], [run.result.changes.length, '确定性变化'],
              [run.result.summary.unresolved, '来源待确认'], [run.review_counts.open, '待审阅条目']].map(([value, label]) =>
              h('div', { key: label }, h('strong', null, value), h('span', null, label)))),
          h('div', { className: 'section-head review-heading' }, h('h2', null, '逐项评审'),
            h('div', { className: 'actions' }, button('刷新记录', { onPress: () => open(run.run_id), variant: 'secondary' }),
              button('导出比较与处理记录', { onPress: download, variant: 'secondary' }))),
          h('div', { className: 'review-grid' },
            h('aside', { className: 'queue', 'aria-label': '审查条目' },
              h(S.TextField, { label: '查找位号或字段', value: query, onChange: value => { setQuery(value); setLimit(50); } }),
              h(S.Picker, { label: '筛选条目', value: filter, onChange: value => { setFilter(value); setLimit(50); } },
                ...Object.entries({ all: '全部', issue: '来源待确认', ...states }).map(([id, label]) => h(S.PickerItem, { id, key: id }, label))),
              h('p', { className: 'muted' }, `匹配 ${visible.length} / 共 ${run.items.length} 项`),
              h('div', { className: 'item-list' }, ...visible.slice(0, limit).map(item => h('button', {
                key: item.id, className: 'item', type: 'button', 'aria-pressed': item.id === selected,
                onClick: () => setSelected(item.id),
              }, h('div', { className: 'section-head' }, h('strong', null,
                (item.data.refdes || '整体声明') + (item.data.pin ? `.${item.data.pin}` : '')),
                h('span', { className: 'pill' }, states[item.review.state])),
                h('span', null, item.category === 'change' ? kinds[item.data.kind] : '来源待确认'),
                h('small', { className: 'mono muted' }, item.data.field || item.data.code)))),
              !visible.length && h('p', null, '没有匹配条目，请调整筛选。'),
              visible.length > limit && button('再显示 50 项', { onPress: () => setLimit(limit + 50) })),
            h(Detail, { run, item: active, onSaved: saved, onError: setError })),
          h('details', { className: 'scope' }, h('summary', null, '本次比较的范围与文件指纹'),
            h('ul', null, ...run.result.scope.map(text => h('li', { key: text }, text))),
            h('p', { className: 'mono' }, `比较指纹：${run.result.comparison_id}`),
            ...['before', 'after'].map(side => h('section', { key: side }, h('h3', null, side === 'before' ? '旧版' : '新版'),
              ...run.result[side].sources.map((source, i) => h('p', { key: i }, source.file, h('code', null, source.sha256))))))),
        h('footer', null, 'Hardwise · 来源比较与评审辅助。处理记录保存在当前工作目录；不构成电气签核。'))));
}

window.ReactDOM.createRoot(document.getElementById('root')).render(h(App));
