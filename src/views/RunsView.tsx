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
  ShieldAlert,
  ThumbsUp,
  ThumbsDown,
  Trash2,
  Info,
} from 'lucide-react';
import {
  AgentRun,
  AgentRunEvent,
  ApprovalRequestData,
  HermesRunStatus,
  HermesServerProfile,
  LocalAgentRunRecord,
} from '../types/hermes';
import {
  approveRun,
  createRun,
  getRunDetails,
  stopRun,
  streamRunEvents,
} from '../utils/hermesClient';
import {
  idbDeleteLocalRun,
  idbGetLocalRuns,
  idbSaveLocalRun,
} from '../utils/storage';
import { translations } from '../i18n/translations';

interface RunsViewProps {
  profile: HermesServerProfile | null;
  language: 'en' | 'fa';
  onNavigateSettings: () => void;
}

export const RunsView: React.FC<RunsViewProps> = ({ profile, language, onNavigateSettings }) => {
  const t = translations[language];

  const [localRuns, setLocalRuns] = useState<LocalAgentRunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRunDetails, setSelectedRunDetails] = useState<AgentRun | null>(null);
  const [events, setEvents] = useState<AgentRunEvent[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);

  // New run modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [runInput, setRunInput] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [instructions, setInstructions] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createNotice, setCreateNotice] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  // Approval state
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequestData | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const eventsEndRef = useRef<HTMLDivElement | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const pollingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 1. Load local runs from IndexedDB
  const refreshLocalRuns = async () => {
    if (!profile) {
      setLocalRuns([]);
      return;
    }
    const list = await idbGetLocalRuns(profile.id);
    setLocalRuns(list);
    if (list.length > 0 && !selectedRunId) {
      setSelectedRunId(list[0].runId);
    }
  };

  useEffect(() => {
    refreshLocalRuns();
  }, [profile?.id]);

  // 2. Poll active runs (status is running, stopping, waiting_for_approval) via GET /v1/runs/{id}
  useEffect(() => {
    if (!profile || localRuns.length === 0) return;

    const pollActiveRuns = async () => {
      if (document.hidden) return;

      const activeList = localRuns.filter((r) =>
        ['running', 'stopping', 'waiting_for_approval', 'unknown'].includes(r.status)
      );

      for (const item of activeList) {
        try {
          const res = await getRunDetails(profile, item.runId);
          if (res.ok && res.run) {
            const updatedRecord: LocalAgentRunRecord = {
              ...item,
              status: res.run.status,
              updatedAt: Date.now(),
              details: res.run,
            };
            await idbSaveLocalRun(updatedRecord);
            if (item.runId === selectedRunId) {
              setSelectedRunDetails(res.run);
              if (res.run.status === 'waiting_for_approval' && res.run.approval_request) {
                setPendingApproval(res.run.approval_request);
              }
            }
          }
        } catch {
          // ignore transient poll error
        }
      }

      const refreshed = await idbGetLocalRuns(profile.id);
      setLocalRuns(refreshed);
    };

    if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    pollingTimerRef.current = setInterval(pollActiveRuns, 5000);

    return () => {
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    };
  }, [profile?.id, localRuns.length, selectedRunId]);

  // 3. Connect to Event Stream for selected run
  useEffect(() => {
    if (!profile || !selectedRunId) {
      setSelectedRunDetails(null);
      setEvents([]);
      setStreamError(null);
      setPendingApproval(null);
      return;
    }

    setStreamError(null);
    setEvents([]);
    setPendingApproval(null);

    // Initial fetch of run details
    getRunDetails(profile, selectedRunId).then((res) => {
      if (res.ok && res.run) {
        setSelectedRunDetails(res.run);
        if (res.run.status === 'waiting_for_approval' && res.run.approval_request) {
          setPendingApproval(res.run.approval_request);
        }
      }
    });

    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
    }
    const abortController = new AbortController();
    streamAbortRef.current = abortController;

    streamRunEvents({
      profile,
      runId: selectedRunId,
      signal: abortController.signal,
      onEvent: (ev) => {
        const newEvent: AgentRunEvent = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          event: ev.event,
          data: ev.data,
          parsedData: ev.parsedData,
          timestamp: Date.now(),
        };
        setEvents((prev) => [...prev, newEvent]);

        // Check for approval request event
        if (ev.event === 'approval.request' || (ev.parsedData as Record<string, unknown>)?.type === 'approval_request') {
          const reqData = ev.parsedData as ApprovalRequestData;
          setPendingApproval({
            ...reqData,
            rawEvent: ev.parsedData,
          });
        }
      },
      onStatusReconciled: (run) => {
        setSelectedRunDetails(run);
        if (run.status === 'waiting_for_approval' && run.approval_request) {
          setPendingApproval(run.approval_request);
        }
        // Update local run record in IndexedDB
        const target = localRuns.find((r) => r.runId === run.id || r.runId === run.run_id);
        if (target) {
          const updated: LocalAgentRunRecord = {
            ...target,
            status: run.status,
            updatedAt: Date.now(),
            details: run,
          };
          idbSaveLocalRun(updated).then(() => refreshLocalRuns());
        }
      },
      onUIError: (errMsg) => {
        setStreamError(errMsg);
      },
    });

    return () => {
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
      }
    };
  }, [profile?.id, selectedRunId]);

  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  // Handle run creation
  const handleCreateRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !runInput.trim()) return;

    setIsCreating(true);
    setCreateError(null);
    setCreateNotice(null);

    // Reuse idempotency key on retries
    const idempotencyKey = `hermes-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      const res = await createRun(
        profile,
        {
          input: runInput.trim(),
          sessionId: sessionId.trim() || undefined,
          instructions: instructions.trim() || undefined,
          idempotencyKey,
        },
        (notice) => setCreateNotice(notice)
      );

      if (res.ok && res.run) {
        const runId = res.run.id || res.run.run_id;
        if (!runId) throw new Error('Server returned run without ID');

        // Save local record into IndexedDB
        const newRecord: LocalAgentRunRecord = {
          runId,
          profileId: profile.id,
          input: runInput.trim(),
          sessionId: sessionId.trim() || undefined,
          instructions: instructions.trim() || undefined,
          idempotencyKey,
          status: res.run.status || 'running',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          details: res.run,
        };

        await idbSaveLocalRun(newRecord);
        await refreshLocalRuns();

        setShowCreateModal(false);
        setRunInput('');
        setSessionId('');
        setInstructions('');
        setSelectedRunId(runId);
      } else {
        setCreateError(res.error || 'Failed to create run');
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Error creating run');
    } finally {
      setIsCreating(false);
      setCreateNotice(null);
    }
  };

  const handleStopRun = async (runId: string) => {
    if (!profile) return;
    try {
      await stopRun(profile, runId);
      const res = await getRunDetails(profile, runId);
      if (res.ok && res.run) {
        setSelectedRunDetails(res.run);
      }
      await refreshLocalRuns();
    } catch (err) {
      console.error('Failed to stop run', err);
    }
  };

  const handleDeleteLocalRun = async (runId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Remove this run from local registry?')) return;
    await idbDeleteLocalRun(runId);
    if (selectedRunId === runId) {
      setSelectedRunId(null);
    }
    await refreshLocalRuns();
  };

  // Handle approval decision
  const handleApprovalDecision = async (decision: 'approved' | 'declined') => {
    if (!profile || !selectedRunId) return;

    setIsApproving(true);
    setApprovalError(null);

    try {
      const res = await approveRun(profile, selectedRunId, decision, {
        raw_event: pendingApproval?.rawEvent,
      });

      if (res.ok) {
        setPendingApproval(null);
        // Reconcile status
        const recon = await getRunDetails(profile, selectedRunId);
        if (recon.ok && recon.run) {
          setSelectedRunDetails(recon.run);
        }
        await refreshLocalRuns();
      } else {
        setApprovalError(res.error || `Failed to submit approval (${decision})`);
      }
    } catch (err) {
      setApprovalError(err instanceof Error ? err.message : 'Error sending approval');
    } finally {
      setIsApproving(false);
    }
  };

  const getStatusColor = (status: HermesRunStatus) => {
    switch (status) {
      case 'running':
        return 'bg-amber-950/80 text-amber-300 border border-amber-600/40 animate-pulse';
      case 'stopping':
        return 'bg-amber-950/80 text-amber-400 border border-amber-500/30';
      case 'waiting_for_approval':
        return 'bg-[#ff7b25]/20 text-[#ff7b25] border border-[#ff7b25]/60 animate-bounce';
      case 'completed':
        return 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/40';
      case 'failed':
        return 'bg-rose-950/80 text-rose-400 border border-rose-600/40';
      case 'cancelled':
        return 'bg-slate-900 text-slate-400 border border-slate-700';
      case 'interrupted':
        return 'bg-rose-950/60 text-rose-300 border border-rose-700/50';
      default:
        return 'bg-[#001e26] text-[#839496] border border-[#073642]';
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
            onClick={refreshLocalRuns}
            className="p-1.5 rounded-lg bg-[#073642] hover:bg-[#0e4a57] text-[#93a1a1] border border-[#073642] transition"
            title="Refresh Runs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
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
        {/* Local Runs List (left column or top drawer on mobile) */}
        <div className="w-full md:w-80 border-b md:border-b-0 md:border-r border-[#073642] bg-[#00222a] overflow-y-auto max-h-48 md:max-h-full shrink-0 p-2 space-y-1">
          {localRuns.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#586e75] space-y-2">
              <div>No agent runs recorded in local registry.</div>
              <div className="text-[10px]">Tap &quot;{t.newRun}&quot; to trigger an execution on Hermes.</div>
            </div>
          ) : (
            localRuns.map((r) => {
              const isSelected = r.runId === selectedRunId;
              return (
                <div
                  key={r.runId}
                  onClick={() => setSelectedRunId(r.runId)}
                  className={`p-2.5 rounded-xl cursor-pointer text-xs transition border relative group ${
                    isSelected
                      ? 'bg-[#073642] border-[#2aa198]/50 text-[#eee8d5]'
                      : 'bg-[#002b36]/60 border-[#073642] text-[#93a1a1] hover:bg-[#073642]/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="font-mono font-bold text-xs truncate text-[#2aa198]" dir="ltr">
                      {r.runId}
                    </span>
                    <div className="flex items-center gap-1">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${getStatusColor(r.status)}`}>
                        {r.status}
                      </span>
                      <button
                        onClick={(e) => handleDeleteLocalRun(r.runId, e)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-rose-400 text-[#586e75]"
                        title="Remove from list"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div className="text-[11px] text-[#839496] truncate">
                    {r.input || 'Agent task'}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Selected Run Details, Approval Card & Event Stream */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#001e26]">
          {selectedRunId ? (
            <>
              {/* Selected Run Header */}
              <div className="px-4 py-2.5 bg-[#00222a] border-b border-[#073642] flex items-center justify-between shrink-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-[#eee8d5] truncate" dir="ltr">
                      {selectedRunId}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold ${getStatusColor(selectedRunDetails?.status || 'running')}`}>
                      {selectedRunDetails?.status || 'running'}
                    </span>
                  </div>
                  <div className="text-[10px] text-[#586e75] truncate mt-0.5" dir="ltr">
                    {localRuns.find((r) => r.runId === selectedRunId)?.input}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {(selectedRunDetails?.status === 'running' || selectedRunDetails?.status === 'waiting_for_approval') && (
                    <button
                      onClick={() => handleStopRun(selectedRunId)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white text-xs border border-rose-500/40 transition"
                    >
                      <Square className="w-3 h-3" />
                      <span>{t.stopRun}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Stream Error Banner in UI per Requirement 5 */}
              {streamError && (
                <div className="p-2.5 bg-amber-950/80 border-b border-amber-600/40 text-amber-200 text-xs flex items-center justify-between px-4 shrink-0">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>{streamError}</span>
                  </div>
                  <button
                    onClick={() => setStreamError(null)}
                    className="text-[11px] underline text-amber-300 hover:text-white"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* APPROVAL UI per Requirement 3 */}
              {(selectedRunDetails?.status === 'waiting_for_approval' || pendingApproval) && (
                <div className="m-3 p-4 rounded-xl bg-gradient-to-r from-[#073642] to-[#00222a] border border-[#ff7b25] shadow-xl text-xs space-y-3 shrink-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[#ff7b25] font-bold">
                      <ShieldAlert className="w-5 h-5 animate-bounce" />
                      <span className="text-sm">Human Approval Required</span>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-[#ff7b25]/20 text-[#ff7b25] font-mono text-[10px] font-bold">
                      WAITING_FOR_APPROVAL
                    </span>
                  </div>

                  <p className="text-[#eee8d5] text-xs leading-relaxed">
                    Hermes Agent paused before executing a guarded tool or terminal action.
                  </p>

                  {/* Tool / command detail */}
                  {pendingApproval && (
                    <div className="p-3 rounded-lg bg-[#00141a] border border-[#073642] space-y-1.5 font-mono text-[11px] text-[#93a1a1]" dir="ltr">
                      {pendingApproval.tool_name && (
                        <div>
                          <span className="text-[#586e75]">Tool: </span>
                          <span className="text-[#2aa198] font-bold">{pendingApproval.tool_name}</span>
                        </div>
                      )}
                      {(pendingApproval.command || pendingApproval.action) && (
                        <div>
                          <span className="text-[#586e75]">Action: </span>
                          <span className="text-[#eee8d5]">{pendingApproval.command || pendingApproval.action}</span>
                        </div>
                      )}
                      {pendingApproval.arguments && (
                        <div>
                          <span className="text-[#586e75]">Arguments: </span>
                          <span className="text-[#2aa198] whitespace-pre-wrap break-all">
                            {typeof pendingApproval.arguments === 'object'
                              ? JSON.stringify(pendingApproval.arguments, null, 2)
                              : String(pendingApproval.arguments)}
                          </span>
                        </div>
                      )}
                      {Boolean(pendingApproval.rawEvent) && (
                        <details className="mt-2 text-[10px] text-[#586e75]">
                          <summary className="cursor-pointer hover:text-[#eee8d5]">Inspect Raw Event Payload</summary>
                          <pre className="mt-1 p-2 rounded bg-[#000d11] overflow-x-auto text-[#839496]">
                            {JSON.stringify(pendingApproval.rawEvent, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  )}

                  {approvalError && (
                    <div className="p-2 rounded bg-rose-950/60 border border-rose-800 text-rose-300 text-xs">
                      {approvalError}
                    </div>
                  )}

                  {/* Approve / Deny Actions */}
                  <div className="flex items-center gap-3 pt-1">
                    <button
                      onClick={() => handleApprovalDecision('approved')}
                      disabled={isApproving}
                      className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition disabled:opacity-50"
                    >
                      <ThumbsUp className="w-4 h-4" />
                      <span>{isApproving ? 'Submitting...' : 'Approve Execution'}</span>
                    </button>
                    <button
                      onClick={() => handleApprovalDecision('declined')}
                      disabled={isApproving}
                      className="flex-1 py-2.5 rounded-xl bg-rose-700 hover:bg-rose-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition disabled:opacity-50"
                    >
                      <ThumbsDown className="w-4 h-4" />
                      <span>{isApproving ? 'Submitting...' : 'Deny (Decline)'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Event Log Stream */}
              <div className="flex-1 overflow-y-auto p-3 font-mono text-xs text-[#839496] space-y-2" dir="ltr">
                <div className="text-[11px] text-[#586e75] pb-2 border-b border-[#073642] flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-[#2aa198]" />
                    <span>{t.liveEvents}</span>
                  </span>
                  <span className="text-[10px] text-[#586e75]">Keepalive: 30s timeout</span>
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
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-xs text-[#586e75]">
              <PlayCircle className="w-8 h-8 mb-2 text-[#073642]" />
              <span>Select a run from the left to view events, or tap &quot;{t.newRun}&quot;.</span>
            </div>
          )}
        </div>
      </div>

      {/* New Run Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-[#073642] border border-[#2aa198]/40 p-5 shadow-2xl text-[#eee8d5] space-y-4">
            <h3 className="font-bold text-base flex items-center gap-2">
              <PlayCircle className="w-5 h-5 text-[#ff7b25]" />
              <span>{t.newRun}</span>
            </h3>

            {createNotice && (
              <div className="p-2.5 rounded-lg bg-amber-950/60 border border-amber-600/40 text-xs text-amber-200">
                {createNotice}
              </div>
            )}

            {createError && (
              <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-900 text-xs text-rose-300">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateRun} className="space-y-3">
              {/* Input text (NEVER send 'task' per Requirement 1) */}
              <div>
                <label className="block text-xs font-semibold text-[#93a1a1] mb-1">
                  Input Prompt / Command <span className="text-[#ff7b25]">*</span>
                </label>
                <textarea
                  rows={3}
                  value={runInput}
                  onChange={(e) => setRunInput(e.target.value)}
                  placeholder="e.g. Inspect git history and generate changelog..."
                  required
                  className="w-full rounded-xl bg-[#002b36] border border-[#073642] p-2.5 text-xs text-[#eee8d5] focus:outline-none focus:border-[#2aa198]"
                />
              </div>

              {/* Optional Session ID */}
              <div>
                <label className="block text-xs font-semibold text-[#93a1a1] mb-1">
                  Session ID <span className="text-[10px] text-[#586e75]">(optional)</span>
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  placeholder="e.g. session-workspace-1"
                  className="w-full rounded-xl bg-[#002b36] border border-[#073642] p-2 text-xs font-mono text-[#eee8d5] focus:outline-none focus:border-[#2aa198]"
                />
              </div>

              {/* Optional Instructions */}
              <div>
                <label className="block text-xs font-semibold text-[#93a1a1] mb-1">
                  Instructions <span className="text-[10px] text-[#586e75]">(optional)</span>
                </label>
                <input
                  type="text"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="e.g. Run tests in silent mode and summarize errors"
                  className="w-full rounded-xl bg-[#002b36] border border-[#073642] p-2 text-xs text-[#eee8d5] focus:outline-none focus:border-[#2aa198]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#002b36]">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl bg-[#002b36] hover:bg-[#0e4a57] text-xs font-medium text-[#93a1a1]"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  disabled={!runInput.trim() || isCreating}
                  className="px-5 py-2 rounded-xl bg-[#ff7b25] hover:bg-[#e06818] text-white text-xs font-semibold shadow flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isCreating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
                  <span>{isCreating ? 'Executing...' : t.startRun}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
