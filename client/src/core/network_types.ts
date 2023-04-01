import { SerializableIgnoreDeal, ProductType, SerializableGameSettings, SerializableServerGameState } from "./game_types";
import { Optional, Result } from "./util";

export interface ClientInfo {
  clientId: number,
  name: string
}
export type HostClientInfo =
  | { localHost: true }
  | { localHost: false, hostClientId: number };

export type ReceivedMessage =
  | { type: "WELCOME", clientId: number, joinedClientIds: number[] }
  | { type: "MSG", message: string }
  | { type: "JOIN", joinedClientId: number }
  | { type: "LEAVE", leftClientId: number };

export function parseReceivedMessage(msg: string): Result<ReceivedMessage, string> {
  if (msg.startsWith("WELCOME|")) { // WELCOME|clientId|all,client,ids
    let workingMsg = msg;
    workingMsg = workingMsg.substring(workingMsg.indexOf("|") + 1); // clientId|all,client,ids

    const clientId = parseInt(workingMsg.substring(0, workingMsg.indexOf("|")));
    if (isNaN(clientId)) return { ok: false, error: `Invalid (NaN) clientId in received WELCOME message: ${msg}` };
    workingMsg = workingMsg.substring(workingMsg.indexOf("|") + 1); // all,client,ids

    const clientIds = workingMsg.split(",").map(x => parseInt(x));
    if (clientIds.some(x => isNaN(x))) return { ok: false, error: `Invalid (NaN) listed client id in received WELCOME message: ${msg}` };
    if (!clientIds.some(x => x == clientId)) return { ok: false, error: `clientId not present in client id list in received WELCOME message: ${msg}` };

    return {
      ok: true,
      value: {
        type: "WELCOME",
        clientId,
        joinedClientIds: clientIds
      }
    };

  } else if (msg.startsWith("MSG|")) { // MSG|message
    return {
      ok: true,
      value: {
        type: "MSG",
        message: msg.substring(msg.indexOf("|") + 1) // message
      }
    };

  } else if (msg.startsWith("JOIN|")) { // JOIN|clientId
    const joinedClientId = parseInt(msg.substring(msg.indexOf("|") + 1)); // clientId
    if (isNaN(joinedClientId)) return { ok: false, error: `Invalid (NaN) clientId in received JOIN message: ${msg}` };
    return {
      ok: true,
      value: {
        type: "JOIN",
        joinedClientId
      }
    };

  } else if (msg.startsWith("LEAVE|")) { // LEAVE|clientId
    const leftClientId = parseInt(msg.substring(msg.indexOf("|") + 1)); // clientId
    if (isNaN(leftClientId)) return { ok: false, error: `Invalid (NaN) clientId in received LEAVE message: ${msg}` };
    return {
      ok: true,
      value: {
        type: "LEAVE",
        leftClientId
      }
    };

  } else {
    return { ok: false, error: `Invalid received message: ${msg}` };
  }
}

export enum ServerEventType {
  WELCOME = 0,
  NOTWELCOME = 1,
  CLIENT_JOINED = 2,
  CLIENT_LEFT = 3,
  PLAYER_ICONS_UPDATE = 4,
  START_GAME = 5,
  STATE_UPDATE = 6,
  OFFICER_TOOL_UPDATE = 7,
}

export enum ClientEventType {
  IDENTIFY = 100,
  SELECT_PLAYER_ICON = 101,
  SWAP_SUPPLY_CONTRACTS = 102,
  PACK_CART = 103,
  ADVANCE_CUSTOMS_INTRO = 104,
  CUSTOMS_ACTION = 105,
}

export interface ServerWelcomeEventData {
  hostClientId: number,
  identifiedClients: ClientInfo[],
  identifiedClientsPlayerIcons: Optional<string>[]
}
export interface ServerNotWelcomeEventData {
  reason: string
}
export type ServerClientJoinedEventData = ClientInfo;
export interface ServerClientLeftEventData {
  clientId: number
};
export interface ServerPlayerIconsUpdateEventData {
  clientId: number,
  playerIcon: Optional<string>,
};
export interface ServerStartGameEventData {
  gameSettings: SerializableGameSettings,
};
export interface ServerStateUpdateEventData {
  state: SerializableServerGameState
}
export type EntryVisaStamp = {
  x: number,
  y: number,
};
export type OfficerToolCrowbarState = {
  useProgress: number
};
export type OfficerToolStampState = {
  offset: { x: number, y: number },
  stamps: EntryVisaStamp[],
  state: "not held" | "held" | "stamping",
};
export type OfficerToolsState = {
  crowbar: Optional<OfficerToolCrowbarState>,
  stamp: Optional<OfficerToolStampState>,
};
export interface ServerOfficerToolUpdateEventData {
  // optionals in state here are treated as "whether or not the state is updating",
  // rather than "whether or not the tool is present"
  toolsUpdates: OfficerToolsState,
}

export type ClientIdentifyEventData = ClientInfo;
export interface ClientSelectPlayerIconEventData {
  sourceClientId: number,
  playerIcon: string,
}
export interface ClientSwapSupplyContractsEventData {
  sourceClientId: number,
  recycled: boolean[],
  took: {
    recycledPools: number[],
    generalPool: number,
  },
}
export interface ClientPackCartEventData {
  sourceClientId: number,
  packed: boolean[],
  claimedType: ProductType,
  claimMessage: Optional<string>,
}
export interface ClientAdvanceCustomsIntroEventData {
  sourceClientId: number,
};
export interface ClientCustomsActionEventData {
  sourceClientId: number,
  action:
  // officer actions:
  | { action: "resume interrogation", iPlayerTrader: number }
  | { action: "pause interrogation" }
  | { action: "search cart" }
  | { action: "prepare tool", tool: "crowbar" | "stamp" }
  | { action: "ignore cart", entryVisaStamps: EntryVisaStamp[] }
  | { action: "officer tool update", update: ServerOfficerToolUpdateEventData }
  // trader & officer actions:
  | { action: "propose deal", deal: SerializableIgnoreDeal }
  | { action: "reject deal" }
  | { action: "accept deal" }
  // other action:
  | { action: "resolve confirmation ready" }
  | { action: "confirm resolve", entryVisaStamps: EntryVisaStamp[] }
  | { action: "resolve completed" }
}

