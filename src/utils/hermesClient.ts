/**
 * Hermes Agent API Client
 * Strictly follows official Hermes API Server documentation.
 *
 * Requirements:
 * 1. POST /v1/runs: sends {"input": "<text>"} + optional session_id/instructions. Never "task". Idempotency-Key header.
 *    Handles HTTP 429 with retry & backoff.
 * 2. GET /v1/runs removed. Statuses: running, stopping, waiting_for_approval, completed, failed, cancelled, interrupted.
 * 3. POST /v1/runs/{run_id}/approval for approval decisions.
 * 4. Unified SSE parser (parseSSEStream).
 * 5. Runs events stream with 30s inactivity timeout, reconnect, reconciliation via GET /v1/runs/{id}, UI error reporting.
 * 6. Heartbeat with 8000ms timeout, non-overlapping in-flight guard, fallback on any non-ok, no debug log spam.
 * 7. Clear distinction between "stopped by user" and "no data for 120 s".
 * 10. Streaming reasoning_content separated into collapsible thinking block.
 */

import {
  AgentRun,
  CapabilitiesResponse,
  ConnectionTestResult,
  DebugLogEntry,
  HermesModel,
  HermesRunStatus,
  HermesServerProfile,
  ModelsResponse,
  ScheduledJob,
  ToolProgressItem,
} from '../types/hermes';
import { appendDebugLog, normalizeBaseUrl } from './storage';
import { parseSSEStream } from './sseParser';

export interface ClassifiedError {
  type: 'mixed_content' | 'cors_or_unreachable' | 'auth_error' | 'http_error' | 'rate_limited' | 'timeout' | 'aborted' | 'unknown';
  message: string;
  statusCode?: number;
  fixSuggestion?: string;
}

export function classifyNetworkError(err: unknown, targetUrl: string, statusCode?: number): ClassifiedError {
  const isHttpsClient = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const isHttpTarget = targetUrl.startsWith('http://');

  if (isHttpsClient && isHttpTarget) {
    return {
      type: 'mixed_content',
      message: 'Blocked by browser security: Mixed Content (HTTPS page cannot make plain HTTP requests).',
      fixSuggestion:
        'Solution: Host Hermes behind an HTTPS reverse proxy (e.g. Caddy, Nginx, Cloudflare Tunnel, or Tailscale Funnel), or access this client from an HTTP environment.',
    };
  }

  if (statusCode === 429) {
    return {
      type: 'rate_limited',
      statusCode: 429,
      message: 'Too many concurrent runs (HTTP 429). The server is busy.',
      fixSuggestion: 'Wait for current agent runs to complete or retry with backoff.',
    };
  }

  if (statusCode === 401 || statusCode === 403) {
    return {
      type: 'auth_error',
      statusCode,
      message: `Authentication failed (HTTP ${statusCode}). The API_SERVER_KEY is missing or invalid.`,
      fixSuggestion: 'Check that API_SERVER_KEY matches the server configuration.',
    };
  }

  if (statusCode && statusCode >= 400) {
    return {
      type: 'http_error',
      statusCode,
      message: `Server returned error status HTTP ${statusCode}.`,
    };
  }

  if (err instanceof Error) {
    if (err.name === 'AbortError') {
      return {
        type: 'aborted',
        message: 'Request was cancelled by user or timed out.',
      };
    }

    if (err.message && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError'))) {
      return {
        type: 'cors_or_unreachable',
        message: 'Network request failed. This is typically caused by CORS restrictions or an unreachable host.',
        fixSuggestion:
          '1) Ensure Hermes API server is running. 2) Set API_SERVER_CORS_ORIGINS to include this client origin or "*" in Hermes environment.',
      };
    }

    return {
      type: 'unknown',
      message: err.message,
    };
  }

  return {
    type: 'unknown',
    message: 'Unknown network error',
  };
}

/**
 * Resolves API URL accurately without doubling /v1
 */
