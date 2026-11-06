import { h, S, button, api } from './api.js';
const { useState } = window.React;

export function Intake({ onImported, onError }) {
  const [format, setFormat] = useState('telesis');
  const [files, setFiles] = useState({});
  const [busy, setBusy] = useState(false);
  const roles = format === 'pst' ? ['pstxnet', 'pstxprt', 'pstchip', 'bom'] : ['netlist', 'bom'];
  const required = ['before', 'after'].flatMap(side => roles.map(role => `${side}_${role}`));
  async function run(demo) {
    setBusy(true);
    try {
      const data = new FormData();
      for (const role of required) if (files[role]) data.append(role, files[role]);
      onImported(await api(demo ? '/api/demo' : `/api/import/${format}`, demo ? {} : data));
    } catch (error) { onError(error.message); }
    finally { setBusy(false); }
  }
  return h('section', { className: 'intake', 'aria-label': '导入工程资料' },
    h('div', { className: 'section-head' }, h('div', null,
      h('span', { className: 'eyebrow' }, '开始一次比较'), h('h2', null, '导入两版工程资料')),
      button('运行公开合成示例', { onPress: () => run(true), isDisabled: busy, variant: 'secondary' })),
    h('p', { className: 'muted' }, '使用公开或合成导出文件。每次导入单独保存，已有处理记录保留在原比较中。'),
    h(S.Picker, { label: '网表格式', value: format, isDisabled: busy,
      onChange: value => { setFormat(value); setFiles({}); } },
      h(S.PickerItem, { id: 'telesis' }, 'Telesis 网表 + BOM'), h(S.PickerItem, { id: 'pst' }, 'Cadence PST 三文件 + BOM')),
    h('div', { className: 'source-pair', key: format }, ...['before', 'after'].map(side =>
      h('fieldset', { key: side, disabled: busy }, h('legend', null, side === 'before' ? '旧版' : '新版'),
        ...roles.map(role => { const key = `${side}_${role}`; return h('label', { key, className: 'file-field' },
          h('span', null, role === 'bom' ? 'BOM · CSV / TSV' : role === 'netlist' ? '网表 · NET / TXT' : `${role}.dat`),
          h('input', { type: 'file', name: key, 'aria-label': `${side === 'before' ? '旧版' : '新版'} ${role}`,
            accept: role === 'bom' ? '.csv,.tsv' : role === 'netlist' ? '.net,.txt' : '.dat',
            onChange: event => setFiles(previous => ({ ...previous, [key]: event.target.files[0] })) })); })))),
    button(busy ? '正在比较来源…' : '比较并保存', { variant: 'accent', onPress: () => run(false),
      isDisabled: busy || required.some(role => !files[role]) }),
    h('span', { className: 'muted file-limit' }, '每个文件不超过 10 MiB；BOM 使用 UTF-8 编码。'));
}
