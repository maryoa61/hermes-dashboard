/**
 * Real Hermes Agent API Client
 * Adheres strictly to the Hermes API Contract:
 * - GET /health & GET /v1/health
 * - GET /v1/models
 * - GET /v1/capabilities
 * - POST /v1/chat/completions (SSE stream, choices[0].delta.content, hermes.tool.progress)
 * - POST /v1/responses, GET/DELETE /v1/responses/{id}
 * - POST /v1/runs, GET /v1/runs/{run_id}, GET /v1/runs/{run_id}/events, POST /v1/runs/{run_id}/stop
 * - GET/POST /api/jobs
 *
 * NO fake data or simulated timeouts.
 */

import {
  AgentRun,
  CapabilitiesResponse,
  ChatMessage,
  ConnectionTestResult,
  DebugLogEntry,
  HermesModel,
  HermesServerProfile,
  ModelsResponse,
  ScheduledJob,
  ToolProgressItem,
} from '../types/hermes';
import { appendDebugLog, normalizeBaseUrl } from './storage';

export interface ClassifiedError {
  type: 'mixed_content' | 'cors_or_unreachable' | 'auth_error' | 'http_error' | 'timeout' | 'aborted' | 'unknown';
  message: string;
  statusCode?: number;
  fixSuggestion?: string;
}

export function classifyNetworkError(err: unknown, targetUrl: string, statusCode?: number): ClassifiedError {
  const isHttpsClient = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const isHttpTarget = targetUrl.startsWith('http://');
  const isLocalHost = targetUrl.includes('localhost') || targetUrl.includes('127.0.0.1');

  if (isHttpsClient && isHttpTarget) {
    return {
      type: 'mixed_content',
      message: 'Blocked by browser security: Mixed Content (HTTPS page cannot make plain HTTP requests).',
      fixSuggestion:
        'Solution: Host Hermes behind an HTTPS reverse proxy (e.g. Caddy, Nginx, Cloudflare Tunnel, or Tailscale Funnel), or access this client from an HTTP environment.',
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
  // Default fallback
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${normalizedBase}${cleanEndpoint}`;
}

/**
 * Wrapper for fetch that records real latency and sanitizes headers for debug logging
 */
async function loggedFetch(
  profile: HermesServerProfile,
  endpoint: string,
  options: RequestInit = {}
): Promise<{ response: Response; durationMs: number; fullUrl: string }> {
  const fullUrl = buildEndpointUrl(profile.baseUrl, endpoint);
  const headers = new Headers(options.headers || {});

  if (profile.apiKey && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${profile.apiKey}`);
  }

  const startTime = performance.now();
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
    logEntry.durationMs = durationMs;
    logEntry.status = response.status;
    
    // We clone response preview if possible for non-streaming calls
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

    return { response, durationMs, fullUrl };
  } catch (err) {
    const durationMs = Math.round(performance.now() - startTime);
    logEntry.durationMs = durationMs;
    logEntry.error = err instanceof Error ? err.message : String(err);
    appendDebugLog(logEntry);
    throw err;
  }
}

/**
 * Health check: GET /health or GET /v1/health
 */
