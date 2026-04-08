import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  createBillingAccount,
  deleteBillingAccount,
  getBillingAccounts,
  updateBillingAccounts,
} from "@/features/billing/api";

export function useBilling() {
  const queryClient = useQueryClient();
  const billingQuery = useQuery({
    queryKey: ["billing", "summary"],
    queryFn: getBillingAccounts,
    refetchOnWindowFocus: true,
  });

  const updateAccountsMutation = useMutation({
    mutationFn: updateBillingAccounts,
    onSuccess: async () => {
      toast.success("Subscription account updated");
      await queryClient.invalidateQueries({ queryKey: ["billing", "summary"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update subscription account");
    },
  });

  const createAccountMutation = useMutation({
    mutationFn: createBillingAccount,
    onSuccess: async () => {
      toast.success("Subscription account added");
      await queryClient.invalidateQueries({ queryKey: ["billing", "summary"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to add subscription account");
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: deleteBillingAccount,
    onSuccess: async () => {
      toast.success("Subscription account deleted");
      await queryClient.invalidateQueries({ queryKey: ["billing", "summary"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete subscription account");
    },
  });

  return {
    billingQuery,
    updateAccountsMutation,
    createAccountMutation,
    deleteAccountMutation,
  };
}
