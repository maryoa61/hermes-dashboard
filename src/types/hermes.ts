/**
 * Hermes Agent Data & Protocol Types
 */

export interface HermesServerProfile {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  createdAt: number;
  updatedAt: number;
}

export type ConnectionState = 'connected' | 'reconnecting' | 'offline' | 'auth_error' | 'unconfigured' | 'error';

export interface HealthState {
  state: ConnectionState;
  lastChecked: number | null;
  latencyMs: number | null;
  errorDetail?: string;
  httpStatus?: number;
}

export interface HermesModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  [key: string]: unknown;
}

export interface ModelsResponse {
  data?: HermesModel[];
  object?: string;
  [key: string]: unknown;
}

export interface CapabilitiesResponse {
  [key: string]: unknown;
}

export interface ToolProgressItem {
  id: string;
  timestamp: number;
  message: string;
  raw?: unknown;
}

export interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: number;
  interrupted?: boolean;
  toolProgress?: ToolProgressItem[];
  tokens?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface Conversation {
  id: string;
  title: string;
  profileId: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface AgentRun {
  id: string;
  run_id?: string;
  status?: string;
  task?: string;
  created_at?: string | number;
  started_at?: string | number;
  completed_at?: string | number;
  error?: string;
  result?: unknown;
  [key: string]: unknown;
}

export interface AgentRunEvent {
  id: string;
  event: string;
  data: string;
  parsedData?: unknown;
  timestamp: number;
}

export interface ScheduledJob {
  id?: string;
  job_id?: string;
  name?: string;
  description?: string;
  schedule?: string;
  cron?: string;
  status?: string;
  next_run?: string | number;
  last_run?: string | number;
  [key: string]: unknown;
}

export interface DebugLogEntry {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  status: number | null;
  durationMs: number;
  requestPreview?: string;
  responsePreview?: string;
  error?: string;
}

export interface AppSettings {
  activeProfileId: string | null;
  language: 'en' | 'fa';
  fontSize: 'sm' | 'md' | 'lg';
  useResponsesApi: boolean;
  heartbeatIntervalSec: number;
  systemPromptAddition: string;
}

export interface ConnectionTestResult {
  step: 'health' | 'models' | 'capabilities';
  status: 'pending' | 'success' | 'failed' | 'skipped';
  httpStatus?: number;
  latencyMs?: number;
  message: string;
  raw?: unknown;
}
