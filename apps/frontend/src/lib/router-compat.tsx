import { useContext, useMemo, useSyncExternalStore } from "react";
import type { MouseEvent, ReactNode } from "react";
import {
  UNSAFE_LocationContext,
  UNSAFE_NavigationContext,
  createPath,
  parsePath,
  type To,
  useInRouterContext,
} from "react-router-dom";
import { markNavigationLoaderSuppressed } from "@/lib/navigation-loader";

type NavigateOptions = { replace?: boolean };
const NAV_LINK_LOADER_SUPPRESS_MS = 8_000;

type SearchParamsInit =
  | URLSearchParams
  | string
  | Record<string, string | number | boolean | null | undefined>
  | Array<[string, string]>;

type RouterLocation = {
  pathname: string;
  search: string;
  hash: string;
};

type RouterNavigator = {
  push: (to: To) => void;
  replace: (to: To) => void;
};

type NavigationContextValue = {
  navigator: RouterNavigator;
};

type LocationContextValue = {
  location: RouterLocation;
};

function subscribeToNoopStore() {
  return () => {};
}

function useHasHydrated() {
  return useSyncExternalStore(subscribeToNoopStore, () => true, () => false);
}

function subscribeToBrowserLocationChanges(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener("popstate", onStoreChange);
  window.addEventListener("hashchange", onStoreChange);

  return () => {
    window.removeEventListener("popstate", onStoreChange);
    window.removeEventListener("hashchange", onStoreChange);
  };
}

function getBrowserLocationSearch() {
  if (typeof window === "undefined") {
    return "";
  }
  return window.location.search;
}

function getBrowserLocationPathname() {
  if (typeof window === "undefined") {
    return "/";
  }
  return window.location.pathname;
}

function emitBrowserLocationChange() {
  if (typeof window === "undefined") {
    return;
  }

  const event =
    typeof PopStateEvent === "function"
      ? new PopStateEvent("popstate")
      : new Event("popstate");
  window.dispatchEvent(event);
}

function toHref(to: To): string {
  if (typeof to === "string") {
    return to;
  }
  return createPath(to);
}

function isNextRuntimeDetected(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const maybeNextData = window as unknown as {
    __NEXT_DATA__?: unknown;
    __next_f?: unknown;
  };

  return Boolean(maybeNextData.__NEXT_DATA__ || maybeNextData.__next_f);
}

function isJSDOMRuntime(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /\bjsdom\b/i.test(navigator.userAgent);
}

function shouldUseHardNavigationFallback(): boolean {
  return isNextRuntimeDetected() && !isJSDOMRuntime();
}

function navigateWithBrowserHistory(
  to: To,
  options?: NavigateOptions & { hardNavigation?: boolean },
) {
  if (typeof window === "undefined") {
    return;
  }

  const href = toHref(to);
  const nextUrl = new URL(href, window.location.href);
  const sameOrigin = nextUrl.origin === window.location.origin;

  if (!sameOrigin || options?.hardNavigation) {
    if (options?.replace) {
      window.location.replace(nextUrl.toString());
    } else {
      window.location.assign(nextUrl.toString());
    }
    return;
  }

  const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  if (options?.replace) {
    window.history.replaceState(window.history.state, "", nextPath);
  } else {
    window.history.pushState(window.history.state, "", nextPath);
  }
  emitBrowserLocationChange();
}