export type ServerEvent =
  | { type: ServerEventType.WELCOME, data: ServerWelcomeEventData }
  | { type: ServerEventType.NOTWELCOME, data: ServerNotWelcomeEventData }
  | { type: ServerEventType.CLIENT_JOINED, data: ServerClientJoinedEventData }
  | { type: ServerEventType.CLIENT_LEFT, data: ServerClientLeftEventData }
  | { type: ServerEventType.PLAYER_ICONS_UPDATE, data: ServerPlayerIconsUpdateEventData }
  | { type: ServerEventType.START_GAME, data: ServerStartGameEventData }
  | { type: ServerEventType.STATE_UPDATE, data: ServerStateUpdateEventData }
  | { type: ServerEventType.OFFICER_TOOL_UPDATE, data: ServerOfficerToolUpdateEventData }

export type ClientEvent =
  | { type: ClientEventType.IDENTIFY, data: ClientIdentifyEventData }
  | { type: ClientEventType.SELECT_PLAYER_ICON, data: ClientSelectPlayerIconEventData }
  | { type: ClientEventType.SWAP_SUPPLY_CONTRACTS, data: ClientSwapSupplyContractsEventData }
  | { type: ClientEventType.PACK_CART, data: ClientPackCartEventData }
  | { type: ClientEventType.ADVANCE_CUSTOMS_INTRO, data: ClientAdvanceCustomsIntroEventData }
  | { type: ClientEventType.CUSTOMS_ACTION, data: ClientCustomsActionEventData }

export function parseServerEvent(rawEvent: string): Result<ServerEvent, string> { // eventType | eventData
  const eventType = parseInt(rawEvent.substring(0, rawEvent.indexOf("|")));
  if (isNaN(eventType)) return { ok: false, error: `Invalid (NaN) server event type id: ${rawEvent}` };
  const eventData = rawEvent.substring(rawEvent.indexOf("|") + 1); // eventData
  switch (eventType) {
    case ServerEventType.WELCOME:
      return { ok: true, value: { type: ServerEventType.WELCOME, data: JSON.parse(eventData) } };
    case ServerEventType.NOTWELCOME:
      return { ok: true, value: { type: ServerEventType.NOTWELCOME, data: JSON.parse(eventData) } };
    case ServerEventType.CLIENT_JOINED:
      return { ok: true, value: { type: ServerEventType.CLIENT_JOINED, data: JSON.parse(eventData) } };
    case ServerEventType.CLIENT_LEFT:
      return { ok: true, value: { type: ServerEventType.CLIENT_LEFT, data: JSON.parse(eventData) } };
    case ServerEventType.PLAYER_ICONS_UPDATE:
      return { ok: true, value: { type: ServerEventType.PLAYER_ICONS_UPDATE, data: JSON.parse(eventData) } };
    case ServerEventType.START_GAME:
      return { ok: true, value: { type: ServerEventType.START_GAME, data: JSON.parse(eventData) } };
    case ServerEventType.STATE_UPDATE:
      return { ok: true, value: { type: ServerEventType.STATE_UPDATE, data: JSON.parse(eventData) } };
    case ServerEventType.OFFICER_TOOL_UPDATE:
      return { ok: true, value: { type: ServerEventType.OFFICER_TOOL_UPDATE, data: JSON.parse(eventData) } };
    default:
      return { ok: false, error: `Invalid (unknown) server event type id: ${rawEvent}` };
  }
}

export function parseClientEvent(rawEvent: string): Result<ClientEvent, string> { // eventType | eventData
  const eventType = parseInt(rawEvent.substring(0, rawEvent.indexOf("|")));
  if (isNaN(eventType)) return { ok: false, error: `Invalid (NaN) client event type id: ${rawEvent}` };
  const eventData = rawEvent.substring(rawEvent.indexOf("|") + 1); // eventData
  switch (eventType) {
    case ClientEventType.IDENTIFY:
      return { ok: true, value: { type: ClientEventType.IDENTIFY, data: JSON.parse(eventData) } };
    case ClientEventType.SELECT_PLAYER_ICON:
      return { ok: true, value: { type: ClientEventType.SELECT_PLAYER_ICON, data: JSON.parse(eventData) } };
    case ClientEventType.SWAP_SUPPLY_CONTRACTS:
      return { ok: true, value: { type: ClientEventType.SWAP_SUPPLY_CONTRACTS, data: JSON.parse(eventData) } };
    case ClientEventType.PACK_CART:
      return { ok: true, value: { type: ClientEventType.PACK_CART, data: JSON.parse(eventData) } };
    case ClientEventType.ADVANCE_CUSTOMS_INTRO:
      return { ok: true, value: { type: ClientEventType.ADVANCE_CUSTOMS_INTRO, data: JSON.parse(eventData) } };
    case ClientEventType.CUSTOMS_ACTION:
      return { ok: true, value: { type: ClientEventType.CUSTOMS_ACTION, data: JSON.parse(eventData) } };
    default:
      return { ok: false, error: `Invalid (unknown) client event type id: ${rawEvent}` };
  }
}