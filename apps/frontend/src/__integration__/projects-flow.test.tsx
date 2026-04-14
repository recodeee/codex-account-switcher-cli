import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";

import App from "@/App";
import { server } from "@/test/mocks/server";
import { renderWithProviders } from "@/test/utils";

const elementPrototype = HTMLElement.prototype as unknown as Record<string, unknown>;
if (typeof elementPrototype.scrollIntoView !== "function") {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    value: vi.fn(),
    writable: true,
  });
}
if (typeof elementPrototype.hasPointerCapture !== "function") {
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    value: vi.fn(() => false),
    writable: true,
  });
}
if (typeof elementPrototype.setPointerCapture !== "function") {
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    value: vi.fn(),
    writable: true,
  });
}
if (typeof elementPrototype.releasePointerCapture !== "function") {
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    value: vi.fn(),
    writable: true,
  });
}

describe("projects flow integration", () => {
  it("loads projects page and supports add/edit/delete", async () => {
    const user = userEvent.setup({ delay: null });
    server.use(
      http.post("http://localhost:9000/store/customers/me", () => HttpResponse.json({ customer: {} })),
    );

    window.history.pushState({}, "", "/projects");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New project" }));
    const createDialog = await screen.findByRole("dialog", { name: "New project" });
    expect(within(createDialog).getByText("recodee.com")).toBeInTheDocument();
    await user.type(within(createDialog).getByPlaceholderText("Project title"), "recodee-core");
    await user.type(
      within(createDialog).getByPlaceholderText("https://project-domain.com"),
      "recodee.com",
    );
    await user.type(
      within(createDialog).getByPlaceholderText("https://github.com/owner/repo"),
      "github.com/webu-pro/recodee",
    );
    await user.click(within(createDialog).getByRole("button", { name: "Select project folder" }));
    expect(
      await within(createDialog).findByDisplayValue("/home/deadpool/Documents"),
    ).toBeInTheDocument();
    await user.clear(within(createDialog).getByPlaceholderText("/absolute/path/to/project"));
    await user.type(
      within(createDialog).getByPlaceholderText("/absolute/path/to/project"),
      "/home/deadpool/projects/recodee-core",
    );
    await user.type(
      within(createDialog).getByPlaceholderText("Add description..."),
      "Main dashboard project",
    );
    await user.click(within(createDialog).getByRole("button", { name: "Create Project" }));

    expect((await screen.findAllByText("recodee-core")).length).toBeGreaterThan(0);
    expect(screen.getByText("Main dashboard project")).toBeInTheDocument();
    expect(screen.getByText("https://recodee.com/")).toBeInTheDocument();
    expect(screen.getByText("https://github.com/webu-pro/recodee")).toBeInTheDocument();
    expect(screen.getByText("/home/deadpool/projects/recodee-core")).toBeInTheDocument();
    expect(screen.getByTestId("project-plan-count-project_1")).toHaveTextContent("0 plans");
    expect(screen.getByTestId("project-plan-count-project_1")).toHaveTextContent("0 successful");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getAllByText("workspace-write").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Open plans" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Open VSCode" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open folder" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const editDialog = await screen.findByRole("dialog", { name: "Edit project" });
    await user.clear(within(editDialog).getByPlaceholderText("Project name (e.g. recodee-core)"));
    await user.type(within(editDialog).getByPlaceholderText("Project name (e.g. recodee-core)"), "recodee-core-v2");
    await user.clear(within(editDialog).getByPlaceholderText("https://project-domain.com (optional)"));
    await user.type(
      within(editDialog).getByPlaceholderText("https://project-domain.com (optional)"),
      "recodee.dev",
    );
    await user.clear(within(editDialog).getByPlaceholderText("https://github.com/owner/repo (optional)"));
    await user.type(
      within(editDialog).getByPlaceholderText("https://github.com/owner/repo (optional)"),
      "github.com/webu-pro/recodee-v2",
    );
    await user.clear(within(editDialog).getByPlaceholderText("Optional description (max 512 characters)"));
    await user.type(
      within(editDialog).getByPlaceholderText("Optional description (max 512 characters)"),
      "Updated project details",
    );
    await user.clear(within(editDialog).getByPlaceholderText("Absolute project path (optional)"));
    await user.type(
      within(editDialog).getByPlaceholderText("Absolute project path (optional)"),
      "/home/deadpool/projects/recodee-core-v2",
    );
    await user.clear(within(editDialog).getByPlaceholderText("Git branch (optional)"));
    await user.type(
      within(editDialog).getByPlaceholderText("Git branch (optional)"),
      "feature/recodee-core-v2",
    );
    await user.click(within(editDialog).getByRole("button", { name: "Save" }));

    expect((await screen.findAllByText("recodee-core-v2")).length).toBeGreaterThan(0);
    expect(screen.getByText("Updated project details")).toBeInTheDocument();
    expect(screen.getByText("https://recodee.dev/")).toBeInTheDocument();
    expect(screen.getByText("https://github.com/webu-pro/recodee-v2")).toBeInTheDocument();
    expect(screen.getByText("/home/deadpool/projects/recodee-core-v2")).toBeInTheDocument();
    expect(screen.getByText("feature/recodee-core-v2")).toBeInTheDocument();
    expect(screen.queryByText("recodee-core")).not.toBeInTheDocument();

    await user.click(screen.getAllByText("recodee-core-v2")[0]!);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.queryByText("recodee-core-v2")).not.toBeInTheDocument();
    });
  });

  it("renders live plan linkage per project path", async () => {
    server.use(
      http.post("http://localhost:9000/store/customers/me", () => HttpResponse.json({ customer: {} })),
      http.get("/api/projects", () =>
        HttpResponse.json({
          entries: [
            {
              id: "project_live_1",
              name: "marvahome",
              description: "linked project",
              projectUrl: "https://marvahome.com",
              githubRepoUrl: "https://github.com/webu-pro/marvahome",
              projectPath: "/home/deadpool/Documents/szaloniroda/marva",
              sandboxMode: "workspace-write",
              gitBranch: null,
              createdAt: new Date("2026-04-14T08:00:00Z").toISOString(),
              updatedAt: new Date("2026-04-14T08:00:00Z").toISOString(),
            },
          ],
        }),
      ),
      http.get("/api/projects/plan-links", () =>
        HttpResponse.json({
          entries: [
            {
              projectId: "project_live_1",
              planCount: 3,
              completedPlanCount: 2,
              latestPlanSlug: "marva-release-rollout",
              latestPlanUpdatedAt: new Date("2026-04-14T09:00:00Z").toISOString(),
            },
          ],
        }),
      ),
    );

    window.history.pushState({}, "", "/projects");
    renderWithProviders(<App />);

    expect((await screen.findAllByText("marvahome")).length).toBeGreaterThan(0);
    expect(screen.getByTestId("project-plan-count-project_live_1")).toHaveTextContent("3 plans");
    expect(screen.getByTestId("project-plan-count-project_live_1")).toHaveTextContent("2 successful");
  });

  it("shows an already-open toast when VSCode is already open for the project", async () => {
    const user = userEvent.setup({ delay: null });

    server.use(
      http.post("http://localhost:9000/store/customers/me", () => HttpResponse.json({ customer: {} })),
      http.get("/api/projects", () =>
        HttpResponse.json({
          entries: [
            {
              id: "project_open_1",
              name: "recodee",
              description: "core project",
              projectUrl: "https://recodee.com",
              githubRepoUrl: "https://github.com/webu-pro/recodee",
              projectPath: "/home/deadpool/Documents/recodee",
              sandboxMode: "workspace-write",
              gitBranch: "dev",
              createdAt: new Date("2026-04-14T08:00:00Z").toISOString(),
              updatedAt: new Date("2026-04-14T08:00:00Z").toISOString(),
            },
          ],
        }),
      ),
      http.get("/api/projects/plan-links", () => HttpResponse.json({ entries: [] })),
      http.post("/api/projects/:projectId/open-folder", async ({ request }) => {
        const payload = await request.json();
        return HttpResponse.json({
          status: "already_open",
          projectPath: "/home/deadpool/Documents/recodee",
          target: typeof payload === "object" && payload && "target" in payload ? payload.target : "vscode",
          editor: "code",
        });
      }),
    );

    window.history.pushState({}, "", "/projects");
    renderWithProviders(<App />);

    await user.click(await screen.findByRole("button", { name: "Open VSCode" }));

    expect(await screen.findByText("Project folder is already open in VSCode")).toBeInTheDocument();
  });

  it("creates a new issue and allocates it to the selected project", async () => {
    const user = userEvent.setup({ delay: null });

    server.use(
      http.post("http://localhost:9000/store/customers/me", () => HttpResponse.json({ customer: {} })),
      http.get("/api/projects", () =>
        HttpResponse.json({
          entries: [
            {
              id: "project_alpha",
              name: "alpha",
              description: "alpha project",
              projectUrl: "https://alpha.example.com",
              githubRepoUrl: "https://github.com/webu-pro/alpha",
              projectPath: "/tmp/alpha",
              sandboxMode: "workspace-write",
              gitBranch: "dev",
              createdAt: new Date("2026-04-14T08:00:00Z").toISOString(),
              updatedAt: new Date("2026-04-14T08:00:00Z").toISOString(),
            },
            {
              id: "project_beta",
              name: "beta",
              description: "beta project",
              projectUrl: "https://beta.example.com",
              githubRepoUrl: "https://github.com/webu-pro/beta",
              projectPath: "/tmp/beta",
              sandboxMode: "workspace-write",
              gitBranch: "dev",
              createdAt: new Date("2026-04-14T08:00:00Z").toISOString(),
              updatedAt: new Date("2026-04-14T08:00:00Z").toISOString(),
            },
          ],
        }),
      ),
      http.get("/api/projects/plan-links", () => HttpResponse.json({ entries: [] })),
    );

    window.history.pushState({}, "", "/projects");
    renderWithProviders(<App />);

    expect(await screen.findByTestId("projects-issues-board")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New Issue" }));

    const issueDialog = await screen.findByRole("dialog", { name: "New Issue" });
    await user.type(within(issueDialog).getByPlaceholderText("Issue title"), "Implement user authentication with OAuth");
    await user.click(within(issueDialog).getByRole("combobox", { name: /project/i }));
    await user.click(await screen.findByRole("option", { name: "beta" }));
    await user.click(within(issueDialog).getByRole("combobox", { name: /priority/i }));
    await user.click(await screen.findByRole("option", { name: "High" }));
    await user.click(within(issueDialog).getByRole("button", { name: "Create Issue" }));

    expect(await screen.findByText("Implement user authentication with OAuth")).toBeInTheDocument();
    expect(screen.getByTestId("project-issue-count-project_beta")).toHaveTextContent("1 issue");
    expect(screen.getByTestId("project-issue-count-project_beta")).toHaveTextContent("1 urgent/high");
  });
});
