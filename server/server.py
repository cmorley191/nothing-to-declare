import asyncio
import http.server
import json
import os
import queue
import socket
import ssl
import subprocess
import sys
import threading
import uuid
import websockets

# TODO: make threadsafe.

SETTINGS_FILE = 'server_settings.json'

def load_settings():
  default_settings_json = {
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
    },
    "gimp": {
      "enabled": False,
      "session_port": 11859,
      "background_img_path": None,
      "foreground_imgs_dir_path": None,
      "output_imgs_dir_path": None,
      "output_img_extension": "jpg",
    }
  }

  if not os.path.isfile(SETTINGS_FILE):
    print(f'Settings file {SETTINGS_FILE} not found.')
    with open(SETTINGS_FILE, 'w') as f:
      json.dump(default_settings_json, f)
    print(f'Wrote default settings to file -- please review, then restart server.')
    sys.exit(2)

  else:
    with open(SETTINGS_FILE, 'r') as f:
      settings_json = json.load(f)

    def check_schema(check_o, expected_o):
      if type(expected_o) is dict:
        if type(check_o) is not dict:
          return False
        for expected_k in expected_o:
          if expected_k not in check_o:
            return False
          if not check_schema(check_o[expected_k], expected_o[expected_k]):
            return False

      return True

    if not check_schema(settings_json, default_settings_json):
      print(f'Settings file {SETTINGS_FILE} has an invalid schema.')
      sys.exit(3)
    return settings_json

next_client_id = 0
client_put_queues = {}
redirects = {}
def follow_redirects(x):
  global redirects
  while x in redirects:
    x = redirects[x]
  return x

# Items are either:
# None: stop the gimpSession
# {"icon":..., "offsets":... (pairs), "receivers":...}: generate a stamp, and send a `STAMP|filename` to each receiver
gimp_queue = queue.Queue()
gimp_validate = lambda gimp_request: False # will be replaced below
def startGimpSessionThread(settings):
  global gimp_queue
  global gimp_validate
  global client_put_queues

  assert settings['gimp']['enabled'], f"startGimpSessionThread called when gimp not enabled"

  session_port = settings['gimp']['session_port']
  background_img_path = settings['gimp']['background_img_path']
  foreground_imgs_dir_path = settings['gimp']['foreground_imgs_dir_path']
  output_imgs_dir_path = settings['gimp']['output_imgs_dir_path']
  output_img_extension = settings['gimp']['output_img_extension']

  assert type(session_port) is int, f"bad gimp settings: {json.dumps(settings)}"
  assert os.path.isfile(background_img_path), f"bad gimp settings: {json.dumps(settings)}"
  assert os.path.isdir(foreground_imgs_dir_path), f"bad gimp settings: {json.dumps(settings)}"
  assert os.path.isdir(output_imgs_dir_path), f"bad gimp settings: {json.dumps(settings)}"
  assert type(output_img_extension) == str, f"bad gimp settings: {json.dumps(settings)}"

  foreground_imgs_paths_by_icon = {
    f[:f.index('.')]: os.path.join(foreground_imgs_dir_path, f)
    for f in os.listdir(foreground_imgs_dir_path)
  }
  for foreground_img_path in foreground_imgs_paths_by_icon.values():
    assert os.path.isfile(foreground_img_path), f"foreground imgs dir contains a dir: {foreground_img_path}"

  gimp_validate = lambda gimp_request: (
    gimp_request == None 
    or (
      gimp_request['icon'] in foreground_imgs_paths_by_icon
    )
  )

  print("Connecting to gimp session...")

  #gimp_session_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
  #gimp_session_sock.connect(('localhost', session_port))

  gimp_session_subprocess = subprocess.Popen(
    args=[
      'gimp', 
      '-i', # run without GUI
      '-s', # don't show splash (shouldn't happen since we -i but who knows)
      '-f', # don't load fonts (we don't need them, improves startup time)
      '-b', '-', # start an interactive Scheme batch command session
    ],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE
  )

  def write_to_session(inputstr):
    print(f"GIMP<{inputstr}>GIMP")
    gimp_session_subprocess.stdin.write((inputstr.encode('utf-8')))
    gimp_session_subprocess.stdin.flush()
    #gimp_session_sock.sendall(inputstr.encode('utf-8'))

  def wait_for_text_on_line(text):
    text = text.encode('utf-8')
    line = b''
    while True:
      line += gimp_session_subprocess.stdout.read(1)
      #line += gimp_session_sock.recv(1)
      if (text[0] == b'\n' and line == text[1:]) or (len(line) >= len(text) and line[-len(text):] == text):
        print(f"GIMP>{line.decode('utf-8')}<GIMP")
        if line.endswith(b'\n'):
          line = b''
        break
      if line.endswith(b'\n'):
        print(f"GIMP>{line.decode('utf-8')}<GIMP")
        line = b''

  wait_for_text_on_line('ts> ')
  write_to_session(
    f"(define stamper-env "
      f"(stamper-setup-env "
        f"\"{background_img_path}\" "
        f"""(list {' '.join([f'"{path}"' for path in foreground_imgs_paths_by_icon.values()])}) """
      f") "
    f")\n"
  )

  wait_for_text_on_line('ts> ')
  print("Gimp session ready")

  def continue_gimp_session():
    try:
      while True:
        request = gimp_queue.get()
        if not gimp_validate(request):
          continue
        if request is None:
          break

        icon = request['icon']
        offsets = request['offsets']
        offsets_as_lists = [
          f"(list {' '.join([(str(coord) if coord >= 0 else f'(- 0 {-coord})') for coord in offset])})"
          for offset in offsets
        ]
        receivers = request['receivers']

        output_img_filename = f"{uuid.uuid4().hex}.{output_img_extension}"
        output_img_path = os.path.join(output_imgs_dir_path, output_img_filename)

        write_to_session(
          f"(stamper-stamp "
            f"stamper-env "
            f"\"{foreground_imgs_paths_by_icon[icon]}\" "
            f"(list {' '.join(offsets_as_lists)}) "
            f"\"{output_img_path}\" "
          f")\n"
        )

        wait_for_text_on_line('"Seal Saved"\n')

        print(f"STAMP>>{','.join([str(x) for x in receivers])}: {output_img_filename}")
        for dest in receivers:
          client_put_queues[dest](f"STAMP|{output_img_filename}")

        wait_for_text_on_line('ts> ')

    finally:
      print("Shutting down gimp session...")

      write_to_session(
        f"(stamper-teardown-env stamper-env)\n"
      )

      wait_for_text_on_line('ts> ')
      write_to_session(
        f"(gimp-quit 0)\n"
      )
      gimp_session_subprocess.communicate()
      gimp_session_subprocess.wait()
      #gimp_session_sock.close()

  session_thread = threading.Thread(target=continue_gimp_session, daemon=True)
  session_thread.start()
  return session_thread

