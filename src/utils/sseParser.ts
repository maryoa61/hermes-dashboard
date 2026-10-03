/**
 * Unified SSE parser (chat completions + run events).
 *
 * Fixes vs. previous version:
 *  - Inactivity timeout and user abort now actually interrupt a pending
 *    reader.read() by calling reader.cancel(). Before, the internal
 *    AbortController was not connected to anything, so a half-open mobile
 *    connection could hang forever.
 *  - cancel() makes read() resolve with done:true (it does not throw), so the
 *    abort flags are checked right after the loop.
 *  - Timeout and user abort are reported distinctly.
 *  - Partial multi-byte characters across chunks are handled by the streaming
 *    TextDecoder; a final decoder flush is done at the end.
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

  if (signal?.aborted) {
    try { await response.body.cancel(); } catch { /* ignore */ }
    return {
      completedNormally: false,
      interrupted: true,
      abortReason: 'user_abort',
      errorMessage: 'stopped by user',
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');

  // SSE state lives outside the read loop
  let eventName = 'message';
  let dataLines: string[] = [];
  let lineBuffer = '';

  let isTimedOut = false;
  let isUserAborted = false;
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelReader = () => {
    // Resolves a pending read() with { done: true } and closes the connection.
    reader.cancel().catch(() => { /* already closed */ });
  };

  const clearTimer = () => {
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
  };

  const resetInactivityTimer = () => {
    if (!inactivityTimeoutMs || inactivityTimeoutMs <= 0) return;
    clearTimer();
    inactivityTimer = setTimeout(() => {
      isTimedOut = true;
      cancelReader();
    }, inactivityTimeoutMs);
  };

  const onExternalAbort = () => {
    isUserAborted = true;
    clearTimer();
    cancelReader();
  };
  signal?.addEventListener('abort', onExternalAbort);

  const dispatchEvent = () => {
    if (dataLines.length > 0) {
      const fullData = dataLines.join('\n');
      dataLines = [];
      const name = eventName;
      eventName = 'message';
      onEvent({ event: name, data: fullData });
    } else {
      eventName = 'message';
    }
  };

  const processLine = (rawLine: string) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    if (line === '') {            // blank line = end of event
      dispatchEvent();
      return;
    }
    if (line.startsWith(':')) {   // comment, e.g. ": keepalive"
      return;
    }

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') {
      eventName = value;
    } else if (field === 'data') {
      dataLines.push(value);
    }
    // 'id' and 'retry' fields are intentionally ignored
  };

  const buildAbortResult = (): SSEStreamResult | null => {
    if (isUserAborted) {
      return {
        completedNormally: false,
        interrupted: true,
        abortReason: 'user_abort',
        errorMessage: 'stopped by user',
      };
    }
    if (isTimedOut) {
      const seconds = Math.round((inactivityTimeoutMs || 0) / 1000);
      return {
        completedNormally: false,
        interrupted: true,
        abortReason: 'inactivity_timeout',
        errorMessage: `no data for ${seconds} s`,
      };
    }
    return null;
  };

  try {
    resetInactivityTimer();

    while (true) {
      const { done, value } = await reader.read();

      // After cancel(), read() resolves with done:true. Check flags first.
      const aborted = buildAbortResult();
      if (aborted) return aborted;

      if (done) break;

      // Any bytes (including ": keepalive" comments) prove the link is alive.
      resetInactivityTimer();

      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) processLine(line);
    }

    // Normal end of stream: flush decoder, last partial line, last event
    lineBuffer += decoder.decode();
    if (lineBuffer.length > 0) {
      processLine(lineBuffer);
      lineBuffer = '';
    }
    dispatchEvent();

    return { completedNormally: true, interrupted: false };
  } catch (err) {
    const aborted = buildAbortResult();
    if (aborted) return aborted;

    if (err instanceof Error && err.name === 'AbortError') {
      // Abort came from the fetch signal itself
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
    clearTimer();
    signal?.removeEventListener('abort', onExternalAbort);
  }
}
