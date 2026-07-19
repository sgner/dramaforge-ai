"""DramaForge AI 后端 — FastAPI + SQLite"""
import os

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import logging

from .database import init_db
from .routers import projects, assets, uploads, agent, llm_providers, media_providers, media, providers, drama_tasks, user_preferences, prompt_templates, bootstrap

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

logger = logging.getLogger("dramaforge")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="DramaForge AI Backend", version="1.0.0")

# CORS — 收紧到本地前端源，可通过环境变量覆盖。
#
# 前端开发场景：Vite dev server 跑在 5173 端口（vite.config.ts，host 0.0.0.0），
# 浏览器经 vite proxy 访问 /api 时 Origin 是 vite dev server 的源
# （http://localhost:5173 / http://127.0.0.1:5173 / http://[::1]:5173）。
# 4173 是 vite preview 的默认端口，一并放行便于本地预览构建产物。
# 生产/打包场景前后端同源（同一端口直接服务静态文件），浏览器不带跨域 Origin，
# CORS 不生效，因此无需额外放行。
#
# 如需放开其它源（如局域网 IP 访问 dev server），设置环境变量：
#   DRAMAFORGE_CORS_ORIGINS="http://localhost:5173,http://192.168.1.10:5173"
_DEFAULT_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://[::1]:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]


def _cors_origins() -> list[str]:
    """从 DRAMAFORGE_CORS_ORIGINS（逗号分隔）读取允许的源，缺省用本地 dev 白名单。

    显式设置为空字符串（如 DRAMAFORGE_CORS_ORIGINS=""）表示完全关闭跨域放行
    （仅同源访问），此时 allow_credentials 也无意义，一并关掉。
    """
    raw = os.environ.get("DRAMAFORGE_CORS_ORIGINS")
    if raw is None:
        return list(_DEFAULT_CORS_ORIGINS)
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


_CORS_ORIGINS = _cors_origins()

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    # credentials 只在明确白名单下开启（"*" + credentials 是浏览器非法组合且全开放）
    allow_credentials=bool(_CORS_ORIGINS),
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
    # Seed builtin prompt templates
    from .database import SessionLocal
    from .agent.prompt_template_seed import seed_builtin_prompt_templates
    with SessionLocal() as db:
        seed_builtin_prompt_templates(db)


# 启动时恢复僵尸 agent 任务：runtime 是纯内存态，进程重启后 DB 中
# status=running 的任务必然已死，从 DB 全量重建继续执行。
# 单个任务恢复失败不影响其他任务和应用启动（函数内部已逐个 try/except）。
@app.on_event("startup")
async def recover_agent_tasks_on_startup():
    from .routers.agent import recover_zombie_agent_tasks
    await recover_zombie_agent_tasks()

# 路由
app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
app.include_router(assets.router, prefix="/api/assets", tags=["assets"])
app.include_router(uploads.router, prefix="/api/uploads", tags=["uploads"])
app.include_router(agent.router, prefix="/api/agent", tags=["agent"])
app.include_router(llm_providers.router, prefix="/api/llm-providers", tags=["llm-providers"])
app.include_router(media_providers.router, prefix="/api/media-providers", tags=["media-providers"])
app.include_router(media.router, prefix="/api/media", tags=["media"])
app.include_router(providers.router, prefix="/api/providers", tags=["providers"])
app.include_router(drama_tasks.router, prefix="/api/drama-tasks", tags=["drama-tasks"])
app.include_router(user_preferences.router, prefix="/api/user-preferences", tags=["user-preferences"])
app.include_router(prompt_templates.router, prefix="/api/prompt-templates", tags=["prompt-templates"])
app.include_router(bootstrap.router, prefix="/api", tags=["bootstrap"])


@app.get("/api/health")
def health():
    return {"status": "ok"}
