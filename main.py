import hashlib
import os
import secrets
import threading
import time

from flask import Flask, jsonify, render_template, request, session
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.middleware.proxy_fix import ProxyFix

MIN_PASSWORD = 8
MAX_NICKNAME = 20
MAX_ROOMS = 200
MAX_MEMBERS = 30
MAX_MESSAGES = 300

app = Flask(__name__)
app.secret_key = secrets.token_hex(32)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,      # JS can't read the cookie
    SESSION_COOKIE_SAMESITE="Strict",  # other sites can't make your browser send it
    SESSION_COOKIE_SECURE=bool(os.environ.get("HTTPS")),  # set HTTPS=1 behind ngrok/HTTPS
    MAX_CONTENT_LENGTH=4 * 1024,       # reject huge request bodies outright
)

# Behind ngrok every request comes from the proxy's IP, so trust its forwarded header.
# Only enable this when you really are behind a proxy (set BEHIND_PROXY=1).
if os.environ.get("BEHIND_PROXY"):
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1)

limiter = Limiter(get_remote_address, app=app, default_limits=["120/minute"])

rooms = {}
rooms_lock = threading.Lock()


def get_or_create_room(room_id):
    """Return the room, creating it if needed. Returns None if the server is full."""
    with rooms_lock:
        if room_id not in rooms:
            if len(rooms) >= MAX_ROOMS:
                return None
            rooms[room_id] = {
                "messages": [],
                "members": {},
                "next_id": 1,
                "created": time.time(),
            }
        return rooms[room_id]


def add_message(room, name, text, kind="chat"):
    """Append a message to a room. The caller must already hold rooms_lock."""
    message = {
        "id": room["next_id"],
        "kind": kind,                  # "chat" or "system"
        "name": name,
        "text": text,
        "time": time.time(),
    }
    room["next_id"] += 1
    room["messages"].append(message)
    if len(room["messages"]) > MAX_MESSAGES:
        del room["messages"][0]        # drop the oldest
    return message


def remove_member(room_id, member_id):
    """Remove a member. Announce it if others remain, delete the room if not."""
    with rooms_lock:
        room = rooms.get(room_id)
        if room is None:
            return

        member = room["members"].pop(member_id, None)
        if member is None:
            return                      # already gone, so don't announce twice

        if room["members"]:
            add_message(room, "", f"{member['nickname']} left", kind="system")
        else:
            del rooms[room_id]          # last one out: the room vanishes
    print("remove_member:", room_id[:6] if room_id else None, member_id, "found:", member is not None)



def current_member():
    """Return (room, member) for this session, or (None, None)."""
    room = rooms.get(session.get("room_id"))
    if room is None:
        return None, None
    member = room["members"].get(session.get("member_id"))
    if member is None:
        return None, None
    return room, member


@app.route("/")
def index():
    return render_template("chat.html")


@app.post("/join")
@limiter.limit("10/minute")
def join():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        body = {}
    nickname = str(body.get("nickname", "")).strip()
    password = str(body.get("password", "")).strip()

    if not nickname or len(nickname) > MAX_NICKNAME:
        return jsonify(ok=False, error=f"Nickname must be 1-{MAX_NICKNAME} characters."), 400
    if len(password) < MIN_PASSWORD:
        return jsonify(ok=False, error=f"Password must be at least {MIN_PASSWORD} characters."), 400

    # If this browser was already in a room, leave it first so no ghost member stays behind
    remove_member(session.get("room_id"), session.get("member_id"))

    room_id = hashlib.sha256(password.encode()).hexdigest()
    room = get_or_create_room(room_id)
    if room is None:
        return jsonify(ok=False, error="Server is full, try again later."), 503

    with rooms_lock:
        if len(room["members"]) >= MAX_MEMBERS:
            return jsonify(ok=False, error="That room is full."), 403

        taken = {m["nickname"].lower() for m in room["members"].values()}
        if nickname.lower() in taken:
            return jsonify(ok=False, error="That nickname is taken in this room."), 409

        member_id = secrets.token_hex(8)
        room["members"][member_id] = {
            "nickname": nickname,
            "last_seen": time.time(),
        }
        add_message(room, "", f"{nickname} joined", kind="system")
        since = room["next_id"] - 1    # newest message id at this moment

    session["room_id"] = room_id
    session["member_id"] = member_id
    session["nickname"] = nickname

    return jsonify(ok=True, since=since)


@app.post("/send")
@limiter.limit("30/minute")
def send():
    room, member = current_member()
    if room is None:
        return jsonify(ok=False, error="Not in a room."), 401

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        data = {}
    text = str(data.get("text", "")).strip()
    if not text or len(text) > 500:
        return jsonify(ok=False, error="Message must be 1-500 characters."), 400

    with rooms_lock:
        message = add_message(room, member["nickname"], text)
        member["last_seen"] = time.time()

    return jsonify(ok=True, id=message["id"])


@app.get("/messages")
@limiter.limit("300/minute")
def messages():
    room, member = current_member()
    if room is None:
        return jsonify(ok=False, error="Not in a room."), 401

    after = request.args.get("after", 0, type=int)

    with rooms_lock:
        member["last_seen"] = time.time()
        new = [m for m in room["messages"] if m["id"] > after]
        online = len(room["members"])

    return jsonify(ok=True, messages=new, online=online)


@app.post("/leave")
def leave():
    remove_member(session.get("room_id"), session.get("member_id"))
    session.clear()
    return jsonify(ok=True)