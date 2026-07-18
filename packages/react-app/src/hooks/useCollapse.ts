// useCollapse (v1.43) — per-card collapse state for the Huddle sidebar, remembered per browser
// under `invokeboard.collapse.<key>`. Defaults to expanded so nothing hides unexpectedly.

import { useCallback, useState } from "react";

export function useCollapse(key: string, defaultCollapsed = false): [boolean, () => void] {
  const storageKey = `invokeboard.collapse.${key}`;
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(storageKey);
      return v === null ? defaultCollapsed : v === "1";
    } catch {
      return defaultCollapsed;
    }
  });
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* private mode / storage disabled — collapse still works for the session */
      }
      return next;
    });
  }, [storageKey]);
  return [collapsed, toggle];
}
