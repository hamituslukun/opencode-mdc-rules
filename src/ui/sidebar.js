import { memo as _$memo } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
/** @jsxImportSource @opentui/solid */
import { For, Show } from "solid-js";
export function ruleName(id) {
  return id.replaceAll("\\", "/").split("/").at(-1) ?? id;
}
function compareText(left, right) {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  return a < b ? -1 : a > b ? 1 : left < right ? -1 : left > right ? 1 : 0;
}
export function sortRules(rules) {
  return [...rules].sort((left, right) => Number(right.active) - Number(left.active) || compareText(ruleName(left.id), ruleName(right.id)) || compareText(left.id, right.id));
}
export function ruleDetails(rule) {
  return [rule.id, `Mode: ${rule.mode}`, `Status: ${rule.active ? "active" : "inactive"}`, rule.reason && `Reason: ${rule.reason}${rule.detail ? ` (${rule.detail})` : ""}`, rule.description, rule.pending && "Changed on disk; the next model request will use the new version.", rule.error && `Error: ${rule.error}`].filter(Boolean).join("\n\n");
}
export function Sidebar(props) {
  const rules = () => sortRules(props.snapshot?.rules ?? []);
  return (() => {
    var _el$ = _$createElement("box"),
      _el$2 = _$createElement("text"),
      _el$3 = _$createElement("b"),
      _el$5 = _$createElement("span"),
      _el$6 = _$createTextNode(` · `),
      _el$7 = _$createTextNode(`/`),
      _el$8 = _$createTextNode(` active`);
    _$insertNode(_el$, _el$2);
    _$setProp(_el$, "flexDirection", "column");
    _$setProp(_el$, "gap", 1);
    _$setProp(_el$, "paddingTop", 1);
    _$insertNode(_el$2, _el$3);
    _$insertNode(_el$2, _el$5);
    _$insertNode(_el$3, _$createTextNode(`Rules`));
    _$insertNode(_el$5, _el$6);
    _$insertNode(_el$5, _el$7);
    _$insertNode(_el$5, _el$8);
    _$insert(_el$5, () => rules().filter(rule => rule.active).length, _el$7);
    _$insert(_el$5, () => rules().length, _el$8);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return props.error;
      },
      get children() {
        var _el$9 = _$createElement("text");
        _$insert(_el$9, () => props.error);
        _$effect(_$p => _$setProp(_el$9, "fg", props.muted, _$p));
        return _el$9;
      }
    }), null);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return _$memo(() => !!!props.snapshot)() && !props.error;
      },
      get children() {
        var _el$0 = _$createElement("text");
        _$insertNode(_el$0, _$createTextNode(`Connecting to rules server…`));
        _$effect(_$p => _$setProp(_el$0, "fg", props.muted, _$p));
        return _el$0;
      }
    }), null);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return _$memo(() => !!props.snapshot)() && !rules().length;
      },
      get children() {
        var _el$10 = _$createElement("text");
        _$insertNode(_el$10, _$createTextNode(`No .md / .mdc rules found`));
        _$effect(_$p => _$setProp(_el$10, "fg", props.muted, _$p));
        return _el$10;
      }
    }), null);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return rules().length > 0;
      },
      get children() {
        var _el$12 = _$createElement("scrollbox");
        _$setProp(_el$12, "scrollX", false);
        _$setProp(_el$12, "horizontalScrollbarOptions", {
          visible: false
        });
        _$setProp(_el$12, "contentOptions", {
          flexDirection: "column",
          gap: 0
        });
        _$insert(_el$12, _$createComponent(For, {
          get each() {
            return rules();
          },
          children: rule => (() => {
            var _el$13 = _$createElement("box"),
              _el$14 = _$createElement("text"),
              _el$15 = _$createElement("span");
            _$insertNode(_el$13, _el$14);
            _$setProp(_el$13, "flexDirection", "row");
            _$setProp(_el$13, "height", 1);
            _$setProp(_el$13, "flexShrink", 0);
            _$setProp(_el$13, "onMouseUp", () => props.inspect(rule));
            _$insertNode(_el$14, _el$15);
            _$setProp(_el$14, "wrapMode", "none");
            _$insertNode(_el$15, _$createTextNode(`●`));
            _$insert(_el$14, () => ` ${ruleName(rule.id)}${rule.error ? " !" : rule.pending ? " *" : ""}`, null);
            _$effect(_p$ => {
              var _v$3 = props.text,
                _v$4 = {
                  fg: rule.active ? "#22c55e" : "#ef4444"
                };
              _v$3 !== _p$.e && (_p$.e = _$setProp(_el$14, "fg", _v$3, _p$.e));
              _v$4 !== _p$.t && (_p$.t = _$setProp(_el$15, "style", _v$4, _p$.t));
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$13;
          })()
        }));
        _$effect(_$p => _$setProp(_el$12, "height", Math.min(rules().length, 12), _$p));
        return _el$12;
      }
    }), null);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return props.snapshot?.warnings.length;
      },
      get children() {
        return _$createComponent(For, {
          get each() {
            return props.snapshot?.warnings;
          },
          children: warning => (() => {
            var _el$17 = _$createElement("text");
            _$insert(_el$17, warning);
            _$effect(_$p => _$setProp(_el$17, "fg", props.muted, _$p));
            return _el$17;
          })()
        });
      }
    }), null);
    _$effect(_p$ => {
      var _v$ = props.text,
        _v$2 = {
          fg: props.muted
        };
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$2, "fg", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$5, "style", _v$2, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$;
  })();
}