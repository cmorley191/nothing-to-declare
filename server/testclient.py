import aioconsole
import asyncio
import sys
import websockets

addr = "ws://localhost:8765"

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
        print(f"<{msg}")

    await asyncio.gather(
      sender(websocket),
      receiver(websocket)
    )
      
asyncio.run(testclient())