def createWebsocketServerHandler(settings):
  async def websocketServer(websocket, *args, **kwargs):
    global next_client_id, client_put_queues, redirects

    client_id = next_client_id
    next_client_id += 1
    print(f"{client_id} joins")

    client_queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    client_put_queues[client_id] = lambda msg: loop.call_soon_threadsafe(lambda: client_queue.put_nowait(msg))
    try:
      client_queue.put_nowait(f"WELCOME|{client_id}|{','.join([str(x) for x in client_put_queues.keys()])}")

      for (dest_client_id, dest_put_queue) in client_put_queues.items():
        if dest_client_id == client_id:
          continue
        dest_put_queue(f"JOIN|{client_id}")

      async def sender(websocket, client_id, client_queue):
        while True:
          msg = await client_queue.get()
          if msg == "STOP":
            return
          await websocket.send(msg)

      async def receiver(websocket, client_id, client_put_queues, redirects):
        while True:
          msg = await websocket.recv()
          if msg.startswith("MSG"): # MSG|dest1,dest2,...|msg
            orig_msg = msg
            msg = msg[msg.index("|") + 1:] # dests|msg
            dest = msg[:msg.index("|")]
            msg = msg[msg.index("|") + 1:] # msg

            print(f"{client_id}>>{dest}: {msg}")

            if dest == "A":
              # broadcast
              for (dest_client_id, dest_put_queue) in client_put_queues.items():
                if dest_client_id == client_id:
                  continue
                dest_put_queue(f"MSG|{msg}")
            else:
              # specific
              dests = dest.split(',')
              for dest in dests:
                assert dest.isnumeric(), f"unrecognized MSG destination: {orig_msg}"
              dests = [int(dest) for dest in dests]
              assert client_id not in dests, f"Can't MSG to yourself: {orig_msg}"
              dests = [follow_redirects(dest) for dest in dests]
              for dest in dests:
                assert dest in client_put_queues, f"Invalid MSG dest id: {orig_msg}"
              for dest in dests:
                client_put_queues[dest](f"MSG|{msg}")

          elif msg.startswith("STAMP_CLEAR"): # STAMP_CLEAR
            print(f"{client_id}: STAMP_CLEAR")
            assert settings['gimp']['enabled'], f"STAMP_CLEAR message when gimp disabled"
            output_imgs_dir_path = settings['gimp']['output_imgs_dir_path']
            assert os.path.isdir(output_imgs_dir_path), f"bad gimp settings: {json.dumps(settings)}"
            for f in os.listdir(output_imgs_dir_path):
              os.remove(os.path.join(output_imgs_dir_path, f))

          elif msg.startswith("STAMP"): # STAMP|icon|off1x,off1y;off2x,...|dest1,dest2...
            assert settings['gimp']['enabled'], f"STAMP message when gimp disabled"
            print(f'{client_id}: {msg}')
            orig_msg = msg
            msg = msg[msg.index("|") + 1:] # icon|offsets|dests
            icon = msg[:msg.index("|")]
            msg = msg[msg.index("|") + 1:] # offsets|dests
            offsets = msg[:msg.index("|")] 
            msg = msg[msg.index("|") + 1:] # dests
            dests = msg.split(',')

            if offsets == '':
              offsets = []
            else:
              offsets = [offset.split(',') for offset in offsets.split(';')]
            for offset in offsets:
              assert len(offset) == 2, f"invalid STAMP offset: {orig_msg}"
              for x in offset:
                assert (x[1:] if x.startswith("-") else x).isnumeric(), f"invalid STAMP offset: {orig_msg}"
            offsets = [tuple([int(x) for x in offset]) for offset in offsets]

            for dest in dests:
                assert dest.isnumeric(), f"unrecognized STAMP destination: {orig_msg}"
            dests = [follow_redirects(int(dest)) for dest in dests]
            for dest in dests:
              assert dest in client_put_queues, f"Invalid STAMP dest id: {orig_msg}"

            request = { "icon": icon, "offsets": offsets, "receivers": dests }
            assert gimp_validate(request), f"STAMP gimp request failed validation: {orig_msg}"
            gimp_queue.put(request)

          elif msg.startswith("LEAVE"):
            print(f"{client_id}: {msg}")
            if msg.startswith("LEAVE|"):
              # redirect provided
              redirect_dest = msg[msg.index("|") + 1:]
              assert redirect_dest.isnumeric(), f"Invalid LEAVE dest id: {orig_msg}"
              redirects[client_id] = int(redirect_dest)
            client_put_queues.pop(client_id)("STOP")
            puts = []
            for dest_put_queue in client_put_queues.values():
              dest_put_queue(f"LEAVE|{client_id}")
            return

          else:
            assert False, f"unrecognized message type: {msg}"

      await asyncio.gather(
        sender(websocket, client_id, client_queue),
        receiver(websocket, client_id, client_put_queues, redirects)
      )
    finally:
      if client_id in client_put_queues:
        client_put_queues.pop(client_id)

  return websocketServer

