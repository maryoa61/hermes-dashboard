/**
 * Unified, specification-compliant Server-Sent Events (SSE) Parser
 * Shared by both Chat completions (/v1/chat/completions) and Runs event stream (/v1/runs/{id}/events).
 *
 * Rules:
 * - Keeps event name and data buffer outside the read loop
 * - Dispatches on blank line
 * - Resets event name after dispatch
 * - Supports multi-line data
 * - Skips ":" comments (e.g. ": keepalive")
 * - Flushes final buffer on stream completion
 * - Handles CRLF (\r\n) cleanly
 * - Inactivity timeout with explicit differentiation between user abort and inactivity drop
 */

export interface ParsedSSEEvent {
  event: string;
  data: string;
}

export interface ParseSSEStreamOptions {
  response: Response;
  inactivityTimeoutMs?: number; // e.g. 120_000 for chat, 30_000 for runs
  onEvent: (event: ParsedSSEEvent) => void;
  signal?: AbortSignal;
}

export interface SSEStreamResult {
  completedNormally: boolean;
  interrupted: boolean;
  abortReason?: 'user_abort' | 'inactivity_timeout' | 'error';
  errorMessage?: string;
}

export async function parseSSEStream({
  response,
  inactivityTimeoutMs,
  onEvent,
  signal,
}: ParseSSEStreamOptions): Promise<SSEStreamResult> {
  if (!response.body) {
    throw new Error('Response body is null, cannot parse SSE');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');

  // State kept strictly outside the read loop
  let eventName = 'message';
  let dataLines: string[] = [];
  let lineBuffer = '';

  let isTimedOut = false;
  let isUserAborted = false;
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  const internalAbortController = new AbortController();

  const resetInactivityTimer = () => {
    if (!inactivityTimeoutMs || inactivityTimeoutMs <= 0) return;
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      isTimedOut = true;
      internalAbortController.abort();
    }, inactivityTimeoutMs);
  };

  const onExternalAbort = () => {
    isUserAborted = true;
    internalAbortController.abort();
  };

  if (signal) {
    if (signal.aborted) {
      return {
        completedNormally: false,
        interrupted: true,
        abortReason: 'user_abort',
        errorMessage: 'stopped by user',
      };
    }
    signal.addEventListener('abort', onExternalAbort);
  }

  resetInactivityTimer();

  const dispatchEvent = () => {
    if (dataLines.length > 0) {
      const fullData = dataLines.join('\n');
      onEvent({ event: eventName, data: fullData });
      dataLines = [];
    }
    // Event name is always reset after dispatch per SSE spec
    eventName = 'message';
  };

  const processLine = (rawLine: string) => {
    // Trim trailing carriage return if any (CRLF)
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    // 1. Skip comment lines (e.g. ": keepalive" or ": ping")
    if (line.startsWith(':')) {
      return;
    }

    // 2. Blank line indicates end of current event block
    if (line === '') {
      dispatchEvent();
      return;
    }

    // 3. Event type field
    if (line.startsWith('event:')) {
      const val = line.slice(6);
      eventName = val.startsWith(' ') ? val.slice(1) : val;
      return;
    }

    // 4. Data line field (supports multi-line by appending to dataLines array)
    if (line.startsWith('data:')) {
      const val = line.slice(5);
      const dataContent = val.startsWith(' ') ? val.slice(1) : val;
      dataLines.push(dataContent);
      return;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();

      // Whenever any chunk arrives (including comments), reset the inactivity timer
      resetInactivityTimer();

      if (done) break;

      lineBuffer += decoder.decode(value, { stream: true });

      // Split on newline (\n)
      const lines = lineBuffer.split('\n');
      // The last element is the remaining partial line
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        processLine(line);
      }
    }

    // Flush any leftover in lineBuffer
    if (lineBuffer.length > 0) {
      processLine(lineBuffer);
      lineBuffer = '';
    }

    // Flush any final buffered event
    dispatchEvent();

    if (inactivityTimer) clearTimeout(inactivityTimer);

    return {
      completedNormally: true,
      interrupted: false,
    };
  } catch (err) {
    if (inactivityTimer) clearTimeout(inactivityTimer);

    const isAbort =
      (err instanceof Error && err.name === 'AbortError') ||
      isTimedOut ||
      isUserAborted;

    if (isTimedOut) {
      const seconds = Math.round((inactivityTimeoutMs || 0) / 1000);
      return {
        completedNormally: false,
        interrupted: true,
        abortReason: 'inactivity_timeout',
        errorMessage: `no data for ${seconds} s`,
      };
    }

    if (isUserAborted || isAbort) {
      return {
        completedNormally: false,
        interrupted: true,
        abortReason: 'user_abort',
        errorMessage: 'stopped by user',
      };
    }

    return {
      completedNormally: false,
      interrupted: true,
      abortReason: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    if (signal) {
      signal.removeEventListener('abort', onExternalAbort);
    }
  }
}
