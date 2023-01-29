import * as React from "react";
import BufferedWebSocket, { WebSocketHandlers } from "../../core/buffered_websocket";
import * as NetworkTypes from "../../core/network_types";
import { playerIcons } from "../../core/game_types";
import { Optional, nullopt, opt } from "../../core/util";
import AnimatedEllipses from "../elements/animated_ellipses";

type LocalInfo = {
  localPlayerName: string,
  connectAddress: string,
  clientId: number,
  isHost: boolean
};

type MenuLobbyProps = {
  localInfo: LocalInfo,
  ws: BufferedWebSocket,

  onClose: (args: { warning: string }) => void
  onStartGame: (args: { hostInfo: NetworkTypes.HostClientInfo, finalLocalName: string, otherClients: NetworkTypes.ClientInfo[] }) => void
};

type LobbyMachineState =
  | { state: "Entering" } // entering state only used for non-host client
  | { state: "Entered", hostInfo: NetworkTypes.HostClientInfo, selectedPlayerIcon: Optional<string>, otherClients: NetworkTypes.ClientInfo[], otherPlayerIcons: Optional<string>[] };

export default function MenuLobby(props: MenuLobbyProps) {
  const localClientInfo: NetworkTypes.ClientInfo = {
    clientId: props.localInfo.clientId,
    name: props.localInfo.localPlayerName
  }
  function produceError(err: any) {
    props.onClose({ warning: err });
  }
  function handleRedundantWELCOMEMessage(rawMessage: string) {
    produceError(`Received redundant WELCOME message: ${rawMessage}`);
  }

  const defaultWebSocketErrorHandlers: WebSocketHandlers = {
    onclose: (event) => {
      console.log("Connection closed.");
      console.log(event);
      produceError("Connection closed unexpectedly.");
    },
    onerror: (event) => {
      console.log("Connection errored:");
      console.log(event);
      produceError("Connection closed unexpectedly.");
    },
  };

  const [lobbyMachineState, setLobbyMachineState] = React.useState<LobbyMachineState>(
    props.localInfo.isHost
      ? {
        state: "Entered",
        hostInfo: { localHost: true },
        selectedPlayerIcon: nullopt,
        otherClients: [],
        otherPlayerIcons: [],
      }
      : { state: "Entering" }
  );

  switch (lobbyMachineState.state) {
    case "Entering":
      // waiting for first welcome event from the host's server
      props.ws.setHandlers({
        ...defaultWebSocketErrorHandlers,
        onmessage: (event) => {
          // wait for WELCOME server event
          const rawMessage: string = event.data.toString();
          const message = NetworkTypes.parseReceivedMessage(rawMessage);
          if (message.ok == false) {
            produceError(`Failed to parse message: ${message.error} | message: ${rawMessage}`);
          } else {
            switch (message.value.type) {
              case "WELCOME": {
                handleRedundantWELCOMEMessage(rawMessage);
              } break;

              case "JOIN":
              case "LEAVE": {
                // ignore while we wait
              } break;

              case "MSG": {
                const msgEvent = NetworkTypes.parseServerEvent(message.value.message);
                if (msgEvent.ok == false) {
                  produceError(`Failed to parse server event: ${msgEvent.error} | message: ${rawMessage}`);
                } else {
                  switch (msgEvent.value.type) {
                    case NetworkTypes.ServerEventType.CLIENT_JOINED:
                    case NetworkTypes.ServerEventType.CLIENT_LEFT: {
                      produceError(`First server event received was not WELCOME: ${rawMessage}`);
                    } break;

                    case NetworkTypes.ServerEventType.NOTWELCOME: {
                      produceError(`Could not join game. ${msgEvent.value.data.reason}`);
                    } break;

                    case NetworkTypes.ServerEventType.WELCOME: {
                      if (msgEvent.value.data.identifiedClients.some(c => c.name == props.localInfo.localPlayerName)) {
                        produceError(`Player name ${props.localInfo.localPlayerName} is already taken. Please choose another name.`)
                      } else {
                        // local is not host, so IDENTIFY needs to be sent over the wire
                        props.ws.ws.send(`MSG|${msgEvent.value.data.hostClientId}|${NetworkTypes.ClientEventType.IDENTIFY}`
                          + `|${JSON.stringify(localClientInfo satisfies NetworkTypes.ClientIdentifyEventData)}`);

                        setLobbyMachineState({
                          state: "Entered",
                          hostInfo: { localHost: false, hostClientId: msgEvent.value.data.hostClientId },
                          selectedPlayerIcon: nullopt,
                          otherClients: msgEvent.value.data.identifiedClients,
                          otherPlayerIcons: msgEvent.value.data.identifiedClientsPlayerIcons,
                        });
                      }
                    } break;
                  }
                }
              } break;
            }
          }
        }
      });
      return (<div></div>);

    case "Entered":
      const clientSendClientEventToServer = function (event: NetworkTypes.ClientEvent) {
        switch (event.type) {
          case NetworkTypes.ClientEventType.IDENTIFY:
            if (lobbyMachineState.hostInfo.localHost == false) {
              props.ws.ws.send(`MSG|${lobbyMachineState.hostInfo.hostClientId}|${NetworkTypes.ClientEventType.IDENTIFY}`
                + `|${JSON.stringify(event.data satisfies NetworkTypes.ClientIdentifyEventData)}`);
            } else {
              serverHandleReceivedClientEvent({ type: NetworkTypes.ClientEventType.IDENTIFY, data: localClientInfo });
            }
            break;
          case NetworkTypes.ClientEventType.SELECT_PLAYER_ICON:
            if (lobbyMachineState.hostInfo.localHost == false) {
              props.ws.ws.send(`MSG|${lobbyMachineState.hostInfo.hostClientId}|${NetworkTypes.ClientEventType.SELECT_PLAYER_ICON}`
                + `|${JSON.stringify(event.data satisfies NetworkTypes.ClientSelectPlayerIconEventData)}`);
            } else {
              serverHandleReceivedClientEvent({ type: NetworkTypes.ClientEventType.SELECT_PLAYER_ICON, data: event.data });
            }
            break;
        }
      }

      const clientHandleReceivedServerEvent = function (event: NetworkTypes.ServerEvent) {
        const hostClientId = lobbyMachineState.hostInfo.localHost == true ? props.localInfo.clientId : lobbyMachineState.hostInfo.hostClientId;
        switch (event.type) {
          case NetworkTypes.ServerEventType.WELCOME:
          case NetworkTypes.ServerEventType.NOTWELCOME:
            produceError(`Received redundant WELCOME event: ${event}`);
            break;

          case NetworkTypes.ServerEventType.CLIENT_JOINED:
            lobbyMachineState.otherClients.push(event.data);
            lobbyMachineState.otherPlayerIcons.push(nullopt);
            setLobbyMachineState({ ...lobbyMachineState });
            break;

          case NetworkTypes.ServerEventType.CLIENT_LEFT:
            if (!lobbyMachineState.otherClients.some(x => x.clientId == event.data.clientId)) produceError(`CLIENT_LEFT on nonexistent other client ${event.data.clientId}`);
            if (event.data.clientId == hostClientId) {
              // host cannot be migrated yet
              produceError("Host disconnected.");
            };
            lobbyMachineState.otherPlayerIcons = lobbyMachineState.otherPlayerIcons.filter((_icon, i) => i != lobbyMachineState.otherClients.filterTransform((c, i) => c.clientId == event.data.clientId ? opt(i) : nullopt)[0])
            lobbyMachineState.otherClients = lobbyMachineState.otherClients.filter(x => x.clientId != event.data.clientId);
            setLobbyMachineState({ ...lobbyMachineState });
            break;

          case NetworkTypes.ServerEventType.PLAYER_ICONS_UPDATE: {
            if (event.data.clientId == props.localInfo.clientId) {
              setLobbyMachineState({
                ...lobbyMachineState,
                selectedPlayerIcon: event.data.playerIcon,
              })
            } else {
              const newOtherPlayerIcons = lobbyMachineState.otherPlayerIcons.shallowCopy();
              const matchingClientIndex = lobbyMachineState.otherClients.filterTransform((c, i) => c.clientId == event.data.clientId ? opt(i) : nullopt)[0];
              if (matchingClientIndex === undefined) {
                console.log(`Received bad PLAYER_ICONS_UPDATE server event: ${JSON.stringify(event)} (state: ${JSON.stringify(lobbyMachineState)})`);
                console.trace();
                break;
              }
              newOtherPlayerIcons[matchingClientIndex] = event.data.playerIcon;
              setLobbyMachineState({
                ...lobbyMachineState,
                otherPlayerIcons: newOtherPlayerIcons,
              })
            }
          } break;

          case NetworkTypes.ServerEventType.START_GAME: {
            const otherPlayers = lobbyMachineState.otherClients.zip(lobbyMachineState.otherPlayerIcons);
            if (otherPlayers === undefined) {
              console.log(`Invalid lobby state: ${JSON.stringify(lobbyMachineState)}`);
              console.trace();
              produceError(`Encountered an internal error.`);
              break;
            }
            props.onStartGame({
              hostInfo: lobbyMachineState.hostInfo,
              finalLocalName: `${lobbyMachineState.selectedPlayerIcon.hasValue == true ? lobbyMachineState.selectedPlayerIcon.value : ""}${props.localInfo.localPlayerName}`,
              otherClients: otherPlayers.map(([c, icon]) => ({
                ...c,
                name: `${(icon.hasValue == true) ? icon.value : ""}${c.name}`
              })),
            })
          } break;

          case NetworkTypes.ServerEventType.STATE_UPDATE:
          case NetworkTypes.ServerEventType.OFFICER_TOOL_UPDATE:
            // unexpected. TODO
            break;
        }
      }

      const serverHandleReceivedClientEvent = function (event: NetworkTypes.ClientEvent) {
        switch (event.type) {
          case NetworkTypes.ClientEventType.IDENTIFY: {
            const notifyClients = lobbyMachineState.otherClients.map(x => x.clientId).filter(x => x != event.data.clientId);
            if (notifyClients.length != 0) {
              props.ws.ws.send(`MSG|${notifyClients.join(",")}|${NetworkTypes.ServerEventType.CLIENT_JOINED}`
                + `|${JSON.stringify(event.data satisfies NetworkTypes.ServerClientJoinedEventData)}`);
            }
            if (event.data.clientId != props.localInfo.clientId) {
              clientHandleReceivedServerEvent({ type: NetworkTypes.ServerEventType.CLIENT_JOINED, data: event.data });
            }
          } break;

          case NetworkTypes.ClientEventType.SELECT_PLAYER_ICON: {
            const notifyClients = lobbyMachineState.otherClients.map(x => x.clientId);

            const updateData: Optional<NetworkTypes.ServerPlayerIconsUpdateEventData> = (() => {
              const matchesLocalIcon = lobbyMachineState.selectedPlayerIcon.hasValue == true && lobbyMachineState.selectedPlayerIcon.value == event.data.playerIcon;
              const matchesOtherClientIcon = lobbyMachineState.otherPlayerIcons.some((icon) => icon.hasValue == true && icon.value == event.data.playerIcon);
              if (event.data.sourceClientId == props.localInfo.clientId) {
                return opt({
                  clientId: event.data.sourceClientId,
                  playerIcon: matchesOtherClientIcon ? nullopt : opt(event.data.playerIcon)
                });

              } else {
                const eventOtherClientIndex = lobbyMachineState.otherClients.filterTransform((c, i) => c.clientId == event.data.sourceClientId ? opt(i) : nullopt)[0];
                if (eventOtherClientIndex === undefined) {
                  console.log(`Received bad SELECT_PLAYER_ICON: ${JSON.stringify(event)} (state: ${JSON.stringify(lobbyMachineState)})`);
                  return nullopt;
                }
                const eventOtherClientExistingIcon = lobbyMachineState.otherPlayerIcons[eventOtherClientIndex];
                if (eventOtherClientExistingIcon === undefined) {
                  console.log(`Received bad SELECT_PLAYER_ICON: ${JSON.stringify(event)} (state: ${JSON.stringify(lobbyMachineState)})`);
                  return nullopt;
                }
                return opt({
                  clientId: event.data.sourceClientId,
                  playerIcon: (matchesLocalIcon || matchesOtherClientIcon) ? nullopt : opt(event.data.playerIcon)
                });
              }
            })();
            if (updateData.hasValue === false) break;
            //console.log(updateData);
            if (notifyClients.length != 0) {
              props.ws.ws.send(`MSG|${notifyClients.join(",")}|${NetworkTypes.ServerEventType.PLAYER_ICONS_UPDATE}`
                + `|${JSON.stringify(updateData.value satisfies NetworkTypes.ServerPlayerIconsUpdateEventData)}`);
            }
            clientHandleReceivedServerEvent({ type: NetworkTypes.ServerEventType.PLAYER_ICONS_UPDATE, data: updateData.value });
          } break;
        }
      }

      props.ws.setHandlers({
        ...defaultWebSocketErrorHandlers,
        onmessage: (event) => {
          const rawMessage: string = event.data.toString();
          const message = NetworkTypes.parseReceivedMessage(rawMessage);
          if (message.ok == false) {
            produceError(`Failed to parse message: ${message.error} | message: ${rawMessage}`);
          } else {
            switch (message.value.type) {
              case "WELCOME": {
                handleRedundantWELCOMEMessage(rawMessage);
              } break;

              case "MSG": {
                if (lobbyMachineState.hostInfo.localHost) {
                  // host only receives client events
                  const msgEvent = NetworkTypes.parseClientEvent(message.value.message);
                  if (msgEvent.ok == false) {
                    produceError(`Failed to parse client event: ${msgEvent.error} | message: ${rawMessage}`);
                  } else {
                    serverHandleReceivedClientEvent(msgEvent.value);
                  }
                } else {
                  // non-host only receives server events
                  const msgEvent = NetworkTypes.parseServerEvent(message.value.message);
                  if (msgEvent.ok == false) {
                    produceError(`Failed to parse server event: ${msgEvent.error} | message: ${rawMessage}`);
                  } else {
                    clientHandleReceivedServerEvent(msgEvent.value);
                  }
                }
              } break;

              case "JOIN": {
                if (lobbyMachineState.hostInfo.localHost == true) {
                  // send welcome
                  props.ws.ws.send(`MSG|${message.value.joinedClientId}|${NetworkTypes.ServerEventType.WELCOME}`
                    + `|${JSON.stringify({
                      hostClientId: props.localInfo.clientId,
                      identifiedClients: lobbyMachineState.otherClients.concat(localClientInfo),
                      identifiedClientsPlayerIcons: lobbyMachineState.otherPlayerIcons.concat(lobbyMachineState.selectedPlayerIcon),
                    } satisfies NetworkTypes.ServerWelcomeEventData)}`);
                }
              } break;

              case "LEAVE": {
                if (lobbyMachineState.hostInfo.localHost) {
                  const m = message.value; // there's some weird fake type errors happening here, need a temporary
                  props.ws.ws.send(`MSG|${lobbyMachineState.otherClients.map(x => x.clientId).filter(x => x != m.leftClientId).join(",")}`
                    + `|${NetworkTypes.ServerEventType.CLIENT_LEFT}`
                    + `|${JSON.stringify({ clientId: m.leftClientId } satisfies NetworkTypes.ServerClientLeftEventData)}`);
                  clientHandleReceivedServerEvent({ type: NetworkTypes.ServerEventType.CLIENT_LEFT, data: { clientId: m.leftClientId } });
                }
              } break;
            }
          }
        }
      });

      const onClickStart = function () {
        if (lobbyMachineState.otherClients.length < 2) {
          alert("The game does not support fewer than three players!");
        } else if (lobbyMachineState.otherClients.length > 9) {
          alert("The game does not support more than ten players!");
        } else if (lobbyMachineState.selectedPlayerIcon.hasValue == false || lobbyMachineState.otherPlayerIcons.some(icon => icon.hasValue == false)) {
          alert("Everyone must select a player icon before starting!");
        } else {
          props.ws.ws.send(`MSG|${lobbyMachineState.otherClients.map(x => x.clientId).join(",")}`
            + `|${NetworkTypes.ServerEventType.START_GAME}|${JSON.stringify({} satisfies NetworkTypes.ServerStartGameEventData)}`
          );
          clientHandleReceivedServerEvent({
            type: NetworkTypes.ServerEventType.START_GAME,
            data: {}
          })
        }

      }

      const onClickLeave = function () {
        if (lobbyMachineState.hostInfo.localHost) {
          props.ws.ws.send(`MSG|${lobbyMachineState.otherClients.map(x => x.clientId).join(",")}|${NetworkTypes.ServerEventType.CLIENT_LEFT}|`
            + JSON.stringify({ clientId: props.localInfo.clientId } satisfies NetworkTypes.ServerClientLeftEventData))
        }
        props.ws.ws.send(`LEAVE`);
        produceError("Left the lobby.");
      }

      const playerListHtml = (() => {
        //console.log(lobbyMachineState);
        const otherPlayers = lobbyMachineState.otherClients.zip(lobbyMachineState.otherPlayerIcons);
        // TODO just zip them in the state
        if (otherPlayers === undefined) {
          console.log(`Invalid lobby state: ${JSON.stringify(lobbyMachineState)}`);
          console.trace();
          produceError(`Encountered an internal error.`);
          return undefined;
        }
        const hostClientId = lobbyMachineState.hostInfo.localHost == true ? props.localInfo.clientId : lobbyMachineState.hostInfo.hostClientId;
        let clients = otherPlayers.concat([[localClientInfo, lobbyMachineState.selectedPlayerIcon]]);
        const hostClient = clients.filter(([x, _icon]) => x.clientId == hostClientId)[0];
        if (hostClient === undefined) {
          console.log(`Invalid lobby state: ${JSON.stringify(lobbyMachineState)} (local info: ${JSON.stringify(localClientInfo)})`);
          console.trace();
          produceError(`Encountered an internal error.`);
          return undefined;
        }
        clients = [hostClient].concat(clients.filter(([x, _icon]) => x.clientId != hostClientId).sort((a, b) => (a[0].clientId - b[0].clientId)));

        const lines = clients.map(([x, icon]) => (
          <span key={`menu_lobby_player_list_item_${x.clientId}`}>
            {icon.hasValue == true ? (<span>{icon.value}</span>) : (<AnimatedEllipses />)}
            {x.name}
            {x.clientId == hostClientId ? " (host)" : x.clientId == props.localInfo.clientId ? " (you)" : ""}
            <br></br>
          </span>
        ));

        return (
          <span>
            Players:<br></br>
            {lines}
          </span>
        );
      })();

      return (
        <div id="menu_lobby">
          {
            props.localInfo.isHost
              ? (
                <div>
                  <button onClick={() => onClickStart()} >Start Game</button>
                </div>
              )
              : undefined
          }
          <button onClick={() => onClickLeave()} >Leave</button>
          <br></br>
          <div>
            <h4>Select a player icon:</h4>
            {
              playerIcons
                .map(playerIcon => (
                  <span style={{ margin: "8px", fontSize: "150%" }}>
                    <input
                      key={`select_player_icon_${playerIcon}`}
                      id={`select_player_icon_${playerIcon}`}
                      type="radio" name="emoji" value={playerIcon}
                      disabled={lobbyMachineState.otherPlayerIcons.some(i => i.hasValue == true && i.value == playerIcon)}
                      checked={lobbyMachineState.selectedPlayerIcon.hasValue == true && lobbyMachineState.selectedPlayerIcon.value == playerIcon}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setLobbyMachineState({
                            ...lobbyMachineState,
                            selectedPlayerIcon: opt(e.target.value)
                          })
                          clientSendClientEventToServer({
                            type: NetworkTypes.ClientEventType.SELECT_PLAYER_ICON,
                            data: {
                              sourceClientId: props.localInfo.clientId,
                              playerIcon: e.target.value,
                            }
                          })
                        }
                      }}
                    ></input>
                    <label htmlFor={`select_player_icon_${playerIcon}`}>{playerIcon}</label>
                  </span>
                ))
            }

          </div>
          <p>{playerListHtml}</p>
        </div >
      );
  }

}