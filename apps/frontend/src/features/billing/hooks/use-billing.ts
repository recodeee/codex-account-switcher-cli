import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { createBillingAccount, getBillingAccounts } from "@/features/billing/api";

export function useBilling() {
  const queryClient = useQueryClient();
  const billingQuery = useQuery({
    queryKey: ["billing", "summary"],
    queryFn: getBillingAccounts,
    refetchOnWindowFocus: true,
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

  return {
    billingQuery,
    createAccountMutation,
  };
}
