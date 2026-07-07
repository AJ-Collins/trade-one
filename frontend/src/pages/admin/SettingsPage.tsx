import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import {
  Key, Settings, Loader2, Plus, Save, Copy, Check, Trash2,
  Eye, EyeOff, Shield, ChevronDown, ChevronUp, AlertTriangle, X, Link, FileCode, Bitcoin, Cpu, Gem, Zap, Wallet, Plug
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SystemSetting {
  key: string;
  label: string;
  group: string;
  isSensitive: boolean;
  isSet: boolean;
  updatedAt: string | null;
}

interface RevealedValues {
  [key: string]: string;
}

// ─── 2FA Modal ───────────────────────────────────────────────────────────────

function TwoFAModal({
  title,
  description,
  onConfirm,
  onCancel,
  isLoading,
}: {
  title: string;
  description: string;
  onConfirm: (code: string) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const [code, setCode] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#0d0f17] border border-[#1a1f28] rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#39ff88]/10 rounded-lg">
              <Shield className="h-5 w-5 text-[#39ff88]" />
            </div>
            <div>
              <h3 className="text-white font-bold text-sm">{title}</h3>
              <p className="text-gray-500 text-xs mt-0.5">{description}</p>
            </div>
          </div>
          <button onClick={onCancel} className="text-gray-500 hover:text-white transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4">
          <label className="block text-xs text-gray-500 uppercase font-bold mb-2">
            Authenticator Code
          </label>
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={e => { if (e.key === 'Enter' && code.length === 6) onConfirm(code); }}
            placeholder="000000"
            className="w-full bg-[#05070a] border border-[#1a1f28] rounded-lg p-3 text-white text-center text-xl font-mono tracking-widest outline-none focus:border-[#39ff88]/50 transition-colors"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 bg-[#1a1f28] text-gray-300 px-4 py-2.5 rounded-lg font-semibold text-sm hover:bg-[#22283a] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(code)}
            disabled={code.length !== 6 || isLoading}
            className="flex-1 bg-[#39ff88] text-black px-4 py-2.5 rounded-lg font-bold text-sm hover:bg-[#5dffa1] disabled:opacity-50 transition-all flex items-center justify-center gap-2"
          >
            {isLoading ? <Loader2 className="animate-spin h-4 w-4" /> : <Shield className="h-4 w-4" />}
            Verify
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── System Settings Tab ──────────────────────────────────────────────────────

const GROUP_CONFIG: Record<string, { label: string; icon: React.ElementType }> = {
  EVM: { label: 'EVM Networks', icon: Link },
  CONTRACTS: { label: 'Token Contracts', icon: FileCode },
  BTC: { label: 'Bitcoin', icon: Bitcoin },
  SOL: { label: 'Solana', icon: Cpu },
  TON: { label: 'TON', icon: Gem },
  TRON: { label: 'Tron', icon: Zap },
  HD_WALLET: { label: 'HD Wallet (Master Key)', icon: Wallet },
  API_KEYS: { label: 'API Keys & Webhooks', icon: Plug },
};

function SystemSettingsTab() {
  const queryClient = useQueryClient();

  // Pending edits: key → new value (unsaved)
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [revealedValues, setRevealedValues] = useState<RevealedValues>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  // 2FA modal state
  type ModalPurpose = { type: 'reveal'; key: string } | { type: 'save'; entries: { key: string; value: string }[] } | null;
  const [modal, setModal] = useState<ModalPurpose>(null);
  const [modalError, setModalError] = useState('');

  const { data: settings = [], isLoading } = useQuery<SystemSetting[]>({
    queryKey: ['systemSettings'],
    queryFn: () => api.get('/admin/system/settings').then(r => r.data),
  });

  // Reveal mutation
  const revealMutation = useMutation({
    mutationFn: ({ key, totpCode }: { key: string; totpCode: string }) =>
      api.post('/admin/system/settings/reveal', { key, totpCode }).then(r => r.data),
    onSuccess: (data) => {
      setRevealedValues(prev => ({ ...prev, [data.key]: data.value }));
      setModal(null);
      setModalError('');
    },
    onError: (e: any) => setModalError(e.response?.data?.error ?? 'Invalid code'),
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: ({ entries, totpCode }: { entries: { key: string; value: string }[]; totpCode: string }) =>
      api.put('/admin/system/settings', { entries, totpCode }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['systemSettings'] });
      setEdits({});
      setModal(null);
      setModalError('');
    },
    onError: (e: any) => setModalError(e.response?.data?.error ?? 'Invalid code'),
  });

  const handleRevealClick = (key: string) => {
    if (revealedValues[key] !== undefined) {
      // Hide again
      setRevealedValues(prev => { const n = { ...prev }; delete n[key]; return n; });
      return;
    }
    setModalError('');
    setModal({ type: 'reveal', key });
  };

  const handleSaveGroup = (groupKeys: string[]) => {
    const entries = groupKeys
      .filter(k => edits[k] !== undefined && edits[k] !== '')
      .map(k => ({ key: k, value: edits[k] }));
    if (entries.length === 0) return;
    setModalError('');
    setModal({ type: 'save', entries });
  };

  const handleModalConfirm = (totpCode: string) => {
    if (!modal) return;
    if (modal.type === 'reveal') {
      revealMutation.mutate({ key: modal.key, totpCode });
    } else {
      saveMutation.mutate({ entries: modal.entries, totpCode });
    }
  };

  const toggleGroup = (group: string) =>
    setCollapsedGroups(prev => ({ ...prev, [group]: !prev[group] }));

  if (isLoading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="animate-spin text-[#39ff88] h-6 w-6" />
      </div>
    );
  }

  // Group settings
  const grouped = settings.reduce<Record<string, SystemSetting[]>>((acc, s) => {
    if (!acc[s.group]) acc[s.group] = [];
    acc[s.group].push(s);
    return acc;
  }, {});

  const isModalLoading = revealMutation.isPending || saveMutation.isPending;

  return (
    <div className="space-y-4">
      {modal && (
        <TwoFAModal
          title={modal.type === 'reveal' ? 'Reveal Secret Value' : 'Confirm Settings Save'}
          description={
            modal.type === 'reveal'
              ? 'Enter your authenticator code to reveal this value.'
              : `Enter your authenticator code to save ${modal.type === 'save' ? modal.entries.length : 0} setting(s).`
          }
          onConfirm={handleModalConfirm}
          onCancel={() => { setModal(null); setModalError(''); }}
          isLoading={isModalLoading}
        />
      )}

      {modalError && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-3 flex items-center gap-2 text-red-400 text-sm">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {modalError}
        </div>
      )}

      <div className="bg-[#0d0f17] border border-amber-500/20 rounded-xl p-3 flex items-start gap-3">
        <Shield className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-amber-400/80 text-xs">
          All changes and reveals require 2FA verification. Sensitive values (private keys, mnemonics, API keys) are encrypted at rest.
          You must have 2FA enabled on your admin account to use this section.
        </p>
      </div>

      {Object.entries(grouped).map(([group, items]) => {
        const collapsed = collapsedGroups[group];
        const groupKeys = items.map(i => i.key);
        const pendingCount = groupKeys.filter(k => edits[k] !== undefined && edits[k] !== '').length;

        return (
          <div key={group} className="bg-[#0d0f17] border border-[#1a1f28] rounded-2xl overflow-hidden">
            {/* Group Header */}
            <button
              onClick={() => toggleGroup(group)}
              className="w-full flex items-center justify-between p-4 hover:bg-[#1a1f28]/40 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  {(() => { const Icon = GROUP_CONFIG[group]?.icon; return Icon ? <Icon className="h-4 w-4 text-[#39ff88]" /> : null; })()}
                  <span className="text-white font-bold text-sm">
                    {GROUP_CONFIG[group]?.label ?? group}
                  </span>
                </div>
                {pendingCount > 0 && (
                  <span className="bg-[#39ff88]/20 text-[#39ff88] text-xs font-bold px-2 py-0.5 rounded-full">
                    {pendingCount} unsaved
                  </span>
                )}
              </div>
              {collapsed ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronUp className="h-4 w-4 text-gray-500" />}
            </button>

            {!collapsed && (
              <div className="px-4 pb-4 space-y-4">
                {/* Config rows */}
                {items.map(setting => {
                  const isRevealed = revealedValues[setting.key] !== undefined;
                  const currentValue = revealedValues[setting.key] ?? '';
                  const editValue = edits[setting.key];
                  const displayValue = editValue !== undefined ? editValue : currentValue;

                  return (
                    <div key={setting.key}>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs text-gray-500 uppercase font-bold">
                          {setting.label}
                        </label>
                        <div className="flex items-center gap-2">
                          {setting.isSensitive && (
                            <span className="text-xs text-amber-400/60 font-mono">encrypted</span>
                          )}
                          {setting.isSet ? (
                            <span className="text-xs text-[#39ff88]/60">● set</span>
                          ) : (
                            <span className="text-xs text-red-400/60">○ not set</span>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <input
                            type={setting.isSensitive && !isRevealed && editValue === undefined ? 'password' : 'text'}
                            value={
                              setting.isSensitive && !isRevealed && editValue === undefined
                                ? (setting.isSet ? '••••••••••••••••' : '')
                                : displayValue
                            }
                            onChange={e => setEdits(prev => ({ ...prev, [setting.key]: e.target.value }))}
                            placeholder={setting.isSet ? 'Click 👁 to reveal, or type to overwrite' : 'Not configured — enter value'}
                            className="w-full bg-[#05070a] border border-[#1a1f28] rounded-lg p-3 pr-10 text-white text-sm font-mono outline-none focus:border-[#39ff88]/40 transition-colors placeholder:text-gray-700"
                          />
                          {editValue !== undefined && editValue !== '' && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 w-2 h-2 bg-[#39ff88] rounded-full" />
                          )}
                        </div>

                        {/* Reveal button — only for set values with no pending edit */}
                        {setting.isSet && editValue === undefined && (
                          <button
                            onClick={() => handleRevealClick(setting.key)}
                            title={isRevealed ? 'Hide value' : 'Reveal value (requires 2FA)'}
                            className="p-3 bg-[#05070a] border border-[#1a1f28] rounded-lg text-gray-400 hover:text-white hover:border-[#39ff88]/40 transition-colors flex-shrink-0"
                          >
                            {isRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        )}

                        {/* Discard edit button */}
                        {editValue !== undefined && (
                          <button
                            onClick={() => setEdits(prev => { const n = { ...prev }; delete n[setting.key]; return n; })}
                            title="Discard change"
                            className="p-3 bg-[#05070a] border border-red-500/20 rounded-lg text-red-400 hover:text-red-300 transition-colors flex-shrink-0"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>

                      {setting.updatedAt && (
                        <p className="text-xs text-gray-700 mt-1">
                          Last updated {new Date(setting.updatedAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                  );
                })}

                {/* Save group button */}
                {pendingCount > 0 && (
                  <div className="flex justify-end pt-2 border-t border-[#1a1f28]">
                    <button
                      onClick={() => handleSaveGroup(groupKeys)}
                      className="flex items-center gap-2 bg-[#39ff88] text-black px-5 py-2.5 rounded-lg font-bold text-sm hover:bg-[#5dffa1] transition-all"
                    >
                      <Shield className="h-4 w-4" />
                      Save {pendingCount} change{pendingCount > 1 ? 's' : ''} (requires 2FA)
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main SettingsPage ────────────────────────────────────────────────────────

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'bot' | 'passkeys' | 'system'>('bot');
  const [tempConfig, setTempConfig] = useState<any>(null);

  const { data: botConfig, isLoading: configLoading } = useQuery({
    queryKey: ["botConfig"],
    queryFn: () => api.get("/admin/bot/config").then(res => res.data),
  });

  useEffect(() => {
    if (botConfig) setTempConfig(botConfig);
    else setTempConfig({ winRate: 0.55, avgWinPct: 0.01, avgLossPct: 0.01, payoutVarPct: 0.1 });
  }, [botConfig]);

  const updateConfigMutation = useMutation({
    mutationFn: (data: any) => api.put("/admin/bot/config", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["botConfig"] });
      alert("Saved successfully!");
    }
  });

  const generateKeyMutation = useMutation({
    mutationFn: () => api.post("/admin/passkeys", { version: "v2.1", label: "VIP License" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["passkeys"] })
  });

  const deleteKeyMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/passkeys/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["passkeys"] })
  });

  const tabs = [
    { id: 'bot', label: 'Bot Tuning', icon: Settings },
    { id: 'passkeys', label: 'Bot Passkeys', icon: Key },
    { id: 'system', label: 'System Settings', icon: Shield },
  ] as const;

  return (
    <div className="max-w-4xl mx-auto px-2 py-4 space-y-4">
      <h1 className="text-2xl font-black text-white">Settings</h1>

      {/* Tab Bar */}
      <div className="flex gap-1 bg-[#0d0f17] border border-[#1a1f28] rounded-xl p-1">
        {tabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === tab.id
                ? 'bg-[#39ff88] text-black'
                : 'text-gray-400 hover:text-white'
                }`}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Bot Tuning Tab */}
      {activeTab === 'bot' && (
        <div className="space-y-6">
          <div className="bg-[#0d0f17] border border-[#1a1f28] rounded-2xl p-6">
            <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
              <Settings className="h-5 w-5 text-[#39ff88]" /> Bot Engine Config
            </h2>
            {configLoading || !tempConfig ? (
              <div className="flex justify-center p-8"><Loader2 className="animate-spin text-[#39ff88]" /></div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {[
                    { label: "Win Rate (0–1)", key: "winRate", step: "0.01" },
                    { label: "Avg Win Pct", key: "avgWinPct", step: "0.001" },
                    { label: "Avg Loss Pct", key: "avgLossPct", step: "0.001" },
                    { label: "Payout Variance", key: "payoutVarPct", step: "0.01" },
                  ].map(field => (
                    <div key={field.key}>
                      <label className="block text-xs text-gray-500 uppercase font-bold mb-1">{field.label}</label>
                      <input
                        type="number" step={field.step}
                        value={tempConfig[field.key] || 0}
                        onChange={e => setTempConfig((p: any) => ({ ...p, [field.key]: Number(e.target.value) }))}
                        className="w-full bg-[#05070a] border border-[#1a1f28] rounded-lg p-3 text-white outline-none focus:border-[#39ff88]/40 transition-colors"
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-8 flex justify-end">
                  <button
                    onClick={() => updateConfigMutation.mutate(tempConfig)}
                    disabled={updateConfigMutation.isPending}
                    className="bg-[#39ff88] text-black px-6 py-3 rounded-lg font-bold text-sm hover:bg-[#5dffa1] disabled:opacity-50 transition-all flex items-center gap-2"
                  >
                    {updateConfigMutation.isPending ? <Loader2 className="animate-spin h-4 w-4" /> : <Save className="h-4 w-4" />}
                    Save Engine Config
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="bg-[#0d0f17] border border-[#1a1f28] rounded-2xl p-6">
            <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
              <Wallet className="h-5 w-5 text-[#39ff88]" /> Withdrawal Settings
            </h2>
            <WithdrawalSettingsForm />
          </div>
        </div>
      )}

      {/* Passkeys Tab */}
      {activeTab === 'passkeys' && (
        <div className="bg-[#0d0f17] border border-[#1a1f28] rounded-2xl p-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Key className="h-5 w-5 text-[#39ff88]" /> Bot Passkeys
            </h2>
            <button
              onClick={() => generateKeyMutation.mutate()}
              disabled={generateKeyMutation.isPending}
              className="w-full sm:w-auto flex items-center justify-center gap-2 bg-[#39ff88] text-black px-4 py-2 rounded-lg font-bold text-sm hover:bg-[#5dffa1] disabled:opacity-50 transition-all"
            >
              {generateKeyMutation.isPending ? <Loader2 className="animate-spin h-4 w-4" /> : <Plus className="h-4 w-4" />}
              Generate New Key
            </button>
          </div>
          <PasskeyTable onDelete={id => deleteKeyMutation.mutate(id)} />
        </div>
      )}

      {/* System Settings Tab */}
      {activeTab === 'system' && <SystemSettingsTab />}
    </div>
  );
}

// ─── WithdrawalSettingsForm ──────────────────────────────────────────────────

function WithdrawalSettingsForm() {
  const queryClient = useQueryClient();
  const [minWithdrawal, setMinWithdrawal] = useState<number>(100);

  const { data, isLoading } = useQuery({
    queryKey: ["adminWithdrawalConfig"],
    queryFn: () => api.get("/admin/withdrawal/config").then(res => res.data),
  });

  useEffect(() => {
    if (data) setMinWithdrawal(data.minWithdrawalAmount);
  }, [data]);

  const updateMutation = useMutation({
    mutationFn: (amount: number) => api.put("/admin/withdrawal/config", { minWithdrawalAmount: amount }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminWithdrawalConfig"] });
      alert("Withdrawal settings saved!");
    }
  });

  if (isLoading) return <div className="flex justify-center"><Loader2 className="animate-spin text-[#39ff88]" /></div>;

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-xs text-gray-500 uppercase font-bold mb-1">Minimum Withdrawal Amount (USD)</label>
          <input
            type="number" step="1"
            value={minWithdrawal}
            onChange={e => setMinWithdrawal(Number(e.target.value))}
            className="w-full bg-[#05070a] border border-[#1a1f28] rounded-lg p-3 text-white outline-none focus:border-[#39ff88]/40 transition-colors"
          />
        </div>
      </div>
      <div className="mt-8 flex justify-end">
        <button
          onClick={() => updateMutation.mutate(minWithdrawal)}
          disabled={updateMutation.isPending}
          className="bg-[#39ff88] text-black px-6 py-3 rounded-lg font-bold text-sm hover:bg-[#5dffa1] disabled:opacity-50 transition-all flex items-center gap-2"
        >
          {updateMutation.isPending ? <Loader2 className="animate-spin h-4 w-4" /> : <Save className="h-4 w-4" />}
          Save
        </button>
      </div>
    </>
  );
}

// ─── PasskeyTable (unchanged) ────────────────────────────────────────────────

function PasskeyTable({ onDelete }: { onDelete: (id: string) => void }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { data: keys, isLoading } = useQuery({
    queryKey: ["passkeys"],
    queryFn: () => api.get("/admin/passkeys").then(res => res.data)
  });

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (isLoading) return <div className="text-gray-500 text-sm p-4">Loading keys...</div>;
  if (!keys?.length) return <div className="text-gray-500 text-sm p-4 text-center italic">No passkeys generated yet.</div>;

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-left text-sm text-gray-300">
        <thead className="text-xs uppercase text-gray-500 border-b border-[#1a1f28]">
          <tr>
            <th className="pb-3">Code</th>
            <th className="pb-3">Version</th>
            <th className="pb-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k: any) => (
            <tr key={k.id} className="border-b border-[#1a1f28]/30">
              <td className="py-3 font-mono text-[#39ff88]">{k.code}</td>
              <td className="py-3">{k.version}</td>
              <td className="py-3 text-right flex justify-end gap-2">
                {!k.isUsed && (
                  <>
                    <button onClick={() => copyToClipboard(k.code, k.id)} className="p-2 hover:bg-[#1a1f28] rounded-lg transition-colors text-gray-400 hover:text-white">
                      {copiedId === k.id ? <Check className="h-4 w-4 text-[#39ff88]" /> : <Copy className="h-4 w-4" />}
                    </button>
                    <button onClick={() => onDelete(k.id)} className="p-2 hover:bg-red-900/20 rounded-lg transition-colors text-gray-400 hover:text-red-400">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}