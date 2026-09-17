// The matrix's line to an AI through the technomancy bridge. The bridge is
// outbound-only: it long-polls a site's queue for a job ({ id, modelId,
// prompt, principal }), runs it through its claude/codex CLIs, and posts the
// text back ({ text? , error?, tokens?, durationMs? }). This is that queue --
// with no HTTP of its own (a server wires `claim` to GET {queue}?wait= and
// `result` to POST {queue}/{id}/result, both behind the bridge's Bearer
// token) -- and the Oracle that fills a matrix cell by queueing its prompt
// and reading the answer through the contract.
//
// A cell is queued once (its key is the job's idempotency key), waits for at
// most `timeoutMs`, and on a failure, a timeout or an answer that isn't JSON
// the oracle returns nothing -- and the matrix asks the next oracle.

import type { Oracle } from "./matrix.ts";
import { jsonFromText } from "./matrix.ts";

export interface RelayJob { readonly id: string; readonly modelId: string; readonly prompt: string; readonly principal?: string }
export interface RelayResult { readonly text?: string; readonly error?: string; readonly tokens?: unknown; readonly durationMs?: number }

export interface RelayQueue {
  /** The bridge asks for work: the next job, waiting up to `waitMs` for one (null: none -- answer 204). */
  claim(waitMs: number): Promise<RelayJob | null>;
  /** The bridge posts a job's answer (false: no such job running). */
  result(id: string, body: RelayResult): boolean;
  /** Queues a prompt; resolves with the answer's text (rejects on an error or a timeout). */
  ask(prompt: string, o?: { key?: string; modelId?: string; principal?: string; timeoutMs?: number }): Promise<string>;
  readonly size: number;
}

export function createRelayQueue(o: { modelId?: string; timeoutMs?: number; /** Job ids start with this (a server gives each run of itself its own). */ prefix?: string } = {}): RelayQueue {
  let ids = 0;
  const queued: Array<RelayJob & { key: string }> = [];
  const running = new Map<string, { resolve: (t: string) => void; reject: (e: Error) => void }>();
  const byKey = new Map<string, Promise<string>>();
  const waiters: Array<(j: RelayJob | null) => void> = [];
  const take = (): RelayJob | null => {
    const j = queued.shift();
    return j ? { id: j.id, modelId: j.modelId, prompt: j.prompt, ...(j.principal ? { principal: j.principal } : {}) } : null;
  };
  return {
    claim(waitMs) {
      const j = take();
      if (j || waitMs <= 0) return Promise.resolve(j);
      return new Promise((res) => {
        const w = (x: RelayJob | null): void => { clearTimeout(timer); res(x); };
        const timer = setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); res(null); }, waitMs);
        waiters.push(w);
      });
    },
    result(id, body) {
      const r = running.get(id);
      if (!r) return false;
      running.delete(id);
      if (body.error || typeof body.text !== "string") r.reject(new Error(body.error ?? "no text")); else r.resolve(body.text);
      return true;
    },
    ask(prompt, a = {}) {
      const key = a.key ?? `job-${ids}`;
      const had = byKey.get(key);
      if (had) return had;
      const id = `${o.prefix ?? "mx"}-${(ids++).toString(36)}`;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const p = new Promise<string>((resolve, reject) => {
        running.set(id, { resolve, reject });
        timer = setTimeout(() => { if (running.delete(id)) reject(new Error("timed out")); const i = queued.findIndex((q) => q.id === id); if (i >= 0) queued.splice(i, 1); }, a.timeoutMs ?? o.timeoutMs ?? 240000);
      });
      const settle = (): void => clearTimeout(timer);
      p.then(settle, settle);
      const job = { id, key, modelId: a.modelId ?? o.modelId ?? "", prompt, ...(a.principal ? { principal: a.principal } : {}) };
      const w = waiters.shift();
      if (w) w({ id: job.id, modelId: job.modelId, prompt: job.prompt, ...(job.principal ? { principal: job.principal } : {}) }); else queued.push(job);
      const done = p.finally(() => byKey.delete(key));
      byKey.set(key, done);
      return done;
    },
    get size() { return queued.length + running.size; },
  };
}

/** An oracle that asks through a relay queue (the bridge's): the cell's prompt out, its JSON back. */
export function relayOracle(q: RelayQueue, o: { name?: string; modelId?: string; principal?: string; timeoutMs?: number } = {}): Oracle {
  return {
    name: o.name ?? "bridge",
    async answer(req) {
      try {
        const text = await q.ask(req.prompt, { key: req.key, ...(o.modelId ? { modelId: o.modelId } : {}), ...(o.principal ? { principal: o.principal } : {}), ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}) });
        return jsonFromText(text);
      } catch { return undefined; }
    },
  };
}
