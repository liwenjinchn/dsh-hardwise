let pendingTarget = null;
const titles = { hardwise_compare: 'Hardwise · 比较工程改版', hardwise_get_review: 'Hardwise · 读取评审记录', hardwise_review_workspace: 'Hardwise · 工程审查' };
function createCard(ctx) {
  return function HardwiseCard({ phase, block, toolName, sessionId }) {
    const text = (block?.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
    let data; try { data = JSON.parse(text); } catch { /* Render errors as text. */ }
    const valid = !block?.isError && data?.protocol === 'hardwise.dsh.v1';
    const url = valid && /^http:\/\/127\.0\.0\.1:\d+\/(?:\?run=[a-f0-9]{32})?$/.test(data.review_url) ? data.review_url : null;
    return h('section', { style: { border: '1px solid var(--dsw-alias-border-l1,#ddd)', borderRadius: 12, padding: 16, margin: '8px 0', overflowWrap: 'anywhere' }, 'data-hardwise-card': true },
      h('strong', null, valid ? data.title : titles[toolName] || 'Hardwise'),
      phase !== 'result' ? h('p', { role: 'status' }, '正在读取与比较…') : !valid ? h('p', { role: 'alert' }, text || '未取得有效结果，请重试。') :
      h(React.Fragment, null,
        data.summary && h('p', null, `${data.summary.changed_components} 个位号有变化 · ${data.summary.unresolved} 项来源待确认`),
        data.runs && h('p', null, `已保存 ${data.runs.length} 次比较`),
        h('p', { style: { fontSize: 12, opacity: .7 } }, '仅比较来源声明；电气正确性未评估。'),
        url && h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', onClick: event => {
          if (!sessionId) return;
          event.preventDefault(); pendingTarget = { session_id: sessionId, run_id: data.run_id };
          ctx.layout.selectPanel(PANEL); window.dispatchEvent(new Event('hardwise:navigate'));
        } }, '在 Hardwise 工作台查看证据 →')));
  };
}
return { inject: ['slots', 'layout', 'sessions', 'workspaces'], apply(ctx) {
  const Desk = createDesk(ctx), Card = createCard(ctx);
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL,
    children: { 'hardwise.assistant': { kind: 'single', scope: 'session' } } }, Desk));
  ctx.slots.inject('hardwise.assistant', () => ctx.slots.register({ name: 'hardwise.assistant' }, EngineeringAssistant));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 5, label: () => 'Hardwise 工程工作台' }, () => h(Glyph, {})));
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'hardwise-context', order: -100 }, ContextDock));
  for (const key of Object.keys(titles)) ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key }, Card));
} };
