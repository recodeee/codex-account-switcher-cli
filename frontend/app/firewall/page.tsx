import { redirect } from "next/navigation";

export default function FirewallRedirectPage() {
  redirect("/settings");
}
