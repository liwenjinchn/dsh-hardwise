export const h = window.React.createElement;
export const S = window.Spectrum2;
export const states = { open: '待审阅', needs_info: '需补资料', acknowledged: '已阅' };
export const kinds = { component_added: '位号新增', component_removed: '位号移除',
  attribute_changed: '属性变化', connection_changed: '连接变化', net_renamed: '网络改名' };
export const button = (label, props = {}) => h(S.Button, props, h(S.Text, null, label));
export async function api(path, body) {
  const form = body instanceof FormData;
  const response = await fetch(path, { headers: { 'x-hardwise-ui': '1',
    ...(body && !form ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { method: 'POST', body: form ? body : JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '输入不符合要求，请检查文件或处理说明。');
  return data;
}
export function time(value) { return new Date(value).toLocaleString('zh-CN', { hour12: false }); }
export function preview(observation) {
  if (!observation) return '本版无此记录';
  if (observation.state === 'missing') return '未声明';
  return observation.values.join(' / ') || '未声明';
}
