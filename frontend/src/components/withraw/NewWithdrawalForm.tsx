import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { CRYPTO_OPTIONS, type CryptoAsset, type Network } from "../../types/index";

interface FormProps {
  availableBalance: number;
  kycStatus?: string;
  accountId?: string;
  onExecuteWithdraw: (data: {
    accountId: string;
    amount: number;
    coin: string;
    network: string;
    toAddress: string;
  }) => Promise<void>;
}

const getCryptoLogo = (symbol: string) => 
  `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/${symbol.toLowerCase()}.png`;

export default function NewWithdrawalForm({
  availableBalance,
  kycStatus = "UNVERIFIED",
  accountId = "default",
  onExecuteWithdraw
}: FormProps) {
  const [selectedCrypto, setSelectedCrypto] = useState<CryptoAsset>(CRYPTO_OPTIONS[0]);
  const [selectedNetwork, setSelectedNetwork] = useState<Network | null>(null);
  const [address, setAddress] = useState<string>("");
  const [amountInput, setAmountInput] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Dropdown UI toggle states
  const [isCryptoOpen, setIsCryptoOpen] = useState(false);
  const [isNetworkOpen, setIsNetworkOpen] = useState(false);

  const cryptoRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<HTMLDivElement>(null);

  // Click outside listener to safely close custom menu drop-downs
  useEffect(() => {
    function clickOutside(e: MouseEvent) {
      if (cryptoRef.current && !cryptoRef.current.contains(e.target as Node)) setIsCryptoOpen(false);
      if (networkRef.current && !networkRef.current.contains(e.target as Node)) setIsNetworkOpen(false);
    }
    document.addEventListener("mousedown", clickOutside);
    return () => document.removeEventListener("mousedown", clickOutside);
  }, []);

  // Compute live calculations
  const parseAmount = parseFloat(amountInput) || 0;
  const currentNetworkFee = selectedNetwork ? selectedNetwork.fee : 0;
  const receiveAmount = parseAmount > currentNetworkFee ? parseAmount - currentNetworkFee : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // KYC validation
    if (kycStatus !== "VERIFIED") {
      alert("Please complete KYC verification before withdrawing");
      return;
    }

    if (!selectedNetwork || !address || parseAmount < 10 || parseAmount > availableBalance) return;

    setIsSubmitting(true);
    try {
      await onExecuteWithdraw({
        accountId,
        amount: parseAmount,
        coin: selectedCrypto.symbol,
        network: selectedNetwork.name,
        toAddress: address,
      });
      // Clear forms on backend confirmation success
      setAmountInput("");
      setAddress("");
    } catch (err) {
      console.error("Withdrawal transmission failed:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 text-left">
      <div>
        <span className="text-xs font-medium text-gray-400">Available Balance</span>
        <div className="text-xl font-bold text-white mt-0.5">${availableBalance.toFixed(2)}</div>
      </div>

      {/* Crypto Selection Menu */}
      <div className={`space-y-2 relative transition-all duration-100 ${isCryptoOpen ? "z-40" : "z-20"}`} ref={cryptoRef}>
        <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">Select Currency</label>
        <button
          type="button"
          onClick={() => { setIsCryptoOpen(!isCryptoOpen); setIsNetworkOpen(false); }}
          className="w-full bg-[#05070a] border border-[#1a1f28] rounded-xl px-4 py-3 text-sm text-white flex items-center justify-between outline-none focus:border-[#39ff88]/40 transition-colors"
        >
          <div className="flex items-center gap-3">
            <img 
              src={getCryptoLogo(selectedCrypto.symbol)} 
              alt={selectedCrypto.name} 
              className="w-5 h-5 object-contain rounded-full"
              onError={(e) => { (e.target as HTMLImageElement).src = "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/generic.png"; }}
            />
            <span className="font-bold text-white">{selectedCrypto.symbol}</span>
            <span className="text-gray-500 text-xs font-medium">{selectedCrypto.name}</span>
          </div>
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${isCryptoOpen ? "rotate-180" : ""}`} />
        </button>

        {isCryptoOpen && (
          <div className="absolute left-0 right-0 mt-1 bg-[#0d0f17] border border-[#252b38] rounded-xl shadow-2xl z-[100] max-h-48 overflow-y-auto scrollbar-none">
            {CRYPTO_OPTIONS.map((crypto) => (
              <button
                key={crypto.id}
                type="button"
                onClick={() => {
                  setSelectedCrypto(crypto);
                  setSelectedNetwork(null); // Reset network select layer to prevent error crossover
                  setIsCryptoOpen(false);
                }}
                className={`w-full px-4 py-3 text-sm text-left flex items-center gap-3 hover:bg-[#1a1f28] transition-colors ${
                  selectedCrypto.id === crypto.id ? "bg-[#1a1f28]" : ""
                }`}
              >
                <img src={getCryptoLogo(crypto.symbol)} alt={crypto.name} className="w-5 h-5 object-contain" />
                <div className="flex flex-col">
                  <span className="font-bold text-white text-xs">{crypto.symbol}</span>
                  <span className="text-gray-400 text-[11px]">{crypto.name}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Network Selection Menu */}
      <div className={`space-y-2 relative transition-all duration-100 ${isNetworkOpen ? "z-30" : "z-10"}`} ref={networkRef}>
        <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">Select Network</label>
        <button
          type="button"
          onClick={() => { setIsNetworkOpen(!isNetworkOpen); setIsCryptoOpen(false); }}
          className="w-full bg-[#05070a] border border-[#1a1f28] rounded-xl px-4 py-3 text-sm text-white flex items-center justify-between outline-none focus:border-[#39ff88]/40 transition-colors"
        >
          <span className={selectedNetwork ? "text-white font-medium" : "text-gray-500"}>
            {selectedNetwork ? `${selectedNetwork.name} (Fee: $${selectedNetwork.fee})` : "Select a network"}
          </span>
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${isNetworkOpen ? "rotate-180" : ""}`} />
        </button>

        {isNetworkOpen && (
          <div className="absolute left-0 right-0 mt-1 bg-[#0d0f17] border border-[#252b38] rounded-xl shadow-2xl z-[100] max-h-48 overflow-y-auto scrollbar-none">
            {selectedCrypto.networks.map((net) => (
              <button
                key={net.name}
                type="button"
                onClick={() => {
                  setSelectedNetwork(net);
                  setIsNetworkOpen(false);
                }}
                className={`w-full px-4 py-3 text-sm text-left text-gray-300 hover:bg-[#1a1f28] hover:text-white flex items-center justify-between transition-colors ${
                  selectedNetwork?.name === net.name ? "bg-[#1a1f28] text-white font-bold" : ""
                }`}
              >
                <span>{net.name}</span>
                <span className="text-xs text-gray-500">Fee: ${net.fee.toFixed(2)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Target Destination Wallet Address Input */}
      <div className="space-y-2 relative z-0">
        <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">Withdrawal Address</label>
        <input 
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Enter external destination address"
          className="w-full bg-[#05070a] border border-[#1a1f28] rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 outline-none focus:border-[#39ff88]/40 transition-all font-mono"
          required
        />
      </div>

      {/* Value Input Box */}
      <div className="space-y-1 relative z-0">
        <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">Amount (USD)</label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
          <input 
            type="number"
            step="any"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            placeholder="100.00"
            className="w-full bg-[#05070a] border border-[#1a1f28] rounded-xl pl-8 pr-4 py-3 text-sm text-white placeholder-gray-600 outline-none focus:border-[#39ff88]/40 transition-all"
            required
          />
        </div>
        <p className="text-[11px] text-gray-500 pl-1">Minimum withdrawal: $10</p>
      </div>

      {/* Dynamic Processing Output Matrix */}
      <div className="bg-[#05070a] border border-[#1a1f28] rounded-xl p-4 space-y-2.5 text-xs text-gray-400 relative z-0">
        <div className="flex justify-between items-center">
          <span>Network Fee</span>
          <span className="text-white font-medium">${currentNetworkFee.toFixed(2)}</span>
        </div>
        <div className="border-t border-[#1a1f28] my-1" />
        <div className="flex justify-between items-center text-sm">
          <span className="font-medium text-white">You will receive</span>
          <span className="text-[#39ff88] font-bold">${receiveAmount.toFixed(2)}</span>
        </div>
      </div>

      {/* Execution Submission Button Trigger */}
      <button
        type="submit"
        disabled={
          !selectedNetwork ||
          !address ||
          parseAmount < 10 ||
          parseAmount > availableBalance ||
          isSubmitting ||
          kycStatus !== "VERIFIED"
        }
        className="w-full bg-[#39ff88] text-[#05070a] font-bold text-sm py-3.5 rounded-xl hover:bg-[#5dffa1] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2 relative z-0"
        title={kycStatus !== "VERIFIED" ? "Complete KYC verification to withdraw" : ""}
      >
        {isSubmitting ? "Processing Submission..." : "Submit Withdrawal"}
      </button>
    </form>
  );
}