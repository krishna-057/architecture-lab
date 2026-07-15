from datetime import datetime, timezone
from typing import Literal
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


app = FastAPI(title="PocketSentinel API", version="0.1.0")


class CreateSessionRequest(BaseModel):
    device_label: str = Field(default="Phone camera", min_length=1, max_length=80)


class SessionResponse(BaseModel):
    session_id: UUID
    device_label: str
    status: Literal["waiting_for_camera", "streaming", "ended"]
    signaling_path: str
    created_at: datetime


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


sessions: dict[UUID, SessionResponse] = {}
events: dict[UUID, list[DetectionEventResponse]] = {}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/sessions", response_model=SessionResponse)
def create_session(payload: CreateSessionRequest) -> SessionResponse:
    session_id = uuid4()
    session = SessionResponse(
        session_id=session_id,
        device_label=payload.device_label,
        status="waiting_for_camera",
        signaling_path=f"/api/sessions/{session_id}/signal",
        created_at=datetime.now(timezone.utc),
    )
    sessions[session_id] = session
    events[session_id] = []
    return session


@app.get("/api/sessions/{session_id}", response_model=SessionResponse)
def get_session(session_id: UUID) -> SessionResponse:
    session = sessions.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found.")
    return session


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
