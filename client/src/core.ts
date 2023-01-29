
export enum ServerEventType {
  WELCOME = 0,
  CLIENT_JOINED = 1,
  CLIENT_LEFT = 2
}

export enum ClientEventType {
  IDENTIFY = 100,
}

export interface ClientInfo {
  clientId: number,
  name: string
}

export interface ServerWelcomeEventData {
  hostClientId: number,
  identifiedClients: ClientInfo[]
}

export type ServerClientJoinedEventData = ClientInfo;

export interface ServerClientLeftEventData {
  clientId: number
};

export type ClientIdentifyEventData = ClientInfo;