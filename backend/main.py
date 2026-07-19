"""
DramaForge AI 后端启动入口
用法:
    python main.py            # 默认 127.0.0.1:8765
    python main.py --port 9000
    python main.py --host 0.0.0.0 --port 8765 --reload
"""
import argparse

import uvicorn


def main():
    parser = argparse.ArgumentParser(description="DramaForge AI Backend")
    parser.add_argument("--host", default="127.0.0.1", help="绑定 host（默认 127.0.0.1）")
    parser.add_argument("--port", type=int, default=8765, help="监听端口（默认 8765）")
    parser.add_argument("--reload", action="store_true", help="开发模式：文件变更自动重启")
    args = parser.parse_args()

    uvicorn.run(
        "app:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
    )


if __name__ == "__main__":
    main()
