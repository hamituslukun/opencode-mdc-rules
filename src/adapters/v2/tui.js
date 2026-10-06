import { createComponent as _$createComponent } from "@opentui/solid";
/** @jsxImportSource @opentui/solid */

import { createEffect, createSignal, onCleanup } from "solid-js";
import { pathKey } from "../../core/paths.ts";
import { RulesRpc } from "../../rpc.ts";
import { ruleDetails, Sidebar } from "../../ui/sidebar.js";
const REQUEST_TIMEOUT_MS = 10_000;
export async function withAbortTimeout(parent, milliseconds, operation) {
  const controller = new AbortController();
  let rejectDeadline;
  const deadline = new Promise((_resolve, reject) => {
    rejectDeadline = reject;
  });
  const cancel = reason => {
    const error = reason instanceof Error ? reason : new Error("Rules server request aborted");
    controller.abort(error);
    rejectDeadline(error);
  };
  const abort = () => cancel(parent.reason);
  if (parent.aborted) abort();else parent.addEventListener("abort", abort, {
    once: true
  });
  const timer = setTimeout(() => {
    const error = new Error(`Rules server timed out after ${milliseconds}ms`);
    cancel(error);
  }, milliseconds);
  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener("abort", abort);
  }
}
function Rules(props) {
  const [snapshot, setSnapshot] = createSignal();
  const [error, setError] = createSignal();
  createEffect(() => {
    const id = props.sessionID;
    const rpc = props.ctx.client.rpc(RulesRpc);
    const controller = new AbortController();
    let location;
    let busy = false;
    let changes = 0;
    setSnapshot(undefined);
    const refresh = async () => {
      if (busy || controller.signal.aborted) return;
      busy = true;
      const before = changes;
      try {
        const value = await withAbortTimeout(controller.signal, REQUEST_TIMEOUT_MS, async signal => {
          let session = props.ctx.data.session.get(id);
          if (!session) {
            await props.ctx.data.session.sync(id);
            if (signal.aborted) throw signal.reason;
            session = props.ctx.data.session.get(id);
          }
          location = session?.location ?? props.ctx.location;
          if (!location) throw new Error(`Session location unavailable: ${id}`);
          return rpc.snapshot({
            sessionID: id
          }, {
            location,
            signal
          });
        });
        if (!controller.signal.aborted && before === changes) {
          setSnapshot(value);
          setError(undefined);
        }
      } catch (error) {
        if (!controller.signal.aborted && before === changes) {
          setSnapshot(undefined);
          setError(`Rules server unavailable: ${String(error)}`);
        }
      } finally {
        busy = false;
      }
    };
    const unsubscribe = rpc.events.on("updated", event => {
      if (location && pathKey(event.location.directory) !== pathKey(location.directory)) return;
      if (event.data.sessionID === id) {
        location ??= event.location;
        changes++;
        setSnapshot(event.data);
        setError(undefined);
      } else if (!event.data.sessionID) void refresh();
    }, {
      signal: controller.signal
    });
    void refresh();
    // RPC events are live-only: snapshots recover missed events and server reloads.
    const timer = setInterval(() => void refresh(), 3000);
    onCleanup(() => {
      controller.abort();
      unsubscribe();
      clearInterval(timer);
    });
  });
  return _$createComponent(Sidebar, {
    get snapshot() {
      return snapshot();
    },
    get error() {
      return error();
    },
    get text() {
      return props.ctx.theme.text.base;
    },
    get muted() {
      return props.ctx.theme.text.weak;
    },
    inspect: rule => {
      void props.ctx.ui.dialog.alert({
        title: "Project rule",
        message: ruleDetails(rule)
      });
    }
  });
}
export const setup = ctx => ctx.ui.slot({
  append: "sidebar.content",
  render: input => _$createComponent(Rules, {
    ctx: ctx,
    get sessionID() {
      return input.sessionID;
    }
  })
});