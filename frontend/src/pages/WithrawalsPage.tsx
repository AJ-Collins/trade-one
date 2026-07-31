import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import NewWithdrawalForm from "../components/withraw/NewWithdrawalForm";
import WithdrawalHistory from "../components/withraw/WithdrawalHistory";
import KYCStatus from "../components/withraw/KYCStatus";
import type { Transaction, KYCStatus as KYCStatusType } from "../types/index";
import { History, AlertCircle } from "lucide-react";
import api from "../lib/api";

export default function WithdrawalsPage() {
  const queryClient = useQueryClient();
  const [kycStatus, setKycStatus] = useState<string>("UNVERIFIED");
  const [toast, setToast] = useState<{
    show: boolean;
    message: string;
    type: "success" | "error";
  } | null>(null);

  // Fetch user profile for account info
  const { data: userProfile } = useQuery({
    queryKey: ["user-profile"],
    queryFn: async () => {
      const { data } = await api.get("/auth/me");
      return data;
    },
  });

  // Fetch KYC status
  useQuery<KYCStatusType>({
    queryKey: ["kyc-status"],
    queryFn: async () => {
      const { data } = await api.get("/kyc/status");
      setKycStatus(data.status);
      return data;
    },
  });

  // Fetch withdrawal records
  const { data: history = [], isLoading: historyLoading } = useQuery<
    Transaction[]
  >({
    queryKey: ["withdrawal-history"],
    queryFn: async () => {
      const { data } = await api.get("/withdraw/history");
      return data;
    },
  });

  // Process withdrawal request mutation
  const withdrawMutation = useMutation({
    mutationFn: async (withdrawalData: {
      accountId: string;
      amount: number;
      coin: string;
      network: string;
      toAddress: string;
    }) => {
      const { data } = await api.post("/withdraw/request", withdrawalData);
      return data;
    },
    onSuccess: (response) => {
      // Invalidate history to refresh
      queryClient.invalidateQueries({ queryKey: ["withdrawal-history"] });

      // Show success message
      setToast({
        show: true,
        type: "success",
        message: `Withdrawal request submitted! ID: ${response.withdrawalId}. Amount: $${response.amount}`,
      });

      setTimeout(() => setToast(null), 6000);
    },
    onError: (error: any) => {
      setToast({
        show: true,
        type: "error",
        message: error.response?.data?.error || "Withdrawal request failed",
      });
      console.error("Withdrawal error:", error);
    },
  });

  const handleWithdrawalSubmit = async (withdrawalData: {
    accountId: string;
    amount: number;
    coin: string;
    network: string;
    toAddress: string;
  }) => {
    await withdrawMutation.mutateAsync(withdrawalData);
  };

  // Get primary account
  const primaryAccount = userProfile?.accounts?.[0];

  return (
    <div className="min-h-screen bg-[#05070a] text-white p-4 md:p-8 flex flex-col items-center justify-start space-y-6">
      {/* Toast Notification */}
      {toast?.show && (
        <div
          className={`w-full max-w-2xl rounded-xl p-4 border animate-slideDown ${
            toast.type === "success"
              ? "bg-[#0d1712] border-[#1a442b]"
              : "bg-[#1a0d0d] border-[#441a1a]"
          }`}
        >
          <h4
            className={`text-sm font-bold ${
              toast.type === "success" ? "text-[#39ff88]" : "text-red-400"
            }`}
          >
            {toast.type === "success" ? "Withdrawal Submitted" : "Error"}
          </h4>
          <p className="text-xs text-gray-400 mt-0.5">{toast.message}</p>
        </div>
      )}

      {/* Main Container */}
      <div className="w-full max-w-2xl space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3 px-1 py-2">
          <div>
            <h1 className="text-2xl font-bold">Withdraw Crypto</h1>
            <p className="text-sm text-gray-400">
              Withdraw your cryptocurrency to an external wallet
            </p>
          </div>
        </div>

        {/* KYC Status Section */}
        <div className="bg-[#0d0f17] border border-[#1a1f28] rounded-2xl p-6 shadow-xl">
          <h2 className="text-sm font-bold text-white mb-4 uppercase tracking-wider">
            Identity Verification
          </h2>
          <KYCStatus onStatusChange={setKycStatus} />
        </div>

        {/* Warning for Unverified Users */}
        {kycStatus !== "VERIFIED" && (
          <div className="bg-yellow-400/10 border border-yellow-400/30 rounded-xl p-4 flex gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-yellow-400">
                Complete KYC to Withdraw
              </h3>
              <p className="text-xs text-yellow-400/80 mt-1">
                You must pass identity verification before you can withdraw funds.
                Submit your documents in the section above.
              </p>
            </div>
          </div>
        )}

        {/* Withdrawal Form */}
        <div className="bg-[#0d0f17] border border-[#1a1f28] rounded-2xl p-6 shadow-xl">
          <h2 className="text-sm font-bold text-white mb-4 uppercase tracking-wider">
            Withdrawal Request
          </h2>
          <NewWithdrawalForm
            availableBalance={primaryAccount?.balance || 0}
            kycStatus={kycStatus}
            accountId={primaryAccount?.id || "default"}
            onExecuteWithdraw={handleWithdrawalSubmit}
          />
        </div>

        {/* Withdrawal History */}
        <div className="bg-[#0d0f17] border border-[#1a1f28] rounded-2xl p-6 shadow-xl">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2 uppercase tracking-wider">
            <History className="h-4 w-4 text-gray-400" />
            Withdrawal History
          </h3>

          {/* Loading State */}
          {historyLoading ? (
            <div className="text-xs text-gray-500 py-10 text-center tracking-wider animate-pulse">
              Loading withdrawal history...
            </div>
          ) : (
            <>
              {/* Empty State */}
              {history.length === 0 ? (
                <div className="text-center py-8">
                  <div className="text-sm text-gray-400 mb-2">
                    No withdrawals yet
                  </div>
                  <p className="text-xs text-gray-500">
                    Your withdrawal history will appear here
                  </p>
                </div>
              ) : (
                <WithdrawalHistory transactions={history} />
              )}
            </>
          )}
        </div>

        {/* Info Box */}
        <div className="bg-[#0d0f17] border border-[#1a1f28] rounded-2xl p-4 space-y-2 text-left">
          <h4 className="text-xs font-bold text-gray-300 uppercase tracking-wider">
            Withdrawal Guidelines
          </h4>
          <ul className="text-xs text-gray-400 space-y-1.5">
            <li className="flex gap-2">
              <span className="text-[#39ff88]">•</span>
              <span>Minimum withdrawal: $10</span>
            </li>
            <li className="flex gap-2">
              <span className="text-[#39ff88]">•</span>
              <span>Network fees vary by blockchain and congestion</span>
            </li>
            <li className="flex gap-2">
              <span className="text-[#39ff88]">•</span>
              <span>Withdrawals are processed within 24-48 hours</span>
            </li>
            <li className="flex gap-2">
              <span className="text-[#39ff88]">•</span>
              <span>KYC verification is required for all withdrawals</span>
            </li>
            <li className="flex gap-2">
              <span className="text-[#39ff88]">•</span>
              <span>Always verify the destination address before confirming</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
