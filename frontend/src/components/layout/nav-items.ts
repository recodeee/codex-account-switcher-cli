export type NavItem = {
  to: string;
  label: string;
  isComingSoon?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/accounts", label: "Accounts" },
  { to: "/apis", label: "APIs" },
  { to: "/devices", label: "Devices" },
  { to: "/storage", label: "Storage", isComingSoon: true },
  { to: "/sessions", label: "Sessions" },
  { to: "/settings", label: "Settings" },
];
