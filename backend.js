/** One disposable local review server per calling workspace. No shell commands. */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { dirname, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const root = dirname(fileURLToPath(import.meta.url));

export class BackendPool {
  constructor(config = {}) { this.config = config; this.backends = new Map(); this.closed = false; }

  async get(workspace, signal) {
    if (this.closed) throw new Error('Hardwise plugin has unloaded.');
    signal?.throwIfAborted();
    const directory = await realpath(workspace);
    if (this.closed) throw new Error('Hardwise plugin has unloaded.');
    if (!this.backends.has(directory)) {
      const pending = this.start(directory);
      this.backends.set(directory, pending);
      pending.catch(() => { if (this.backends.get(directory) === pending) this.backends.delete(directory); });
    }
    const backend = await this.backends.get(directory);
    signal?.throwIfAborted();
    return backend;
  }

  async start(workspace) {
    const candidatePython = resolve(root, '../../.venv/bin/python');
    const python = this.config.pythonExecutable || process.env.HARDWISE_PYTHON ||
      (existsSync(candidatePython) ? candidatePython : 'python3');
    const source = existsSync(resolve(root, 'python/hardwise')) ? resolve(root, 'python') : resolve(root, '../../src');
    const token = randomBytes(32).toString('hex');
    const child = spawn(python, ['-m', 'hardwise.dsh_plugin.server', '--workspace', workspace,
      '--ui', resolve(root, 'ui'), '--parent-pipe',
      ...(this.config.frameOrigin ? ['--frame-origin', this.config.frameOrigin] : [])], {
      cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      env: { ...process.env, PYTHONPATH: [source, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
        PYTHONDONTWRITEBYTECODE: '1', HARDWISE_BRIDGE_TOKEN: token },
    });
    let errorTail = '';
    child.stderr.on('data', data => { errorTail = (errorTail + data).slice(-2000); });
    const lines = createInterface({ input: child.stdout });
    const origin = await new Promise((accept, reject) => {
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Hardwise 启动超时。')); }, 20000);
      const fail = error => { clearTimeout(timeout); reject(error); };
      child.once('error', () => fail(new Error('无法启动 Python，请配置 HARDWISE_PYTHON。')));
      child.once('exit', () => fail(new Error(`Hardwise 服务未启动；请安装 requirements.txt。${errorTail}`)));
      lines.once('line', line => {
        try {
          const value = JSON.parse(line);
          if (value.protocol !== 'hardwise.dsh.v1' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(value.origin)) throw new Error();
          clearTimeout(timeout); accept(value.origin);
        } catch { child.kill(); fail(new Error('Hardwise 服务响应无效。')); }
      });
    });
    const request = async (path, body, signal) => {
      const response = await fetch(origin + path, { signal, headers: {
        authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}),
      }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '输入不符合要求。');
      return data;
    };
    const backend = { origin, request, child };
    child.once('exit', () => { this.backends.delete(workspace); lines.close(); });
    for (let attempt = 0; attempt < 30; attempt++) {
      try { await request('/api/runs'); return backend; }
      catch (error) {
        if (attempt === 29 || child.exitCode !== null) { child.kill(); throw error; }
        await new Promise(r => setTimeout(r, 100));
      }
    }
  }

  async dispose() {
    this.closed = true;
    const pending = [...this.backends.values()];
    this.backends.clear();
    await Promise.all(pending.map(async promise => {
      const backend = await promise.catch(() => null);
      if (!backend || backend.child.exitCode !== null) return;
      await new Promise(resolveStop => {
        const timer = setTimeout(() => { backend.child.kill('SIGKILL'); }, 3000);
        backend.child.once('exit', () => { clearTimeout(timer); resolveStop(); });
        backend.child.kill('SIGTERM');
      });
    }));
  }
}