function isToActive(to: To, pathname: string, search: string) {
  const normalizedTo = typeof to === "string" ? parsePath(to) : to;

  const targetPathname = normalizedTo.pathname ?? pathname;
  if (targetPathname !== pathname) {
    return false;
  }

  if (normalizedTo.search != null) {
    return normalizedTo.search === search;
  }

  return true;
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

function navigateWithRouterNavigator(
  navigationContext: NavigationContextValue | null,
  to: To,
  options?: NavigateOptions,
): boolean {
  if (!navigationContext) {
    return false;
  }

  const navigator = navigationContext.navigator as Partial<RouterNavigator>;
  const navigateFn = options?.replace ? navigator.replace : navigator.push;
  if (typeof navigateFn !== "function") {
    return false;
  }

  try {
    navigateFn(to);
    return true;
  } catch {
    return false;
  }
}

export function useNavigate() {
  const inRouterContext = useInRouterContext();
  const navigationContext = useContext(UNSAFE_NavigationContext) as
    | NavigationContextValue
    | null;

  return (to: To, options?: NavigateOptions) => {
    markNavigationLoaderSuppressed();
    if (
      inRouterContext &&
      navigateWithRouterNavigator(navigationContext, to, options)
    ) {
      return;
    }

    navigateWithBrowserHistory(to, {
      ...options,
      hardNavigation: shouldUseHardNavigationFallback(),
    });
  };
}

export function useSearchParams(): [
  URLSearchParams,
  (next: SearchParamsInit, options?: NavigateOptions) => void,
] {
  const inRouterContext = useInRouterContext();
  const navigationContext = useContext(UNSAFE_NavigationContext) as
    | NavigationContextValue
    | null;
  const locationContext = useContext(UNSAFE_LocationContext) as LocationContextValue | null;
  const browserSearch = useSyncExternalStore(
    subscribeToBrowserLocationChanges,
    getBrowserLocationSearch,
    getBrowserLocationSearch,
  );

  const search = inRouterContext ? (locationContext?.location.search ?? "") : browserSearch;
  const searchParams = useMemo(() => new URLSearchParams(search), [search]);

  const setCompatSearchParams = (next: SearchParamsInit, options?: NavigateOptions) => {
    const nextSearchParams = normalizeSearchParams(next);
    const nextSearch = nextSearchParams.toString();

    if (inRouterContext && locationContext) {
      const currentLocation = locationContext.location;
      const nextTo: To = {
        pathname: currentLocation.pathname,
        search: nextSearch ? `?${nextSearch}` : "",
        hash: currentLocation.hash,
      };
      if (navigateWithRouterNavigator(navigationContext, nextTo, options)) {
        return;
      }
    }

    if (typeof window === "undefined") {
      return;
    }

    const nextTo = {
      pathname: window.location.pathname,
      search: nextSearch ? `?${nextSearch}` : "",
      hash: window.location.hash,
    };
    navigateWithBrowserHistory(nextTo, options);
  };

  return [searchParams, setCompatSearchParams];
}

type NavLinkRenderState = {
  isActive: boolean;
};

type NavLinkProps = {
  to: To;
  className?: string | ((state: NavLinkRenderState) => string);
  children?: ReactNode | ((state: NavLinkRenderState) => ReactNode);
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
};

export function NavLink({ to, className, children, onClick }: NavLinkProps) {
  const inRouterContext = useInRouterContext();
  const locationContext = useContext(UNSAFE_LocationContext) as LocationContextValue | null;
  const navigationContext = useContext(UNSAFE_NavigationContext) as
    | NavigationContextValue
    | null;
  const hasHydrated = useHasHydrated();

  const browserPathname = useSyncExternalStore(
    subscribeToBrowserLocationChanges,
    getBrowserLocationPathname,
    getBrowserLocationPathname,
  );
  const browserSearch = useSyncExternalStore(
    subscribeToBrowserLocationChanges,
    getBrowserLocationSearch,
    getBrowserLocationSearch,
  );

  const routerLocation = locationContext?.location ?? null;
  const routerNavigator = navigationContext?.navigator ?? null;
  const canUseRouterNavigation =
    inRouterContext && routerNavigator !== null && routerLocation !== null;
  const isActive = canUseRouterNavigation
    ? isToActive(to, routerLocation!.pathname, routerLocation!.search)
    : hasHydrated && isToActive(to, browserPathname, browserSearch);

  return (
    <a
      href={toHref(to)}
      className={
        typeof className === "function"
          ? className({ isActive })
          : className
      }
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

        markNavigationLoaderSuppressed(NAV_LINK_LOADER_SUPPRESS_MS);

        if (
          canUseRouterNavigation &&
          navigateWithRouterNavigator(navigationContext, to)
        ) {
          event.preventDefault();
          return;
        }

        event.preventDefault();
        navigateWithBrowserHistory(to, {
          hardNavigation: shouldUseHardNavigationFallback(),
        });
      }}
    >
      {typeof children === "function"
        ? children({ isActive })
        : children}
    </a>
  );
}
