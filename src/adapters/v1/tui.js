import { createComponent as _$createComponent } from "@opentui/solid";
/** @jsxImportSource @opentui/solid */

import { createEffect, createSignal, onCleanup } from "solid-js";
import { readLocalState } from "../../local-state.ts";
import { ruleDetails, Sidebar } from "../../ui/sidebar.js";
function Rules(props) {
  const [snapshot, setSnapshot] = createSignal();
  const [error, setError] = createSignal();
  createEffect(() => {
    const id = props.sessionID;
    const location = props.api.state.session.get(id)?.directory ?? props.api.state.path.directory;
    let closed = false;
    let busy = false;
    setSnapshot(undefined);
    const refresh = async () => {
      if (closed || busy || !location) return;
      busy = true;
      try {
        const value = await readLocalState(location, id);
        if (closed) return;
        setSnapshot(value);
        setError(value ? undefined : "Rules server unavailable");
      } catch (error) {
        if (!closed) {
          setSnapshot(undefined);
          setError(String(error));
        }
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 500);
    onCleanup(() => {
      closed = true;
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
      return props.api.theme.current.text;
    },
    get muted() {
      return props.api.theme.current.textMuted;
    },
    inspect: rule => {
      const DialogAlert = props.api.ui.DialogAlert;
      props.api.ui.dialog.replace(() => _$createComponent(DialogAlert, {
        title: "Project rule",
        get message() {
          return ruleDetails(rule);
        }
      }));
    }
  });
}
export const tui = async api => {
  api.slots.register({
    order: 550,
    slots: {
      sidebar_content: (_context, input) => _$createComponent(Rules, {
        api: api,
        get sessionID() {
          return input.session_id;
        }
      })
    }
  });
};