"use client";

import { FileText, Plus, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

const SKILLS_STORAGE_KEY = "recodee.skills.v1";
const DEFAULT_FILE_PATH = "SKILL.md";

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `skill-${Math.random().toString(36).slice(2, 11)}`;
}

function buildDefaultSkills(): SkillRecord[] {
  return [
    {
      id: generateId(),
      name: "Code review",
      description: "",
      files: [{ path: DEFAULT_FILE_PATH, content: "" }],
    },
  ];
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
      const id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : generateId();
      const name = typeof candidate.name === "string" && candidate.name.trim() ? candidate.name : "Untitled skill";
      const description = typeof candidate.description === "string" ? candidate.description : "";
      const files = Array.isArray(candidate.files)
        ? candidate.files
            .map((file) => {
              if (!file || typeof file !== "object") {
                return null;
              }
              const candidateFile = file as Partial<SkillFile>;
              const path = typeof candidateFile.path === "string" && candidateFile.path.trim() ? candidateFile.path.trim() : null;
              if (!path) {
                return null;
              }
              return {
                path,
                content: typeof candidateFile.content === "string" ? candidateFile.content : "",
              };
            })
            .filter((file): file is SkillFile => Boolean(file))
        : [];

      return {
        id,
        name,
        description,
        files: files.length > 0 ? files : [{ path: DEFAULT_FILE_PATH, content: "" }],
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
    return normalized.length > 0 ? normalized : buildDefaultSkills();
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

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillRecord[]>(() => readStoredSkills());
  const [selectedSkillId, setSelectedSkillId] = useState<string>("");
  const [selectedFileBySkillId, setSelectedFileBySkillId] = useState<Record<string, string>>({});

  const panelSurfaceClass =
    "overflow-hidden border-white/[0.08] bg-[linear-gradient(180deg,rgba(7,10,18,0.97)_0%,rgba(3,5,12,1)_100%)] py-0 text-slate-100";

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
    return selectedSkill.files.find((file) => file.path === selectedFilePath) ?? null;
  }, [selectedFilePath, selectedSkill]);

  const updateSelectedSkill = (updater: (skill: SkillRecord) => SkillRecord) => {
    if (!selectedSkill) {
      return;
    }

    setSkills((current) =>
      current.map((skill) => (skill.id === selectedSkill.id ? updater(skill) : skill)),
    );
  };

  const createSkill = () => {
    const skill: SkillRecord = {
      id: generateId(),
      name: makeUniqueSkillName(skills),
      description: "",
      files: [{ path: DEFAULT_FILE_PATH, content: "" }],
    };

    setSkills((current) => {
      return [skill, ...current];
    });
    setSelectedSkillId(skill.id);
    setSelectedFileBySkillId((current) => ({
      ...current,
      [skill.id]: DEFAULT_FILE_PATH,
    }));
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
  };

  return (
    <div className="animate-fade-in-up h-full w-full overflow-hidden bg-[linear-gradient(180deg,rgba(7,10,18,0.97)_0%,rgba(3,5,12,1)_100%)]">
      <h1 className="sr-only">Skills</h1>
      <div className="grid h-[calc(100vh-98px)] gap-px bg-white/[0.06] xl:grid-cols-[260px_200px_minmax(0,1fr)]">
        <Card className={cn(panelSurfaceClass, "h-full rounded-none border-0 xl:border-r xl:border-white/[0.08]")}>
          <CardContent className="flex h-full flex-col p-0">
            <div className="flex h-12 items-center justify-between border-b border-white/[0.08] px-3">
              <p className="text-sm font-semibold text-slate-100">Skills</p>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-slate-400 hover:bg-white/[0.06] hover:text-slate-100"
                onClick={createSkill}
                aria-label="Create skill"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {skills.map((skill) => {
                const selected = skill.id === selectedSkill?.id;
                return (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={() => setSelectedSkillId(skill.id)}
                    className={cn(
                      "flex w-full items-center gap-3 border-b border-white/[0.06] px-3 py-3 text-left transition-colors",
                      selected ? "bg-white/[0.08]" : "hover:bg-white/[0.04]",
                    )}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/[0.1] bg-white/[0.03]">
                      <Sparkles className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-100">{skill.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-slate-400">
                        {skill.description || "No description"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className={cn(panelSurfaceClass, "h-full rounded-none border-0 xl:border-r xl:border-white/[0.08]")}>
          <CardContent className="flex h-full flex-col p-0">
            <div className="flex h-12 items-center justify-between border-b border-white/[0.08] px-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Files</p>
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
              {(selectedSkill?.files ?? []).map((file) => {
                const selected = file.path === selectedFilePath;
                return (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => {
                      if (!selectedSkill) {
                        return;
                      }
                      setSelectedFileBySkillId((current) => ({
                        ...current,
                        [selectedSkill.id]: file.path,
                      }));
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                      selected ? "bg-white/[0.08] text-slate-100" : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200",
                    )}
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{file.path}</span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className={cn(panelSurfaceClass, "h-full rounded-none border-0")}>
          <CardContent className="flex h-full flex-col p-0">
            <div className="grid gap-2 border-b border-white/[0.08] px-4 py-2 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
              <Input
                value={selectedSkill?.name ?? ""}
                onChange={(event) => {
                  updateSelectedSkill((skill) => ({
                    ...skill,
                    name: event.target.value,
                  }));
                }}
                disabled={!selectedSkill}
                className="h-8 border-white/[0.12] bg-white/[0.03] text-sm text-slate-100 placeholder:text-slate-500"
                placeholder="Skill name"
              />
              <Input
                value={selectedSkill?.description ?? ""}
                onChange={(event) => {
                  updateSelectedSkill((skill) => ({
                    ...skill,
                    description: event.target.value,
                  }));
                }}
                disabled={!selectedSkill}
                className="h-8 border-white/[0.12] bg-white/[0.03] text-sm text-slate-100 placeholder:text-slate-500"
                placeholder="Description"
              />
            </div>

            <div className="flex h-10 items-center border-b border-white/[0.08] px-4 text-xs text-slate-400">
              {selectedFile?.path ?? DEFAULT_FILE_PATH}
            </div>

            <div className="relative flex-1 overflow-hidden p-4">
              {selectedFile?.content ? null : (
                <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-base italic text-slate-500">
                  No content yet
                </p>
              )}
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
                disabled={!selectedSkill || !selectedFile}
                className={cn(
                  "h-full min-h-full w-full resize-none border-0 bg-transparent px-0 font-mono text-sm leading-6 text-slate-200 shadow-none placeholder:text-slate-600 focus-visible:ring-0",
                  selectedFile?.content ? "opacity-100" : "opacity-60",
                )}
                placeholder=""
                spellCheck={false}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
