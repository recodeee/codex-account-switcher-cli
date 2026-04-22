import { AccountService } from "./account-service";

export { AccountService } from "./account-service";
export type { AccountChoice, RemoveResult } from "./account-service";
export {
  AccountNotFoundError,
  AmbiguousAccountQueryError,
  AuthFileMissingError,
  AutoSwitchConfigError,
  CodexAuthError,
  InvalidAccountNameError,
  InvalidRemoveSelectionError,
  NoAccountsSavedError,
  PromptCancelledError,
  SnapshotEmailMismatchError,
} from "./errors";
export type { AutoSwitchRunResult, StatusReport } from "./types";

export const accountService = new AccountService();
