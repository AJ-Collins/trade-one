import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import StepTracker from "../deposits/StepTracker";
import Step2Currency from "../deposits/Step2Currency";
import Step3Payment from "../deposits/Step3Payment";

export default function FeeDepositFlow({
  onCancel,
  onSuccess,
}: {
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(2); // Skip step 1
  const amount = 400; // Fixed fee amount
  const [paymentDetails, setPaymentDetails] = useState<any>(null);
  const [depositConfirmed, setDepositConfirmed] = useState(false);
  const [depositStartedAt, setDepositStartedAt] = useState<Date | null>(null);

  const { data: history = [] } = useQuery<any[]>({
    queryKey: ["deposit-history-fee"],
    queryFn: async () => {
      const response = await api.get("/deposit/history");
      let rawHistory: any[] = [];
      if (Array.isArray(response.data)) {
        rawHistory = response.data;
      } else if (response.data?.data) {
        rawHistory = Array.isArray(response.data.data.deposits)
          ? response.data.data.deposits
          : Array.isArray(response.data.data)
            ? response.data.data
            : [];
      }
      return rawHistory.map((d: any) => ({
        ...d,
        coin: d.coin || d.currency || "USD",
      }));
    },
    refetchInterval: step === 3 && !depositConfirmed ? 2000 : false,
  });

  const createDepositMutation = useMutation({
    mutationFn: async (payload: { amount: number; currency: string; network: string }) => {
      const { data } = await api.post("/deposit/address", {
        coin: payload.currency,
        network: payload.network,
      });
      return data?.data || data;
    },
    onMutate: () => {
      setDepositStartedAt(new Date());
      setDepositConfirmed(false);
      setPaymentDetails(null);
    },
    onSuccess: (data, variables) => {
      const CRYPTO_RATES: Record<string, number> = {
        ETH: 3500, BTC: 65000, BNB: 600,
        XRP: 0.5,  USDT: 1,    USDC: 1,
      };
      const rate = CRYPTO_RATES[variables.currency] ?? 1;

      setPaymentDetails({
        address: data.address,
        amountToSend: parseFloat((variables.amount / rate).toFixed(8)),
        currency: data.coin,
        network: data.network || variables.network,
        expiresInSeconds: data.expiresInSeconds ?? 3600,
        txHash: data.txHash || null,
        depositId: data.depositId || null,
      });
      setStep(3);
      queryClient.invalidateQueries({ queryKey: ["deposit-history-fee"] });
    },
    onError: (err: any) => {
      const message = err?.response?.data?.error || err?.response?.data?.message || "Failed to generate deposit address";
      alert(message);
    },
  });

  const payFeeMutation = useMutation({
    mutationFn: async () => {
      await api.post("/withdraw/pay-fee");
    },
    onSuccess: () => {
      onSuccess();
    }
  });

  useEffect(() => {
    if (step !== 3 || !paymentDetails || depositConfirmed || !depositStartedAt) return;

    const credited = history.find((d: any) =>
      d.coin === paymentDetails.currency &&
      (d.status === "CREDITED" || d.status === "SWEPT") &&
      new Date(d.createdAt) > depositStartedAt
    );

    if (credited && !payFeeMutation.isPending && !payFeeMutation.isSuccess) {
      setDepositConfirmed(true);
      queryClient.invalidateQueries({ queryKey: ["accountBalance"] });
      payFeeMutation.mutate();
    }
  }, [history, step, paymentDetails, depositConfirmed, depositStartedAt, queryClient, payFeeMutation]);

  return (
    <div className="bg-[#0d0f17] border border-[#1a1f28] rounded-2xl p-6 shadow-xl animate-slideDown space-y-6">
      <div className="flex justify-between items-center border-b border-[#1a1f28] pb-4 mb-2">
        <div>
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">
            Fee Deposit Configuration
          </h2>
          <p className="text-xs text-gray-400">Fixed Processing Fee: $400.00</p>
        </div>
      </div>

      <StepTracker currentStep={step} />

      {step === 2 && (
        <Step2Currency
          amount={amount}
          onBack={onCancel}
          isGenerating={createDepositMutation.isPending}
          onGenerate={(crypto, network) => {
            createDepositMutation.mutate({ amount, currency: crypto, network });
          }}
        />
      )}

      {step === 3 && paymentDetails && !depositConfirmed && (
        <Step3Payment paymentData={paymentDetails} />
      )}

      {step === 3 && depositConfirmed && (
        <div className="flex flex-col items-center gap-4 py-8 text-center animate-fadeIn">
          <div className="w-16 h-16 rounded-full bg-[#14231c] border border-[#39ff88]/30 flex items-center justify-center">
            <svg className="w-8 h-8 text-[#39ff88]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-black text-white mb-1">Fee Payment Confirmed!</h2>
            <p className="text-xs text-gray-400">Your processing fee has been received securely.</p>
          </div>
          {payFeeMutation.isPending && (
            <p className="text-xs text-amber-400 font-mono tracking-wider animate-pulse">RECORDING FEE PAYMENT...</p>
          )}
        </div>
      )}
    </div>
  );
}
