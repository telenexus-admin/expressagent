import crypto from 'node:crypto';

export class CallRegistry {
  #calls = new Map();

  create(metadata = {}) {
    const id = crypto.randomUUID();
    const call = { id, state: 'created', createdAt: new Date().toISOString(), ...metadata };
    this.#calls.set(id, call);
    return call;
  }

  update(id, patch) {
    const current = this.#calls.get(id);
    if (!current) return null;
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.#calls.set(id, next);
    return next;
  }

  get(id) { return this.#calls.get(id) || null; }

  list() { return [...this.#calls.values()]; }

  remove(id) { return this.#calls.delete(id); }
}
