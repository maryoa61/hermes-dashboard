import React, { useEffect, useRef, useState } from 'react';
import {
  PlayCircle,
  Square,
  RefreshCw,
  Plus,
  Terminal,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { AgentRun, AgentRunEvent, HermesServerProfile } from '../types/hermes';
import {
  buildEndpointUrl,
  createRun,
  getRunDetails,
  getRuns,
  stopRun,
} from '../utils/hermesClient';
import { translations } from '../i18n/translations';

interface RunsViewProps {
  profile: HermesServerProfile | null;
  language: 'en' | 'fa';
  onNavigateSettings: () => void;
}

export const RunsView: React.FC<RunsViewProps> = ({ profile, language, onNavigateSettings }) => {
  const t = translations[language];

  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRunDetails, setSelectedRunDetails] = useState<AgentRun | null>(null);
  const [events, setEvents] = useState<AgentRunEvent[]>([]);
  const [isSubscribingEvents, setIsSubscribingEvents] = useState(false);

  // New run modal / composer
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [taskPrompt, setTaskPrompt] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const eventsEndRef = useRef<HTMLDivElement | null>(null);
  const eventsAbortRef = useRef<AbortController | null>(null);

  const fetchRuns = async () => {
    if (!profile) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getRuns(profile);
      if (res.ok) {
        setRuns(res.runs);
        if (res.runs.length > 0 && !selectedRunId) {
          const firstRun = res.runs[0];
          const firstId = firstRun.id || firstRun.run_id;
          if (firstId) setSelectedRunId(firstId);
        }
      } else {
        setError(res.error || 'Failed to query /v1/runs');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error fetching runs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRuns();
  }, [profile?.id, profile?.baseUrl, profile?.apiKey]);

  // Load details and stream events when selectedRunId changes
  useEffect(() => {
    if (!profile || !selectedRunId) {
      setSelectedRunDetails(null);
      setEvents([]);
      return;
    }

    // Fetch initial details
    getRunDetails(profile, selectedRunId).then((res) => {
      if (res.ok && res.run) {
        setSelectedRunDetails(res.run);
      }
    });

    // Subscribe to SSE /v1/runs/{id}/events
    if (eventsAbortRef.current) {
      eventsAbortRef.current.abort();
    }
    const abortController = new AbortController();
    eventsAbortRef.current = abortController;

    const streamEvents = async () => {
      setIsSubscribingEvents(true);
      setEvents([]);

      const eventsUrl = buildEndpointUrl(profile.baseUrl, `/v1/runs/${encodeURIComponent(selectedRunId)}/events`);
      const headers: Record<string, string> = {
        Accept: 'text/event-stream',
      };
      if (profile.apiKey) {
        headers['Authorization'] = `Bearer ${profile.apiKey}`;
      }

      try {
        const response = await fetch(eventsUrl, {
          headers,
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`Events endpoint returned HTTP ${response.status}`);
        }

        if (!response.body) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let currentEvent = 'message';
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || line.startsWith(':')) continue;

            if (line.startsWith('event:')) {
              currentEvent = line.slice(6).trim();
              continue;
            }

            if (line.startsWith('data:')) {
              const dataStr = line.slice(5).trim();
              if (dataStr === '[DONE]') continue;

              let parsedData = null;
              try {
                parsedData = JSON.parse(dataStr);
              } catch {
                parsedData = dataStr;
              }

              const newEvent: AgentRunEvent = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                event: currentEvent,
                data: dataStr,
                parsedData,
                timestamp: Date.now(),
              };

              setEvents((prev) => [...prev, newEvent]);
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.debug('Run events stream ended or failed:', err);
        }
      } finally {
        setIsSubscribingEvents(false);
      }
    };

    streamEvents();

    return () => {
      if (eventsAbortRef.current) {
        eventsAbortRef.current.abort();
      }
    };
  }, [profile?.id, selectedRunId]);

  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  const handleCreateRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !taskPrompt.trim()) return;

    setIsCreating(true);
    setCreateError(null);
    try {
      const res = await createRun(profile, taskPrompt.trim());
      if (res.ok && res.run) {
        const newRunId = res.run.id || res.run.run_id;
        setShowCreateModal(false);
        setTaskPrompt('');
        await fetchRuns();
        if (newRunId) {
          setSelectedRunId(newRunId);
        }
      } else {
        setCreateError(res.error || 'Failed to start run');
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Error creating run');
    } finally {
      setIsCreating(false);
    }
  };

  const handleStopRun = async (runId: string) => {
    if (!profile) return;
    try {
      await stopRun(profile, runId);
      // Re-fetch details
      const res = await getRunDetails(profile, runId);
      if (res.ok && res.run) {
        setSelectedRunDetails(res.run);
      }
      fetchRuns();
    } catch (err) {
      console.error('Failed to stop run', err);
    }
  };

  if (!profile) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <PlayCircle className="w-12 h-12 text-[#586e75] mb-3" />
        <h2 className="text-base font-bold text-[#eee8d5] mb-1">{t.unconfigured}</h2>
        <p className="text-xs text-[#839496] mb-4">{t.quickConnectHint}</p>
        <button
          onClick={onNavigateSettings}
          className="px-4 py-2 rounded-xl bg-[#ff7b25] text-white text-xs font-semibold"
        >
          {t.configureNow}
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col h-[calc(100dvh-3.5rem-3.5rem)] bg-[#002b36]">
      {/* Top Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#002b36]/90 border-b border-[#073642] shrink-0">
        <div>
          <h1 className="text-sm font-bold text-[#eee8d5] flex items-center gap-2">
            <PlayCircle className="w-4 h-4 text-[#ff7b25]" />
            <span>{t.runsTitle}</span>
          </h1>
          <div className="text-[11px] text-[#586e75]">{t.runsSubtitle}</div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchRuns}
            disabled={loading}
            className="p-1.5 rounded-lg bg-[#073642] hover:bg-[#0e4a57] text-[#93a1a1] border border-[#073642] transition"
            title="Refresh Runs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#ff7b25]' : ''}`} />
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#ff7b25] hover:bg-[#e06818] text-white text-xs font-semibold shadow transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.newRun}</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Runs List (left or top on mobile) */}
        <div className="w-full md:w-80 border-b md:border-b-0 md:border-r border-[#073642] bg-[#00222a] overflow-y-auto max-h-48 md:max-h-full shrink-0 p-2 space-y-1">
          {loading && runs.length === 0 ? (
            <div className="p-4 text-center text-xs text-[#586e75]">{t.testing}</div>
          ) : error ? (
            <div className="p-3 text-xs text-rose-400 bg-rose-950/20 rounded-lg border border-rose-900/30">
              {error}
            </div>
          ) : runs.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#586e75]">{t.noRunsFound}</div>
          ) : (
            runs.map((run) => {
              const runId = run.id || run.run_id || '';
              const isSelected = runId === selectedRunId;
              const isRunning = run.status === 'running' || run.status === 'in_progress';
              return (
                <div
                  key={runId}
                  onClick={() => setSelectedRunId(runId)}
                  className={`p-2.5 rounded-xl cursor-pointer text-xs transition border ${
                    isSelected
                      ? 'bg-[#073642] border-[#2aa198]/50 text-[#eee8d5]'
                      : 'bg-[#002b36]/60 border-[#073642] text-[#93a1a1] hover:bg-[#073642]/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="font-mono font-bold text-xs truncate text-[#2aa198]" dir="ltr">
                      {runId}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                        isRunning
                          ? 'bg-amber-950/80 text-amber-300 border border-amber-600/40 animate-pulse'
                          : run.status === 'completed' || run.status === 'success'
                          ? 'bg-emerald-950/80 text-emerald-400'
                          : 'bg-[#001e26] text-[#586e75]'
                      }`}
                    >
                      {run.status || 'active'}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#839496] truncate">
                    {String(run.task || (run as Record<string, unknown>).prompt || 'Agent execution')}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Selected Run Details & Event Stream */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#001e26]">
          {selectedRunId ? (
            <>
              {/* Selected Run Header */}
              <div className="px-4 py-2.5 bg-[#00222a] border-b border-[#073642] flex items-center justify-between shrink-0">
                <div className="min-w-0">
                  <div className="text-xs font-mono font-bold text-[#eee8d5] truncate" dir="ltr">
                    {selectedRunId}
                  </div>
                  <div className="text-[11px] text-[#586e75]">
                    {selectedRunDetails?.status && (
                      <span className="capitalize mr-2">Status: {selectedRunDetails.status}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleStopRun(selectedRunId)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white text-xs border border-rose-500/40 transition"
                  >
                    <Square className="w-3 h-3" />
                    <span>{t.stopRun}</span>
                  </button>
                </div>
              </div>

              {/* Event Log Window */}
              <div className="flex-1 overflow-y-auto p-3 font-mono text-xs text-[#839496] space-y-2" dir="ltr">
                <div className="text-[11px] text-[#586e75] pb-2 border-b border-[#073642] flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-[#2aa198]" />
                    <span>{t.liveEvents}</span>
                  </span>
                  {isSubscribingEvents && (
                    <span className="text-[10px] text-amber-400 animate-pulse">Streaming events...</span>
                  )}
                </div>

                {events.length === 0 ? (
                  <div className="py-8 text-center text-[#586e75] text-xs">
                    {t.noEventsYet}
                  </div>
                ) : (
                  events.map((ev, idx) => (
                    <div key={ev.id || idx} className="p-2 rounded bg-[#00141a] border border-[#073642]/60 space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-[#586e75]">
                        <span className="text-[#2aa198] uppercase font-bold">{ev.event}</span>
                        <span>{new Date(ev.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <div className="text-[#eee8d5] whitespace-pre-wrap break-all text-[11px]">
                        {typeof ev.parsedData === 'object'
                          ? JSON.stringify(ev.parsedData, null, 2)
                          : ev.data}
                      </div>
                    </div>
                  ))
                )}
                <div ref={eventsEndRef} />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-[#586e75]">
              Select a run to view live events and status
            </div>
          )}
        </div>
      </div>

      {/* New Run Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-[#073642] border border-[#2aa198]/40 p-5 shadow-2xl text-[#eee8d5]">
            <h3 className="font-bold text-base mb-3 flex items-center gap-2">
              <PlayCircle className="w-5 h-5 text-[#ff7b25]" />
              <span>{t.newRun}</span>
            </h3>

            {createError && (
              <div className="mb-3 p-2.5 rounded-lg bg-rose-950/40 border border-rose-900 text-xs text-rose-300">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateRun} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#93a1a1] mb-1.5">
                  {t.taskPrompt}
                </label>
                <textarea
                  rows={4}
                  value={taskPrompt}
                  onChange={(e) => setTaskPrompt(e.target.value)}
                  placeholder={t.taskPromptPlaceholder}
                  className="w-full rounded-xl bg-[#002b36] border border-[#073642] p-3 text-xs text-[#eee8d5] focus:outline-none focus:border-[#2aa198]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl bg-[#002b36] hover:bg-[#073642] text-xs font-medium text-[#93a1a1]"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  disabled={!taskPrompt.trim() || isCreating}
                  className="px-5 py-2 rounded-xl bg-[#ff7b25] hover:bg-[#e06818] text-white text-xs font-semibold shadow flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isCreating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
                  <span>{t.startRun}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
