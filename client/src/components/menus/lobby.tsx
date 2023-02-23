import * as React from "react";
import BufferedWebSocket, { WebSocketHandlers } from "../../core/buffered_websocket";
import * as NetworkTypes from "../../core/network_types";
import { GameSettings, ProductArray, SwapMode, playerIcons, productInfos } from "../../core/game_types";
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
  onStartGame: (args: { hostInfo: NetworkTypes.HostClientInfo, gameSettings: GameSettings, finalLocalName: string, otherClients: NetworkTypes.ClientInfo[] }) => void
};

type HostInfo =
  & NetworkTypes.HostClientInfo
  & (
    | {
      localHost: true,
      gameSettings: {
        numRoundsPerPlayer:
        | { type: "recommended" }
        | { type: "custom", value: number },
        generalPoolContractCounts:
        | { type: "recommended" }
        | { type: "custom", value: ProductArray<number> },
        swapMode: SwapMode,
      }
    }
    | { localHost: false, }
  )

type LobbyMachineState =
  | { state: "Entering" } // entering state only used for non-host client
  | { state: "Entered", hostInfo: HostInfo, selectedPlayerIcon: Optional<string>, otherClients: NetworkTypes.ClientInfo[], otherPlayerIcons: Optional<string>[] };

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
        hostInfo: {
          localHost: true,
          gameSettings: {
            numRoundsPerPlayer: { type: "recommended" },
            generalPoolContractCounts: { type: "recommended" },
            swapMode: "simple",
          }
        },
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
            const deserializedGeneralPoolContractCounts = ProductArray.tryNewArray(event.data.gameSettings.generalPoolContractCounts);
            if (deserializedGeneralPoolContractCounts.hasValue === false) {
              console.log(`Invalid START_GAME event: ${JSON.stringify(event)}`);
              console.trace();
              produceError(`Encountered an internal error.`);
              break;
            }
            const otherPlayers = lobbyMachineState.otherClients.zip(lobbyMachineState.otherPlayerIcons);
            if (otherPlayers === undefined) {
              console.log(`Invalid lobby state: ${JSON.stringify(lobbyMachineState)}`);
              console.trace();
              produceError(`Encountered an internal error.`);
              break;
            }
            props.onStartGame({
              hostInfo: lobbyMachineState.hostInfo,
              gameSettings: {
                numRounds: event.data.gameSettings.numRounds,
                generalPoolContractCounts: deserializedGeneralPoolContractCounts.value,
                swapMode: event.data.gameSettings.swapMode,
              },
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

      const recommendedGameSettings = {
        numRoundsPerPlayer: ((numPlayers: number) => (numPlayers <= 3 ? 3 : (numPlayers == 4 || numPlayers == 5) ? 2 : 1))(1 + lobbyMachineState.otherClients.length),
        generalPoolContractCounts: (
          ((1 + lobbyMachineState.otherClients.length) <= 3)
            ? ProductArray.newArray([48, 36, 0, 24, 2, 1, 2, 0, 0, 0, 1, 18, 16, 9, 5])
            : ProductArray.newArray([48, 36, 36, 24, 2, 2, 2, 1, 2, 1, 2, 22, 21, 12, 5])
        ),
      };

      const onClickStart = function () {
        if (lobbyMachineState.hostInfo.localHost === false) return; // should be impossible

        if (lobbyMachineState.otherClients.length < 2) {
          alert("The game does not support fewer than three players!");
        } else if (lobbyMachineState.otherClients.length > 9) {
          alert("The game does not support more than ten players!");
        } else if (lobbyMachineState.selectedPlayerIcon.hasValue == false || lobbyMachineState.otherPlayerIcons.some(icon => icon.hasValue == false)) {
          alert("Everyone must select a player icon before starting!");
        } else {
          const startGameData: NetworkTypes.ServerStartGameEventData = {
            gameSettings: {
              numRounds: (
                (1 + lobbyMachineState.otherClients.length)
                * (
                  (lobbyMachineState.hostInfo.gameSettings.numRoundsPerPlayer.type === "recommended")
                    ? recommendedGameSettings.numRoundsPerPlayer
                    : lobbyMachineState.hostInfo.gameSettings.numRoundsPerPlayer.value
                )
              ),
              generalPoolContractCounts: (
                (lobbyMachineState.hostInfo.gameSettings.generalPoolContractCounts.type === "recommended")
                  ? recommendedGameSettings.generalPoolContractCounts.arr
                  : lobbyMachineState.hostInfo.gameSettings.generalPoolContractCounts.value.arr
              ),
              swapMode: lobbyMachineState.hostInfo.gameSettings.swapMode,
            }
          };

          props.ws.ws.send(`MSG|${lobbyMachineState.otherClients.map(x => x.clientId).join(",")}`
            + `|${NetworkTypes.ServerEventType.START_GAME}|${JSON.stringify(startGameData satisfies NetworkTypes.ServerStartGameEventData)}`
          );
          clientHandleReceivedServerEvent({
            type: NetworkTypes.ServerEventType.START_GAME,
            data: startGameData
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
          {
            (() => {
              const hostInfo = lobbyMachineState.hostInfo;
              if (hostInfo.localHost === false) return undefined;
              else return (
                <div>
                  <h4>Game Settings:</h4>
                  <button
                    onClick={(_e) => {
                      setLobbyMachineState({
                        ...lobbyMachineState,
                        hostInfo: {
                          ...hostInfo,
                          gameSettings: {
                            ...hostInfo.gameSettings,
                            numRoundsPerPlayer: (
                              (hostInfo.gameSettings.numRoundsPerPlayer.type === "recommended")
                                ? { type: "custom", value: recommendedGameSettings.numRoundsPerPlayer }
                                : { type: "recommended" }
                            )
                          }
                        }
                      });
                    }}
                  >
                    {(hostInfo.gameSettings.numRoundsPerPlayer.type === "recommended") ? "(edit)" : "(undo)"}
                  </button>
                  <span>{" "}Rounds per player:{" "}</span>
                  {
                    (() => {
                      const [roundsPerPlayerEle, numRoundsPerPlayer] = (
                        (hostInfo.gameSettings.numRoundsPerPlayer.type === "recommended")
                          ? [
                            (<span>{recommendedGameSettings.numRoundsPerPlayer}</span>),
                            recommendedGameSettings.numRoundsPerPlayer
                          ]
                          : [
                            (
                              <input
                                type="number"
                                min="1"
                                value={hostInfo.gameSettings.numRoundsPerPlayer.value}
                                max="9"
                                onChange={(e) => {
                                  setLobbyMachineState({
                                    ...lobbyMachineState,
                                    hostInfo: {
                                      ...hostInfo,
                                      gameSettings: {
                                        ...hostInfo.gameSettings,
                                        numRoundsPerPlayer: {
                                          type: "custom",
                                          value: parseInt(e.target.value)
                                        }
                                      }
                                    }
                                  });
                                }}
                              />
                            ),
                            hostInfo.gameSettings.numRoundsPerPlayer.value
                          ]
                      );

                      return (
                        <span>
                          {roundsPerPlayerEle}
                          {" "}
                          <span>({numRoundsPerPlayer * (1 + lobbyMachineState.otherClients.length)} total rounds)</span>
                        </span>
                      );
                    })()
                  }
                  <br></br>
                  <div>
                    <span style={{ display: "inline-block", verticalAlign: "top" }}>
                      <button
                        onClick={(_e) => {
                          setLobbyMachineState({
                            ...lobbyMachineState,
                            hostInfo: {
                              ...hostInfo,
                              gameSettings: {
                                ...hostInfo.gameSettings,
                                generalPoolContractCounts: (
                                  (hostInfo.gameSettings.generalPoolContractCounts.type === "recommended")
                                    ? { type: "custom", value: recommendedGameSettings.generalPoolContractCounts }
                                    : { type: "recommended" }
                                )
                              }
                            }
                          });
                        }}
                      >
                        {(hostInfo.gameSettings.generalPoolContractCounts.type === "recommended") ? "(edit)" : "(undo)"}
                      </button>
                      {" "}
                    </span>
                    <span style={{ display: "inline-block", verticalAlign: "top" }}
                    >
                      <span>Number of Supply Contracts: ({(
                        (hostInfo.gameSettings.generalPoolContractCounts.type === "recommended"
                          ? recommendedGameSettings.generalPoolContractCounts
                          : hostInfo.gameSettings.generalPoolContractCounts.value
                        ).arr.reduce((a, b) => a + b)
                      )} total)</span>
                      {
                        (() => {
                          return productInfos.arr
                            .groupBy(p => p.award.hasValue === true ? p.award.value.productType as number : 9999)
                            .sort((a, b) => a.key - b.key)
                            .map(g => (
                              <div key={`game_settings_general_pool_contract_counts_group_${g.key}`}>
                                {
                                  g.group.map(p => (
                                    <span key={`game_settings_general_pool_contract_counts_product_${p.type}`}>
                                      <span>{p.icon}</span>
                                      {
                                        (() => {
                                          const generalPoolContractCounts = hostInfo.gameSettings.generalPoolContractCounts;
                                          return (generalPoolContractCounts.type === "recommended")
                                            ? (
                                              <span>{recommendedGameSettings.generalPoolContractCounts.get(p.type)}</span>
                                            )
                                            : (
                                              <input
                                                type="number"
                                                min="0"
                                                value={generalPoolContractCounts.value.get(p.type)}
                                                max="999"
                                                onChange={(e) => {
                                                  setLobbyMachineState({
                                                    ...lobbyMachineState,
                                                    hostInfo: {
                                                      ...hostInfo,
                                                      gameSettings: {
                                                        ...hostInfo.gameSettings,
                                                        generalPoolContractCounts: {
                                                          type: "custom",
                                                          value:
                                                            generalPoolContractCounts.value
                                                              .shallowCopy()
                                                              .set(p.type, parseInt(e.target.value)),
                                                        }
                                                      }
                                                    }
                                                  });
                                                }}
                                              ></input>
                                            );
                                        })()
                                      }
                                      {" "}
                                    </span>
                                  ))
                                }
                              </div>
                            ));
                        })()
                      }
                    </span>
                  </div>
                  <br></br>
                  <div>
                    <span>Supply Contract Exchange Mode:</span>
                    <select
                      onChange={(e) => {
                        setLobbyMachineState({
                          ...lobbyMachineState,
                          hostInfo: {
                            ...hostInfo,
                            gameSettings: {
                              ...hostInfo.gameSettings,
                              swapMode: e.target.value === "simple" ? "simple" : "strategic",
                            }
                          }
                        })
                      }}
                    >
                      <option selected value="simple">Simple</option>
                      <option value="strategic">Strategic</option>
                    </select>
                  </div>
                  <br></br>
                </div>
              )
            })()
          }
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
          <h4>Players:</h4>
          <p>{playerListHtml}</p>
        </div >
      );
  }

}