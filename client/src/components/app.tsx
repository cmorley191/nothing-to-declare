import * as React from "react";
import MenuConnect from "./menus/connect";
import AnimatedEllipses from "./elements/animated_ellipses";
import BufferedWebSocket from "../core/buffered_websocket";
import * as NetworkTypes from "../core/network_types";
import MenuLobby from "./menus/lobby";
import MenuGame from "./menus/game";
import { GameSettings, PlayerArray } from "../core/game_types";

type AppProps = {};

type ConnectInfo = {
  localPlayerName: string,
  connectAddress: string
};

type AppMachineState =
  | { state: "ConnectReady", connectInfo?: ConnectInfo, warning?: string }
  | { state: "Connecting", connectInfo: ConnectInfo, ws: BufferedWebSocket }
  | { state: "Lobby", connectInfo: ConnectInfo, ws: BufferedWebSocket, localClientIsHost: boolean, clientId: number }
  | {
    state: "Game", connectInfo: ConnectInfo, localIcon: string, ws: BufferedWebSocket,
    hostInfo: NetworkTypes.HostClientInfo, gameSettings: GameSettings, clientId: number, otherClients: (NetworkTypes.ClientInfo & { icon: string })[]
  };

export default function App({ }: AppProps) {
  const [appMachineState, setAppMachineState] = React.useState<AppMachineState>({
    state: "ConnectReady"
  } satisfies AppMachineState);

  switch (appMachineState.state) {
    case "ConnectReady":
      return (
        <MenuConnect
          connectInfo={appMachineState.connectInfo}
          warning={appMachineState.warning}
          onSubmit={(connectInfo) => {
            const [wsProtocol, wsPort] =
              (location.protocol === "https:")
                ? ["wss", 9283]
                : ["ws", 9282]
            const ws = new BufferedWebSocket(`${wsProtocol}://${connectInfo.connectAddress}:${wsPort}`);

            setAppMachineState({
              state: "Connecting",
              connectInfo,
              ws
            });

            function handleConnectionError(...devErrors: any[]) {
              devErrors.forEach(devError => console.log(devError));
              setAppMachineState({
                state: "ConnectReady",
                connectInfo,
                warning: "Connection closed unexpectedly."
              });

              ws.unsetHandlers();
              ws.ws.close();
            }

            ws.setHandlers({
              onerror: (evt) => {
                handleConnectionError("Connection errored.", evt);
              },
              onclose: (evt) => {
                handleConnectionError("Connection closed.", evt);
              },
              onmessage: (evt) => {
                // Only handle first message, which should be WELCOME message.
                // We expect to advance to lobby which will handle next messages itself.
                ws.unsetHandlers();

                // first message should be WELCOME|clientId|other,client,ids
                const rawMessage: string = evt.data.toString();
                const message = NetworkTypes.parseReceivedMessage(rawMessage);
                if (message.ok == false) {
                  handleConnectionError("First message could not be parsed.", message.error);
                } else if (message.value.type != "WELCOME") {
                  handleConnectionError("Expected first message to be WELCOME type, but got...", rawMessage);
                } else {
                  setAppMachineState({
                    state: "Lobby",
                    connectInfo,
                    ws,
                    localClientIsHost: message.value.joinedClientIds.length == 1, // first to join == host
                    clientId: message.value.clientId
                  });
                }
              }
            });
          }}
        />
      );
    case "Connecting":
      return (
        <div>
          <span>Connecting to {appMachineState.connectInfo.connectAddress} as {appMachineState.connectInfo.localPlayerName}<AnimatedEllipses /></span>
        </div>
      );
    case "Lobby":
      //return (<div>LOBBY CLIENT {appMachineState.clientId} {appMachineState.localClientIsHost ? "(HOST)" : ""}</div>);
      return (
        <MenuLobby
          localInfo={{
            ...appMachineState,
            ...appMachineState.connectInfo,
            isHost: appMachineState.localClientIsHost
          }}
          ws={appMachineState.ws}

          onClose={({ warning }) => {
            appMachineState.ws.unsetHandlers();
            appMachineState.ws.ws.close();

            setAppMachineState({
              state: "ConnectReady",
              connectInfo: appMachineState.connectInfo,
              warning
            });
          }}

          onStartGame={({ hostInfo, gameSettings, finalLocalName, localIcon, otherClients }) => {
            appMachineState.ws.unsetHandlers();

            setAppMachineState({
              state: "Game",
              connectInfo: {
                ...appMachineState.connectInfo,
                localPlayerName: finalLocalName,
              },
              localIcon,
              ws: appMachineState.ws,
              clientId: appMachineState.clientId,
              hostInfo,
              otherClients,
              gameSettings,
            });
          }}
        />
      );
    case "Game": {
      const clients = PlayerArray.constructFirstPlayerArray(
        appMachineState.otherClients
          .concat({ clientId: appMachineState.clientId, name: appMachineState.connectInfo.localPlayerName, icon: appMachineState.localIcon })
          .sort((a, b) => a.clientId - b.clientId)
      );
      if (clients.hasValue === false) {
        console.log(`Invalid state: ${JSON.stringify(appMachineState)}`);
        console.trace();
        return (<div>An error occurred</div>);
      }

      return (
        <MenuGame
          localInfo={{
            ...appMachineState.connectInfo,
            clientId: appMachineState.clientId
          }}
          hostInfo={appMachineState.hostInfo}
          ws={appMachineState.ws}

          settings={appMachineState.gameSettings}
          clients={clients.value}

          onClose={({ warning }) => {
            appMachineState.ws.unsetHandlers();
            appMachineState.ws.ws.close();

            setAppMachineState({
              state: "ConnectReady",
              warning
            });
          }}
        />
      );
    }
  }
}