export function buildEndpointUrl(baseUrl: string, endpoint: string): string {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const baseWithoutV1 = normalizedBase.replace(/\/v1$/, '');

  if (endpoint.startsWith('/v1/')) {
    return `${baseWithoutV1}${endpoint}`;
  }
  if (endpoint.startsWith('/api/')) {
    return `${baseWithoutV1}${endpoint}`;
  }
  if (endpoint.startsWith('/health')) {
    return `${baseWithoutV1}${endpoint}`;
  }
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${normalizedBase}${cleanEndpoint}`;
}

/**
 * Creates an AbortSignal with a timeout (using AbortSignal.timeout if supported, with fallback)
 */
function createTimeoutSignal(timeoutMs: number, parentSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Timeout after ${timeoutMs}ms`));
  }, timeoutMs);

  const onParentAbort = () => {
    controller.abort(parentSignal?.reason);
  };

  if (parentSignal) {
    parentSignal.addEventListener('abort', onParentAbort);
  }

  const cleanup = () => {
    clearTimeout(timer);
    if (parentSignal) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  };

  return { signal: controller.signal, cleanup };
}

/**
 * Wrapper for fetch that records real latency and sanitizes headers for debug logging.
 * Option skipDebugLog prevents debug log spam (e.g. for periodic heartbeats).
 */
