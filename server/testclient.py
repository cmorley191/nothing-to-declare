import aioconsole
import asyncio
import sys
import websockets

addr = f"ws://{sys.argv[1]}"

async def testclient():
  async with websockets.connect(addr) as websocket:
    print("Connected")

    async def sender(websocket):
      while True:
        msg = await aioconsole.ainput()
        await websocket.send(msg)

    async def receiver(websocket):
      while True:
        msg = await websocket.recv()
        if (type(msg) is bytes):
          with open('msg.bin', 'wb') as f:
            f.write(msg)
          print('Binary message written to msg.bin')
        else:
          print(f"<{msg}")

    await asyncio.gather(
      sender(websocket),
      receiver(websocket)
    )
      
asyncio.run(testclient())