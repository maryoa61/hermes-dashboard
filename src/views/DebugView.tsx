import React, { useState } from 'react';
import { Bug, Trash2, ChevronDown, ChevronUp, Copy, Check, Clock } from 'lucide-react';
import { DebugLogEntry } from '../types/hermes';
import { clearDebugLogs, loadDebugLogs } from '../utils/storage';
import { translations } from '../i18n/translations';

interface DebugViewProps {
  language: 'en' | 'fa';
}

export const DebugView: React.FC<DebugViewProps> = ({ language }) => {
  const t = translations[language];
  const [logs, setLogs] = useState<DebugLogEntry[]>(() => loadDebugLogs());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleClear = () => {
    clearDebugLogs();
    setLogs([]);
  };

  const handleCopyLog = async (log: DebugLogEntry) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(log, null, 2));
      setCopiedId(log.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore
    }
  };

  const refreshLogs = () => {
    setLogs(loadDebugLogs());
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 max-w-4xl mx-auto w-full pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm font-bold text-[#eee8d5] flex items-center gap-2">
            <Bug className="w-4 h-4 text-[#ff7b25]" />
            <span>{t.debugTitle}</span>
          </h1>
          <div className="text-[11px] text-[#586e75]">{t.debugSubtitle}</div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={refreshLogs}
            className="p-1.5 rounded-lg bg-[#073642] hover:bg-[#0e4a57] text-[#93a1a1] border border-[#073642] text-xs transition"
          >
            Refresh
          </button>
          <button
            onClick={handleClear}
            disabled={logs.length === 0}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#073642] hover:bg-rose-950 text-[#93a1a1] hover:text-rose-400 text-xs border border-[#073642] transition disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t.clearLogs}</span>
          </button>
        </div>
      </div>

      {/* Logs Table / List */}
      <div className="space-y-2">
        {logs.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#586e75] bg-[#00222a] rounded-xl border border-[#073642]">
            {t.noLogs}
          </div>
        ) : (
          logs.map((log) => {
            const isExpanded = expandedId === log.id;
            const isSuccess = log.status && log.status >= 200 && log.status < 300;
            const isError = log.status && log.status >= 400;

            return (
              <div
                key={log.id}
                className="rounded-xl bg-[#00222a] border border-[#073642] overflow-hidden text-xs font-mono transition"
                dir="ltr"
              >
                <div
                  onClick={() => setExpandedId(isExpanded ? null : log.id)}
                  className="p-3 flex items-center justify-between gap-2 cursor-pointer hover:bg-[#073642]/30 select-none"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                        log.method === 'POST'
                          ? 'bg-amber-950 text-amber-300 border border-amber-600/40'
                          : 'bg-[#002b36] text-[#2aa198] border border-[#2aa198]/30'
                      }`}
                    >
                      {log.method}
                    </span>

                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        isSuccess
                          ? 'bg-emerald-950 text-emerald-300'
                          : isError
                          ? 'bg-rose-950 text-rose-300'
                          : 'bg-[#001e26] text-[#839496]'
                      }`}
                    >
                      {log.status ?? 'ERR'}
                    </span>

                    <span className="truncate text-[#eee8d5] text-[11px] max-w-[140px] sm:max-w-md">
                      {log.url}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 text-[10px] text-[#586e75]">
                    <span className="flex items-center gap-0.5">
                      <Clock className="w-2.5 h-2.5" />
                      {log.durationMs}ms
                    </span>
                    <span>{new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}</span>
                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5 text-[#586e75]" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="p-3 bg-[#001820] border-t border-[#073642] space-y-2 text-[11px]">
                    <div className="flex items-center justify-between text-[#586e75]">
                      <span>Timestamp: {new Date(log.timestamp).toISOString()}</span>
                      <button
                        onClick={() => handleCopyLog(log)}
                        className="flex items-center gap-1 text-[#2aa198] hover:text-[#ff7b25]"
                      >
                        {copiedId === log.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedId === log.id ? 'Copied' : 'Copy Entry'}</span>
                      </button>
                    </div>

                    {log.error && (
                      <div className="p-2 rounded bg-rose-950/40 border border-rose-900 text-rose-300">
                        Error: {log.error}
                      </div>
                    )}

                    {log.requestPreview && (
                      <div>
                        <div className="text-[10px] text-[#586e75] uppercase font-bold mb-1">Request Payload</div>
                        <pre className="p-2 rounded bg-[#001015] border border-[#073642]/60 overflow-x-auto text-[#93a1a1] whitespace-pre-wrap break-all">
                          {log.requestPreview}
                        </pre>
                      </div>
                    )}

                    {log.responsePreview && (
                      <div>
                        <div className="text-[10px] text-[#586e75] uppercase font-bold mb-1">Response Body Preview</div>
                        <pre className="p-2 rounded bg-[#001015] border border-[#073642]/60 overflow-x-auto text-[#2aa198] whitespace-pre-wrap break-all max-h-48">
                          {log.responsePreview}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
