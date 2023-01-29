import asyncio
import http.server
import json
import os
import ssl
import sys
import threading
import websockets

# TODO: make threadsafe.

SETTINGS_FILE = 'server_settings.json'

def load_settings():
  if not os.path.isfile(SETTINGS_FILE):
    print(f'Settings file {SETTINGS_FILE} not found.')
    with open(SETTINGS_FILE, 'w') as f:
      json.dump({
        "host_to_bind": "127.0.0.1",
        "insecure_enabled": True,
        "secure_enabled": False,
        "http_enabled": False,
        "ports": {
          "http": 80,
          "https": 443,
          "ws": 9282,
          "wss": 9283,
        },
        "ssl_cert": {
          "certfile": None,
          "keyfile": None,
        }
      }, f)
    print(f'Wrote default settings to file -- please review, then restart server.')
    sys.exit(2)

  else:
    with open(SETTINGS_FILE, 'r') as f:
      settings_json = json.load(f)
    checks = [
      (lambda o: 'host_to_bind' in o),
      (lambda o: 'insecure_enabled' in o),
      (lambda o: 'secure_enabled' in o),
      (lambda o: 'ports' in o),
      (lambda o: 'http' in o['ports']),
      (lambda o: 'https' in o['ports']),
      (lambda o: 'ws' in o['ports']),
      (lambda o: 'wss' in o['ports']),
      (lambda o: 'ssl_cert' in o),
      (lambda o: 'certfile' in o['ssl_cert']),
      (lambda o: 'keyfile' in o['ssl_cert']),
    ]
    if [c for c in checks if not c(settings_json)]:
      print(f'Settings file {SETTINGS_FILE} has an invalid schema.')
      sys.exit(3)
    return settings_json

next_client_id = 0
client_queues = {}
redirects = {}
def follow_redirects(x):
  global redirects
  while x in redirects:
    x = redirects[x]
  return x

async def websocketServer(websocket):
  global next_client_id, client_queues, redirects

  client_id = next_client_id
  next_client_id += 1
  print(f"{client_id} joins")

  client_queue = asyncio.Queue()
  client_queues[client_id] = client_queue
  try:
    client_queue.put_nowait(f"WELCOME|{client_id}|{','.join([str(x) for x in client_queues.keys()])}")

    for (dest_client_id, dest_queue) in client_queues.items():
      if dest_client_id == client_id:
        continue
      dest_queue.put_nowait(f"JOIN|{client_id}")

    async def sender(websocket, client_id, client_queue):
      while True:
        msg = await client_queue.get()
        if msg == "STOP":
          return
        await websocket.send(msg)

    async def receiver(websocket, client_id, client_queues, redirects):
      while True:
        msg = await websocket.recv()
        if msg.startswith("MSG"): # MSG|dest|msg
          orig_msg = msg
          msg = msg[msg.index("|") + 1:] # dest|msg
          dest = msg[:msg.index("|")]
          msg = msg[msg.index("|") + 1:] # msg

          print(f"{client_id}>>{dest}: {msg}")

          if dest == "A":
            # broadcast
            for (dest_client_id, dest_queue) in client_queues.items():
              if dest_client_id == client_id:
                continue
              dest_queue.put_nowait(f"MSG|{msg}")
          else:
            # specific
            dests = dest.split(',')
            for dest in dests:
              assert dest.isnumeric(), f"unrecognized MSG destination: {orig_msg}"
            dests = [int(dest) for dest in dests]
            assert client_id not in dests, f"Can't MSG to yourself: {orig_msg}"
            dests = [follow_redirects(dest) for dest in dests]
            for dest in dests:
              assert dest in client_queues, f"Invalid MSG dest id: {orig_msg}"
            for dest in dests:
              client_queues[dest].put_nowait(f"MSG|{msg}")

        elif msg.startswith("LEAVE"):
          print(f"{client_id}: {msg}")
          if msg.startswith("LEAVE|"):
            # redirect provided
            redirect_dest = msg[msg.index("|") + 1:]
            assert redirect_dest.isnumeric(), f"Invalid LEAVE dest id: {orig_msg}"
            redirects[client_id] = int(redirect_dest)
          client_queues.pop(client_id).put_nowait("STOP")
          puts = []
          for dest_queue in client_queues.values():
            dest_queue.put_nowait(f"LEAVE|{client_id}")
          return

        else:
          assert False, f"unrecognized message type: {msg}"

    await asyncio.gather(
      sender(websocket, client_id, client_queue),
      receiver(websocket, client_id, client_queues, redirects)
    )
  finally:
    if client_id in client_queues:
      client_queues.pop(client_id)

async def serveWebsocketServer(settings, ssl_context):
  port = settings['ports']['ws'] if ssl_context is None else settings['ports']['wss']
  async with websockets.serve(websocketServer, settings['host_to_bind'], port, ssl=ssl_context):
    print(f"Listening on {port} (websocket -- {'secure' if ssl_context is not None else 'insecure'})")
    await asyncio.Future()

def runAsync(func, args):
  loop = asyncio.new_event_loop()
  asyncio.set_event_loop(loop)

  loop.run_until_complete(func(*args))
  loop.close()

def serveHttpServer(settings, ssl_context):
  port = settings['ports']['http'] if ssl_context is None else settings['ports']['https']
  httpd = http.server.ThreadingHTTPServer((settings['host_to_bind'], port), http.server.BaseHTTPRequestHandler)
  if ssl_context is not None:
    httpd.socket = ssl_context.wrap_socket(httpd.socket, server_side=True)
  print(f"About to listen on {port} (http -- {'secure' if ssl_context is not None else 'insecure'})")
  httpd.serve_forever()

def main():
  settings = load_settings()

  ssl_context = None
  if settings['secure_enabled'] is True:
    ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ssl_context.load_cert_chain(settings['ssl_cert']['certfile'], keyfile=settings['ssl_cert']['keyfile'])

  threads = []

  if settings['http_enabled'] is True:
    if settings['insecure_enabled'] is True:
      http_thread = threading.Thread(target=serveHttpServer, args=(settings, None), daemon=True)
      http_thread.start()
      threads.append(http_thread)
    if settings['secure_enabled'] is True:
      https_thread = threading.Thread(target=serveHttpServer, args=(settings, ssl_context), daemon=True)
      https_thread.start()
      threads.append(https_thread)

  # ws
  if settings['insecure_enabled'] is True:
    ws_thread = threading.Thread(target=runAsync, args=(serveWebsocketServer, (settings, None)), daemon=True)
    ws_thread.start()
    threads.append(ws_thread)
  if settings['secure_enabled'] is True:
    wss_thread = threading.Thread(target=runAsync, args=(serveWebsocketServer, (settings, ssl_context)), daemon=True)
    wss_thread.start()
    threads.append(wss_thread)

  for thread in threads:
    while thread.is_alive():
      thread.join(2)


if __name__ == '__main__':
  main()
