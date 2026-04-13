export type NavItem = {
  to: string;
  label: string;
  isComingSoon?: boolean;
  children?: NavItem[];
};

export const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/accounts", label: "Accounts" },
  { to: "/referrals", label: "Referrals" },
  {
    to: "/projects",
    label: "Projects",
    children: [{ to: "/projects/plans", label: "Plans" }],
  },
  { to: "/agents", label: "Agents" },
  { to: "/billing", label: "Billing" },
  { to: "/apis", label: "APIs" },
  { to: "/devices", label: "Devices" },
  { to: "/storage", label: "Storage", isComingSoon: true },
  { to: "/runtimes", label: "Runtimes" },
  { to: "/skills", label: "Skills" },
  { to: "/sessions", label: "Sessions" },
  { to: "/settings", label: "Settings" },
];

export type FlattenedNavItem = {
  to: string;
  label: string;
  isComingSoon?: boolean;
  depth: number;
};

export function flattenNavItems(items: NavItem[], depth = 0): FlattenedNavItem[] {
  const flattened: FlattenedNavItem[] = [];
  for (const item of items) {
    flattened.push({
      to: item.to,
      label: item.label,
      isComingSoon: item.isComingSoon,
      depth,
    });
    if (item.children && item.children.length > 0) {
      flattened.push(...flattenNavItems(item.children, depth + 1));
    }
  }
  return flattened;
}
