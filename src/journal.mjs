import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
export class Journal {
  constructor(directory) { this.directory = directory; this.queues = new Map(); }
  path(id) { if (!/^[a-zA-Z0-9-]{1,70}$/.test(id)) throw new Error('Invalid plan ID'); return join(this.directory, `${id}.json`); }
  async get(id) { return JSON.parse(await readFile(this.path(id), 'utf8')); }
  async list() { await mkdir(this.directory, { recursive: true }); return Promise.all((await readdir(this.directory)).filter(n => n.endsWith('.json')).map(n => this.get(n.slice(0, -5)))); }
  async save(plan) {
    await mkdir(this.directory, { recursive: true });
    const path = this.path(plan.id), temp = `${path}.${randomUUID()}.tmp`;
    // Flush content before the atomic replacement. A crash cannot expose a partial JSON document.
    await writeFile(temp, JSON.stringify(plan, null, 2), { flush: true });
    await rename(temp, path);
    return plan;
  }
  async update(id, fn) {
    const prior = this.queues.get(id) || Promise.resolve();
    const operation = prior.catch(() => {}).then(async () => { const p = await this.get(id); await fn(p); return this.save(p); });
    this.queues.set(id, operation);
    try { return await operation; } finally { if (this.queues.get(id) === operation) this.queues.delete(id); }
  }
}
