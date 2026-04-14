"use client";

import {
  AlertCircle,
  Download,
  Eye,
  FileText,
  Link,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type SkillFile = {
  path: string;
  content: string;
};

type SkillRecord = {
  id: string;
  name: string;
  description: string;
  files: SkillFile[];
};

type ImportedSkill = {
  name: string;
  description: string;
  content: string;
  files: SkillFile[];
};

type ImportSource = "clawhub" | "skills.sh" | "markdown-url";

type ClawHubSkillResponse = {
  skill?: {
    slug?: string;
    displayName?: string;
    summary?: string;
    tags?: Record<string, string>;
  };
  latestVersion?: {
    version?: string;
  };
};

type ClawHubVersionResponse = {
  version?: {
    version?: string;
    files?: Array<{ path?: string }>;
  };
};

type GitHubRepoInfo = {
  default_branch?: string;
};

type GitHubContentEntry = {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
};

const SKILLS_STORAGE_KEY = "recodee.skills.v1";
const DEFAULT_FILE_PATH = "SKILL.md";
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function generateId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `skill-${Math.random().toString(36).slice(2, 11)}`;
}

function buildDefaultSkills(): SkillRecord[] {
  return [];
}

function normalizeSkills(value: unknown): SkillRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const candidate = entry as Partial<SkillRecord>;
      const id =
        typeof candidate.id === "string" && candidate.id.trim()
          ? candidate.id
          : generateId();
      const name =
        typeof candidate.name === "string" && candidate.name.trim()
          ? candidate.name
          : "Untitled skill";
      const description =
        typeof candidate.description === "string" ? candidate.description : "";
      const files = Array.isArray(candidate.files)
        ? candidate.files
            .map((file) => {
              if (!file || typeof file !== "object") {
                return null;
              }
              const candidateFile = file as Partial<SkillFile>;
              const path =
                typeof candidateFile.path === "string" &&
                candidateFile.path.trim()
                  ? candidateFile.path.trim()
                  : null;
              if (!path) {
                return null;
              }
              return {
                path,
                content:
                  typeof candidateFile.content === "string"
                    ? candidateFile.content
                    : "",
              };
            })
            .filter((file): file is SkillFile => Boolean(file))
        : [];

      return {
        id,
        name,
        description,
        files:
          files.length > 0
            ? files
            : [{ path: DEFAULT_FILE_PATH, content: "" }],
      };
    })
    .filter((skill): skill is SkillRecord => Boolean(skill));

  return normalized;
}

function readStoredSkills(): SkillRecord[] {
  if (typeof window === "undefined") {
    return buildDefaultSkills();
  }

  try {
    const raw = window.localStorage.getItem(SKILLS_STORAGE_KEY);
    if (!raw) {
      return buildDefaultSkills();
    }
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizeSkills(parsed);
    return normalized;
  } catch {
    return buildDefaultSkills();
  }
}

