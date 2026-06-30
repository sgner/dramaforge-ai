# DramaForge AI Backend

FastAPI + SQLite 后端，持久化项目、节点、连接、资产库、上传图片。

## 启动

```bash
cd backend
python main.py                    # 默认 127.0.0.1:8765
python main.py --port 9000        # 自定义端口
python main.py --host 0.0.0.0     # 允许外部访问
python main.py --reload           # 开发模式热重载
```

## 前端接入

`vite.config.ts` 中 `server.proxy` 已将 `/api` 和 `/files` 转发到 `http://127.0.0.1:8765`。

如果后端改了端口，前端也要相应修改 `vite.config.ts`。

## 数据存储

- SQLite 数据库：`backend/dramaforge.db`（自动创建）
- 上传图片：`backend/uploads/`（静态文件通过 `/files/<filename>` 访问）
