/** Browser globals the plugin code expects from Obsidian's Electron window.
 *
 *  `window.setTimeout` and `window.clearTimeout` are Node's timers here, and
 *  `activeDocument.createElement` hands the HTML renderer an element whose
 *  `innerHTML` it fills and the API reads back. Nothing else of the DOM is
 *  used. Imported first by the entry point, before any plugin module. */

const scope = globalThis as unknown as Record<string, unknown>;

if (scope.window === undefined) scope.window = globalThis;
if (scope.activeDocument === undefined) {
  scope.activeDocument = {
    createElement: (): { innerHTML: string } => ({ innerHTML: "" }),
  };
}

export {};
