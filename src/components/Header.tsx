import React from 'react';
import { Activity, ShieldAlert, WifiOff, RefreshCw, Server, Globe } from 'lucide-react';
import { HealthState, HermesServerProfile } from '../types/hermes';
import { PWAInstallBanner } from './PWAInstallBanner';
import { translations } from '../i18n/translations';

interface HeaderProps {
  activeProfile: HermesServerProfile | null;
  profiles: HermesServerProfile[];
  onSelectProfile: (id: string) => void;
  healthState: HealthState;
  onRefreshHealth: () => void;
  language: 'en' | 'fa';
  onToggleLanguage: () => void;
  onOpenSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeProfile,
  profiles,
  onSelectProfile,
  healthState,
  onRefreshHealth,
  language,
  onToggleLanguage,
  onOpenSettings,
}) => {
  const t = translations[language];

  // Helper for status badge presentation
  const getStatusBadge = () => {
    switch (healthState.state) {
      case 'connected':
        return {
          icon: <Activity className="w-3 h-3 text-emerald-400" />,
          text: t.connected,
          bg: 'bg-emerald-950/70 border-emerald-500/40 text-emerald-300',
        };
      case 'reconnecting':
        return {
          icon: <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" />,
          text: t.reconnecting,
          bg: 'bg-amber-950/70 border-amber-500/40 text-amber-300',
        };
      case 'auth_error':
        return {
          icon: <ShieldAlert className="w-3 h-3 text-rose-400" />,
          text: t.authError,
          bg: 'bg-rose-950/70 border-rose-500/40 text-rose-300',
        };
      case 'offline':
        return {
          icon: <WifiOff className="w-3 h-3 text-slate-400" />,
          text: t.offline,
          bg: 'bg-slate-900/80 border-slate-600/40 text-slate-300',
        };
      case 'unconfigured':
      default:
        return {
          icon: <Server className="w-3 h-3 text-amber-400" />,
          text: t.unconfigured,
          bg: 'bg-[#073642]/80 border-[#2aa198]/30 text-[#93a1a1]',
        };
    }
  };

  const badge = getStatusBadge();

  return (
    <header className="sticky top-0 z-40 w-full bg-[#002b36]/95 backdrop-blur-md border-b border-[#073642] px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <div className="flex items-center justify-between gap-2 max-w-5xl mx-auto">
        {/* Brand & Profile selector */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#073642] to-[#001e26] border border-[#ff7b25]/50 flex items-center justify-center shrink-0 shadow-sm">
            <span className="text-[#ff7b25] font-black text-sm">H</span>
          </div>

          {profiles.length > 0 ? (
            <div className="relative min-w-0">
              <select
                aria-label={t.serverProfiles}
                value={activeProfile?.id || ''}
                onChange={(e) => onSelectProfile(e.target.value)}
                className="bg-[#073642]/60 hover:bg-[#073642] text-[#eee8d5] text-xs font-medium rounded-md px-2 py-1 border border-[#2aa198]/20 focus:outline-none focus:ring-1 focus:ring-[#ff7b25] truncate max-w-[140px] sm:max-w-[200px] cursor-pointer"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id} className="bg-[#002b36] text-[#eee8d5]">
                    {p.name || p.baseUrl}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <button
              onClick={onOpenSettings}
              className="text-xs text-[#ff7b25] font-semibold hover:underline flex items-center gap-1"
            >
              <span>+ {t.addProfile}</span>
            </button>
          )}
        </div>

        {/* Status indicator & Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Status pill */}
          <button
            onClick={onRefreshHealth}
            title={`${t.latency}: ${healthState.latencyMs !== null ? `${healthState.latencyMs}ms` : t.never}. Click to re-check.`}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-mono border transition-all ${badge.bg} active:scale-95`}
          >
            {badge.icon}
            <span className="font-sans font-medium hidden xs:inline">{badge.text}</span>
            {healthState.latencyMs !== null && healthState.state === 'connected' && (
              <span className="text-[10px] text-emerald-400 font-mono hidden sm:inline">
                {healthState.latencyMs}ms
              </span>
            )}
          </button>

          {/* Compact PWA Install Button */}
          <PWAInstallBanner compact />

          {/* Language Toggle button */}
          <button
            onClick={onToggleLanguage}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-[#073642]/50 hover:bg-[#073642] text-[#93a1a1] hover:text-[#eee8d5] text-xs border border-[#073642] transition"
            title="Switch Language (English / فارسی)"
          >
            <Globe className="w-3.5 h-3.5 text-[#2aa198]" />
            <span className="font-semibold text-[10px]">{language === 'fa' ? 'FA' : 'EN'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
