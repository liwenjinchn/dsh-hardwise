/** Integration with the actual installed Cordis and DSH tool pipeline, no LLM. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import * as plugin from '../index.js';
import { BackendPool } from '../backend.js';

const runtime = process.env.DSH_RUNTIME;
if (!runtime) throw new Error('Set DSH_RUNTIME to a verified DSH node_modules directory.');
const load = name => import(pathToFileURL(join(runtime, '@deepseek-ai', name, 'lib/index.js')));
const { Context } = await load('cordis');
const { SystemPrompt } = await load('dsh-system-prompt');
const { ToolRuntime } = await load('dsh-tools');

test('real DSH registration, schema validation, execution, reopening and unload', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'hardwise-dsh-test-'));
  const net = "$PACKAGES\n ! 'R0603' ! '10k' ; R1\n$NETS\n 'VCC' ; R1.1\n 'GND' ; R1.2\n$END\n";
  for (const side of ['before', 'after']) {
    await writeFile(join(workspace, `${side}.net`), net);
    await writeFile(join(workspace, `${side}.csv`), `RefDes,Value,Footprint\nR1,${side === 'before' ? '10k' : '4.7k'},R0603\n`);
  }
  const ctx = new Context();
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(ToolRuntime, {});
  await ctx.plugin(await load('dsh-tool-executor-native'));
  ctx.provide('workingDirectory', { ensure: async () => workspace });
  const owner = await ctx.plugin(plugin);
  const agent = { ctx };
  let count = 0;
  const execute = async (name, args, includeAgent = true) => {
    const batch = await ctx.tools.execute({ calls: [{ type: 'tool-call', name, arguments: JSON.stringify(args), id: `call-${++count}` }],
      signal: new AbortController().signal, ...(includeAgent ? { agent } : {}) });
    return batch.results[0].result;
  };
  try {
    assert.deepEqual(ctx.tools.schemas().map(x => x.name).sort(),
      ['hardwise_compare', 'hardwise_get_review', 'hardwise_review_workspace']);
    const invalid = await execute('hardwise_compare', { unknown: 'path' });
    assert.equal(invalid.isError, true);
    const missingAgent = await execute('hardwise_review_workspace', {}, false);
    assert.equal(missingAgent.isError, true);
    const result = await execute('hardwise_compare', { before_netlist: 'before.net', before_bom: 'before.csv',
      after_netlist: 'after.net', after_bom: 'after.csv', label: '工具集成测试' });
    assert.equal(result.isError, false, JSON.stringify(result));
    const card = JSON.parse(result.content[0].text);
    assert.equal(card.summary.attribute_changes, 1);
    assert.equal(card.items[0].data.refdes, 'R1');
    assert.equal(card.electrical_verdict, 'not_evaluated');
    assert.match(card.items[0].data.after.evidence[0].sha256, /^[a-f0-9]{64}$/);
    assert.equal((await fetch(card.review_url)).status, 200);
    const reopened = await execute('hardwise_get_review', { run_id: card.run_id, limit: 1 });
    assert.equal(JSON.parse(reopened.content[0].text).run_id, card.run_id);
    const notFound = await execute('hardwise_get_review', { run_id: '0'.repeat(32) });
    assert.equal(notFound.isError, true);
    const listed = await execute('hardwise_review_workspace', {});
    assert.equal(JSON.parse(listed.content[0].text).runs.length, 1);
    await owner.dispose();
    assert.equal(ctx.tools.schemas().length, 0);
    await assert.rejects(fetch(card.review_url));
  } finally { await ctx.fiber.dispose(); }
});

test('browser module registers only its three keyed tool views and guards links', async () => {
  let factory;
  vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'),
    { window: { __ModuleLoader__: { load: x => { factory = x.factory; } } } });
  const h = (type, props, ...children) => ({ type, props, children });
  const client = factory(name => { assert.equal(name, 'react'); return { createElement: h, Fragment: 'fragment' }; });
  const seats = new Map();
  const layoutRegistrations = [];
  client.apply({ layout: { toggleSidebar() {} }, slots: { inject: (_name, fn) => fn(),
    register: (spec, view) => { layoutRegistrations.push(spec); if (spec.name === 'tool.call.toolview') seats.set(spec.key, view); },
  } });
  assert.ok(layoutRegistrations.some(x => x.name === 'main' && x.key === 'hardwise-desk'));
  assert.ok(layoutRegistrations.some(x => x.name === 'sidebar.panellist' && x.id === 'hardwise-desk'));
  assert.ok(!layoutRegistrations.some(x => x.name === 'main.conversation' || x.name.startsWith('sidebar.brand')));
  assert.ok(layoutRegistrations.some(x => x.name === 'conversation.input.dock' && x.id === 'hardwise-context'));
  assert.equal(seats.size, 3);
  const view = seats.get('hardwise_compare');
  const render = (data, isError = false) => JSON.stringify(view({ phase: 'result', toolName: 'hardwise_compare',
    block: { isError, content: [{ type: 'text', text: JSON.stringify(data) }] } }));
  assert.ok(!render({ protocol: 'hardwise.dsh.v1', review_url: 'javascript:alert(1)' }).includes('"href"'));
  assert.ok(!render({ protocol: 'hardwise.dsh.v1', review_url: 'http://127.0.0.1:18776/' }, true).includes('"href"'));
  assert.ok(render({ protocol: 'hardwise.dsh.v1', review_url: 'http://127.0.0.1:18776/' }).includes('"href"'));
});

test('backend pool cannot start after unload', async () => {
  const pool = new BackendPool();
  await pool.dispose();
  await assert.rejects(pool.get(tmpdir()), /unloaded/);
});

test('authenticated workspace bridge derives paths from the session and confines embedding', async () => {
  const { registerWorkspaceRoutes } = await import('../workspace.js');
  const routes = new Map();
  const workspace = '/verified/session/workspace';
  let starts = 0;
  const pool = { config: {}, async get(path, signal) {
    assert.equal(path, workspace); assert.ok(signal); starts++;
    return { origin: 'http://127.0.0.1:18003', request: async () => ({ runs: [] }) };
  } };
  registerWorkspaceRoutes({ webServer: { getOrigin: () => 'http://127.0.0.1:18002' },
    connection: { fetch: { register: route => routes.set(route.path, route) } },
    sessionQuery: { readTitleSnapshot: async id => {
      assert.equal(id, 'test-session'); return { session: { cwd: workspace } };
    } },
  }, pool);
  const route = routes.get('/api/hardwise.workspace');
  const missing = await route.fetch(new Request('http://127.0.0.1:18002/api/hardwise.workspace?cwd=/etc'));
  assert.equal(missing.status, 400); assert.equal(starts, 0);
  const response = await route.fetch(new Request('http://127.0.0.1:18002/api/hardwise.workspace?session_id=test-session&cwd=/etc'));
  const data = await response.json();
  assert.equal(data.workspace, workspace); assert.equal(starts, 1);
  assert.equal(pool.config.frameOrigin, 'http://127.0.0.1:18002');
  assert.match(data.review_url, /embed=1&parent_origin=http%3A%2F%2F127.0.0.1%3A18002/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const disabled = [];
  registerWorkspaceRoutes({ webServer: { getOrigin: () => 'https://public.example' },
    connection: { fetch: { register: r => disabled.push(r) } } }, pool);
  assert.equal(disabled.length, 0);
});


test('project catalog groups sessions, reads existing stores and never initializes empty projects', async () => {
  const { registerWorkspaceRoutes } = await import('../workspace.js');
  const root = await mkdtemp(join(tmpdir(), 'hardwise-catalog-'));
  const ready = join(root, 'ready'), empty = join(root, 'empty');
  await mkdir(join(ready, '.hardwise-dsh'), { recursive: true });
  await mkdir(empty);
  await writeFile(join(ready, '.hardwise-dsh', 'reviews.sqlite3'), 'fixture');
  const routes = new Map(), opened = [];
  registerWorkspaceRoutes({ webServer: { getOrigin: () => 'http://127.0.0.1:18002' },
    connection: { fetch: { register: route => routes.set(route.path, route) } },
    sessionQuery: { listSessions: async () => [
      { header: { id: 'latest', cwd: ready } }, { header: { id: 'older', cwd: ready } },
      { header: { id: 'empty', cwd: empty } }, { header: { id: 'unscoped' } },
    ] },
  }, { config: {}, get: async path => { opened.push(path); return { request: async () => ({ runs: [{ run_id: 'test-run' }] }) }; } });
  const response = await routes.get('/api/hardwise.projects').fetch(new Request('http://127.0.0.1:18002/api/hardwise.projects?cwd=/etc'));
  const { projects } = await response.json();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(projects.length, 2); assert.equal(projects[0].session_id, 'latest');
  assert.equal(projects[0].runs.length, 1); assert.equal(projects[1].status, 'empty');
  assert.deepEqual(opened, [ready]);
  await assert.rejects(readFile(join(empty, '.hardwise-dsh', 'reviews.sqlite3')), { code: 'ENOENT' });
});
