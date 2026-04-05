"use client";

import type { MouseEvent, ReactNode } from "react";
import { useMemo, useSyncExternalStore } from "react";

const LOCATION_CHANGE_EVENT = "codex-lb:location-change";

type NavigateOptions = { replace?: boolean };

type SearchParamsInit =
  | URLSearchParams
  | string
  | Record<string, string | number | boolean | null | undefined>
  | Array<[string, string]>;

type LocationSnapshot = {
  pathname: string;
  search: string;
};

function notifyLocationChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
  }
}

function subscribeLocationChange(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const onChange = () => listener();
  window.addEventListener("popstate", onChange);
  window.addEventListener(LOCATION_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(LOCATION_CHANGE_EVENT, onChange);
  };
}

function getLocationSnapshot(): string {
  if (typeof window === "undefined") {
    return "/";
  }
  return `${window.location.pathname}${window.location.search}`;
}

function parseLocationSnapshot(snapshot: string): LocationSnapshot {
  const [pathname, rawSearch = ""] = snapshot.split("?", 2);
  return {
    pathname: pathname || "/",
    search: rawSearch.length > 0 ? `?${rawSearch}` : "",
  };
}

function buildUrl(pathname: string, params: URLSearchParams): string {
  const query = params.toString();
  return query.length > 0 ? `${pathname}?${query}` : pathname;
}

function normalizeSearchParams(input: SearchParamsInit): URLSearchParams {
  if (input instanceof URLSearchParams) {
    return new URLSearchParams(input);
  }
  if (Array.isArray(input) || typeof input === "string") {
    return new URLSearchParams(input);
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) {
      continue;
    }
    params.set(key, String(value));
  }
  return params;
}

function navigateTo(url: string, options?: NavigateOptions) {
  if (typeof window === "undefined") {
    return;
  }

  const nextUrl = new URL(url, window.location.href);
  const sameOrigin = nextUrl.origin === window.location.origin;

  if (!sameOrigin) {
    if (options?.replace) {
      window.location.replace(nextUrl.toString());
      return;
    }
    window.location.assign(nextUrl.toString());
    return;
  }

  const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  if (options?.replace) {
    window.history.replaceState({}, "", nextPath);
  } else {
    window.history.pushState({}, "", nextPath);
  }
  notifyLocationChanged();
}

function useLocationSnapshot(): LocationSnapshot {
  const snapshot = useSyncExternalStore(
    subscribeLocationChange,
    getLocationSnapshot,
    getLocationSnapshot,
  );

  return useMemo(() => parseLocationSnapshot(snapshot), [snapshot]);
}

export function useNavigate() {
  return (to: string, options?: NavigateOptions) => {
    navigateTo(to, options);
  };
}

export function useSearchParams(): [
  URLSearchParams,
  (next: SearchParamsInit, options?: NavigateOptions) => void,
] {
  const location = useLocationSnapshot();
  const currentParams = useMemo(() => new URLSearchParams(location.search), [location.search]);

  const setSearchParams = (next: SearchParamsInit, options?: NavigateOptions) => {
    if (typeof window === "undefined") {
      return;
    }

    const nextParams = normalizeSearchParams(next);
    const nextUrl = buildUrl(window.location.pathname, nextParams);

    if (options?.replace) {
      window.history.replaceState({}, "", nextUrl);
    } else {
      window.history.pushState({}, "", nextUrl);
    }

    notifyLocationChanged();
  };

  return [currentParams, setSearchParams];
}

type NavLinkRenderState = {
  isActive: boolean;
};

type NavLinkProps = {
  to: string;
  className?: string | ((state: NavLinkRenderState) => string);
  children?: ReactNode | ((state: NavLinkRenderState) => ReactNode);
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
};

function isRouteActive(currentPathname: string, targetPathname: string): boolean {
  if (targetPathname === "/") {
    return currentPathname === "/";
  }

  return currentPathname === targetPathname || currentPathname.startsWith(`${targetPathname}/`);
}

export function NavLink({ to, className, children, onClick }: NavLinkProps) {
  const location = useLocationSnapshot();
  const target = new URL(to, "http://localhost");
  const state: NavLinkRenderState = {
    isActive: isRouteActive(location.pathname, target.pathname),
  };

  const resolvedClassName = typeof className === "function" ? className(state) : className;
  const resolvedChildren = typeof children === "function" ? children(state) : children;

  return (
    <a
      href={to}
      className={resolvedClassName}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) {
          return;
        }

        if (
          event.button !== 0 ||
          event.metaKey ||
          event.altKey ||
          event.ctrlKey ||
          event.shiftKey
        ) {
          return;
        }

        event.preventDefault();
        navigateTo(to);
      }}
    >
      {resolvedChildren}
    </a>
  );
}
