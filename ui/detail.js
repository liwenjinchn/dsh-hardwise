import { h, S, states, kinds, button, api, time, preview } from './api.js';
const { useState } = window.React;

function Evidence({ entries = [] }) {
  const unique = [...new Map(entries.map(e => [JSON.stringify(e), e])).values()];
  return h('div', { className: 'evidence' }, unique.length ? unique.map((e, i) =>
    h('div', { key: i }, h('strong', null, e.file), h('p', null, e.locator),
      h('details', null, h('summary', null, '文件 SHA-256'), h('code', null, e.sha256)))) :
    h('p', { className: 'muted' }, '此项未附具体来源定位；保留为待确认信息。'));
}

function Side({ side, item, run }) {
  const observation = item.data[side];
  const connection = ['connection_changed', 'net_renamed'].includes(item.data.kind);
  const nets = connection ? run.result[side].networks.filter(n => observation?.values.includes(n.name)) : [];
  return h('section', { className: 'source-side' },
    h('h3', null, side === 'before' ? '旧版声明' : '新版声明'),
    h('p', { className: 'value' }, preview(observation)),
    observation && h('p', { className: 'muted' }, `声明状态：${{ known: '已声明', missing: '缺失', ambiguous: '冲突' }[observation.state]}`),
    observation ? h(Evidence, { entries: observation.evidence }) :
      h('p', { className: 'muted' }, '本版没有可展示的对应声明；不据此推断物理移除或新增。'),
    ...nets.map(n => h('details', { key: n.name, className: 'network' },
      h('summary', null, `${n.name} · ${n.endpoints.length} 个端点${n.ambiguous ? ' · 存在冲突' : ''}`),
      h('p', { className: 'mono' }, n.endpoints.map(p => `${p.refdes}.${p.pin}`).join('、')))));
}

function ReviewForm({ run, item, onSaved, onError }) {
  const [state, setState] = useState(item.review.state);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const next = await api(`/api/runs/${run.run_id}/review`, {
        item_id: item.id, state, note: note.trim(), expected_version: item.review.version,
      });
      onSaved(next);
    } catch (error) { onError(error.message); }
    finally { setBusy(false); }
  }
  return h('section', { className: 'review-form' },
    h('h3', null, '记录处理意见'),
    h('p', { className: 'muted' }, '“已阅”表示已查看并记录意见，不代表电气批准。来源问题会继续保留。'),
    h(S.Picker, { label: '处理状态', value: state, onChange: setState, isDisabled: busy },
      ...Object.entries(states).map(([id, label]) => h(S.PickerItem, { id, key: id }, label))),
    h('div', { className: 'note-field' }, h(S.TextArea, { label: '处理说明', value: note,
      onChange: setNote, isRequired: true, maxLength: 4000, isDisabled: busy,
      placeholder: '记录复查依据、待补资料或下一步动作', UNSAFE_style: { width: '100%' } })),
    button(busy ? '正在保存…' : '保存处理记录', { variant: 'accent', onPress: save,
      isDisabled: busy || !note.trim() }));
}

export function Detail({ run, item, onSaved, onError }) {
  if (!item) return h('section', { className: 'detail empty' }, h('h2', null, '选择一项查看证据'),
    h('p', null, run.items.length ? '从左侧选择变化或来源待确认项。' : '没有可列出的变化或来源问题；本结果不评价电气正确性。'));
  const change = item.category === 'change';
  const history = run.history.filter(event => event.item_id === item.id);
  return h('section', { className: 'detail', 'aria-label': '条目详情' },
    h('div', { className: 'section-head' }, h('span', { className: 'eyebrow' }, change ? kinds[item.data.kind] : '来源待确认'),
      h('span', { className: 'pill' }, states[item.review.state])),
    h('h2', null, (item.data.refdes || '整体声明') + (item.data.pin ? `.${item.data.pin}` : '')),
    h('p', { className: 'mono muted' }, item.data.field || item.data.code),
    h('p', null, item.data.explanation),
    change ? h('div', { className: 'source-pair' },
      h(Side, { side: 'before', item, run }), h(Side, { side: 'after', item, run })) :
      h('section', { className: 'source-side' },
        h('h3', null, `来源范围：${{ before: '旧版', after: '新版', both: '两版' }[item.data.side]}`),
        h(Evidence, { entries: item.data.evidence })),
    change && item.data.related_count > 0 && h('p', { className: 'muted' },
      `直接同网复查线索：${item.data.related_refdes.join('、')}（共 ${item.data.related_count} 个；不代表完整电气影响）`),
    h(ReviewForm, { key: `${run.run_id}:${item.id}:${item.review.version}`, run, item, onSaved, onError }),
    h('section', { className: 'history' }, h('h3', null, '处理历史'),
      history.length ? history.map(event => h('article', { key: event.sequence },
        h('strong', null, states[event.state]), h('span', { className: 'muted' }, ` · ${time(event.created_at)}`),
        h('p', null, event.note), h('small', { className: 'muted' }, '本机界面提交 · 未认证签核身份'))) :
        h('p', { className: 'muted' }, '尚未保存处理记录。')));
}
