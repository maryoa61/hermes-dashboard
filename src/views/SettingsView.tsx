import React, { useState } from 'react';
import {
  Server,
  Plus,
  Trash2,
  Edit2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Eye,
  EyeOff,
  Shield,
  Upload,
  Download,
  Terminal,
  Activity,
  Check,
  RefreshCw,
} from 'lucide-react';
import { AppSettings, ConnectionTestResult, HermesServerProfile } from '../types/hermes';
import {
  exportAppData,
  forgetEverything,
  importAppData,
  normalizeBaseUrl,
} from '../utils/storage';
import { testConnectionSteps } from '../utils/hermesClient';
import { translations } from '../i18n/translations';
import { PWAInstallBanner } from '../components/PWAInstallBanner';

interface SettingsViewProps {
  profiles: HermesServerProfile[];
  activeProfileId: string | null;
  onSaveProfiles: (profiles: HermesServerProfile[]) => void;
  onSelectActiveProfile: (id: string) => void;
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => void;
  language: 'en' | 'fa';
  onLanguageChange: (lang: 'en' | 'fa') => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  profiles,
  activeProfileId,
  onSaveProfiles,
  onSelectActiveProfile,
  settings,
  onSaveSettings,
  language,
  onLanguageChange,
}) => {
  const t = translations[language];

  // Form states for creating / editing a profile
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(profiles.length === 0);

  // Connection testing states
  const [isTesting, setIsTesting] = useState(false);
  const [testResults, setTestResults] = useState<ConnectionTestResult[] | null>(null);

  // URL security warning checks
  const isHttpsClient = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const isPlainHttp = baseUrl.trim().toLowerCase().startsWith('http://');
  const isLocalHost = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1');
  const isMixedContent = isHttpsClient && isPlainHttp;
  const isUnencryptedRemote = isPlainHttp && !isLocalHost;

  const startNewProfile = () => {
    setEditingProfileId(null);
    setName('');
    setBaseUrl('http://127.0.0.1:8642');
    setApiKey('');
    setModelName('');
    setTestResults(null);
    setIsFormOpen(true);
  };

  const startEditProfile = (profile: HermesServerProfile) => {
    setEditingProfileId(profile.id);
    setName(profile.name);
    setBaseUrl(profile.baseUrl);
    setApiKey(profile.apiKey);
    setModelName(profile.modelName || '');
    setTestResults(null);
    setIsFormOpen(true);
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUrl = normalizeBaseUrl(baseUrl);
    if (!cleanUrl) return;

    if (editingProfileId) {
      const updated = profiles.map((p) =>
        p.id === editingProfileId
          ? {
              ...p,
              name: name.trim() || cleanUrl,
              baseUrl: cleanUrl,
              apiKey: apiKey.trim(),
              modelName: modelName.trim(),
              updatedAt: Date.now(),
            }
          : p
      );
      onSaveProfiles(updated);
    } else {
      const newId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newProfile: HermesServerProfile = {
        id: newId,
        name: name.trim() || cleanUrl,
        baseUrl: cleanUrl,
        apiKey: apiKey.trim(),
        modelName: modelName.trim(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const updated = [...profiles, newProfile];
      onSaveProfiles(updated);
      onSelectActiveProfile(newId);
    }

    setIsFormOpen(false);
    setTestResults(null);
  };

  const handleDeleteProfile = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(t.deleteProfileConfirm)) return;
    const updated = profiles.filter((p) => p.id !== id);
    onSaveProfiles(updated);
    if (activeProfileId === id) {
      if (updated.length > 0) {
        onSelectActiveProfile(updated[0].id);
      } else {
        onSelectActiveProfile('');
      }
    }
  };

  const handleRunTest = async () => {
    const cleanUrl = normalizeBaseUrl(baseUrl);
    if (!cleanUrl) return;

    const probeProfile: HermesServerProfile = {
      id: 'test',
      name: name || 'Test',
      baseUrl: cleanUrl,
      apiKey: apiKey.trim(),
      modelName: modelName.trim(),
      createdAt: 0,
      updatedAt: 0,
    };

    setIsTesting(true);
    setTestResults(null);

    try {
      await testConnectionSteps(probeProfile, (steps) => {
        setTestResults([...steps]);
      });
    } catch (err) {
      console.error('Test connection error', err);
    } finally {
      setIsTesting(false);
    }
  };

  const handleExport = () => {
    if (!window.confirm(t.exportWarning)) return;
    const dataStr = exportAppData();
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hermes-client-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const res = importAppData(content);
      if (res.success) {
        window.location.reload();
      } else {
        alert(res.error || 'Import failed');
      }
    };
    reader.readAsText(file);
  };

  const handleForgetAll = () => {
    if (window.confirm(t.forgetAllConfirm)) {
      forgetEverything();
      window.location.reload();
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6 max-w-4xl mx-auto w-full pb-24">
      {/* PWA Banner */}
      <PWAInstallBanner />

      {/* Security Advisory Callout */}
      <div className="p-4 rounded-xl bg-[#001e26] border border-[#ff7b25]/40 shadow-sm space-y-2">
        <div className="flex items-center gap-2 text-[#ff7b25]">
          <Shield className="w-5 h-5 shrink-0" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#eee8d5]">{t.securityNoticeTitle}</h2>
        </div>
        <p className="text-xs text-[#839496] leading-relaxed">
          {t.securityNoticeText}
        </p>
      </div>

      {/* Section 1: Server Profiles */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-[#2aa198]" />
            <h2 className="text-sm font-bold text-[#eee8d5]">{t.serverProfiles}</h2>
          </div>
          {!isFormOpen && (
            <button
              onClick={startNewProfile}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#ff7b25] hover:bg-[#e06818] text-white text-xs font-semibold shadow transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t.addProfile}</span>
            </button>
          )}
        </div>

        {/* Existing Profiles List */}
        {!isFormOpen && (
          <div className="space-y-2">
            {profiles.length === 0 ? (
              <div className="p-6 text-center rounded-xl bg-[#073642]/30 border border-[#073642] text-xs text-[#586e75]">
                {t.unconfigured}. Tap &quot;{t.addProfile}&quot; to configure your Hermes server.
              </div>
            ) : (
              profiles.map((p) => {
                const isActive = p.id === activeProfileId;
                return (
                  <div
                    key={p.id}
                    onClick={() => onSelectActiveProfile(p.id)}
                    className={`p-3.5 rounded-xl border transition flex items-center justify-between cursor-pointer ${
                      isActive
                        ? 'bg-[#073642] border-[#2aa198] text-[#eee8d5] shadow-md'
                        : 'bg-[#00222a] border-[#073642] text-[#93a1a1] hover:bg-[#073642]/40'
                    }`}
                  >
                    <div className="min-w-0 flex items-center gap-3">
                      <div
                        className={`w-3 h-3 rounded-full shrink-0 ${
                          isActive ? 'bg-[#ff7b25] shadow-[0_0_6px_#ff7b25]' : 'bg-[#586e75]'
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="font-semibold text-xs truncate text-[#eee8d5]">{p.name}</div>
                        <div className="text-[11px] font-mono text-[#586e75] truncate" dir="ltr">
                          {p.baseUrl}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isActive && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#ff7b25]/20 text-[#ff7b25] font-bold">
                          {t.active}
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditProfile(p);
                        }}
                        className="p-1.5 rounded-lg hover:bg-[#002b36] text-[#93a1a1] hover:text-[#eee8d5]"
                        title={t.editProfile}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => handleDeleteProfile(p.id, e)}
                        className="p-1.5 rounded-lg hover:bg-[#002b36] text-[#93a1a1] hover:text-rose-400"
                        title={t.deleteProfile}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Profile Editor Form */}
        {isFormOpen && (
          <div className="p-4 sm:p-5 rounded-xl bg-[#00222a] border border-[#2aa198]/40 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#073642]">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#eee8d5]">
                {editingProfileId ? t.editProfile : t.addProfile}
              </h3>
              {profiles.length > 0 && (
                <button
                  onClick={() => setIsFormOpen(false)}
                  className="text-xs text-[#839496] hover:text-white"
                >
                  {t.cancel}
                </button>
              )}
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4">
              {/* Display Name */}
              <div>
                <label className="block text-xs font-semibold text-[#93a1a1] mb-1">
                  {t.profileName}
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t.profileNamePlaceholder}
                  className="w-full rounded-xl bg-[#002b36] border border-[#073642] p-2.5 text-xs text-[#eee8d5] focus:outline-none focus:border-[#2aa198]"
                />
              </div>

              {/* Base URL */}
              <div>
                <label className="block text-xs font-semibold text-[#93a1a1] mb-1">
                  {t.baseUrl}
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={t.baseUrlHint}
                  required
                  className="w-full rounded-xl bg-[#002b36] border border-[#073642] p-2.5 text-xs font-mono text-[#eee8d5] focus:outline-none focus:border-[#2aa198]"
                />

                {/* Warnings based on URL */}
                {isMixedContent && (
                  <div className="mt-2 p-2.5 rounded-lg bg-amber-950/80 border border-amber-500/50 text-[11px] text-amber-200 space-y-1">
                    <div className="font-bold flex items-center gap-1 text-amber-300">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>{t.baseUrlWarningMixed}</span>
                    </div>
                    <div>{t.mixedContentFix}</div>
                  </div>
                )}

                {isUnencryptedRemote && !isMixedContent && (
                  <div className="mt-2 p-2 rounded-lg bg-[#073642]/60 border border-[#073642] text-[11px] text-[#93a1a1]">
                    {t.baseUrlWarningHttp}
                  </div>
                )}
              </div>

              {/* API Server Key */}
              <div>
                <label className="block text-xs font-semibold text-[#93a1a1] mb-1">
                  {t.apiKey}
                </label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    dir="ltr"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={t.apiKeyPlaceholder}
                    className="w-full rounded-xl bg-[#002b36] border border-[#073642] p-2.5 pr-10 text-xs font-mono text-[#eee8d5] focus:outline-none focus:border-[#2aa198]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2.5 top-2.5 text-[#586e75] hover:text-[#93a1a1]"
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Model Override */}
              <div>
                <label className="block text-xs font-semibold text-[#93a1a1] mb-1">
                  {t.modelName}
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  placeholder={t.modelNamePlaceholder}
                  className="w-full rounded-xl bg-[#002b36] border border-[#073642] p-2.5 text-xs font-mono text-[#eee8d5] focus:outline-none focus:border-[#2aa198]"
                />
              </div>

              {/* Real Connection Validator */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleRunTest}
                  disabled={!baseUrl.trim() || isTesting}
                  className="w-full py-2.5 rounded-xl bg-[#073642] hover:bg-[#0e4a57] text-[#2aa198] hover:text-[#eee8d5] text-xs font-semibold border border-[#2aa198]/40 flex items-center justify-center gap-2 transition disabled:opacity-50"
                >
                  <Activity className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin text-[#ff7b25]' : ''}`} />
                  <span>{isTesting ? t.testing : t.testConnection}</span>
                </button>

                {/* Step Results */}
                {testResults && (
                  <div className="mt-3 p-3 rounded-xl bg-[#001e26] border border-[#073642] space-y-2 text-xs font-mono" dir="ltr">
                    {testResults.map((stepResult) => (
                      <div key={stepResult.step} className="flex items-start gap-2">
                        {stepResult.status === 'success' && <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />}
                        {stepResult.status === 'failed' && <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />}
                        {stepResult.status === 'pending' && <RefreshCw className="w-4 h-4 text-amber-400 animate-spin shrink-0 mt-0.5" />}
                        {stepResult.status === 'skipped' && <span className="w-4 h-4 shrink-0 text-[#586e75] text-center">-</span>}
                        <div>
                          <div className={`font-semibold ${stepResult.status === 'success' ? 'text-emerald-300' : stepResult.status === 'failed' ? 'text-rose-300' : 'text-[#839496]'}`}>
                            {stepResult.message}
                          </div>
                          {stepResult.httpStatus && (
                            <div className="text-[10px] text-[#586e75]">HTTP Status: {stepResult.httpStatus}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Form Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#073642]">
                {profiles.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setIsFormOpen(false)}
                    className="px-4 py-2 rounded-xl bg-[#002b36] hover:bg-[#073642] text-xs font-medium text-[#93a1a1]"
                  >
                    {t.cancel}
                  </button>
                )}
                <button
                  type="submit"
                  disabled={!baseUrl.trim()}
                  className="px-5 py-2.5 rounded-xl bg-[#ff7b25] hover:bg-[#e06818] text-white text-xs font-semibold shadow transition disabled:opacity-50"
                >
                  {t.saveProfile}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Section 2: Preferences */}
      <div className="p-4 rounded-xl bg-[#00222a] border border-[#073642] space-y-4">
        <h2 className="text-sm font-bold text-[#eee8d5]">{t.preferences}</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          {/* Language Selection */}
          <div>
            <label className="block text-xs font-semibold text-[#93a1a1] mb-1.5">
              {t.language}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onLanguageChange('fa')}
                className={`py-2 px-3 rounded-lg border text-xs font-medium transition ${
                  language === 'fa'
                    ? 'bg-[#073642] border-[#ff7b25] text-white'
                    : 'bg-[#002b36] border-[#073642] text-[#93a1a1]'
                }`}
              >
                فارسی (RTL)
              </button>
              <button
                type="button"
                onClick={() => onLanguageChange('en')}
                className={`py-2 px-3 rounded-lg border text-xs font-medium transition ${
                  language === 'en'
                    ? 'bg-[#073642] border-[#ff7b25] text-white'
                    : 'bg-[#002b36] border-[#073642] text-[#93a1a1]'
                }`}
              >
                English (LTR)
              </button>
            </div>
          </div>

          {/* Heartbeat Poll Interval */}
          <div>
            <label className="block text-xs font-semibold text-[#93a1a1] mb-1.5">
              {t.heartbeatInterval} ({settings.heartbeatIntervalSec}s)
            </label>
            <input
              type="range"
              min={10}
              max={60}
              step={5}
              value={settings.heartbeatIntervalSec}
              onChange={(e) =>
                onSaveSettings({ ...settings, heartbeatIntervalSec: Number(e.target.value) })
              }
              className="w-full accent-[#ff7b25] bg-[#002b36]"
            />
            <div className="flex justify-between text-[10px] text-[#586e75] mt-1 font-mono">
              <span>10s</span>
              <span>30s</span>
              <span>60s</span>
            </div>
          </div>
        </div>

        {/* System Prompt Layer */}
        <div>
          <label className="block text-xs font-semibold text-[#93a1a1] mb-1">
            {t.systemPrompt}
          </label>
          <div className="text-[11px] text-[#586e75] mb-2">{t.systemPromptHint}</div>
          <textarea
            rows={3}
            value={settings.systemPromptAddition || ''}
            onChange={(e) => onSaveSettings({ ...settings, systemPromptAddition: e.target.value })}
            placeholder="e.g. Always respond concisely in Persian or provide bash one-liners..."
            className="w-full rounded-xl bg-[#002b36] border border-[#073642] p-2.5 text-xs text-[#eee8d5] focus:outline-none focus:border-[#2aa198]"
          />
        </div>
      </div>

      {/* Section 3: Data Management */}
      <div className="p-4 rounded-xl bg-[#00222a] border border-[#073642] space-y-3">
        <h2 className="text-sm font-bold text-[#eee8d5]">{t.settings}</h2>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#073642] hover:bg-[#0e4a57] text-xs font-medium text-[#eee8d5] border border-[#073642] transition"
          >
            <Download className="w-3.5 h-3.5 text-[#2aa198]" />
            <span>{t.exportSettings}</span>
          </button>

          <label className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#073642] hover:bg-[#0e4a57] text-xs font-medium text-[#eee8d5] border border-[#073642] transition cursor-pointer">
            <Upload className="w-3.5 h-3.5 text-[#ff7b25]" />
            <span>{t.importSettings}</span>
            <input type="file" accept=".json" onChange={handleImport} className="hidden" />
          </label>

          <button
            onClick={handleForgetAll}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 text-xs font-medium border border-rose-800/40 transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t.forgetAll}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
