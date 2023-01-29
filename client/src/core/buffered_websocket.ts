

type WebSocketEvent =
  { type: "close", event: CloseEvent }
  | { type: "error", event: Event }
  | { type: "message", event: MessageEvent }
  | { type: "open", event: Event };

export type WebSocketHandlers = {
  // we want onclose and onerror always handled
  onclose: (event: CloseEvent) => void;
  onerror: (event: Event) => void;
  onmessage?: (event: MessageEvent) => void;
  onopen?: (event: Event) => void;
};

function handleEvent(event: WebSocketEvent, handlers: WebSocketHandlers) {
  switch (event.type) {
    case "close":
      if (handlers.onclose !== undefined) handlers.onclose(event.event);
      break;
    case "error":
      if (handlers.onerror !== undefined) handlers.onerror(event.event);
      break;
    case "message":
      if (handlers.onmessage !== undefined) handlers.onmessage(event.event);
      break;
    case "open":
      if (handlers.onopen !== undefined) handlers.onopen(event.event);
      break;
  }
}

export default class BufferedWebSocket {
  readonly ws: WebSocket;
  private events: WebSocketEvent[] = [];
  private handlers?: WebSocketHandlers = undefined;

  constructor(url: string | URL, protocols?: string | string[]) {
    this.ws = new WebSocket(url, protocols);
    this.ws.onclose = (event) => this.forwardEvent({ type: "close", event });
    this.ws.onerror = (event) => this.forwardEvent({ type: "error", event });
    this.ws.onmessage = (event) => this.forwardEvent({ type: "message", event });
    this.ws.onopen = (event) => this.forwardEvent({ type: "open", event });
  }

  private forwardEvent(event: WebSocketEvent) {
    if (this.handlers === undefined) {
      this.events.push(event);
    } else {
      handleEvent(event, this.handlers);
    }
  }

  setHandlers(handlers: WebSocketHandlers) {
    this.handlers = handlers;
    while (true) {
      if (this.handlers === undefined) break;
      const event = this.events.shift();
      if (event === undefined) break;
      handleEvent(event, this.handlers);
    }
  }

  unsetHandlers() {
    this.handlers = undefined;
  }

  clearBuffer() {
    this.events = [];
  }
}