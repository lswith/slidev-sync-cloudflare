// Wire protocol — direct port of upstream slidev-sync-server (MIT, Smile-SA).
// Keeping field names identical so this is drop-in compatible with slidev-addon-sync.

export type State = Record<string, unknown>;
export type States = Record<string, State>;

export enum DataType {
  CONNECT = "connect",
  PATCH = "patch",
  REPLACE = "replace",
  RESET = "reset",
}

export enum EventType {
  PATCH = "patch",
  REPLACE = "replace",
  RESET = "reset",
}

export interface Data {
  id: string;
}

export interface WsData extends Data {
  type: DataType;
}

export interface ConnectData extends Data {
  full?: boolean;
  states?: States;
}

export interface WsConnectData extends ConnectData {
  type: DataType.CONNECT;
  uid: string;
}

export interface ReplaceData extends Data {
  states: States;
}

export interface WsReplaceData extends ReplaceData {
  type: DataType.REPLACE;
  uid: string;
}

export interface PatchData extends Data {
  full?: boolean;
  states: States;
}

export interface WsPatchData extends PatchData {
  type: DataType.PATCH;
  uid: string;
}

export type ResetData = Data;

export interface WsResetData extends ResetData {
  type: DataType.RESET;
  uid: string;
}

export function isConnectData(data: WsData): data is WsConnectData {
  return data.type === DataType.CONNECT;
}

export function isPatchData(data: WsData): data is WsPatchData {
  return data.type === DataType.PATCH;
}

export function isReplaceData(data: WsData): data is WsReplaceData {
  return data.type === DataType.REPLACE;
}

export function isResetData(data: WsData): data is WsResetData {
  return data.type === DataType.RESET;
}
