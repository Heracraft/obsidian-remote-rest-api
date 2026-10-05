/** The subset of Obsidian's `Events` class the server relies on: named events,
 *  listeners added and removed by reference, and a synchronous `trigger`. */

export type EventCallback = (...data: unknown[]) => unknown;

export interface EventRef {
  name: string;
  callback: EventCallback;
}

export class Events {
  private listeners = new Map<string, EventCallback[]>();

  on(name: string, callback: EventCallback): EventRef {
    const list = this.listeners.get(name) ?? [];
    list.push(callback);
    this.listeners.set(name, list);
    return { name, callback };
  }

  off(name: string, callback: EventCallback): void {
    const list = this.listeners.get(name);
    if (!list) return;
    const index = list.indexOf(callback);
    if (index !== -1) list.splice(index, 1);
  }

  offref(ref: EventRef): void {
    this.off(ref.name, ref.callback);
  }

  /** Call every listener for `name`. A listener that throws is logged and the
   *  rest still run, as in Obsidian: one bad subscriber must not stop the
   *  metadata cache or another stream from hearing about a change. */
  trigger(name: string, ...data: unknown[]): void {
    const list = this.listeners.get(name);
    if (!list) return;
    for (const callback of [...list]) {
      try {
        const result = callback(...data);
        if (result instanceof Promise) {
          result.catch((error) => console.error(`[REST API] Listener for '${name}' failed:`, error));
        }
      } catch (error) {
        console.error(`[REST API] Listener for '${name}' failed:`, error);
      }
    }
  }
}
