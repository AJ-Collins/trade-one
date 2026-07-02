import { useState } from "react";
import { ArrowRight } from "lucide-react";

interface Step1Props {
  onNext: (amount: number) => void;
  initialAmount: number;
}

export default function Step1Amount({ onNext, initialAmount }: Step1Props) {
  const [amount, setAmount] = useState<string>(initialAmount > 0 ? initialAmount.toString() : "100.00");
  const minDeposit = 60;

  const quickAmounts = [60, 100, 300, 1000];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseFloat(amount);
    if (!isNaN(parsed) && parsed >= minDeposit) {
      onNext(parsed);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 text-center animate-fadeIn">
      <div>
        <h2 className="text-lg font-bold text-white mb-1">Enter Amount</h2>
        <p className="text-xs text-gray-400">How much do you want to deposit?</p>
      </div>

      <div className="text-left space-y-2">
        <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">Amount (USD)</label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">$</span>
          <input
            type="number"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full bg-[#05070a] border border-[#1a1f28] rounded-xl pl-8 pr-4 py-3 text-base text-white font-bold outline-none focus:border-[#39ff88]/40 transition-colors"
            placeholder="0.00"
            required
          />
        </div>
        <p className="text-[11px] text-gray-500">Minimum deposit: ${minDeposit}</p>
      </div>

      {/* Quick selection tags */}
      <div className="grid grid-cols-4 gap-2">
        {quickAmounts.map((amt) => (
          <button
            key={amt}
            type="button"
            onClick={() => setAmount(amt.toFixed(2))}
            className={`py-2 px-3 border rounded-lg text-xs font-bold transition-all ${
              parseFloat(amount) === amt
                ? "bg-[#39ff88]/10 border-[#39ff88] text-[#39ff88]"
                : "bg-[#05070a] border-[#1a1f28] text-gray-400 hover:border-gray-700"
            }`}
          >
            ${amt}
          </button>
        ))}
      </div>

      <button
        type="submit"
        disabled={parseFloat(amount) < minDeposit || isNaN(parseFloat(amount))}
        className="w-full bg-[#39ff88] text-[#05070a] font-bold text-sm py-3 rounded-xl hover:bg-[#5dffa1] transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Continue <ArrowRight className="h-4 w-4" />
      </button>
    </form>
  );
}