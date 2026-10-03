/**
 * Hermes Agent Data & Protocol Types
 * Strictly aligned with official Hermes API Server documentation.
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
  features?: string[];
  capabilities?: Record<string, unknown>;
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
  reasoning?: string; // Collapsible reasoning_content separate from answer
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

/**
 * Valid Hermes Agent Run Statuses per official docs:
 * running, stopping, waiting_for_approval, completed, failed, cancelled, interrupted
 * (in_progress and success removed)
 */
export type HermesRunStatus =
  | 'running'
  | 'stopping'
  | 'waiting_for_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'unknown';

export interface ApprovalRequestData {
  tool_name?: string;
  action?: string;
  command?: string;
  arguments?: Record<string, unknown> | string;
  reason?: string;
  rawEvent?: unknown;
}

export interface AgentRun {
  id: string;
  run_id?: string;
  status: HermesRunStatus;
  input?: string;
  session_id?: string;
  instructions?: string;
  created_at?: string | number;
  started_at?: string | number;
  completed_at?: string | number;
  error?: string;
  result?: unknown;
  approval_request?: ApprovalRequestData;
  [key: string]: unknown;
}

export interface LocalAgentRunRecord {
  runId: string;
  profileId: string;
  input: string;
  sessionId?: string;
  instructions?: string;
  idempotencyKey: string;
  status: HermesRunStatus;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
  details?: AgentRun;
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
