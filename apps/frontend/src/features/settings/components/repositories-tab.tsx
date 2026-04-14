import { useMemo, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  patchWorkspaceLocalProfile,
  readWorkspaceLocalProfile,
  type LocalWorkspaceRepository,
} from "@/features/settings/components/workspace-settings-local";
import { useWorkspaces } from "@/features/workspaces/hooks/use-workspaces";

function buildRepositoryDraft(): LocalWorkspaceRepository {
  return {
    id: crypto.randomUUID(),
    url: "",
    description: "",
  };
}

export function RepositoriesTab() {
  const { workspacesQuery } = useWorkspaces();
  const workspace = useMemo(() => {
    const entries = workspacesQuery.data?.entries ?? [];
    return entries.find((entry) => entry.isActive) ?? entries[0] ?? null;
  }, [workspacesQuery.data?.entries]);

  const [repositories, setRepositories] = useState<LocalWorkspaceRepository[]>(() => {
    if (!workspace) {
      return [];
    }
    return readWorkspaceLocalProfile(workspace.id).repositories;
  });

  const handleSave = () => {
    if (!workspace) {
      return;
    }
    const normalized = repositories
      .map((repository) => ({
        ...repository,
        url: repository.url.trim(),
        description: repository.description.trim(),
      }))
      .filter((repository) => repository.url.length > 0);
    patchWorkspaceLocalProfile(workspace.id, { repositories: normalized });
    setRepositories(normalized);
    toast.success("Repositories saved");
  };

  const handleAdd = () => {
    setRepositories((current) => [...current, buildRepositoryDraft()]);
  };

  const handleRemove = (repositoryId: string) => {
    setRepositories((current) => current.filter((repository) => repository.id !== repositoryId));
  };

  const handleChange = (repositoryId: string, field: "url" | "description", value: string) => {
    setRepositories((current) =>
      current.map((repository) =>
        repository.id === repositoryId ? { ...repository, [field]: value } : repository,
      ),
    );
  };

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Repositories</h2>

        <Card className="border-white/[0.08] bg-white/[0.03]">
          <CardContent className="space-y-3 p-4">
            <p className="text-xs text-muted-foreground">
              GitHub repositories associated with this workspace. Agents use these repositories to clone and work on code.
            </p>

            {repositories.map((repository) => (
              <div key={repository.id} className="flex gap-2">
                <div className="min-w-0 flex-1 space-y-2">
                  <Input
                    value={repository.url}
                    onChange={(event) => handleChange(repository.id, "url", event.target.value)}
                    placeholder="https://github.com/org/repo"
                    className="bg-white/[0.03]"
                  />
                  <Input
                    value={repository.description}
                    onChange={(event) => handleChange(repository.id, "description", event.target.value)}
                    placeholder="Description"
                    className="bg-white/[0.03]"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="mt-1 text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemove(repository.id)}
                  aria-label="Remove repository"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
                <Plus className="h-3.5 w-3.5" />
                Add repository
              </Button>
              <Button type="button" size="sm" onClick={handleSave} disabled={!workspace}>
                <Save className="h-3.5 w-3.5" />
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
