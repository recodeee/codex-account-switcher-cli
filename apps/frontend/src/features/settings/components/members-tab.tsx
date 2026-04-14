import { useMemo, useState } from "react";
import { Crown, Plus, Shield, Trash2, UserRound, Users } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMedusaAdminAuthStore } from "@/features/medusa-auth/hooks/use-medusa-admin-auth";
import {
  patchWorkspaceLocalProfile,
  readWorkspaceLocalProfile,
  type LocalWorkspaceMember,
  type LocalWorkspaceMemberRole,
} from "@/features/settings/components/workspace-settings-local";
import { useWorkspaces } from "@/features/workspaces/hooks/use-workspaces";

const ROLE_ICON: Record<LocalWorkspaceMemberRole, typeof Crown> = {
  owner: Crown,
  admin: Shield,
  member: UserRound,
};

const ROLE_LABEL: Record<LocalWorkspaceMemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

function resolveOwnerName(email: string): string {
  const local = email.split("@")[0] ?? email;
  const words = local.split(/[._-]+/).filter(Boolean);
  return words.length > 0 ? words.join(" ") : email;
}

export function MembersTab() {
  const { workspacesQuery } = useWorkspaces();
  const user = useMedusaAdminAuthStore((state) => state.user);
  const lastAuthenticatedEmail = useMedusaAdminAuthStore((state) => state.lastAuthenticatedEmail);

  const workspace = useMemo(() => {
    const entries = workspacesQuery.data?.entries ?? [];
    return entries.find((entry) => entry.isActive) ?? entries[0] ?? null;
  }, [workspacesQuery.data?.entries]);

  const ownerEmail = user?.email ?? lastAuthenticatedEmail ?? "owner@workspace.local";
  const ownerName =
    `${user?.first_name ?? ""} ${user?.last_name ?? ""}`.trim() || resolveOwnerName(ownerEmail);

  const [members, setMembers] = useState<LocalWorkspaceMember[]>(() => {
    if (!workspace) {
      return [];
    }
    const local = readWorkspaceLocalProfile(workspace.id);
    if (local.members.length > 0) {
      return local.members;
    }
    return [
      {
        id: `member-owner-${ownerEmail}`,
        name: ownerName,
        email: ownerEmail,
        role: "owner",
      },
    ];
  });
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<LocalWorkspaceMemberRole>("member");

  const persistMembers = (nextMembers: LocalWorkspaceMember[]) => {
    if (!workspace) {
      return;
    }
    patchWorkspaceLocalProfile(workspace.id, { members: nextMembers });
    setMembers(nextMembers);
  };

  const handleInvite = () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      return;
    }
    if (members.some((member) => member.email.toLowerCase() === email)) {
      toast.error("Member already exists");
      return;
    }
    const nextMembers = [
      ...members,
      {
        id: crypto.randomUUID(),
        name: resolveOwnerName(email),
        email,
        role: inviteRole,
      },
    ];
    persistMembers(nextMembers);
    setInviteEmail("");
    setInviteRole("member");
    toast.success("Member added");
  };

  const handleRemove = (memberId: string) => {
    const target = members.find((member) => member.id === memberId);
    if (target?.role === "owner") {
      toast.error("Owner cannot be removed");
      return;
    }
    const nextMembers = members.filter((member) => member.id !== memberId);
    persistMembers(nextMembers);
    toast.success("Member removed");
  };

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Members ({members.length})</h2>
        </div>

        <Card className="border-white/[0.08] bg-white/[0.03]">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Add member</h3>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_120px_auto]">
              <Input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="user@company.com"
                className="bg-white/[0.03]"
              />
              <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as LocalWorkspaceMemberRole)}>
                <SelectTrigger size="sm" className="bg-white/[0.03]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              <Button type="button" onClick={handleInvite} disabled={!inviteEmail.trim()}>
                Add
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03]">
          {members.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">No members found.</p>
          ) : (
            members.map((member, index) => {
              const RoleIcon = ROLE_ICON[member.role];
              return (
                <div key={member.id} className={index > 0 ? "border-t border-white/[0.08]" : ""}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xs font-semibold text-muted-foreground">
                      {(member.name.trim()[0] ?? member.email[0] ?? "M").toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{member.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                    </div>
                    <Badge variant="secondary">
                      <RoleIcon className="h-3.5 w-3.5" />
                      {ROLE_LABEL[member.role]}
                    </Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemove(member.id)}
                      disabled={member.role === "owner"}
                      aria-label={`Remove ${member.email}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
