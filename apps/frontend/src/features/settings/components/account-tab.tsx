import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMedusaAdminAuthStore } from "@/features/medusa-auth/hooks/use-medusa-admin-auth";

function getDisplayName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  fallbackEmail: string | null | undefined,
): string {
  const combined = `${firstName ?? ""} ${lastName ?? ""}`.trim();
  if (combined) {
    return combined;
  }
  if (fallbackEmail) {
    return fallbackEmail.split("@")[0] ?? fallbackEmail;
  }
  return "";
}

function getInitials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) {
    return "U";
  }
  return cleaned
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function AccountTab() {
  const user = useMedusaAdminAuthStore((state) => state.user);
  const lastAuthenticatedEmail = useMedusaAdminAuthStore((state) => state.lastAuthenticatedEmail);

  const [profileName, setProfileName] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const email = user?.email ?? lastAuthenticatedEmail ?? "";
  const displayName = useMemo(
    () => getDisplayName(user?.first_name, user?.last_name, email),
    [email, user?.first_name, user?.last_name],
  );

  useEffect(() => {
    setProfileName(displayName);
  }, [displayName]);

  const avatarSrc = avatarPreview || user?.avatar_url || null;
  const initials = getInitials(profileName || displayName || email);

  const handleAvatarUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setAvatarPreview(reader.result);
        toast.success("Avatar updated locally");
      }
    };
    reader.onerror = () => {
      toast.error("Failed to read avatar image");
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const handleSave = async () => {
    const trimmed = profileName.trim();
    if (!trimmed) {
      return;
    }

    setProfileSaving(true);
    try {
      const [firstName, ...rest] = trimmed.split(/\s+/);
      const lastName = rest.join(" ").trim();

      useMedusaAdminAuthStore.setState((state) => ({
        user: state.user
          ? {
              ...state.user,
              first_name: firstName || null,
              last_name: lastName || null,
            }
          : state.user,
      }));
      toast.success("Profile updated");
    } finally {
      setProfileSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Profile</h2>

        <Card className="border-white/[0.08] bg-white/[0.03]">
          <CardContent className="space-y-4 p-4">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-full border border-white/10 bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Upload avatar"
              >
                {avatarSrc ? (
                  <img src={avatarSrc} alt="Profile avatar" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-sm font-semibold text-muted-foreground">
                    {initials}
                  </span>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarUpload}
              />
              <div className="text-sm text-muted-foreground">Click to upload avatar</div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="settings-profile-name" className="text-xs text-muted-foreground">
                Name
              </Label>
              <Input
                id="settings-profile-name"
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
                placeholder="Your name"
                className="bg-white/[0.03]"
              />
            </div>

            {email ? (
              <p className="text-xs text-muted-foreground">Signed in as {email}</p>
            ) : null}

            <div className="flex items-center justify-end">
              <Button size="sm" onClick={() => void handleSave()} disabled={profileSaving || !profileName.trim()}>
                {profileSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {profileSaving ? "Updating..." : "Update Profile"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