async function loggedFetch(
  profile: HermesServerProfile,
  endpoint: string,
  options: RequestInit & { skipDebugLog?: boolean } = {}
): Promise<{ response: Response; durationMs: number; fullUrl: string }> {
  const fullUrl = buildEndpointUrl(profile.baseUrl, endpoint);
  const headers = new Headers(options.headers || {});

  if (profile.apiKey && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${profile.apiKey}`);
  }

  const startTime = performance.now();
  const shouldLog = !options.skipDebugLog;

  let logEntry: DebugLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    method: options.method || 'GET',
    url: fullUrl,
    status: null,
    durationMs: 0,
    requestPreview: options.body ? (typeof options.body === 'string' ? options.body.slice(0, 500) : '[Body]') : undefined,
  };

  try {
    const response = await fetch(fullUrl, {
      ...options,
      headers,
    });
    const durationMs = Math.round(performance.now() - startTime);

    if (shouldLog) {
      logEntry.durationMs = durationMs;
      logEntry.status = response.status;

      if (!options.headers || !(options.headers as Record<string, string>)['Accept']?.includes('text/event-stream')) {
        response.clone().text().then((txt) => {
          logEntry.responsePreview = txt.slice(0, 1000);
          appendDebugLog(logEntry);
        }).catch(() => {
          appendDebugLog(logEntry);
        });
      } else {
        logEntry.responsePreview = '[EventStream]';
        appendDebugLog(logEntry);
      }
    }

    return { response, durationMs, fullUrl };
  } catch (err) {
    const durationMs = Math.round(performance.now() - startTime);
    if (shouldLog) {
      logEntry.durationMs = durationMs;
      logEntry.error = err instanceof Error ? err.message : String(err);
      appendDebugLog(logEntry);
    }
    throw err;
  }
}

type HealthResult = { ok: boolean; status: number; latencyMs: number; errorDetail?: string };

// One shared in-flight request per server, so concurrent callers (heartbeat,
// "Test connection", Refresh) never get a fake failure.
const healthInFlight = new Map<string, Promise<HealthResult>>();

async function probeHealthPath(
  profile: HermesServerProfile,
  path: '/health' | '/v1/health',
  parentSignal?: AbortSignal
): Promise<HealthResult> {
  const { signal, cleanup } = createTimeoutSignal(8000, parentSignal);
  try {
    const res = await loggedFetch(profile, path, { method: 'GET', signal, skipDebugLog: true });
    return {
      ok: res.response.ok,
      status: res.response.status,
      latencyMs: res.durationMs,
      errorDetail: res.response.ok ? undefined : `HTTP ${res.response.status}: ${res.response.statusText}`,
    };
  } finally {
    cleanup();
  }
}

/**
 * Health check:
 * - 8 s timeout per request
 * - concurrent callers share one in-flight request
 * - /v1/health fallback exactly once, on ANY failure of /health
 * - heartbeat requests are not written to the debug log
 */
export function checkHealth(
  profile: HermesServerProfile,
  parentSignal?: AbortSignal
): Promise<HealthResult> {
  const key = `${profile.id}|${profile.baseUrl}`;
  const existing = healthInFlight.get(key);
  if (existing) return existing;

  const run = (async (): Promise<HealthResult> => {
    const startedAt = performance.now();
    try {
      const primary = await probeHealthPath(profile, '/health', parentSignal);
      if (primary.ok) return primary;
    } catch {
      // network error or timeout: fall through to /v1/health
    }

    try {
      return await probeHealthPath(profile, '/v1/health', parentSignal);
    } catch (err) {
      const classified = classifyNetworkError(err, buildEndpointUrl(profile.baseUrl, '/v1/health'));
      return {
        ok: false,
        status: classified.statusCode || 0,
        latencyMs: Math.round(performance.now() - startedAt),
        errorDetail: classified.message,
      };
    }
  })().finally(() => {
    healthInFlight.delete(key);
  });

  healthInFlight.set(key, run);
  return run;
}

/**
 * /health is public, so a wrong API key still looks "connected".
 * GET /health/detailed requires the bearer key (HTTP 200 even when degraded):
 * 401/403 => bad key. 404 => older server, cannot tell, so do not claim failure.
 */
export async function checkAuth(
  profile: HermesServerProfile,
  parentSignal?: AbortSignal
): Promise<{ authOk: boolean; status: number; raw?: unknown; errorDetail?: string }> {
  const { signal, cleanup } = createTimeoutSignal(8000, parentSignal);
  try {
    const { response } = await loggedFetch(profile, '/health/detailed', {
      method: 'GET',
      signal,
      skipDebugLog: true,
    });
    if (response.status === 401 || response.status === 403) {
      return { authOk: false, status: response.status, errorDetail: 'API key rejected by server' };
    }
    if (response.status === 404) {
      return { authOk: true, status: 404, errorDetail: '/health/detailed not available on this server' };
    }
    if (!response.ok) {
      return { authOk: false, status: response.status, errorDetail: `HTTP ${response.status}` };
    }
    let raw: unknown;
    try { raw = await response.json(); } catch { raw = undefined; }
    return { authOk: true, status: response.status, raw };
  } catch (err) {
    const classified = classifyNetworkError(err, buildEndpointUrl(profile.baseUrl, '/health/detailed'));
    return { authOk: false, status: 0, errorDetail: classified.message };
  } finally {
    cleanup();
  }
}

/**
 * Step-by-step Connection Validator
 */
export async function testConnectionSteps(
  profile: HermesServerProfile,
  onStepUpdate: (results: ConnectionTestResult[]) => void,
  signal?: AbortSignal
): Promise<ConnectionTestResult[]> {
  const results: ConnectionTestResult[] = [
    { step: 'health', status: 'pending', message: 'Checking server health ping...' },
    { step: 'models', status: 'pending', message: 'Awaiting health pass...' },
    { step: 'capabilities', status: 'pending', message: 'Awaiting models pass...' },
  ];
  onStepUpdate([...results]);

  // Step 1: Health
  try {
    const healthRes = await checkHealth(profile, signal);
    if (healthRes.ok) {
      results[0] = {
        step: 'health',
        status: 'success',
        httpStatus: healthRes.status,
        latencyMs: healthRes.latencyMs,
        message: `Health ping verified (${healthRes.latencyMs}ms)`,
      };
    } else {
      results[0] = {
        step: 'health',
        status: 'failed',
        httpStatus: healthRes.status,
        latencyMs: healthRes.latencyMs,
        message: healthRes.errorDetail || 'Health ping failed',
      };
      results[1].status = 'skipped';
      results[2].status = 'skipped';
      onStepUpdate([...results]);
      return results;
    }
  } catch (err) {
    const classified = classifyNetworkError(err, buildEndpointUrl(profile.baseUrl, '/health'));
    results[0] = {
      step: 'health',
      status: 'failed',
      message: `${classified.message} ${classified.fixSuggestion || ''}`,
    };
    results[1].status = 'skipped';
    results[2].status = 'skipped';
    onStepUpdate([...results]);
    return results;
  }
  onStepUpdate([...results]);

  // Step 2: Models
  try {
    const { response, durationMs } = await loggedFetch(profile, '/v1/models', {
      method: 'GET',
      signal,
    });
    if (response.ok) {
      const data = await response.json();
      const modelCount = Array.isArray(data?.data) ? data.data.length : 0;
      results[1] = {
        step: 'models',
        status: 'success',
        httpStatus: response.status,
        latencyMs: durationMs,
        message: `Authenticated successfully. Found ${modelCount} model(s).`,
        raw: data,
      };
    } else {
      const errText = await response.text().catch(() => '');
      const classified = classifyNetworkError(null, buildEndpointUrl(profile.baseUrl, '/v1/models'), response.status);
      results[1] = {
        step: 'models',
        status: 'failed',
        httpStatus: response.status,
        latencyMs: durationMs,
        message: `${classified.message} ${classified.fixSuggestion || ''} ${errText ? `(${errText})` : ''}`,
      };
      results[2].status = 'skipped';
      onStepUpdate([...results]);
      return results;
    }
  } catch (err) {
    const classified = classifyNetworkError(err, buildEndpointUrl(profile.baseUrl, '/v1/models'));
    results[1] = {
      step: 'models',
      status: 'failed',
      message: `${classified.message} ${classified.fixSuggestion || ''}`,
    };
    results[2].status = 'skipped';
    onStepUpdate([...results]);
    return results;
  }
  onStepUpdate([...results]);

  // Step 3: Capabilities
  try {
    const { response, durationMs } = await loggedFetch(profile, '/v1/capabilities', {
      method: 'GET',
      signal,
    });
    if (response.ok) {
      const data = await response.json();
      results[2] = {
        step: 'capabilities',
        status: 'success',
        httpStatus: response.status,
        latencyMs: durationMs,
        message: 'Server capabilities reported successfully.',
        raw: data,
      };
    } else {
      results[2] = {
        step: 'capabilities',
        status: 'failed',
        httpStatus: response.status,
        latencyMs: durationMs,
        message: `HTTP ${response.status} from /v1/capabilities.`,
      };
    }
  } catch (err) {
    const classified = classifyNetworkError(err, buildEndpointUrl(profile.baseUrl, '/v1/capabilities'));
    results[2] = {
      step: 'capabilities',
      status: 'failed',
      message: `Failed to probe /v1/capabilities: ${classified.message}`,
    };
  }

  onStepUpdate([...results]);
  return results;
}

/**
 * GET /v1/models
 */
export async function getModels(
  profile: HermesServerProfile,
  signal?: AbortSignal
): Promise<{ ok: boolean; models: HermesModel[]; status: number; error?: string }> {
  try {
    const { response } = await loggedFetch(profile, '/v1/models', { method: 'GET', signal });
    if (!response.ok) {
      return { ok: false, models: [], status: response.status, error: `HTTP ${response.status}` };
    }
    const data: ModelsResponse = await response.json();
    return {
      ok: true,
      models: Array.isArray(data.data) ? data.data : [],
      status: response.status,
    };
  } catch (err) {
    const classified = classifyNetworkError(err, buildEndpointUrl(profile.baseUrl, '/v1/models'));
    return { ok: false, models: [], status: 0, error: classified.message };
  }
}

/**
 * GET /v1/capabilities
 */
export async function getCapabilities(
  profile: HermesServerProfile,
  signal?: AbortSignal
): Promise<{ ok: boolean; capabilities: CapabilitiesResponse | null; status: number; error?: string }> {
  try {
    const { response } = await loggedFetch(profile, '/v1/capabilities', { method: 'GET', signal });
    if (!response.ok) {
      return { ok: false, capabilities: null, status: response.status, error: `HTTP ${response.status}` };
    }
    const data = await response.json();
    return { ok: true, capabilities: data, status: response.status };
  } catch (err) {
    const classified = classifyNetworkError(err, buildEndpointUrl(profile.baseUrl, '/v1/capabilities'));
    return { ok: false, capabilities: null, status: 0, error: classified.message };
  }
}

/**
 * POST /v1/runs
 *
 * Requirements:
 * - sends {"input": "<text>"} plus optional session_id / instructions.
 * - NEVER sends "task".
 * - Adds an Idempotency-Key header (unique per user action, reused on retry).
 * - On HTTP 429: show "too many concurrent runs" and retry with backoff.
 */
export interface CreateRunParams {
  input: string;
  sessionId?: string;
  instructions?: string;
  idempotencyKey?: string;
}

export async function createRun(
  profile: HermesServerProfile,
  params: CreateRunParams,
  onRateLimitNotice?: (message: string) => void,
  signal?: AbortSignal
): Promise<{ ok: boolean; run: AgentRun | null; status: number; error?: string }> {
  const idempotencyKey = params.idempotencyKey || `run-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const bodyPayload: Record<string, unknown> = {
    input: params.input,
  };
  if (params.sessionId) {
    bodyPayload.session_id = params.sessionId;
  }
  if (params.instructions) {
    bodyPayload.instructions = params.instructions;
  }

  const maxAttempts = 3;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      const { response } = await loggedFetch(profile, '/v1/runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(bodyPayload),
        signal,
      });

      if (response.status === 429) {
        const backoffMs = attempt * 2500;
        if (onRateLimitNotice) {
          onRateLimitNotice(`Too many concurrent runs (HTTP 429). Retrying in ${backoffMs / 1000}s... (attempt ${attempt}/${maxAttempts})`);
        }
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        return {
          ok: false,
          run: null,
          status: 429,
          error: 'too many concurrent runs',
        };
      }

      if (!response.ok) {
        const errTxt = await response.text().catch(() => '');
        return { ok: false, run: null, status: response.status, error: `HTTP ${response.status}: ${errTxt}` };
      }

      const data = await response.json();
      return { ok: true, run: data, status: response.status };
    } catch (err) {
      if (attempt >= maxAttempts || (err instanceof Error && err.name === 'AbortError')) {
        const classified = classifyNetworkError(err, buildEndpointUrl(profile.baseUrl, '/v1/runs'));
        return { ok: false, run: null, status: 0, error: classified.message };
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  return { ok: false, run: null, status: 0, error: 'Failed to create run after retries' };
}

/**
 * GET /v1/runs/{id}
 */
export async function getRunDetails(
  profile: HermesServerProfile,
  runId: string,
  signal?: AbortSignal
): Promise<{ ok: boolean; run: AgentRun | null; status: number; error?: string }> {
  try {
    const { response } = await loggedFetch(profile, `/v1/runs/${encodeURIComponent(runId)}`, {
      method: 'GET',
      signal,
    });
    if (!response.ok) {
      return { ok: false, run: null, status: response.status, error: `HTTP ${response.status}` };
    }
    const data = await response.json();
    return { ok: true, run: data, status: response.status };
  } catch (err) {
    const classified = classifyNetworkError(err, buildEndpointUrl(profile.baseUrl, `/v1/runs/${runId}`));
    return { ok: false, run: null, status: 0, error: classified.message };
  }
}

/**
 * POST /v1/runs/{id}/stop
 */
export async function stopRun(
  profile: HermesServerProfile,
  runId: string
): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const { response } = await loggedFetch(profile, `/v1/runs/${encodeURIComponent(runId)}/stop`, {
      method: 'POST',
    });
    return { ok: response.ok, status: response.status };
  } catch (err) {
    const classified = classifyNetworkError(err, buildEndpointUrl(profile.baseUrl, `/v1/runs/${runId}/stop`));
    return { ok: false, status: 0, error: classified.message };
  }
}

