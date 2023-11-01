import * as React from "react";
import { Optional, nullopt, opt } from "../../core/optional";

type ConnectInfo = {
  localPlayerName: string,
  connectAddress: string
};

type MenuConnectProps = {
  connectInfo?: ConnectInfo
  warning?: string;
  onSubmit: (connectInfo: ConnectInfo) => void;
};

export default function MenuConnect(props: MenuConnectProps) {
  const cookieNicknameKeyname = "local_player_name".toLowerCase();
  const cookieAddressKeyname = "connect_address".toLowerCase();

  const cookieConnectInfo = ((): ConnectInfo | undefined => {
    const cookies = document.cookie.split(";");
    let nickname: Optional<string> = nullopt;
    let address: Optional<string> = nullopt;
    for (const cookie of cookies) {
      const cookieParts = cookie.split("=");
      const cookieName = cookieParts[0]?.trim()?.toLowerCase();
      const cookieValueRaw = cookieParts[1]?.trim();
      if (cookieName === undefined || cookieValueRaw === undefined || cookieParts.length > 2) continue;
      if (cookieName === cookieNicknameKeyname) {
        const cookieValue = decodeURIComponent(cookieValueRaw);
        nickname = opt(cookieValue);
      } else if (cookieName === cookieAddressKeyname) {
        const cookieValue = decodeURIComponent(cookieValueRaw);
        address = opt(cookieValue);
      }
    }
    if (nickname.hasValue === true && address.hasValue === true) {
      return {
        localPlayerName: nickname.value,
        connectAddress: address.value,
      };
    }
    else return undefined;
  })();
  const [nicknameInputValue, setNicknameInputValue] = React.useState(props.connectInfo?.localPlayerName ?? cookieConnectInfo?.localPlayerName ?? "");
  const [addressInputValue, setAddressInputValue] = React.useState(props.connectInfo?.connectAddress ?? cookieConnectInfo?.connectAddress ?? "");
  const [warning, setWarning] = React.useState(props.warning ?? "");

  function onClickConnect() {
    let localPlayerName = nicknameInputValue.trim();
    const firstChar = localPlayerName[0];
    if (firstChar === undefined) {
      setWarning("Enter a name.");
      return;
    }
    localPlayerName = firstChar.toUpperCase() + localPlayerName.substring(1);
    const connectAddress = addressInputValue.trim();
    if (connectAddress.trim() == "") {
      setWarning("Enter a connection address.");
      return;
    }

    document.cookie = `${cookieNicknameKeyname}=${encodeURIComponent(localPlayerName)}`;
    document.cookie = `${cookieAddressKeyname}=${encodeURIComponent(connectAddress)}`;

    props.onSubmit({ localPlayerName, connectAddress });
  }

  return (
    <div id="menu_connect">
      <span>Nickname:</span>
      <input
        type="text"
        onChange={e => setNicknameInputValue(e.target.value)}
        value={nicknameInputValue}
        id="menu_connect_input_nickname" // unused - just a unique value to facilitate autofill
      />
      <br></br>
      <span>Host address:</span>
      <input
        type="text"
        onChange={e => setAddressInputValue(e.target.value)}
        value={addressInputValue}
        id="menu_connect_input_address" // unused - just a unique value to facilitate autofill
      />
      <br></br>
      <button onClick={onClickConnect}>Connect</button>
      <br></br>
      <span>{warning}</span>
    </div>
  );
}