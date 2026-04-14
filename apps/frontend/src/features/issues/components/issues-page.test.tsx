import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IssuesPage } from "@/features/issues/components/issues-page";
import { renderWithProviders } from "@/test/utils";

function createDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "all",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [],
    clearData: (format?: string) => {
      if (!format) {
        store.clear();
        return;
      }
      store.delete(format);
    },
    getData: (format: string) => store.get(format) ?? "",
    setData: (format: string, data: string) => {
      store.set(format, data);
    },
    setDragImage: () => undefined,
  } as DataTransfer;
}

describe("IssuesPage", () => {
  it("renders five issue columns in full board layout", () => {
    renderWithProviders(<IssuesPage />);

    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Members" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Backlog issues" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Todo issues" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "In Progress issues" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "In Review issues" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Done issues" })).toBeInTheDocument();
  });

  it("moves an issue card from backlog to todo via drag and drop", () => {
    renderWithProviders(<IssuesPage />);

    const backlogColumn = screen.getByRole("region", { name: "Backlog issues" });
    const todoColumn = screen.getByRole("region", { name: "Todo issues" });
    const issueTitle = "Invite a teammate";
    const issueCard = within(backlogColumn).getByText(issueTitle).closest("article");

    expect(issueCard).not.toBeNull();
    const dataTransfer = createDataTransfer();

    fireEvent.dragStart(issueCard!, { dataTransfer });
    fireEvent.dragOver(todoColumn, { dataTransfer });
    fireEvent.drop(todoColumn, { dataTransfer });
    fireEvent.dragEnd(issueCard!, { dataTransfer });

    expect(within(todoColumn).getByText(issueTitle)).toBeInTheDocument();
    expect(within(backlogColumn).queryByText(issueTitle)).not.toBeInTheDocument();
  });

  it("filters backlog cards by members and agents scope tabs", () => {
    renderWithProviders(<IssuesPage />);

    const backlogColumn = screen.getByRole("region", { name: "Backlog issues" });
    expect(within(backlogColumn).getByText("Invite a teammate")).toBeInTheDocument();
    expect(within(backlogColumn).getByText("Set up your repository connection")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Members" }));
    expect(within(backlogColumn).getByText("Invite a teammate")).toBeInTheDocument();
    expect(within(backlogColumn).queryByText("Set up your repository connection")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    expect(within(backlogColumn).getByText("Set up your repository connection")).toBeInTheDocument();
    expect(within(backlogColumn).queryByText("Invite a teammate")).not.toBeInTheDocument();
  });

  it("creates a new issue from the composer dialog", () => {
    renderWithProviders(<IssuesPage />);

    fireEvent.click(screen.getByRole("button", { name: "Add issue in Backlog" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText("Issue title"), {
      target: { value: "Ship full-width issue composer parity" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Issue" }));

    const backlogColumn = screen.getByRole("region", { name: "Backlog issues" });
    expect(within(backlogColumn).getByText("Ship full-width issue composer parity")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
