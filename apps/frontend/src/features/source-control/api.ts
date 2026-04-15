import { get, post } from "@/lib/api-client";

import {
  SourceControlCommitActivityResponseSchema,
  SourceControlBranchDetailsResponseSchema,
  SourceControlCreatePullRequestResponseSchema,
  SourceControlDeleteBranchResponseSchema,
  SourceControlMergePullRequestResponseSchema,
  SourceControlPreviewResponseSchema,
} from "@/features/source-control/schemas";

const SOURCE_CONTROL_PREVIEW_PATH = "/api/source-control/preview";
const SOURCE_CONTROL_COMMIT_ACTIVITY_PATH = "/api/source-control/commit-activity";
const SOURCE_CONTROL_BRANCH_DETAILS_PATH = "/api/source-control/branch-details";
const SOURCE_CONTROL_CREATE_PULL_REQUEST_PATH = "/api/source-control/pr/create";
const SOURCE_CONTROL_MERGE_PULL_REQUEST_PATH = "/api/source-control/pr/merge";
const SOURCE_CONTROL_DELETE_BRANCH_PATH = "/api/source-control/branch/delete";

type SourceControlPreviewOptions = {
  projectId?: string | null;
  branchLimit?: number;
  changedFileLimit?: number;
};

type SourceControlBranchDetailsOptions = {
  projectId?: string | null;
  branch: string;
  changedFileLimit?: number;
};

type SourceControlCommitActivityOptions = {
  projectId?: string | null;
  days?: number;
  limit?: number;
};

type SourceControlCreatePullRequestInput = {
  projectId?: string | null;
  branch: string;
  baseBranch?: string | null;
  title?: string | null;
  body?: string | null;
  draft?: boolean;
};

type SourceControlMergePullRequestInput = {
  projectId?: string | null;
  branch: string;
  pullRequestNumber?: number | null;
  baseBranch?: string | null;
  deleteBranch?: boolean;
  squash?: boolean;
};

type SourceControlDeleteBranchInput = {
  projectId?: string | null;
  branch: string;
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

export function getSourceControlBranchDetails(options: SourceControlBranchDetailsOptions) {
  const searchParams = new URLSearchParams();
  searchParams.set("branch", options.branch);
  if (options.projectId) {
    searchParams.set("projectId", options.projectId);
  }
  if (typeof options.changedFileLimit === "number") {
    searchParams.set("changedFileLimit", String(options.changedFileLimit));
  }
  return get(
    `${SOURCE_CONTROL_BRANCH_DETAILS_PATH}?${searchParams.toString()}`,
    SourceControlBranchDetailsResponseSchema,
  );
}

export function getSourceControlCommitActivity(options: SourceControlCommitActivityOptions = {}) {
  const searchParams = new URLSearchParams();
  if (options.projectId) {
    searchParams.set("projectId", options.projectId);
  }
  if (typeof options.days === "number") {
    searchParams.set("days", String(options.days));
  }
  if (typeof options.limit === "number") {
    searchParams.set("limit", String(options.limit));
  }
  const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : "";
  return get(`${SOURCE_CONTROL_COMMIT_ACTIVITY_PATH}${suffix}`, SourceControlCommitActivityResponseSchema);
}

export function createSourceControlPullRequest(input: SourceControlCreatePullRequestInput) {
  return post(
    SOURCE_CONTROL_CREATE_PULL_REQUEST_PATH,
    SourceControlCreatePullRequestResponseSchema,
    {
      body: {
        projectId: input.projectId ?? null,
        branch: input.branch,
        baseBranch: input.baseBranch ?? null,
        title: input.title ?? null,
        body: input.body ?? null,
        draft: Boolean(input.draft),
      },
    },
  );
}

export function mergeSourceControlPullRequest(input: SourceControlMergePullRequestInput) {
  return post(
    SOURCE_CONTROL_MERGE_PULL_REQUEST_PATH,
    SourceControlMergePullRequestResponseSchema,
    {
      body: {
        projectId: input.projectId ?? null,
        branch: input.branch,
        pullRequestNumber: input.pullRequestNumber ?? null,
        baseBranch: input.baseBranch ?? null,
        deleteBranch: input.deleteBranch ?? true,
        squash: Boolean(input.squash),
      },
    },
  );
}

export function deleteSourceControlBranch(input: SourceControlDeleteBranchInput) {
  return post(
    SOURCE_CONTROL_DELETE_BRANCH_PATH,
    SourceControlDeleteBranchResponseSchema,
    {
      body: {
        projectId: input.projectId ?? null,
        branch: input.branch,
      },
    },
  );
}
