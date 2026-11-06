/** Cross-frame coordination: exact parent origin and window identity, no tool execution. */
const params = new URL(location.href).searchParams;
export const embedded = params.get('embed') === '1' && parent !== window;
const origin = params.get('parent_origin');
const allowed = embedded && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin || '');
if (embedded) document.documentElement.dataset.embedded = 'true';
export function notify(type, payload = {}) {
  if (allowed) parent.postMessage({ type, ...payload }, origin);
}
export function listenCommands(handle) {
  const receive = event => {
    if (!allowed || event.source !== parent || event.origin !== origin) return;
    if (event.data?.type === 'hardwise.new' ||
        (event.data?.type === 'hardwise.open' && /^[a-f0-9]{32}$/.test(event.data.run_id))) handle(event.data);
  };
  window.addEventListener('message', receive);
  return () => window.removeEventListener('message', receive);
}
