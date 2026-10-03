import React, { useEffect, useState } from 'react';
import {
  Activity,
  Cpu,
  Layers,
  PlayCircle,
  Clock,
  RefreshCw,
  AlertTriangle,
  Server,
  ArrowRight,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';
import {
  CapabilitiesResponse,
  HealthState,
  HermesModel,
  HermesServerProfile,
  LocalAgentRunRecord,
  ScheduledJob,
} from '../types/hermes';
import { getCapabilities, getJobs, getModels, getRunDetails } from '../utils/hermesClient';
import { idbGetLocalRuns } from '../utils/storage';
import { translations } from '../i18n/translations';
import { PWAInstallBanner } from '../components/PWAInstallBanner';

interface DashboardViewProps {
  profile: HermesServerProfile | null;
  healthState: HealthState;
  onRefreshHealth: () => void;
  language: 'en' | 'fa';
  onNavigate: (tab: 'dashboard' | 'chat' | 'runs' | 'settings' | 'debug') => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  profile,
  healthState,
  onRefreshHealth,
  language,
  onNavigate,
}) => {
  const t = translations[language];

  const [models, setModels] = useState<HermesModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null);
  const [capsLoading, setCapsLoading] = useState(false);
  const [capsError, setCapsError] = useState<string | null>(null);

  // Local runs from IndexedDB (polled individually via GET /v1/runs/{id}, since GET /v1/runs is undocumented)
  const [localRuns, setLocalRuns] = useState<LocalAgentRunRecord[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);

  const [isRefreshingAll, setIsRefreshingAll] = useState(false);

  // Mixed content warning check
  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const isMixedContent = isHttps && profile?.baseUrl.startsWith('http://');

  // Capability inspection helpers per Requirement 9
  const supportedFeatures = Array.isArray(capabilities?.features)
    ? capabilities.features
    : typeof capabilities?.capabilities === 'object' && capabilities.capabilities
    ? Object.keys(capabilities.capabilities)
    : capabilities
    ? Object.keys(capabilities)
    : [];

  const supportsFeature = (featureName: string): boolean => {
    if (!capabilities) return true; // until capabilities load, do not prematurely hide everything
    return supportedFeatures.some(
      (f) => f.toLowerCase().includes(featureName.toLowerCase()) || f.toLowerCase() === featureName.toLowerCase()
    );
  };

  const fetchAllData = async () => {
    if (!profile) return;
    setIsRefreshingAll(true);

    onRefreshHealth();

    // 1. Models
    setModelsLoading(true);
    setModelsError(null);
    getModels(profile).then((res) => {
      setModelsLoading(false);
      if (res.ok) {
        setModels(res.models);
      } else {
        setModelsError(res.error || 'Failed to load models');
        setModels([]);
      }
    });

    // 2. Capabilities (/v1/capabilities)
    setCapsLoading(true);
    setCapsError(null);
    getCapabilities(profile).then((res) => {
      setCapsLoading(false);
      if (res.ok && res.capabilities) {
        setCapabilities(res.capabilities);
      } else {
        setCapsError(res.error || 'Endpoint unavailable');
        setCapabilities(null);
      }
    });

    // 3. Local Runs (polled via GET /v1/runs/{id} for active items)
    setRunsLoading(true);
    idbGetLocalRuns(profile.id).then(async (runs) => {
      setLocalRuns(runs);
      setRunsLoading(false);
      // Refresh status for top 3 runs
      for (const r of runs.slice(0, 3)) {
        getRunDetails(profile, r.runId).then((res) => {
          if (res.ok && res.run) {
            setLocalRuns((prev) =>
              prev.map((item) => (item.runId === r.runId ? { ...item, status: res.run?.status || item.status } : item))
            );
          }
        });
      }
    });

    // 4. Jobs (/api/jobs) - if server capabilities don't explicitly disable it
    setJobsLoading(true);
    setJobsError(null);
    getJobs(profile).then((res) => {
      setJobsLoading(false);
      if (res.ok) {
        setJobs(res.jobs);
      } else {
        setJobsError(res.error || 'Endpoint unavailable');
        setJobs([]);
      }
    });

    setIsRefreshingAll(false);
  };

  useEffect(() => {
    if (profile) {
      fetchAllData();
    } else {
      setModels([]);
      setCapabilities(null);
      setLocalRuns([]);
      setJobs([]);
    }
  }, [profile?.id, profile?.baseUrl, profile?.apiKey]);

  if (!profile) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-[#073642] border border-[#2aa198]/30 flex items-center justify-center mb-4 text-[#ff7b25] shadow-xl">
          <Server className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-[#eee8d5] mb-2">{t.unconfigured}</h2>
        <p className="text-sm text-[#839496] max-w-sm mb-6 leading-relaxed">
          {t.quickConnectHint}
        </p>
        <button
          onClick={() => onNavigate('settings')}
          className="px-6 py-3 rounded-xl bg-[#ff7b25] hover:bg-[#e06818] text-white text-sm font-semibold shadow-lg transition-transform active:scale-95 flex items-center gap-2 cursor-pointer"
        >
          <span>{t.configureNow}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 max-w-4xl mx-auto w-full pb-20">
      {/* Top Banner: PWA prompt if available */}
      <PWAInstallBanner />

      {/* Mixed Content Warning */}
      {isMixedContent && (
        <div className="p-3.5 rounded-xl bg-amber-950/80 border border-amber-500/50 text-amber-200 text-xs flex items-start gap-3 shadow-md">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-semibold text-amber-100">{t.baseUrlWarningMixed}</div>
            <div className="text-amber-300/90 leading-relaxed">{t.mixedContentFix}</div>
          </div>
        </div>
      )}

      {/* Telemetry Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[#eee8d5]">{t.overviewTitle}</h1>
          <div className="text-xs text-[#586e75] font-mono truncate max-w-[260px] sm:max-w-md" dir="ltr">
            {profile.baseUrl}
          </div>
        </div>
        <button
          onClick={fetchAllData}
          disabled={isRefreshingAll}
          className="p-2 rounded-lg bg-[#073642] hover:bg-[#0e4a57] text-[#93a1a1] hover:text-[#eee8d5] border border-[#073642] transition active:scale-90"
          title="Refresh telemetry"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshingAll ? 'animate-spin text-[#ff7b25]' : ''}`} />
        </button>
      </div>

      {/* Grid of Telemetry Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* Card 1: Node Health */}
        <div className="p-4 rounded-xl bg-[#073642]/40 border border-[#073642] hover:border-[#2aa198]/30 transition shadow-sm space-y-3">
          <div className="flex items-center justify-between text-[#2aa198]">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#ff7b25]" />
              <span className="text-xs font-bold uppercase tracking-wider text-[#eee8d5]">{t.nodeHealth}</span>
            </div>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase ${
                healthState.state === 'connected'
                  ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/40'
                  : 'bg-rose-950/80 text-rose-400 border border-rose-500/40'
              }`}
            >
              {healthState.state}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div className="p-2.5 rounded-lg bg-[#002b36]/70 border border-[#073642]/60">
              <div className="text-[10px] text-[#586e75] uppercase">{t.latency}</div>
              <div className="text-sm font-bold text-[#eee8d5] mt-0.5">
                {healthState.latencyMs !== null ? `${healthState.latencyMs} ms` : '—'}
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-[#002b36]/70 border border-[#073642]/60">
              <div className="text-[10px] text-[#586e75] uppercase">{t.lastCheck}</div>
              <div className="text-xs font-medium text-[#93a1a1] mt-1 truncate">
                {healthState.lastChecked
                  ? new Date(healthState.lastChecked).toLocaleTimeString([], { hour12: false })
                  : t.never}
              </div>
            </div>
          </div>

          {healthState.errorDetail && (
            <div className="p-2 rounded bg-rose-950/30 border border-rose-900/50 text-[11px] text-rose-300 leading-snug">
              {healthState.errorDetail}
            </div>
          )}
        </div>

        {/* Card 2: Models (/v1/models) */}
        <div className="p-4 rounded-xl bg-[#073642]/40 border border-[#073642] hover:border-[#2aa198]/30 transition shadow-sm space-y-3">
          <div className="flex items-center justify-between text-[#2aa198]">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-[#2aa198]" />
              <span className="text-xs font-bold uppercase tracking-wider text-[#eee8d5]">{t.modelsCard}</span>
            </div>
            <span className="text-xs font-mono text-[#586e75]">{models.length} loaded</span>
          </div>

          {modelsLoading ? (
            <div className="flex items-center justify-center py-6 text-xs text-[#586e75]">
              <RefreshCw className="w-4 h-4 animate-spin text-[#ff7b25] mr-2" />
              <span>Querying /v1/models...</span>
            </div>
          ) : modelsError ? (
            <div className="text-xs text-rose-400 p-2.5 rounded-lg bg-rose-950/20 border border-rose-900/30 space-y-1">
              <div className="font-semibold">{t.cardUnavailable}</div>
              <div className="text-[11px] text-rose-300/80">{modelsError}</div>
              <button
                onClick={() => onNavigate('debug')}
                className="text-[10px] text-[#2aa198] underline flex items-center gap-1 pt-1"
              >
                <span>{t.viewInDebug}</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </button>
            </div>
          ) : models.length === 0 ? (
            <div className="text-xs text-[#586e75] py-4 text-center">{t.noModelsFound}</div>
          ) : (
            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1" dir="ltr">
              {models.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-[#002b36]/80 border border-[#073642] text-xs font-mono"
                >
                  <span className="font-semibold text-[#2aa198] truncate max-w-[200px]">{m.id}</span>
                  {m.owned_by && <span className="text-[10px] text-[#586e75]">{m.owned_by}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Card 3: Capabilities (/v1/capabilities) */}
        <div className="p-4 rounded-xl bg-[#073642]/40 border border-[#073642] hover:border-[#2aa198]/30 transition shadow-sm space-y-3">
          <div className="flex items-center justify-between text-[#2aa198]">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#ff7b25]" />
              <span className="text-xs font-bold uppercase tracking-wider text-[#eee8d5]">{t.capabilitiesCard}</span>
            </div>
            <span className="text-xs font-mono text-[#586e75]">/v1/capabilities</span>
          </div>

          {capsLoading ? (
            <div className="flex items-center justify-center py-6 text-xs text-[#586e75]">
              <RefreshCw className="w-4 h-4 animate-spin text-[#ff7b25] mr-2" />
              <span>Inspecting capabilities...</span>
            </div>
          ) : capsError ? (
            <div className="text-xs text-[#586e75] p-2.5 rounded-lg bg-[#002b36]/60 border border-[#073642] space-y-1">
              <div>{t.cardUnavailable}</div>
              <div className="text-[10px] text-[#586e75]">{capsError}</div>
            </div>
          ) : !capabilities || Object.keys(capabilities).length === 0 ? (
            <div className="text-xs text-[#586e75] py-4 text-center">{t.noCapabilities}</div>
          ) : (
            <div className="space-y-2">
              {supportedFeatures.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pb-1">
                  {supportedFeatures.map((f, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded-md bg-[#001e26] border border-[#2aa198]/40 text-[#2aa198] text-[10px] font-mono flex items-center gap-1"
                    >
                      <ShieldCheck className="w-3 h-3 text-[#ff7b25]" />
                      <span>{f}</span>
                    </span>
                  ))}
                </div>
              )}
              <div
                className="p-2.5 rounded-lg bg-[#001e26] border border-[#073642] max-h-32 overflow-y-auto font-mono text-[11px] text-[#93a1a1]"
                dir="ltr"
              >
                <pre className="whitespace-pre-wrap">{JSON.stringify(capabilities, null, 2)}</pre>
              </div>
            </div>
          )}
        </div>

        {/* Card 4: Local Runs Registry (polled via GET /v1/runs/{id}, list endpoint removed) */}
        <div className="p-4 rounded-xl bg-[#073642]/40 border border-[#073642] hover:border-[#2aa198]/30 transition shadow-sm space-y-3">
          <div className="flex items-center justify-between text-[#2aa198]">
            <div className="flex items-center gap-2">
              <PlayCircle className="w-4 h-4 text-[#2aa198]" />
              <span className="text-xs font-bold uppercase tracking-wider text-[#eee8d5]">{t.activeRunsCard}</span>
            </div>
            <button
              onClick={() => onNavigate('runs')}
              className="text-xs text-[#ff7b25] hover:underline flex items-center gap-1 font-semibold"
            >
              <span>{t.runs}</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          {runsLoading ? (
            <div className="flex items-center justify-center py-6 text-xs text-[#586e75]">
              <RefreshCw className="w-4 h-4 animate-spin text-[#ff7b25] mr-2" />
              <span>Checking active runs...</span>
            </div>
          ) : localRuns.length === 0 ? (
            <div className="text-xs text-[#586e75] py-4 text-center">{t.noRunsFound}</div>
          ) : (
            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1" dir="ltr">
              {localRuns.slice(0, 3).map((r) => (
                <div
                  key={r.runId}
                  className="p-2 rounded-lg bg-[#002b36]/80 border border-[#073642] flex items-center justify-between text-xs font-mono"
                >
                  <div className="truncate max-w-[180px]">
                    <span className="font-semibold text-[#eee8d5]">{r.runId}</span>
                    <div className="text-[10px] text-[#586e75] truncate">{r.input || 'Agent run'}</div>
                  </div>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${
                      r.status === 'running'
                        ? 'bg-amber-950/80 text-amber-300 border border-amber-600/40'
                        : r.status === 'waiting_for_approval'
                        ? 'bg-[#ff7b25]/20 text-[#ff7b25] border border-[#ff7b25]/50'
                        : r.status === 'completed'
                        ? 'bg-emerald-950/80 text-emerald-400'
                        : 'bg-[#073642] text-[#93a1a1]'
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Card 5: Scheduled Jobs (/api/jobs) - only shown if server doesn't prohibit */}
        {supportsFeature('jobs') && (
          <div className="p-4 rounded-xl bg-[#073642]/40 border border-[#073642] hover:border-[#2aa198]/30 transition shadow-sm space-y-3 md:col-span-2">
            <div className="flex items-center justify-between text-[#2aa198]">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#ff7b25]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#eee8d5]">{t.scheduledJobsCard}</span>
              </div>
              <span className="text-xs font-mono text-[#586e75]">/api/jobs ({jobs.length})</span>
            </div>

            {jobsLoading ? (
              <div className="flex items-center justify-center py-4 text-xs text-[#586e75]">
                <RefreshCw className="w-4 h-4 animate-spin text-[#ff7b25] mr-2" />
                <span>Checking /api/jobs...</span>
              </div>
            ) : jobsError ? (
              <div className="text-xs text-[#586e75] p-2.5 rounded-lg bg-[#002b36]/60 border border-[#073642]">
                {t.cardUnavailable}
              </div>
            ) : jobs.length === 0 ? (
              <div className="text-xs text-[#586e75] py-2 text-center">{t.noJobsFound}</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto" dir="ltr">
                {jobs.map((j, idx) => (
                  <div key={j.id || idx} className="p-2 rounded bg-[#002b36]/70 border border-[#073642] text-xs font-mono">
                    <div className="font-semibold text-[#2aa198] truncate">{j.name || j.id || `Job #${idx + 1}`}</div>
                    <div className="text-[10px] text-[#839496] truncate">{j.cron || j.schedule || 'Scheduled interval'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
