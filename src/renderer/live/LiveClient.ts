/**
 * Arsist Engine — ライブ配置モード WebSocket クライアント
 *
 * 実機で動いているアプリの ArsistWebSocketServer に接続する。
 * Electron のレンダラは Chromium なので、追加パッケージ無しで
 * ブラウザ標準の WebSocket がそのまま使える（main プロセス経由は不要）。
 *
 * プロトコル (ArsistWebSocketServer.ProcessCommand):
 *   送信: { type, method, authToken?, requestId?, parameters: {...} }
 *   受信: { requestId, success, data?, error? }
 *
 * requestId を付けたコマンドだけ応答が返る。付けない場合は投げっぱなし
 * （毎フレーム流すドラッグ操作はこちらを使い、往復待ちで詰まらせない）。
 */

export interface LiveCommandParams {
  [key: string]: unknown;
}

interface PendingRequest {
  resolve: (data: any) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export type LiveConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface LiveClientOptions {
  host: string;
  port: number;
  password?: string;
  onStateChange?: (state: LiveConnectionState, detail?: string) => void;
  /** 応答待ちのタイムアウト(ms) */
  requestTimeoutMs?: number;
}

export class LiveClient {
  private ws: WebSocket | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private requestCounter = 0;
  private closedByUser = false;

  constructor(private readonly options: LiveClientOptions) {}

  get url(): string {
    return `ws://${this.options.host}:${this.options.port}`;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): Promise<void> {
    this.closedByUser = false;
    this.options.onStateChange?.('connecting');

    return new Promise((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        this.options.onStateChange?.('error', String(e));
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      this.ws = ws;

      ws.onopen = () => {
        settled = true;
        this.options.onStateChange?.('connected');
        resolve();
      };

      ws.onmessage = (event) => this.handleMessage(event);

      ws.onerror = () => {
        // WebSocket の error イベントは詳細を持たない（仕様上、意図的に伏せられる）。
        // 原因は onclose の code / 接続不能かで推測するしかないので、ここでは状態だけ更新する。
        this.options.onStateChange?.('error', 'connection error');
        if (!settled) {
          settled = true;
          reject(new Error(`Failed to connect to ${this.url}`));
        }
      };

      ws.onclose = () => {
        this.failAllPending(new Error('connection closed'));
        this.ws = null;
        this.options.onStateChange?.(this.closedByUser ? 'disconnected' : 'error', 'closed');
      };
    });
  }

  disconnect(): void {
    this.closedByUser = true;
    this.failAllPending(new Error('disconnected'));
    this.ws?.close();
    this.ws = null;
    this.options.onStateChange?.('disconnected');
  }

  /** 応答を待たずに投げる（ドラッグ中の連続更新用）。 */
  send(type: string, method: string, parameters: LiveCommandParams = {}): void {
    if (!this.isConnected) return;
    this.ws!.send(JSON.stringify(this.buildCommand(type, method, parameters)));
  }

  /** 応答を待つ。 */
  request<T = any>(type: string, method: string, parameters: LiveCommandParams = {}): Promise<T> {
    if (!this.isConnected) {
      return Promise.reject(new Error('not connected'));
    }

    const requestId = `req-${++this.requestCounter}`;
    const timeoutMs = this.options.requestTimeoutMs ?? 5000;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`request timed out: ${type}.${method}`));
      }, timeoutMs);

      this.pending.set(requestId, { resolve, reject, timer });
      this.ws!.send(JSON.stringify({ ...this.buildCommand(type, method, parameters), requestId }));
    });
  }

  private buildCommand(type: string, method: string, parameters: LiveCommandParams) {
    const cmd: Record<string, unknown> = { type, method, parameters };
    if (this.options.password) cmd.authToken = this.options.password;
    return cmd;
  }

  private handleMessage(event: MessageEvent): void {
    let msg: any;
    try {
      msg = JSON.parse(typeof event.data === 'string' ? event.data : '');
    } catch {
      return;
    }
    if (!msg || typeof msg.requestId !== 'string') return;

    const pending = this.pending.get(msg.requestId);
    if (!pending) return;

    this.pending.delete(msg.requestId);
    clearTimeout(pending.timer);

    if (msg.success) pending.resolve(msg.data);
    else pending.reject(new Error(msg.error || 'request failed'));
  }

  private failAllPending(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
}

// ─────────────────────────────────────────
// 実機から返ってくる値の型（C# 側は Newtonsoft 既定なのでフィールド名が PascalCase。
// 将来 camelCase 化されても壊れないよう、読み取りは両対応にする）
// ─────────────────────────────────────────

export interface DeviceObjectState {
  id: string;
  name?: string;
  active: boolean;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  error?: string;
}

export interface DeviceViewerPose {
  available: boolean;
  position: [number, number, number];
  rotation: [number, number, number];
  forward: [number, number, number];
  up: [number, number, number];
  fieldOfView: number;
  tracking: boolean;
  error?: string;
}

function pick<T>(obj: any, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key] as T;
  }
  return undefined;
}

function triple(value: any, fallback: [number, number, number]): [number, number, number] {
  if (Array.isArray(value) && value.length >= 3) {
    const [x, y, z] = value;
    if ([x, y, z].every((n) => typeof n === 'number' && Number.isFinite(n))) return [x, y, z];
  }
  return fallback;
}

export function parseObjectState(raw: any): DeviceObjectState | null {
  const id = pick<string>(raw, 'Id', 'id');
  if (!id) return null;
  return {
    id,
    name: pick<string>(raw, 'Name', 'name'),
    active: pick<boolean>(raw, 'Active', 'active') ?? true,
    position: triple(pick(raw, 'Position', 'position'), [0, 0, 0]),
    rotation: triple(pick(raw, 'Rotation', 'rotation'), [0, 0, 0]),
    scale: triple(pick(raw, 'Scale', 'scale'), [1, 1, 1]),
    error: pick<string>(raw, 'Error', 'error'),
  };
}

export function parseViewerPose(raw: any): DeviceViewerPose | null {
  if (!raw) return null;
  return {
    available: pick<boolean>(raw, 'Available', 'available') ?? false,
    position: triple(pick(raw, 'Position', 'position'), [0, 0, 0]),
    rotation: triple(pick(raw, 'Rotation', 'rotation'), [0, 0, 0]),
    forward: triple(pick(raw, 'Forward', 'forward'), [0, 0, 1]),
    up: triple(pick(raw, 'Up', 'up'), [0, 1, 0]),
    fieldOfView: pick<number>(raw, 'FieldOfView', 'fieldOfView') ?? 50,
    tracking: pick<boolean>(raw, 'Tracking', 'tracking') ?? false,
    error: pick<string>(raw, 'Error', 'error'),
  };
}
