import os
import sys
import tempfile
from pathlib import Path


def _resolve_runtime_paths() -> tuple[Path, Path, Path, Path]:
    if getattr(sys, "frozen", False):
        package_root = Path(sys.executable).resolve().parent
        return package_root, package_root, package_root / "frontend-dist", package_root

    backend_dir = Path(__file__).resolve().parent
    dashboard_dir = backend_dir.parent
    project_dir = dashboard_dir.parent
    frontend_dist_dir = dashboard_dir / "frontend" / "dist"
    return backend_dir, project_dir, frontend_dist_dir, dashboard_dir


BACKEND_DIR, PROJECT_DIR, FRONTEND_DIST_DIR, DASHBOARD_DIR = _resolve_runtime_paths()

# ── Data paths ─────────────────────────────────────────────────────────────────
# DATA_DIR env var lets Docker / Fly.io redirect data to a persistent volume (/data).
# Falls back to the project root for local development.
_data_dir = Path(os.getenv("DATA_DIR", str(PROJECT_DIR)))
RAW_DATA_PATH = _data_dir / "raw_data.xlsx"

# Cache lives alongside raw_data so it's also on the persistent volume in production.
CACHE_DIR = _data_dir / "cache"

FINANCIAL_TOOL_EXE_PATH = PROJECT_DIR / "financial_tool.exe"
MODEL_PATH = PROJECT_DIR / "Smit Financial Model.xlsm"
PACKAGE_MODE = getattr(sys, "frozen", False)


def _ensure_cache_dir() -> Path:
    preferred_dir = CACHE_DIR
    try:
        preferred_dir.mkdir(exist_ok=True, parents=True)
        return preferred_dir
    except (PermissionError, OSError):
        fallback_dir = Path(tempfile.gettempdir()) / "valuation_dashboard_cache"
        try:
            fallback_dir.mkdir(exist_ok=True, parents=True)
        except (PermissionError, OSError):
            return Path(tempfile.gettempdir())
        return fallback_dir


CACHE_DIR = _ensure_cache_dir()


def _parse_origins(value: str | None) -> list[str]:
    if not value:
        return [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ]
    return [origin.strip() for origin in value.split(",") if origin.strip()]


ALLOWED_ORIGINS = _parse_origins(os.getenv("VALUATION_DASHBOARD_ALLOWED_ORIGINS"))
DEFAULT_PORT = int(os.getenv("VALUATION_DASHBOARD_BACKEND_PORT", "8000"))
BACKEND_HOST = os.getenv("VALUATION_DASHBOARD_BACKEND_HOST", "127.0.0.1")
FRONTEND_PORT = int(os.getenv("VALUATION_DASHBOARD_FRONTEND_PORT", "5173"))

PROVIDER_API_KEYS = {
    "anthropic": os.getenv("ANTHROPIC_API_KEY", "").strip(),
    "perplexity": os.getenv("PERPLEXITY_API_KEY", "").strip(),
    "gemini": os.getenv("GEMINI_API_KEY", "").strip(),
}


def provider_is_configured(provider: str) -> bool:
    return bool(PROVIDER_API_KEYS.get(provider, ""))


def configured_providers() -> list[str]:
    return [provider for provider, value in PROVIDER_API_KEYS.items() if value]


def frontend_dist_available() -> bool:
    return (
        FRONTEND_DIST_DIR.exists()
        and (FRONTEND_DIST_DIR / "index.html").exists()
        and (FRONTEND_DIST_DIR / "assets").exists()
    )