async def serveWebsocketServer(settings, ssl_context):
  port = settings['ports']['ws'] if ssl_context is None else settings['ports']['wss']
  async with websockets.serve(createWebsocketServerHandler(settings), settings['host_to_bind'], port, ssl=ssl_context):
    print(f"Listening on {port} (websocket -- {'secure' if ssl_context is not None else 'insecure'})")
    await asyncio.Future()

def runAsync(func, args):
  loop = asyncio.new_event_loop()
  asyncio.set_event_loop(loop)

  loop.run_until_complete(func(*args))
  loop.close()

class LongcacheHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
  def end_headers(self):
    self.send_my_headers()
    http.server.SimpleHTTPRequestHandler.end_headers(self)

  def send_my_headers(self):
    self.send_header("Cache-Control", "public, max_age=300")

def getRequestHandlerConstructor(settings):
  if settings['gimp']['enabled'] is True:
    output_imgs_dir_path = settings['gimp']['output_imgs_dir_path']
    assert os.path.isdir(output_imgs_dir_path)

    def constructor(*args, **kwargs):
      return LongcacheHTTPRequestHandler(*args, **kwargs, directory=output_imgs_dir_path)
    
    return constructor

  else:
    return http.server.BaseHttpRequestHandler

def serveHttpServer(settings, ssl_context):
  port = settings['ports']['http'] if ssl_context is None else settings['ports']['https']
  httpd = http.server.ThreadingHTTPServer((settings['host_to_bind'], port), getRequestHandlerConstructor(settings))
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

  if settings['gimp']['enabled'] is True:
    threads.append(startGimpSessionThread(settings))

  for thread in threads:
    while thread.is_alive():
      thread.join(2)
    gimp_queue.put(None) # stop the gimp thread as soon as one of the main threads exits


if __name__ == '__main__':
  main()
