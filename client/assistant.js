let selectedContext = null;
const contextListeners = new Set();
const contextStore = { subscribe(fn) { contextListeners.add(fn); return () => contextListeners.delete(fn); }, getSnapshot: () => selectedContext };
function publishContext(value) { selectedContext = value; for (const fn of contextListeners) fn(); }
function ContextDock({ sessionId, inputActions }) {
  const context = useSyncExternalStore(contextStore.subscribe, contextStore.getSnapshot);
  if (!context || context.sessionId !== sessionId) return null;
  return h('div', { className: 'hd-context' }, h('div', null, h(Glyph, { name: 'file', size: 14 }), h('span', null, context.refdes || '整体声明', ' · ', context.field || '来源待确认')),
    button('带入提问', () => {
      inputActions.insertText(`\n请根据 Hardwise 记录分析当前条目。先调用 hardwise_get_review 读取 run_id=${context.run_id}，核对最新来源，不得补造位号或将已阅当作电气批准。\n条目：${context.item_id}\n来源摘录：${JSON.stringify(context.evidence)}\n`, inputActions.captureInsertion());
      inputActions.persistDraft();
    }, { className: 'hd-context-action' }));
}
function EngineeringAssistant({ renderFactorySlot }) {
  return h('div', { className: 'hd-conversation' }, renderFactorySlot('conversation.content', {
    variant: 'embedded', phase: 'active', hero: false,
  }));
}
