import { get } from "@/lib/api-client";

import { SourceControlPreviewResponseSchema } from "@/features/source-control/schemas";

const SOURCE_CONTROL_PREVIEW_PATH = "/api/source-control/preview";

type SourceControlPreviewOptions = {
  projectId?: string | null;
  branchLimit?: number;
  changedFileLimit?: number;
};

export function getSourceControlPreview(options: SourceControlPreviewOptions = {}) {
  const searchParams = new URLSearchParams();
  if (options.projectId) {
    searchParams.set("projectId", options.projectId);
  }
  if (typeof options.branchLimit === "number") {
    searchParams.set("branchLimit", String(options.branchLimit));
  }
  if (typeof options.changedFileLimit === "number") {
    searchParams.set("changedFileLimit", String(options.changedFileLimit));
  }

  const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : "";
  return get(`${SOURCE_CONTROL_PREVIEW_PATH}${suffix}`, SourceControlPreviewResponseSchema);
}