export async function checkHealth(
  profile: HermesServerProfile,
  signal?: AbortSignal
): Promise<{ ok: boolean; status: number; latencyMs: number; errorDetail?: string }> {
  const startTime = performance.now();
  try {
    const { response, durationMs } = await loggedFetch(profile, '/health', {
      method: 'GET',
      signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: durationMs,
      errorDetail: response.ok ? undefined : `HTTP ${response.status}: ${response.statusText}`,
    };
  } catch (err) {
    // If /health failed, fallback to /v1/health per contract
    try {
      const { response, durationMs } = await loggedFetch(profile, '/v1/health', {
        method: 'GET',
        signal,
      });
      return {
        ok: response.ok,
        status: response.status,
        latencyMs: durationMs,
        errorDetail: response.ok ? undefined : `HTTP ${response.status}: ${response.statusText}`,
      };
    } catch (secondErr) {
      const durationMs = Math.round(performance.now() - startTime);
      const classified = classifyNetworkError(secondErr, buildEndpointUrl(profile.baseUrl, '/health'));
      return {
        ok: false,
        status: classified.statusCode || 0,
        latencyMs: durationMs,
        errorDetail: classified.message,
      };
    }
  }
}

/**
 * Step-by-step Connection Validator
 * Runs: 1. GET /health -> 2. GET /v1/models -> 3. GET /v1/capabilities
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

  // Check 1: Health
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

  // Check 2: Models (verifies API key and model list)
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

  // Check 3: Capabilities Probe
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
        message: `HTTP ${response.status} from /v1/capabilities (Optional endpoint or disabled).`,
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
 * GET /v1/runs
 */
export async function getRuns(
  profile: HermesServerProfile,
  signal?: AbortSignal
): Promise<{ ok: boolean; runs: AgentRun[]; status: number; error?: string }> {
  try {
    const { response } = await loggedFetch(profile, '/v1/runs', { method: 'GET', signal });
    if (!response.ok) {
      return { ok: false, runs: [], status: response.status, error: `HTTP ${response.status}` };
    }
    const data = await response.json();
    const runsList = Array.isArray(data) ? data : Array.isArray(data?.runs) ? data.runs : Array.isArray(data?.data) ? data.data : [];
    return { ok: true, runs: runsList, status: response.status };
  } catch (err) {
    const classified = classifyNetworkError(err, buildEndpointUrl(profile.baseUrl, '/v1/runs'));
    return { ok: false, runs: [], status: 0, error: classified.message };
  }
}

/**
 * POST /v1/runs
 */
export async function createRun(
  profile: HermesServerProfile,
  taskPrompt: string,
  extraParams: Record<string, unknown> = {},
  signal?: AbortSignal
): Promise<{ ok: boolean; run: AgentRun | null; status: number; error?: string }> {
  try {
    const { response } = await loggedFetch(profile, '/v1/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: taskPrompt,
        ...extraParams,
      }),
      signal,
    });
    if (!response.ok) {
      const errTxt = await response.text().catch(() => '');
      return { ok: false, run: null, status: response.status, error: `HTTP ${response.status}: ${errTxt}` };
    }
    const data = await response.json();
    return { ok: true, run: data, status: response.status };
  } catch (err) {
    const classified = classifyNetworkError(err, buildEndpointUrl(profile.baseUrl, '/v1/runs'));
    return { ok: false, run: null, status: 0, error: classified.message };
  }
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
 * POST /api/jobs
 */
export async function createJob(
  profile: HermesServerProfile,
  jobData: Record<string, unknown>
): Promise<{ ok: boolean; job: ScheduledJob | null; status: number; error?: string }> {
  try {
    const { response } = await loggedFetch(profile, '/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(jobData),
    });
    if (!response.ok) {
      const errTxt = await response.text().catch(() => '');
      return { ok: false, job: null, status: response.status, error: `HTTP ${response.status}: ${errTxt}` };
    }
    const data = await response.json();
    return { ok: true, job: data, status: response.status };
  } catch (err) {
    const classified = classifyNetworkError(err, buildEndpointUrl(profile.baseUrl, '/api/jobs'));
    return { ok: false, job: null, status: 0, error: classified.message };
  }
}

/**
 * POST /v1/chat/completions (Reliable SSE Streaming with fetch + ReadableStream)
 *
 * Handles:
 * - Bearer Auth header
 * - Chunk boundary splitting
 * - Event "hermes.tool.progress": parsed and delegated to onToolProgress (NOT mixed with assistant text)
 * - choices[0].delta.content: appended to assistant text
 * - [DONE] termination
 * - Inactivity timeout (120s inactivity timer that resets whenever data arrives)
 * - AbortController for instant Stop
 */