/**
 * POST /v1/runs/{run_id}/approval
 * Sends the approval decision ("approved" or "declined") to resume or cancel execution.
 */
export async function approveRun(
  profile: HermesServerProfile,
  runId: string,
  decision: 'approved' | 'declined',
  extraPayload: Record<string, unknown> = {}
): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const body = {
      decision,
      ...extraPayload,
    };
    const { response } = await loggedFetch(profile, `/v1/runs/${encodeURIComponent(runId)}/approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errTxt = await response.text().catch(() => '');
      return { ok: false, status: response.status, error: `HTTP ${response.status}: ${errTxt}` };
    }
    return { ok: true, status: response.status };
  } catch (err) {
    const classified = classifyNetworkError(err, buildEndpointUrl(profile.baseUrl, `/v1/runs/${runId}/approval`));
    return { ok: false, status: 0, error: classified.message };
  }
}

/**
 * Stream Run Events (/v1/runs/{run_id}/events)
 *
 * Requirements:
 * - 30s inactivity timeout (server sends ": keepalive" every 10s)
 * - Automatic reconnect with backoff
 * - Reconcile via GET /v1/runs/{id} after any drop
 * - Surfaces errors in the UI (via onUIError callback)
 */
export interface StreamRunEventsOptions {
  profile: HermesServerProfile;
  runId: string;
  onEvent: (event: { event: string; data: string; parsedData?: unknown }) => void;
  onStatusReconciled: (run: AgentRun) => void;
  onUIError: (errorMsg: string) => void;
  signal?: AbortSignal;
}

export async function streamRunEvents({
  profile,
  runId,
  onEvent,
  onStatusReconciled,
  onUIError,
  signal,
}: StreamRunEventsOptions): Promise<void> {
  const eventsUrl = buildEndpointUrl(profile.baseUrl, `/v1/runs/${encodeURIComponent(runId)}/events`);
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;

  while (!signal?.aborted) {
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
    };
    if (profile.apiKey) {
      headers['Authorization'] = `Bearer ${profile.apiKey}`;
    }

    try {
      const response = await fetch(eventsUrl, {
        headers,
        signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${errText || response.statusText}`);
      }

      reconnectAttempts = 0; // successfully connected

      const parseResult = await parseSSEStream({
        response,
        inactivityTimeoutMs: 30_000, // 30s inactivity timeout per requirement 5
        signal,
        onEvent: (ev) => {
          let parsedData: unknown = undefined;
          try {
            parsedData = JSON.parse(ev.data);
          } catch {
            parsedData = ev.data;
          }
          onEvent({ event: ev.event, data: ev.data, parsedData });
        },
      });

      if (parseResult.interrupted) {
        if (parseResult.abortReason === 'user_abort') {
          return;
        }
        if (parseResult.abortReason === 'inactivity_timeout') {
          onUIError(`Stream disconnected: ${parseResult.errorMessage || 'no data for 30 s'}. Reconnecting...`);
        } else if (parseResult.errorMessage) {
          onUIError(`Stream interrupted: ${parseResult.errorMessage}. Reconnecting...`);
        }
      }

      // Always reconcile after the stream ends for any reason
      const recon = await getRunDetails(profile, runId);
      if (recon.ok && recon.run) {
        onStatusReconciled(recon.run);
        const termStatuses: HermesRunStatus[] = ['completed', 'failed', 'cancelled', 'interrupted'];
        if (termStatuses.includes(recon.run.status)) {
          return;
        }
        // Not terminal yet: the stream ended early, so reconnect after a short pause
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }

      // Could not reconcile (network down?): count it as a failed attempt
      reconnectAttempts++;
      if (reconnectAttempts > maxReconnectAttempts) {
        onUIError(`Max reconnect attempts reached (${maxReconnectAttempts}). Stopping stream listener.`);
        return;
      }
      await new Promise((r) => setTimeout(r, Math.min(30_000, 2000 * Math.pow(1.5, reconnectAttempts))));
    } catch (err) {
      if (signal?.aborted) return;

      reconnectAttempts++;
      const errMsg = err instanceof Error ? err.message : String(err);
      onUIError(`Connection error: ${errMsg}. Reconciling run status...`);

      // Reconcile via GET /v1/runs/{id}
      const recon = await getRunDetails(profile, runId);
      if (recon.ok && recon.run) {
        onStatusReconciled(recon.run);
        const termStatuses: HermesRunStatus[] = ['completed', 'failed', 'cancelled', 'interrupted'];
        if (termStatuses.includes(recon.run.status)) {
          return;
        }
      }

      if (reconnectAttempts > maxReconnectAttempts) {
        onUIError(`Max reconnect attempts reached (${maxReconnectAttempts}). Stopping stream listener.`);
        return;
      }

      const backoffMs = Math.min(30_000, 2000 * Math.pow(1.5, reconnectAttempts));
      onUIError(`Reconnecting in ${Math.round(backoffMs / 1000)}s... (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
}

/**
 * GET /api/jobs
 */
export async function getJobs(
  profile: HermesServerProfile,
  signal?: AbortSignal
): Promise<{ ok: boolean; jobs: ScheduledJob[]; status: number; error?: string }> {
  try {
    const { response } = await loggedFetch(profile, '/api/jobs', { method: 'GET', signal });
    if (!response.ok) {
      return { ok: false, jobs: [], status: response.status, error: `HTTP ${response.status}` };
    }
    const data = await response.json();
    const jobsList = Array.isArray(data) ? data : Array.isArray(data?.jobs) ? data.jobs : [];
    return { ok: true, jobs: jobsList, status: response.status };
  } catch (err) {
    const classified = classifyNetworkError(err, buildEndpointUrl(profile.baseUrl, '/api/jobs'));
    return { ok: false, jobs: [], status: 0, error: classified.message };
  }
}

/**
 * POST /v1/chat/completions (Reliable SSE Streaming using unified SSE Parser)
 *
 * Handles:
 * - Bearer Auth header
 * - Unified SSE parser
 * - choices[0].delta.content: appended to assistant text
 * - choices[0].delta.reasoning_content: accumulated separately as collapsible thinking
 * - hermes.tool.progress: captured as subtle tool indicator
 * - 120s inactivity timeout distinguishing "stopped by user" from "no data for 120 s"
 */
export interface StreamChatOptions {
  profile: HermesServerProfile;
  messages: Array<{ role: string; content: string }>;
  systemPromptLayer?: string;
  onChunk: (delta: string, fullText: string) => void;
  onReasoningChunk: (delta: string, fullReasoning: string) => void;
  onToolProgress: (progress: ToolProgressItem) => void;
  onTokenUsage?: (usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }) => void;
  signal?: AbortSignal;
}

export async function streamChatCompletions({
  profile,
  messages,
  systemPromptLayer,
  onChunk,
  onReasoningChunk,
  onToolProgress,
  onTokenUsage,
  signal,
}: StreamChatOptions): Promise<{
  fullText: string;
  fullReasoning: string;
  interrupted: boolean;
  abortReason?: 'user_abort' | 'inactivity_timeout' | 'error';
  errorMessage?: string;
}> {
  const fullMessages = [...messages];
  if (systemPromptLayer && systemPromptLayer.trim()) {
    fullMessages.unshift({
      role: 'system',
      content: systemPromptLayer.trim(),
    });
  }

  const model = profile.modelName?.trim() || 'hermes-agent';
  const fullUrl = buildEndpointUrl(profile.baseUrl, '/v1/chat/completions');

  let accumulatedText = '';
  let accumulatedReasoning = '';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (profile.apiKey) {
    headers['Authorization'] = `Bearer ${profile.apiKey}`;
  }

  const startTime = performance.now();
  let logEntry: DebugLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    method: 'POST',
    url: fullUrl,
    status: null,
    durationMs: 0,
    requestPreview: JSON.stringify({ model, messagesCount: fullMessages.length, stream: true }),
  };

  try {
    const response = await fetch(fullUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: fullMessages,
        stream: true,
      }),
      signal,
    });

    logEntry.status = response.status;

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      logEntry.durationMs = Math.round(performance.now() - startTime);
      logEntry.responsePreview = errText.slice(0, 1000);
      appendDebugLog(logEntry);

      const classified = classifyNetworkError(null, fullUrl, response.status);
      throw new Error(`${classified.message} ${errText ? `(${errText})` : ''}`);
    }

    const parseResult = await parseSSEStream({
      response,
      inactivityTimeoutMs: 120_000, // 120s inactivity timeout
      signal,
      onEvent: (ev) => {
        if (ev.data === '[DONE]') return;

        try {
          const parsed = JSON.parse(ev.data);

          // 1. Tool progress event
          if (ev.event === 'hermes.tool.progress' || parsed.event === 'hermes.tool.progress') {
            const toolInfo: ToolProgressItem = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              timestamp: Date.now(),
              message: parsed.message || parsed.tool_name || parsed.action || 'Executing tool...',
              raw: parsed,
            };
            onToolProgress(toolInfo);
            return;
          }

          // 2. Token usage
          if (parsed.usage && onTokenUsage) {
            onTokenUsage(parsed.usage);
          }

          // 3. Reasoning / thinking content (delta.reasoning_content or delta.thinking)
          const deltaReasoning =
            parsed.choices?.[0]?.delta?.reasoning_content ??
            parsed.choices?.[0]?.delta?.thinking;
          if (typeof deltaReasoning === 'string' && deltaReasoning.length > 0) {
            accumulatedReasoning += deltaReasoning;
            onReasoningChunk(deltaReasoning, accumulatedReasoning);
          }

          // 4. Standard assistant content delta
          const deltaContent = parsed.choices?.[0]?.delta?.content;
          if (typeof deltaContent === 'string' && deltaContent.length > 0) {
            accumulatedText += deltaContent;
            onChunk(deltaContent, accumulatedText);
          }
        } catch {
          // Ignore unparseable lines
        }
      },
    });

    logEntry.durationMs = Math.round(performance.now() - startTime);
    logEntry.responsePreview = `[Streaming Done: ${accumulatedText.length} chars content, ${accumulatedReasoning.length} chars reasoning]`;
    appendDebugLog(logEntry);

    return {
      fullText: accumulatedText,
      fullReasoning: accumulatedReasoning,
      interrupted: parseResult.interrupted,
      abortReason: parseResult.abortReason,
      errorMessage: parseResult.errorMessage,
    };
  } catch (err) {
    logEntry.durationMs = Math.round(performance.now() - startTime);
    logEntry.error = err instanceof Error ? err.message : String(err);
    appendDebugLog(logEntry);

    const isUserAbort = err instanceof Error && err.name === 'AbortError' && signal?.aborted;
    return {
      fullText: accumulatedText,
      fullReasoning: accumulatedReasoning,
      interrupted: true,
      abortReason: isUserAbort ? 'user_abort' : 'error',
      errorMessage: isUserAbort ? 'stopped by user' : err instanceof Error ? err.message : 'Streaming interrupted',
    };
  }
}
