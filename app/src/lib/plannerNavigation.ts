import { useEffect, useRef, useState } from "react";

type Route = "home" | "new" | number;
const readRoute = (): Route => {
  const match = /^#planner\/(new|[1-9]\d*)$/.exec(window.location.hash);
  return match ? match[1] === "new" ? "new" : Number(match[1]) : "home";
};
const url = (route: Route) => route === "home" ? "#planner" : `#planner/${route}`;

/** Planner-only history entries leave the application's other screens unchanged. */
export function usePlannerNavigation(dirty: boolean, saving: boolean) {
  const [route, setRoute] = useState<Route>(readRoute);
  const [pendingReturn, setPendingReturn] = useState<(() => void) | null>(null);
  const index = useRef(0);
  const restoring = useRef<(() => void) | null>(null);
  const allowed = useRef(false);

  useEffect(() => {
    index.current = window.history.state?.plannerIndex ?? 0;
    window.history.replaceState({ ...window.history.state, plannerIndex: index.current }, "", url(readRoute()));
  }, []);

  const replace = (next: Route) => {
    allowed.current = false;
    window.history.replaceState(window.history.state, "", url(next));
    setRoute(next);
  };
  const open = (next: Route) => {
    const parent = index.current;
    index.current += 1;
    window.history.pushState({ plannerIndex: index.current, plannerParent: parent }, "", url(next));
    setRoute(next);
  };
  const goBack = () => {
    const parent = window.history.state?.plannerParent;
    if (typeof parent === "number" && parent < index.current) window.history.go(parent - index.current);
    else replace("home");
  };
  const back = () => {
    if (saving || route === "home") return;
    if (dirty) setPendingReturn(() => goBack);
    else goBack();
  };

  useEffect(() => {
    const pop = (event: PopStateEvent) => {
      if (restoring.current) {
        const afterRestore = restoring.current;
        restoring.current = null;
        afterRestore();
        return;
      }
      const next = readRoute();
      const nextIndex = event.state?.plannerIndex ?? 0;
      if (!allowed.current && (dirty || saving) && next !== route) {
        const delta = index.current - nextIndex;
        if (delta) {
          // Restore the current entry before asking, preserving Back/Forward history.
          restoring.current = () => {
            if (!saving) setPendingReturn(() => () => { allowed.current = true; window.history.go(-delta); });
          };
          window.history.go(delta);
        } else {
          window.history.replaceState(window.history.state, "", url(route));
          if (!saving) setPendingReturn(() => () => replace(next));
        }
        return;
      }
      allowed.current = false;
      index.current = nextIndex;
      setRoute(next);
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("tb-planner-home", back);
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("tb-planner-home", back);
    };
    // These handlers intentionally observe the current draft and history state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, saving, route]);

  const finishReturn = () => {
    allowed.current = true;
    setPendingReturn(null);
    pendingReturn?.();
  };
  return { route, open, replace, back, pendingReturn, finishReturn, clearPendingReturn: () => setPendingReturn(null) };
}
