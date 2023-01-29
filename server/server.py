import asyncio
import websockets


HOST = "localhost"
PORT = 9282


next_client_id = 0
client_queues = {}
redirects = {}
def follow_redirects(x):
  global redirects
  while x in redirects:
    x = redirects[x]
  return x

async def server(websocket):
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
    client_queues.pop(client_id)

async def main():
  async with websockets.serve(server, HOST, PORT):
    await asyncio.Future()

asyncio.run(main())