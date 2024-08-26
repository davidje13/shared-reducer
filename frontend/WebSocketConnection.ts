const PING = 'P';
const PONG = 'p';
const PING_INTERVAL = 20 * 1000;

export class WebSocketConnection {
  private _ws: WebSocket;

  private _pingTimeout: NodeJS.Timeout | null = null;

  public constructor(
    wsUrl: string,
    token: string | undefined = undefined,
    private readonly _messageCallback: (message: unknown) => void,
    private readonly _errorCallback: ((error: string) => void) | undefined = undefined,
  ) {
    this._ws = new WebSocket(wsUrl);
    this._ws.addEventListener('message', this._handleMessage);
    this._ws.addEventListener('error', this._handleError);
    this._ws.addEventListener('close', this._handleClose);
    if (token) {
      this._ws.addEventListener('open', () => this._ws.send(token), { once: true });
    }
    this._queueNextPing();
  }

  public send(message: unknown) {
    this._ws.send(JSON.stringify(message));
  }

  public close() {
    this._ws.close();
    if (this._pingTimeout !== null) {
      clearTimeout(this._pingTimeout);
    }
  }

  private _queueNextPing() {
    if (this._pingTimeout !== null) {
      clearTimeout(this._pingTimeout);
    }
    this._pingTimeout = setTimeout(this._sendPing, PING_INTERVAL);
  }

  private _sendPing = () => {
    this._ws.send(PING);
  };

  private _handleMessage = ({ data }: { data: string }) => {
    this._queueNextPing();
    if (data !== PONG) {
      this._messageCallback(JSON.parse(data));
    }
  };

  private _handleError = () => {
    this._errorCallback?.('Failed to connect');
  };

  private _handleClose = () => {
    if (this._pingTimeout !== null) {
      clearTimeout(this._pingTimeout);
    }
  };
}
