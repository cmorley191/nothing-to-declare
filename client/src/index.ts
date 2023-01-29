import {
  ClientEventType, ServerEventType, ClientInfo,
  ServerWelcomeEventData, ServerClientJoinedEventData, ServerClientLeftEventData,
  ClientIdentifyEventData,
} from "./core";

function produceError(msg: string) {
  alert(msg);
  location.reload();
}

let ws: WebSocket = null;
let playerName = "";
let welcomeReceived = false;
let welcomeEventReceived = false;
let clientId = -1;
let otherClients: ClientInfo[] = [];
let hostClientId = -1;


function clientSendClientEventIdentify(data: ClientIdentifyEventData) {
  if (hostClientId != clientId) {
    ws.send(`MSG|${hostClientId}|${ClientEventType.IDENTIFY}|${JSON.stringify(data satisfies ClientIdentifyEventData)}`);
  } else {
    serverHandleReceivedClientEventIdentify({ clientId, name: playerName });
  }
}

// --- clientHandleReceivedServerEvent... ---

function clientHandleReceivedServerEventWelcome(data: ServerWelcomeEventData) {
  if (welcomeEventReceived) {
    produceError(`Unexpected ${ServerEventType.WELCOME} server event received: ${JSON.stringify(data)}`);
  }
  welcomeEventReceived = true;
  otherClients = data.identifiedClients;
  hostClientId = data.hostClientId;

  document.getElementById("menu_lobby").hidden = false;
  const playerListEle = document.getElementById("menu_lobby_player_list");

  let clients = otherClients.concat({ clientId, name: playerName });
  const hostClient = clients.filter(x => x.clientId == hostClientId)[0];
  clients = clients.filter(x => x.clientId != hostClientId);
  clients = [hostClient].concat(clients);
  playerListEle.innerHTML = `Players:</br>`
    + (
      clients.map(x => `<span id="menu_lobby_player_list_item_${x.clientId}">`
        + `${x.clientId == hostClientId ? "🤴🏽" : x.clientId == clientId ? "⭐" : "🧑🏽"}${x.name}</br></span>`)
    ).join("");

  clientSendClientEventIdentify({ clientId, name: playerName });
}

function clientHandleReceivedServerEventClientJoined(data: ServerClientJoinedEventData) {
  if (!welcomeEventReceived) {
    produceError(`Unexpected ${ServerEventType.CLIENT_JOINED} server event received: ${JSON.stringify(data)}`);
  }
  otherClients.push(data);
  document.getElementById("menu_lobby_player_list").innerHTML +=
    `<span id="menu_lobby_player_list_item_${data.clientId}">🧑🏽${data.name}</br></span>`;
}

function clientHandleReceivedServerEventClientLeft(data: ServerClientLeftEventData) {
  if (!welcomeEventReceived) {
    produceError(`Unexpected ${ServerEventType.CLIENT_LEFT} server event received: ${JSON.stringify(data)}`);
  }
  if (!otherClients.some(x => x.clientId == data.clientId)) produceError(`CLIENT_LEFT on nonexistent other client ${data.clientId}`);
  otherClients = otherClients.filter(x => x.clientId != data.clientId);
  document.getElementById(`menu_lobby_player_list_item_${data.clientId}`).remove();
  if (data.clientId == hostClientId) {
    // host cannot be migrated yet
    produceError("Host disconnected.");
  };
}

function clientHandleReceivedServerEvent(eventType: ServerEventType, eventDataStr: string) {
  switch (eventType) {
    case ServerEventType.WELCOME:
      console.log(eventDataStr);
      clientHandleReceivedServerEventWelcome(JSON.parse(eventDataStr));
      break;
    case ServerEventType.CLIENT_JOINED:
      clientHandleReceivedServerEventClientJoined(JSON.parse(eventDataStr));
      break;
    case ServerEventType.CLIENT_LEFT:
      clientHandleReceivedServerEventClientLeft(JSON.parse(eventDataStr));
      break;
    default: produceError(`Invalid server event type: ${eventType} | ${eventDataStr}`);
  }
}

// --- server... ---

function serverHandleReceivedClientEventIdentify(data: ClientIdentifyEventData) {
  const notifyClients = otherClients.map(x => x.clientId).filter(x => x != data.clientId);
  if (notifyClients.length != 0) {
    ws.send(`MSG|${notifyClients.join(",")}|${ServerEventType.CLIENT_JOINED}|${JSON.stringify(data satisfies ServerClientJoinedEventData)}`);
  }
  if (data.clientId != clientId) {
    clientHandleReceivedServerEventClientJoined(data);
  }
}

function serverHandleReceivedClientEvent(eventType: ClientEventType, eventDataStr: string) {
  switch (eventType) {
    case ClientEventType.IDENTIFY:
      serverHandleReceivedClientEventIdentify(JSON.parse(eventDataStr));
      break;
    default: produceError(`Invalid client event type: ${eventType} ${ClientEventType.IDENTIFY} ${ClientEventType.IDENTIFY == eventType} | ${eventDataStr}`);
  }
}

