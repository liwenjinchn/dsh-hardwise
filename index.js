/** Host adapter. Hardwise computes facts; DSH owns the agent and tool execution pipeline. */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { BackendPool } from './backend.js';
import { registerWorkspaceRoutes } from './workspace.js';

export const name = 'hardwise';
export const inject = ['tools', 'workingDirectory'];

export function resultCard(run, origin, offset = 0, limit = 20) {
  return {
    protocol: 'hardwise.dsh.v1', found: true, title: run.label, run_id: run.run_id,
    comparison_id: run.result.comparison_id, review_url: `${origin}/?run=${run.run_id}`,
    summary: run.result.summary, source_status: run.result.status,
    review_counts: run.review_counts, electrical_verdict: run.result.electrical_verdict,
    items: run.items.slice(offset, offset + limit), offset, total: run.items.length,
    scope: run.result.scope,
  };
}

export function apply(ctx, config = {}) {
  const pool = new BackendPool(config);
  ctx.effect(() => () => pool.dispose());
  ctx.inject(['connection', 'sessionQuery', 'webServer'], scoped => {
    registerWorkspaceRoutes(scoped, pool);
  });
  const register = (toolName, description, parameters, execute) => ctx.tools.register(defineTool({
    name: toolName, description, parameters,
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('Hardwise requires a DSH session working directory.');
      const workspace = await ctx.workingDirectory.ensure(exec.agent, exec.signal);
      const backend = await pool.get(workspace, exec.signal);
      return execute(args, backend, exec.signal);
    },
  }));
  register('hardwise_compare',
    'Compare two revisions of public/synthetic Cadence PST or Telesis exports plus CSV/TSV BOM. '
    + 'Paths must be inside the current working directory. PST path is a directory containing '
    + 'pstxnet.dat, pstxprt.dat, pstchip.dat. Persists a new sourced comparison and opens review. '
    + 'Returns declared differences, not electrical correctness or signoff. Never invent refdes or fill missing evidence.',
    Object.fromEntries(['before_netlist', 'before_bom', 'after_netlist', 'after_bom', 'label'].map(key =>
      [key, { type: 'string', ...(key !== 'label' ? { required: true } : {}), description: key }])),
    async (args, backend, signal) => resultCard(await backend.request('/tool/compare', args, signal), backend.origin));
  register('hardwise_review_workspace',
    'Open the local Hardwise import/review page and list up to 100 recent comparisons for this working directory. '
    + 'Review dispositions are submitted in the local UI; this tool cannot record human approval.', {},
    async (_args, backend, signal) => ({ protocol: 'hardwise.dsh.v1', found: true,
      title: 'Hardwise 工程审查', review_url: backend.origin + '/',
      ...(await backend.request('/api/runs', undefined, signal)), electrical_verdict: 'not_evaluated' }));
  register('hardwise_get_review',
    'Reopen a stored comparison and read its current dispositions and source evidence. '
    + 'Use offset/limit to page through all changes AND unresolved declarations. '
    + 'Acknowledged means a local UI disposition, never electrical approval or authenticated signoff.',
    { run_id: { type: 'string', required: true }, offset: { type: 'integer' }, limit: { type: 'integer' } },
    async ({ run_id, offset = 0, limit = 20 }, backend, signal) => {
      if (!/^[a-f0-9]{32}$/.test(run_id) || offset < 0 || limit < 1 || limit > 50) throw new Error('无效的记录 ID 或分页参数。');
      return resultCard(await backend.request(`/api/runs/${run_id}`, undefined, signal), backend.origin, offset, limit);
    });
}