function writeStoredSkills(skills: SkillRecord[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(SKILLS_STORAGE_KEY, JSON.stringify(skills));
}

function makeUniqueSkillName(skills: SkillRecord[]) {
  const base = "New skill";
  const names = new Set(skills.map((skill) => skill.name.trim().toLowerCase()));
  if (!names.has(base.toLowerCase())) {
    return base;
  }

  let index = 2;
  while (names.has(`${base} ${index}`.toLowerCase())) {
    index += 1;
  }
  return `${base} ${index}`;
}

function makeUniqueFilePath(files: SkillFile[]) {
  const base = "new-file";
  const ext = ".md";
  const paths = new Set(files.map((file) => file.path.toLowerCase()));
  if (!paths.has(`${base}${ext}`)) {
    return `${base}${ext}`;
  }

  let index = 2;
  while (paths.has(`${base}-${index}${ext}`)) {
    index += 1;
  }
  return `${base}-${index}${ext}`;
}

function isMarkdownFile(path: string): boolean {
  return /\.mdx?$/i.test(path);
}

function deriveSkillNameFromFile(fileName: string): string {
  const nameWithoutExtension = fileName.replace(/\.[^.]+$/, "");
  const normalized = nameWithoutExtension.replace(/[-_]+/g, " ").trim();
  if (!normalized) {
    return "Imported skill";
  }
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function parseSkillMarkdownImport(
  fileName: string,
  raw: string,
): {
  name: string;
  description: string;
  content: string;
} {
  const match = FRONTMATTER_RE.exec(raw);
  const fallbackName = deriveSkillNameFromFile(fileName);

  if (!match) {
    return { name: fallbackName, description: "", content: raw };
  }

  let name = "";
  let description = "";
  const frontmatterBlock = match[1] ?? "";

  for (const line of frontmatterBlock.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim().toLowerCase();
    let value = line.slice(separator + 1).trim();
    value = value.replace(/^['"]|['"]$/g, "");

    if (key === "name") {
      name = value;
    } else if (key === "description") {
      description = value;
    }
  }

  return {
    name: name || fallbackName,
    description,
    content: raw,
  };
}

function normalizeImportUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("URL is required");
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function detectImportSource(raw: string): {
  source: ImportSource;
  normalizedUrl: string;
} {
  const normalizedUrl = normalizeImportUrl(raw);
  const parsed = new URL(normalizedUrl);
  const host = parsed.hostname.toLowerCase();

  if (host === "clawhub.ai" || host === "www.clawhub.ai") {
    return { source: "clawhub", normalizedUrl };
  }

  if (host === "skills.sh" || host === "www.skills.sh") {
    return { source: "skills.sh", normalizedUrl };
  }

  if (/\.(md|mdx)(?:$|\?)/i.test(parsed.pathname)) {
    return { source: "markdown-url", normalizedUrl };
  }

  throw new Error(
    `Unsupported source: ${host}. Supported sources are clawhub.ai, skills.sh, or direct SKILL.md URLs.`,
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return (await response.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return await response.text();
}

function parseClawHubSlug(normalizedUrl: string): string {
  const parsed = new URL(normalizedUrl);
  const parts = parsed.pathname.split("/").filter(Boolean);

  if (parts.length >= 2) {
    return parts[parts.length - 1] ?? "";
  }

  if (parts.length === 1) {
    return parts[0] ?? "";
  }

  throw new Error("Missing skill slug in ClawHub URL");
}

async function importFromClawHub(normalizedUrl: string): Promise<ImportedSkill> {
  const slug = parseClawHubSlug(normalizedUrl);
  const apiBase = "https://clawhub.ai/api/v1";

  const metadata = await fetchJson<ClawHubSkillResponse>(
    `${apiBase}/skills/${encodeURIComponent(slug)}`,
  );

  const displayName = metadata.skill?.displayName?.trim() || slug;
  const description = metadata.skill?.summary?.trim() || "";
  const latestVersion =
    metadata.skill?.tags?.latest?.trim() ||
    metadata.latestVersion?.version?.trim() ||
    "";

  let filePaths: string[] = [DEFAULT_FILE_PATH];

  if (latestVersion) {
    try {
      const versionDetail = await fetchJson<ClawHubVersionResponse>(
        `${apiBase}/skills/${encodeURIComponent(
          slug,
        )}/versions/${encodeURIComponent(latestVersion)}`,
      );
      const fromVersion = (versionDetail.version?.files ?? [])
        .map((file) => file.path?.trim() ?? "")
        .filter(Boolean);
      if (fromVersion.length > 0) {
        filePaths = fromVersion;
      }
    } catch {
      // Keep default SKILL.md fallback.
    }
  }

  let skillMarkdown = "";
  const importedFiles: SkillFile[] = [];

  for (const path of filePaths) {
    const fileUrl = new URL(`${apiBase}/skills/${encodeURIComponent(slug)}/file`);
    fileUrl.searchParams.set("path", path);
    if (latestVersion) {
      fileUrl.searchParams.set("version", latestVersion);
    }

    try {
      const content = await fetchText(fileUrl.toString());
      if (path === DEFAULT_FILE_PATH) {
        skillMarkdown = content;
      } else {
        importedFiles.push({ path, content });
      }
    } catch {
      if (path === DEFAULT_FILE_PATH) {
        throw new Error("Unable to download SKILL.md from ClawHub");
      }
    }
  }

  if (!skillMarkdown) {
    throw new Error("ClawHub import returned no SKILL.md content");
  }

  const parsed = parseSkillMarkdownImport(DEFAULT_FILE_PATH, skillMarkdown);

  return {
    name: parsed.name || displayName,
    description: parsed.description || description,
    content: parsed.content,
    files: importedFiles,
  };
}

function parseSkillsShParts(normalizedUrl: string): {
  owner: string;
  repo: string;
  skillName: string;
} {
  const parsed = new URL(normalizedUrl);
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length !== 3) {
    throw new Error(
      "Expected skills.sh URL format: skills.sh/{owner}/{repo}/{skill-name}",
    );
  }

  return {
    owner: parts[0] ?? "",
    repo: parts[1] ?? "",
    skillName: parts[2] ?? "",
  };
}

async function fetchGitHubDefaultBranch(
  owner: string,
  repo: string,
): Promise<string> {
  try {
    const info = await fetchJson<GitHubRepoInfo>(
      `https://api.github.com/repos/${encodeURIComponent(
        owner,
      )}/${encodeURIComponent(repo)}`,
    );
    return info.default_branch?.trim() || "main";
  } catch {
    return "main";
  }
}

async function listGitHubDirectory(
  owner: string,
  repo: string,
  dirPath: string,
  branch: string,
): Promise<GitHubContentEntry[]> {
  const url = new URL(
    `https://api.github.com/repos/${encodeURIComponent(
      owner,
    )}/${encodeURIComponent(repo)}/contents/${dirPath}`,
  );
  url.searchParams.set("ref", branch);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`GitHub contents request failed (${response.status})`);
  }

  const json = (await response.json()) as unknown;
  if (!Array.isArray(json)) {
    return [];
  }

  return json
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const candidate = entry as Partial<GitHubContentEntry>;
      if (
        typeof candidate.name !== "string" ||
        typeof candidate.path !== "string" ||
        (candidate.type !== "file" && candidate.type !== "dir")
      ) {
        return null;
      }
      return {
        name: candidate.name,
        path: candidate.path,
        type: candidate.type,
        download_url:
          typeof candidate.download_url === "string"
            ? candidate.download_url
            : null,
      } satisfies GitHubContentEntry;
    })
    .filter((entry): entry is GitHubContentEntry => Boolean(entry));
}

async function importFromSkillsSh(normalizedUrl: string): Promise<ImportedSkill> {
  const { owner, repo, skillName } = parseSkillsShParts(normalizedUrl);
  const branch = await fetchGitHubDefaultBranch(owner, repo);

  const candidateDirectories = [
    `skills/${skillName}`,
    `.claude/skills/${skillName}`,
    `plugin/skills/${skillName}`,
    `${skillName}`,
  ];

  let skillDir = "";
  let skillMarkdown = "";

  for (const directory of candidateDirectories) {
    const skillUrl = `https://raw.githubusercontent.com/${encodeURIComponent(
      owner,
    )}/${encodeURIComponent(repo)}/${encodeURIComponent(
      branch,
    )}/${directory}/SKILL.md`;
    try {
      skillMarkdown = await fetchText(skillUrl);
      skillDir = directory;
      break;
    } catch {
      // Try next candidate directory.
    }
  }

  if (!skillDir || !skillMarkdown) {
    throw new Error(`SKILL.md not found for ${owner}/${repo}/${skillName}`);
  }

  const parsed = parseSkillMarkdownImport(DEFAULT_FILE_PATH, skillMarkdown);
  const files: SkillFile[] = [];
  const visitedDirs = new Set<string>();

  const collectFiles = async (directory: string): Promise<void> => {
    if (visitedDirs.has(directory)) {
      return;
    }
    visitedDirs.add(directory);

    let entries: GitHubContentEntry[];
    try {
      entries = await listGitHubDirectory(owner, repo, directory, branch);
    } catch {
      return;
    }

    for (const entry of entries) {
      const lower = entry.name.toLowerCase();
      if (
        lower === "skill.md" ||
        lower === "license" ||
        lower === "license.md" ||
        lower === "license.txt"
      ) {
        continue;
      }

      if (entry.type === "dir") {
        await collectFiles(entry.path);
        continue;
      }

      if (!entry.download_url) {
        continue;
      }

      try {
        const content = await fetchText(entry.download_url);
        const relativePath = entry.path.startsWith(`${skillDir}/`)
          ? entry.path.slice(skillDir.length + 1)
          : entry.path;

        if (!relativePath) {
          continue;
        }

        files.push({
          path: relativePath,
          content,
        });
      } catch {
        // Ignore individual file download failures.
      }
    }
  };

  await collectFiles(skillDir);

  return {
    name: parsed.name || deriveSkillNameFromFile(skillName),
    description: parsed.description,
    content: parsed.content,
    files,
  };
}

async function importFromMarkdownUrl(normalizedUrl: string): Promise<ImportedSkill> {
  const markdown = await fetchText(normalizedUrl);
  const fileName = new URL(normalizedUrl).pathname.split("/").pop() || DEFAULT_FILE_PATH;
  const parsed = parseSkillMarkdownImport(fileName, markdown);

  return {
    name: parsed.name,
    description: parsed.description,
    content: parsed.content,
    files: [],
  };
}

async function importSkillFromUrl(url: string): Promise<ImportedSkill> {
  const { source, normalizedUrl } = detectImportSource(url);

  if (source === "clawhub") {
    return await importFromClawHub(normalizedUrl);
  }
  if (source === "skills.sh") {
    return await importFromSkillsSh(normalizedUrl);
  }
  return await importFromMarkdownUrl(normalizedUrl);
}

function mergeImportedFiles(imported: ImportedSkill): SkillFile[] {
  const seen = new Set<string>();
  const normalizedFiles: SkillFile[] = [];

  const pushFile = (file: SkillFile) => {
    const path = file.path.trim();
    if (!path || seen.has(path.toLowerCase())) {
      return;
    }
    seen.add(path.toLowerCase());
    normalizedFiles.push({ path, content: file.content });
  };

  pushFile({ path: DEFAULT_FILE_PATH, content: imported.content });
  for (const file of imported.files) {
    pushFile(file);
  }

  return normalizedFiles;
}

function AddSkillDialog({
  open,
  onOpenChange,
  onCreate,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { name: string; description: string }) => Promise<void>;
  onImport: (url: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<"create" | "import">("create");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetDialogState = () => {
    setTab("create");
    setName("");
    setDescription("");
    setImportUrl("");
    setIsSubmitting(false);
    setError(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetDialogState();
    }
    onOpenChange(nextOpen);
  };

  const detectedSource = useMemo(() => {
    if (!importUrl.trim()) {
      return null;
    }

    try {
      const { source } = detectImportSource(importUrl);
      if (source === "clawhub" || source === "skills.sh") {
        return source;
      }
    } catch {
      return null;
    }

    return null;
  }, [importUrl]);

  const handleCreate = async () => {
    if (!name.trim()) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onCreate({
        name: name.trim(),
        description: description.trim(),
      });
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create skill");
      setIsSubmitting(false);
    }
  };

  const handleImport = async () => {
    if (!importUrl.trim()) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onImport(importUrl.trim());
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to import skill");
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border border-white/[0.12] bg-[#111318] p-0 text-slate-100 shadow-2xl sm:max-w-[430px]">
        <DialogHeader className="space-y-1 border-b border-white/[0.08] px-5 pt-4 pb-3 text-left">
          <DialogTitle className="text-xl font-semibold tracking-tight">
            Add Skill
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-400">
            Create a new skill or import from ClawHub / Skills.sh.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <Tabs value={tab} onValueChange={(value) => setTab(value as "create" | "import")}> 
            <TabsList className="grid h-8 w-full grid-cols-2 rounded-lg border border-white/[0.08] bg-white/[0.02] p-0.5">
              <TabsTrigger
                value="create"
                className="h-7 rounded-md text-xs data-[state=active]:bg-white/[0.08]"
              >
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Create
              </TabsTrigger>
              <TabsTrigger
                value="import"
                className="h-7 rounded-md text-xs data-[state=active]:bg-white/[0.08]"
              >
                <Download className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Import
              </TabsTrigger>
            </TabsList>

            <TabsContent value="create" className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400">Name</Label>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Code Review, Bug Triage"
                  className="h-10 border-white/[0.12] bg-white/[0.03] text-sm text-slate-100 placeholder:text-slate-500"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void handleCreate();
                    }
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400">Description</Label>
                <Input
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Brief description of what this skill does"
                  className="h-10 border-white/[0.12] bg-white/[0.03] text-sm text-slate-100 placeholder:text-slate-500"
                />
              </div>
            </TabsContent>

            <TabsContent value="import" className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400">Skill URL</Label>
                <Input
                  value={importUrl}
                  onChange={(event) => {
                    setImportUrl(event.target.value);
                    setError(null);
                  }}
                  placeholder="Paste a skill URL..."
                  className="h-10 border-white/[0.12] bg-white/[0.03] text-sm text-slate-100 placeholder:text-slate-500"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void handleImport();
                    }
                  }}
                />
              </div>

              <div className="space-y-2">
                <p className="text-xs text-slate-400">Supported sources</p>
                <div className="grid grid-cols-2 gap-2">
                  <div
                    className={cn(
                      "rounded-md border border-white/[0.1] bg-white/[0.02] px-3 py-2.5",
                      detectedSource === "clawhub" &&
                        "border-cyan-400/45 bg-cyan-500/[0.08]",
                    )}
                  >
                    <p className="text-xs font-medium text-slate-200">ClawHub</p>
                    <p className="mt-1 text-[11px] text-slate-500">clawhub.ai/owner/skill</p>
                  </div>
                  <div
                    className={cn(
                      "rounded-md border border-white/[0.1] bg-white/[0.02] px-3 py-2.5",
                      detectedSource === "skills.sh" &&
                        "border-cyan-400/45 bg-cyan-500/[0.08]",
                    )}
                  >
                    <p className="text-xs font-medium text-slate-200">Skills.sh</p>
                    <p className="mt-1 text-[11px] text-slate-500">skills.sh/owner/repo/skill</p>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {error ? (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-t border-white/[0.08] bg-white/[0.02] px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            className="text-slate-300 hover:bg-white/[0.06] hover:text-slate-100"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          {tab === "create" ? (
            <Button
              type="button"
              onClick={() => {
                void handleCreate();
              }}
              disabled={isSubmitting || !name.trim()}
              className="bg-white text-black hover:bg-slate-200"
            >
              {isSubmitting ? "Creating..." : "Create"}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => {
                void handleImport();
              }}
              disabled={isSubmitting || !importUrl.trim()}
              className="bg-white text-black hover:bg-slate-200"
            >
              <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {isSubmitting ? "Importing..." : "Import"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillRecord[]>(() => readStoredSkills());
  const [selectedSkillId, setSelectedSkillId] = useState<string>("");
  const [selectedFileBySkillId, setSelectedFileBySkillId] = useState<
    Record<string, string>
  >({});
  const [isAddSkillDialogOpen, setIsAddSkillDialogOpen] = useState(false);
  const [isDeleteSkillDialogOpen, setIsDeleteSkillDialogOpen] = useState(false);
  const [isMarkdownPreview, setIsMarkdownPreview] = useState(false);

  const panelSurfaceClass =
    "overflow-hidden border-white/[0.08] bg-[linear-gradient(180deg,rgba(7,10,18,0.97)_0%,rgba(3,5,12,1)_100%)] py-0 text-slate-100";
  const hasSkills = skills.length > 0;

  useEffect(() => {
    writeStoredSkills(skills);
  }, [skills]);

  const effectiveSelectedSkillId =
    selectedSkillId && skills.some((skill) => skill.id === selectedSkillId)
      ? selectedSkillId
      : skills[0]?.id ?? "";

  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.id === effectiveSelectedSkillId) ?? null,
    [effectiveSelectedSkillId, skills],
  );

  const selectedFilePath = useMemo(() => {
    if (!selectedSkill) {
      return "";
    }

    const preferred = selectedFileBySkillId[selectedSkill.id];
    if (preferred && selectedSkill.files.some((file) => file.path === preferred)) {
      return preferred;
    }

    return selectedSkill.files[0]?.path ?? "";
  }, [selectedFileBySkillId, selectedSkill]);

  const selectedFile = useMemo(() => {
    if (!selectedSkill || !selectedFilePath) {
      return null;
    }
    return (
      selectedSkill.files.find((file) => file.path === selectedFilePath) ?? null
    );
  }, [selectedFilePath, selectedSkill]);

  const selectedFileIsMarkdown = selectedFile
    ? isMarkdownFile(selectedFile.path)
    : false;

  const updateSelectedSkill = (updater: (skill: SkillRecord) => SkillRecord) => {
    if (!selectedSkill) {
      return;
    }

    setSkills((current) =>
      current.map((skill) =>
        skill.id === selectedSkill.id ? updater(skill) : skill,
      ),
    );
  };

  const addSkill = (input: {
    name?: string;
    description?: string;
    files?: SkillFile[];
  }) => {
    const baseName = input.name?.trim() || makeUniqueSkillName(skills);
    const existingNames = new Set(skills.map((skill) => skill.name.trim().toLowerCase()));
    const resolvedName = (() => {
      if (!existingNames.has(baseName.toLowerCase())) {
        return baseName;
      }
      let index = 2;
      let candidate = `${baseName} ${index}`;
      while (existingNames.has(candidate.toLowerCase())) {
        index += 1;
        candidate = `${baseName} ${index}`;
      }
      return candidate;
    })();

    const files =
      (input.files ?? [])
        .map((file) => ({ path: file.path.trim(), content: file.content }))
        .filter((file) => file.path.length > 0) ?? [];

    const skill: SkillRecord = {
      id: generateId(),
      name: resolvedName,
      description: input.description?.trim() ?? "",
      files:
        files.length > 0 ? files : [{ path: DEFAULT_FILE_PATH, content: "" }],
    };

    setSkills((current) => [skill, ...current]);
    setSelectedSkillId(skill.id);
    setSelectedFileBySkillId((current) => ({
      ...current,
      [skill.id]: skill.files[0]?.path ?? DEFAULT_FILE_PATH,
    }));
    setIsMarkdownPreview(false);
  };

  const handleCreateSkill = async (input: {
    name: string;
    description: string;
  }) => {
    addSkill({
      name: input.name,
      description: input.description,
      files: [{ path: DEFAULT_FILE_PATH, content: "" }],
    });
  };

  const handleImportSkill = async (url: string) => {
    const imported = await importSkillFromUrl(url);
    addSkill({
      name: imported.name,
      description: imported.description,
      files: mergeImportedFiles(imported),
    });
  };

  const createFile = () => {
    if (!selectedSkill) {
      return;
    }

    const nextPath = makeUniqueFilePath(selectedSkill.files);
    updateSelectedSkill((skill) => ({
      ...skill,
      files: [...skill.files, { path: nextPath, content: "" }],
    }));

    setSelectedFileBySkillId((current) => ({
      ...current,
      [selectedSkill.id]: nextPath,
    }));
    setIsMarkdownPreview(false);
  };

  const deleteSelectedSkill = () => {
    if (!selectedSkill) {
      return;
    }

    const remaining = skills.filter((skill) => skill.id !== selectedSkill.id);
    setSkills(remaining);
    setSelectedSkillId(remaining[0]?.id ?? "");
    setIsMarkdownPreview(false);

    setSelectedFileBySkillId((current) => {
      if (!(selectedSkill.id in current)) {
        return current;
      }
      const next = { ...current };
      delete next[selectedSkill.id];
      return next;
    });
    setIsDeleteSkillDialogOpen(false);
  };

  return (
    <>
      <div className="animate-fade-in-up h-full w-full overflow-hidden bg-[linear-gradient(180deg,rgba(7,10,18,0.97)_0%,rgba(3,5,12,1)_100%)]">
        <h1 className="sr-only">Skills</h1>
        <div
          className={cn(
            "grid h-[calc(100vh-98px)] gap-px bg-white/[0.06]",
            hasSkills
              ? "xl:grid-cols-[260px_200px_minmax(0,1fr)]"
              : "xl:grid-cols-[260px_minmax(0,1fr)]",
          )}
        >
          <Card
            className={cn(
              panelSurfaceClass,
              "h-full rounded-none border-0 xl:border-r xl:border-white/[0.08]",
            )}
          >
            <CardContent className="flex h-full flex-col p-0">
              <div className="flex h-12 items-center justify-between gap-2 border-b border-white/[0.08] px-3">
                <p className="text-sm font-semibold text-slate-100">Skills</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-md border-white/[0.14] bg-white/[0.03] px-2.5 text-xs text-slate-200 hover:bg-white/[0.08]"
                  onClick={() => setIsAddSkillDialogOpen(true)}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Add Skill
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto">
                {skills.length === 0 ? (
                  <div className="flex h-full items-center justify-center p-4">
                    <div className="w-full max-w-[210px] text-center">
                      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.03]">
                        <Sparkles className="h-5 w-5 text-slate-500" aria-hidden="true" />
                      </span>
                      <p className="mt-3 text-sm font-medium text-slate-200">No skills yet</p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-400">
                        Skills define reusable instructions for agents.
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-4 h-8 rounded-md border-white/[0.14] bg-white/[0.03] px-3 text-xs text-slate-200 hover:bg-white/[0.08]"
                        onClick={() => setIsAddSkillDialogOpen(true)}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                        Create Skill
                      </Button>
                    </div>
                  </div>
                ) : (
                  skills.map((skill) => {
                    const selected = skill.id === selectedSkill?.id;
                    return (
                      <button
                        key={skill.id}
                        type="button"
                        onClick={() => {
                          setSelectedSkillId(skill.id);
                          setIsMarkdownPreview(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 border-b border-white/[0.06] px-3 py-3 text-left transition-colors",
                          selected ? "bg-white/[0.08]" : "hover:bg-white/[0.04]",
                        )}
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/[0.1] bg-white/[0.03]">
                          <Sparkles className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-100">
                            {skill.name}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-slate-400">
                            {skill.description || "No description"}
                          </span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>

          {hasSkills ? (
            <Card
              className={cn(
                panelSurfaceClass,
                "h-full rounded-none border-0 xl:border-r xl:border-white/[0.08]",
              )}
            >
              <CardContent className="flex h-full flex-col p-0">
                <div className="flex h-12 items-center justify-between border-b border-white/[0.08] px-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                    Files
                  </p>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-slate-400 hover:bg-white/[0.06] hover:text-slate-100"
                    onClick={createFile}
                    aria-label="Create file"
                    disabled={!selectedSkill}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>

                <div className="flex-1 overflow-y-auto px-1 py-1">
                  {selectedSkill ? (
                    selectedSkill.files.map((file) => {
                      const selected = file.path === selectedFilePath;
                      return (
                        <button
                          key={file.path}
                          type="button"
                          onClick={() => {
                            if (!selectedSkill) {
                              return;
                            }
                            setIsMarkdownPreview(false);
                            setSelectedFileBySkillId((current) => ({
                              ...current,
                              [selectedSkill.id]: file.path,
                            }));
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                            selected
                              ? "bg-white/[0.08] text-slate-100"
                              : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200",
                          )}
                        >
                          <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate">{file.path}</span>
                        </button>
                      );
                    })
                  ) : (
                    <p className="px-2 py-3 text-xs text-slate-500">
                      Select or create a skill to manage files.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card className={cn(panelSurfaceClass, "h-full rounded-none border-0")}> 
            {selectedSkill ? (
              <CardContent className="flex h-full flex-col p-0">
                <div className="flex items-center gap-2 border-b border-white/[0.08] px-4 py-2">
                  <Input
                    value={selectedSkill.name}
                    onChange={(event) => {
                      updateSelectedSkill((skill) => ({
                        ...skill,
                        name: event.target.value,
                      }));
                    }}
                    className="h-8 max-w-[320px] border-white/[0.12] bg-white/[0.03] text-sm text-slate-100 placeholder:text-slate-500"
                    placeholder="Skill name"
                  />
                  <Input
                    value={selectedSkill.description}
                    onChange={(event) => {
                      updateSelectedSkill((skill) => ({
                        ...skill,
                        description: event.target.value,
                      }));
                    }}
                    className="h-8 flex-1 border-white/[0.12] bg-white/[0.03] text-sm text-slate-100 placeholder:text-slate-500"
                    placeholder="Description"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-slate-400 hover:bg-white/[0.06] hover:text-red-300"
                    aria-label="Delete skill"
                    onClick={() => setIsDeleteSkillDialogOpen(true)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>

                <div className="flex h-10 items-center justify-between border-b border-white/[0.08] px-4 text-xs text-slate-400">
                  <div className="flex min-w-0 items-center">
                    <Link className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      {selectedFile?.path ?? DEFAULT_FILE_PATH}
                    </span>
                  </div>
                  {selectedFileIsMarkdown ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-slate-400 hover:bg-white/[0.06] hover:text-slate-100"
                      onClick={() => setIsMarkdownPreview((value) => !value)}
                      aria-label={isMarkdownPreview ? "Edit markdown" : "Preview markdown"}
                      disabled={!selectedFile}
                    >
                      {isMarkdownPreview ? (
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </Button>
                  ) : null}
                </div>

                <div className="relative flex-1 overflow-hidden p-4">
                  {isMarkdownPreview && selectedFileIsMarkdown ? (
                    selectedFile?.content ? (
                      <pre className="h-full overflow-auto whitespace-pre-wrap break-words font-mono text-sm leading-6 text-slate-200">
                        {selectedFile.content}
                      </pre>
                    ) : (
                      <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-base italic text-slate-500">
                        No content yet
                      </p>
                    )
                  ) : (
                    <Textarea
                      value={selectedFile?.content ?? ""}
                      onChange={(event) => {
                        if (!selectedFile) {
                          return;
                        }
                        updateSelectedSkill((skill) => ({
                          ...skill,
                          files: skill.files.map((file) =>
                            file.path === selectedFile.path
                              ? {
                                  ...file,
                                  content: event.target.value,
                                }
                              : file,
                          ),
                        }));
                      }}
                      disabled={!selectedFile}
                      className="h-full min-h-full w-full resize-none border-0 bg-transparent px-0 font-mono text-sm leading-6 text-slate-200 shadow-none placeholder:text-slate-600 focus-visible:ring-0"
                      placeholder={
                        selectedFileIsMarkdown
                          ? "Write markdown content..."
                          : "File content..."
                      }
                      spellCheck={false}
                    />
                  )}
                </div>
              </CardContent>
            ) : (
              <CardContent className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.03]">
                  <Sparkles className="h-5 w-5 text-slate-500" aria-hidden="true" />
                </span>
                <div className="space-y-1">
                  <p className="text-base font-medium text-slate-200">
                    Select a skill to view details
                  </p>
                  <p className="text-sm text-slate-400">
                    Create your first skill to start adding files and instructions.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-md border-white/[0.14] bg-white/[0.03] px-3 text-xs text-slate-200 hover:bg-white/[0.08]"
                  onClick={() => setIsAddSkillDialogOpen(true)}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Create Skill
                </Button>
              </CardContent>
            )}
          </Card>
        </div>
      </div>

      <AddSkillDialog
        open={isAddSkillDialogOpen}
        onOpenChange={setIsAddSkillDialogOpen}
        onCreate={handleCreateSkill}
        onImport={handleImportSkill}
      />

      <Dialog
        open={isDeleteSkillDialogOpen}
        onOpenChange={setIsDeleteSkillDialogOpen}
      >
        <DialogContent
          showCloseButton={false}
          className="border border-white/[0.12] bg-[#111318] p-0 text-slate-100 shadow-2xl sm:max-w-[420px]"
        >
          <div className="flex items-start gap-3 px-5 pt-5 pb-4">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/20">
              <AlertCircle className="h-4 w-4 text-red-300" aria-hidden="true" />
            </span>
            <DialogHeader className="space-y-1 text-left">
              <DialogTitle className="text-xl font-semibold tracking-tight">
                Delete skill?
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-400">
                This will permanently delete &quot;{selectedSkill?.name ?? "this skill"}&quot; and remove it from all agents.
              </DialogDescription>
            </DialogHeader>
          </div>
          <DialogFooter className="border-t border-white/[0.08] bg-white/[0.02] px-5 py-3">
            <Button
              type="button"
              variant="ghost"
              className="text-slate-300 hover:bg-white/[0.06] hover:text-slate-100"
              onClick={() => setIsDeleteSkillDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={deleteSelectedSkill}
              disabled={!selectedSkill}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
