"""DramaForge AI 后端 — FastAPI + SQLite"""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import logging

from .database import init_db
from .routers import projects, assets, uploads, agent, llm_providers

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

logger = logging.getLogger("dramaforge")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="DramaForge AI Backend", version="1.0.0")

# CORS — 允许任意来源（开发用）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 422 异常处理 — 打印错误详情便于调试
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.error(f"[422] {request.method} {request.url.path} body invalid: {exc.errors()[:3]}")
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors()},
    )

# 静态文件 — 上传的图片可通过 /files/<filename> 直接访问
app.mount("/files", StaticFiles(directory=str(UPLOAD_DIR)), name="files")

# 启动时初始化数据库
@app.on_event("startup")
def on_startup():
    init_db()

# 路由
app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
app.include_router(assets.router, prefix="/api/assets", tags=["assets"])
app.include_router(uploads.router, prefix="/api/uploads", tags=["uploads"])
app.include_router(agent.router, prefix="/api/agent", tags=["agent"])
app.include_router(llm_providers.router, prefix="/api/llm-providers", tags=["llm-providers"])


@app.get("/api/health")
def health():
    return {"status": "ok"}