export interface StreamChatOptions {
  profile: HermesServerProfile;
  messages: Array<{ role: string; content: string }>;
  systemPromptLayer?: string;
  onChunk: (delta: string, fullText: string) => void;
  onToolProgress: (progress: ToolProgressItem) => void;
  onTokenUsage?: (usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }) => void;
  signal?: AbortSignal;
}

export async function streamChatCompletions({
  profile,
  messages,
  systemPromptLayer,
  onChunk,
  onToolProgress,
  onTokenUsage,
  signal,
}: StreamChatOptions): Promise<{ fullText: string; interrupted: boolean; error?: string }> {
  const fullMessages = [...messages];
  if (systemPromptLayer && systemPromptLayer.trim()) {
    // Client system message layered on top per Hermes contract
    fullMessages.unshift({
      role: 'system',
      content: systemPromptLayer.trim(),
    });
  }

  const model = profile.modelName?.trim() || 'hermes-agent';
  const fullUrl = buildEndpointUrl(profile.baseUrl, '/v1/chat/completions');

  let accumulatedText = '';
  let interrupted = false;
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  const INACTIVITY_TIMEOUT_MS = 120_000; // 2 minutes without ANY chunk

  const resetInactivityTimer = (abortFn: () => void) => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      console.warn('Hermes streaming inactivity timeout reached');
      abortFn();
    }, INACTIVITY_TIMEOUT_MS);
  };

  const internalAbortController = new AbortController();
  const combinedSignal = signal;

  const onUserAbort = () => {
    internalAbortController.abort();
  };
  if (combinedSignal) {
    combinedSignal.addEventListener('abort', onUserAbort);
  }

  resetInactivityTimer(() => internalAbortController.abort());

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
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
      signal: internalAbortController.signal,
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

    if (!response.body) {
      throw new Error('Response body is null, cannot stream SSE');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      resetInactivityTimer(() => internalAbortController.abort());

      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE lines split on double newline or newline
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let currentEvent = 'message';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith(':')) {
          continue; // comment or empty heartbeat
        }

        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim();
          continue;
        }

        if (line.startsWith('data:')) {
          const dataStr = line.slice(5).trim();

          if (dataStr === '[DONE]') {
            currentEvent = 'message';
            continue;
          }

          try {
            const parsed = JSON.parse(dataStr);

            // 1. Check for custom tool progress event
            if (currentEvent === 'hermes.tool.progress' || parsed.event === 'hermes.tool.progress') {
              const toolInfo: ToolProgressItem = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                timestamp: Date.now(),
                message: parsed.message || parsed.tool_name || parsed.action || 'Executing tool...',
                raw: parsed,
              };
              onToolProgress(toolInfo);
              continue;
            }

            // 2. Check for token usage if present
            if (parsed.usage && onTokenUsage) {
              onTokenUsage(parsed.usage);
            }

            // 3. Standard OpenAI choices[0].delta.content
            const deltaContent = parsed.choices?.[0]?.delta?.content;
            if (typeof deltaContent === 'string' && deltaContent.length > 0) {
              accumulatedText += deltaContent;
              onChunk(deltaContent, accumulatedText);
            }
          } catch {
            // Partial JSON or custom text data line
          }
        }
      }
    }

    if (inactivityTimer) clearTimeout(inactivityTimer);
    logEntry.durationMs = Math.round(performance.now() - startTime);
    logEntry.responsePreview = `[Streaming Complete, ${accumulatedText.length} chars]`;
    appendDebugLog(logEntry);

    return { fullText: accumulatedText, interrupted: false };
  } catch (err) {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    interrupted = true;
    logEntry.durationMs = Math.round(performance.now() - startTime);
    logEntry.error = err instanceof Error ? err.message : String(err);
    appendDebugLog(logEntry);

    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      fullText: accumulatedText,
      interrupted: true,
      error: isAbort ? 'Stream stopped by user' : err instanceof Error ? err.message : 'Streaming interrupted',
    };
  } finally {
    if (combinedSignal) {
      combinedSignal.removeEventListener('abort', onUserAbort);
    }
  }
}