// --- wsOn... ---

function wsOnOpen(event: any) {
  document.getElementById("menu_connect").hidden = true;
}

function wsOnMessage(event: any) {
  const msg: string = event.data.toString();
  if (!welcomeReceived) {  // WELCOME|clientId|other,client,ids
    welcomeReceived = true;
    const error = `Expected valid welcome message but got: ${msg}`;
    if (!msg.startsWith("WELCOME|")) produceError(error);
    let workingMsg = msg.substring(msg.indexOf("|") + 1); // clientId|other,client,ids

    clientId = parseInt(workingMsg.substring(0, workingMsg.indexOf("|")));
    if (isNaN(clientId)) produceError(error);
    workingMsg = workingMsg.substring(workingMsg.indexOf("|") + 1); // other,client,ids

    const clientIds = workingMsg.split(",").map(x => parseInt(x));
    if (clientIds.some(x => isNaN(x))) produceError(error);
    if (!clientIds.some(x => x == clientId)) produceError(error);

    if (clientIds.length == 1) {
      // we are first to join, we're host
      hostClientId = clientId;
      clientHandleReceivedServerEventWelcome({
        hostClientId: clientId,
        identifiedClients: []
      });
    }

  } else if (msg.startsWith("JOIN|")) { // JOIN|clientId
    let workingMsg = msg.substring(msg.indexOf("|") + 1); // clientId
    const joinedClientId = parseInt(workingMsg);
    if (isNaN(joinedClientId)) produceError(`Invalid JOIN message: ${msg}`);

    if (hostClientId == clientId) {
      // send welcome
      ws.send(`MSG|${joinedClientId}|${ServerEventType.WELCOME}|`
        + JSON.stringify({
          hostClientId,
          identifiedClients: otherClients.concat({ clientId, name: playerName })
        } satisfies ServerWelcomeEventData));
    }

  } else if (msg.startsWith("LEAVE|")) { // LEAVE|clientId
    let workingMsg = msg.substring(msg.indexOf("|") + 1); // clientId
    const leftClientId = parseInt(workingMsg);
    if (isNaN(leftClientId)) produceError(`Invalid LEAVE message: ${msg}`);

    if (hostClientId == clientId) {
      ws.send(`MSG|${otherClients.map(x => x.clientId).filter(x => x != leftClientId).join(",")}|${ServerEventType.CLIENT_LEFT}|`
        + JSON.stringify({ clientId: leftClientId } satisfies ServerClientLeftEventData));
      clientHandleReceivedServerEventClientLeft({ clientId: leftClientId });
    }

  } else if (msg.startsWith("MSG|")) { // MSG|eventType|eventData
    let workingMsg = msg.substring(msg.indexOf("|") + 1); // eventType|eventData
    if (hostClientId == clientId) {
      // host only receives client events
      const eventType: ClientEventType = parseInt(workingMsg.substring(0, workingMsg.indexOf("|")));
      workingMsg = workingMsg.substring(workingMsg.indexOf("|") + 1); // eventData
      serverHandleReceivedClientEvent(eventType, workingMsg);
    } else {
      // non-host only receives server events
      const eventType: ServerEventType = parseInt(workingMsg.substring(0, workingMsg.indexOf("|")));
      workingMsg = workingMsg.substring(workingMsg.indexOf("|") + 1); // eventData
      clientHandleReceivedServerEvent(eventType, workingMsg);
    }

  } else {
    produceError(`Invalid message received: ${msg}`)
  }
}

function wsOnError(event: any) {
  console.log(JSON.stringify(event.data));
  produceError("Connection error; check console.");
}

function wsOnClose(event: any) {
  produceError("Connecion closed.");
}

// --------------

const connectButtonEle = document.getElementById("menu_connect_button_connect");
connectButtonEle.addEventListener("click", () => {
  document.getElementById("menu_connect").hidden = true;

  const nicknameInput = document.getElementById("menu_connect_input_nickname");
  const addressInput = document.getElementById("menu_connect_input_host");
  if (!(nicknameInput instanceof HTMLInputElement && addressInput instanceof HTMLInputElement)) {
    produceError("Type error.");
    return;
  }
  playerName = nicknameInput.value.trim();
  if (playerName == "") produceError("Enter a name.");
  const address = addressInput.value.trim();
  if (address.trim() == "") produceError("Enter a connection address.");

  ws = new WebSocket(`ws://${address}:9282`);
  ws.onopen = wsOnOpen;
  ws.onmessage = wsOnMessage;
  ws.onerror = wsOnError;
  ws.onclose = wsOnClose;
});

const leaveButtonEle = document.getElementById("menu_lobby_button_leave");
leaveButtonEle.addEventListener("click", () => {
  if (clientId == hostClientId) {
    ws.send(`MSG|${otherClients.map(x => x.clientId).join(",")}|${ServerEventType.CLIENT_LEFT}|`
      + JSON.stringify({ clientId } satisfies ServerClientLeftEventData))
  }
  ws.send(`LEAVE`);
  produceError("Left the lobby.");
});