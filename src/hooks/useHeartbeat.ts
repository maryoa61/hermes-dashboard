import { useEffect, useRef, useState } from 'react';
import { HealthState, HermesServerProfile } from '../types/hermes';
import { checkHealth } from '../utils/hermesClient';

export function useHeartbeat(
  profile: HermesServerProfile | null,
  baseIntervalSec: number = 20
) {
  const [healthState, setHealthState] = useState<HealthState>({
    state: profile ? 'reconnecting' : 'unconfigured',
    lastChecked: null,
    latencyMs: null,
  });

  const failureCountRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRunningRef = useRef(false);

  const performCheck = async () => {
    if (!profile) {
      setHealthState({
        state: 'unconfigured',
        lastChecked: null,
        latencyMs: null,
      });
      return;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setHealthState((prev) => ({
        ...prev,
        state: 'offline',
        errorDetail: 'Browser is offline',
      }));
      scheduleNext(baseIntervalSec);
      return;
    }

    if (document.hidden) {
      // Paused while hidden
      return;
    }

    try {
      const result = await checkHealth(profile);

      if (result.ok) {
        failureCountRef.current = 0;
        setHealthState({
          state: 'connected',
          lastChecked: Date.now(),
          latencyMs: result.latencyMs,
          httpStatus: result.status,
          errorDetail: undefined,
        });
        scheduleNext(baseIntervalSec);
      } else {
        failureCountRef.current += 1;
        const isAuth = result.status === 401 || result.status === 403;
        setHealthState((prev) => ({
          ...prev,
          state: isAuth ? 'auth_error' : 'reconnecting',
          latencyMs: result.latencyMs,
          httpStatus: result.status,
          errorDetail: result.errorDetail || `Status ${result.status}`,
        }));

        // Exponential backoff with jitter, capped at 60s
        const backoff = Math.min(
          60,
          baseIntervalSec * Math.pow(1.5, Math.min(failureCountRef.current, 4))
        );
        const jitter = (Math.random() * 3000) / 1000;
        scheduleNext(Math.round(backoff + jitter));
      }
    } catch (err) {
      failureCountRef.current += 1;
      setHealthState((prev) => ({
        ...prev,
        state: 'reconnecting',
        errorDetail: err instanceof Error ? err.message : 'Connection failed',
      }));
      const backoff = Math.min(60, baseIntervalSec * 2);
      scheduleNext(backoff);
    }
  };

  const scheduleNext = (seconds: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      performCheck();
    }, seconds * 1000);
  };

  useEffect(() => {
    failureCountRef.current = 0;
    if (!profile) {
      setHealthState({
        state: 'unconfigured',
        lastChecked: null,
        latencyMs: null,
      });
      return;
    }

    setHealthState((prev) => ({
      ...prev,
      state: 'reconnecting',
    }));

    // Immediate check on mount or profile change
    performCheck();

    // Listeners for visibility and online
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        performCheck();
      } else {
        if (timerRef.current) clearTimeout(timerRef.current);
      }
    };

    const handleOnline = () => {
      performCheck();
    };

    const handleOffline = () => {
      setHealthState((prev) => ({
        ...prev,
        state: 'offline',
        errorDetail: 'Browser went offline',
      }));
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [profile?.id, profile?.baseUrl, profile?.apiKey, baseIntervalSec]);

  return {
    healthState,
    refreshHealth: performCheck,
  };
}
