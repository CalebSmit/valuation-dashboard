from fastapi.testclient import TestClient

from main import app
from routers import analyze as analyze_router
from routers import pipeline as pipeline_router
from services.pipeline_runner import PipelineError


client = TestClient(app)


def test_health_endpoint_returns_status() -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert "raw_data_exists" in payload
    assert "configured_providers" in payload


def test_pipeline_invalid_ticker_rejected() -> None:
    response = client.post("/api/pipeline/INVALID$")

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid ticker format"


def test_analyze_invalid_ticker_rejected() -> None:
    response = client.post(
        "/api/analyze/INVALID$",
        json={"provider": "anthropic", "api_key": "dummy", "deep_research": False},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid ticker format"


def test_analyze_missing_api_key_rejected(monkeypatch) -> None:
    monkeypatch.setitem(analyze_router.PROVIDER_API_KEYS, "anthropic", "")

    response = client.post(
        "/api/analyze/AAPL",
        json={"provider": "anthropic", "deep_research": False},
    )

    assert response.status_code == 400
    assert "No API key available" in response.json()["detail"]


def test_pipeline_streams_pipeline_error(monkeypatch) -> None:
    async def failing_run_pipeline(_: str):
        raise PipelineError("simulated pipeline failure")
        yield "unreachable"

    monkeypatch.setattr(pipeline_router, "run_pipeline", failing_run_pipeline)

    response = client.post("/api/pipeline/AAPL")

    assert response.status_code == 200
    assert "simulated pipeline failure" in response.text
    assert '"type": "error"' in response.text
