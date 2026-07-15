from datetime import datetime, timedelta, timezone
from secrets import choice
from string import ascii_uppercase, digits
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


app = FastAPI(title="PocketSentinel API", version="0.1.0")


class CreateSessionRequest(BaseModel):
    device_label: str = Field(default="Phone camera", min_length=1, max_length=80)


class SessionResponse(BaseModel):
    session_id: UUID
    device_label: str
    status: Literal["waiting_for_camera", "pairing", "streaming", "ended"]
    pairing_code: str
    signaling_path: str
    created_at: datetime
    expires_at: datetime


class DetectionEventRequest(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    confidence: float = Field(ge=0, le=1)
    occurred_at: datetime | None = None


class DetectionEventResponse(BaseModel):
    event_id: UUID
    session_id: UUID
    label: str
    confidence: float
    occurred_at: datetime


class SignalMessageRequest(BaseModel):
    sender_role: Literal["camera", "dashboard"]
    type: Literal["offer", "answer", "ice-candidate", "ready", "bye"]
    payload: dict[str, Any] = Field(default_factory=dict)
    client_message_id: str | None = Field(default=None, max_length=120)


class SignalMessageResponse(BaseModel):
    message_id: UUID
    session_id: UUID
    sequence: int
    sender_role: Literal["camera", "dashboard"]
    recipient_role: Literal["camera", "dashboard"]
    type: Literal["offer", "answer", "ice-candidate", "ready", "bye"]
    payload: dict[str, Any]
    client_message_id: str | None = None
    created_at: datetime


sessions: dict[UUID, SessionResponse] = {}
events: dict[UUID, list[DetectionEventResponse]] = {}
pairings: dict[str, UUID] = {}
signals: dict[UUID, list[SignalMessageResponse]] = {}


def generate_pairing_code() -> str:
    alphabet = ascii_uppercase + digits
    while True:
        code = "".join(choice(alphabet) for _ in range(6))
        if code not in pairings:
            return code


def update_session(session: SessionResponse, **changes: object) -> SessionResponse:
    if hasattr(session, "model_copy"):
        updated = session.model_copy(update=changes)
    else:
        updated = session.copy(update=changes)
    sessions[session.session_id] = updated
    return updated


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/sessions", response_model=SessionResponse)
def create_session(payload: CreateSessionRequest) -> SessionResponse:
    session_id = uuid4()
    pairing_code = generate_pairing_code()
    now = datetime.now(timezone.utc)
    session = SessionResponse(
        session_id=session_id,
        device_label=payload.device_label,
        status="waiting_for_camera",
        pairing_code=pairing_code,
        signaling_path=f"/api/sessions/{session_id}/signal",
        created_at=now,
        expires_at=now + timedelta(minutes=10),
    )
    sessions[session_id] = session
    events[session_id] = []
    pairings[pairing_code] = session_id
    signals[session_id] = []
    return session


@app.get("/api/sessions/{session_id}", response_model=SessionResponse)
def get_session(session_id: UUID) -> SessionResponse:
    session = sessions.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found.")
    return session


@app.post("/api/pairings/{pairing_code}/claim", response_model=SessionResponse)
def claim_pairing(pairing_code: str) -> SessionResponse:
    session_id = pairings.get(pairing_code.upper())
    if session_id is None:
        raise HTTPException(status_code=404, detail="Pairing code not found.")

    session = sessions[session_id]
    if session.status == "ended":
        raise HTTPException(status_code=409, detail="Session has ended.")
    if session.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Pairing code expired.")

    if session.status == "waiting_for_camera":
        session = update_session(session, status="pairing")
    return session


@app.post("/api/sessions/{session_id}/signal", response_model=SignalMessageResponse)
def post_signal(session_id: UUID, payload: SignalMessageRequest) -> SignalMessageResponse:
    session = sessions.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found.")
    if session.status == "ended":
        raise HTTPException(status_code=409, detail="Session has ended.")

    existing_messages = signals.setdefault(session_id, [])
    recipient_role = "dashboard" if payload.sender_role == "camera" else "camera"
    message = SignalMessageResponse(
        message_id=uuid4(),
        session_id=session_id,
        sequence=len(existing_messages) + 1,
        sender_role=payload.sender_role,
        recipient_role=recipient_role,
        type=payload.type,
        payload=payload.payload,
        client_message_id=payload.client_message_id,
        created_at=datetime.now(timezone.utc),
    )
    existing_messages.append(message)

    if payload.type == "answer" and session.status == "pairing":
        update_session(session, status="streaming")
    if payload.type == "bye":
        update_session(session, status="ended")

    return message


@app.get("/api/sessions/{session_id}/signal", response_model=list[SignalMessageResponse])
def list_signals(
    session_id: UUID,
    recipient_role: Literal["camera", "dashboard"],
    after_sequence: int = 0,
) -> list[SignalMessageResponse]:
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found.")

    return [
        message
        for message in signals.get(session_id, [])
        if message.recipient_role == recipient_role and message.sequence > after_sequence
    ]


@app.post("/api/sessions/{session_id}/detections", response_model=DetectionEventResponse)
def record_detection(session_id: UUID, payload: DetectionEventRequest) -> DetectionEventResponse:
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found.")

    event = DetectionEventResponse(
        event_id=uuid4(),
        session_id=session_id,
        label=payload.label,
        confidence=payload.confidence,
        occurred_at=payload.occurred_at or datetime.now(timezone.utc),
    )
    events[session_id].append(event)
    return event


@app.get("/api/sessions/{session_id}/detections", response_model=list[DetectionEventResponse])
def list_detections(session_id: UUID) -> list[DetectionEventResponse]:
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found.")
    return events[session_id]
