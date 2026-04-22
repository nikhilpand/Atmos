"""WebSocket Router — /ws/admin real-time feed"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from persistent_queue import PersistentQueue
from transfer_manager import TransferManager

router = APIRouter()

tm = TransferManager()
pq = PersistentQueue()

# Connected admin clients
_ws_clients: list = []


@router.websocket("/ws/admin")
async def ws_admin(websocket: WebSocket):
    """Real-time WebSocket feed for admin dashboard."""
    await websocket.accept()
    _ws_clients.append(websocket)
    try:
        try:
            await websocket.send_json({
                "type": "connected",
                "queue_size": pq.get_stats().get('queued', 0),
                "transfers": len(tm.get_active_transfers()) if hasattr(tm, 'get_active_transfers') else 0,
            })
        except Exception as e:
            print(f"WS initial state error: {e}")
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if websocket in _ws_clients:
            _ws_clients.remove(websocket)


async def ws_broadcast(event: dict):
    """Broadcast an event to all connected admin WebSocket clients."""
    dead = []
    for ws in _ws_clients:
        try:
            await ws.send_json(event)
        except Exception:
            dead.append(ws)
    for ws in dead:
        if ws in _ws_clients:
            _ws_clients.remove(ws)
