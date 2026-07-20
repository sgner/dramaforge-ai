# -*- coding: utf-8 -*-
"""一次性 UI 验证脚本：启动后端+vite preview+无头 Edge，CDP 截图后全部清理。"""
import base64
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import requests
import websocket

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
NODE = r"C:\Users\25315\AppData\Local\Programs\kimi-desktop\resources\resources\runtime\node.exe"
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
SHOTS = ROOT / "docs" / "creator-studio" / "shots"
SHOTS.mkdir(parents=True, exist_ok=True)

procs = []


def wait_port(url, timeout=30):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            urllib.request.urlopen(url, timeout=2)
            return True
        except Exception:
            time.sleep(0.5)
    return False


class CDP:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=30)
        self.mid = 0

    def call(self, method, params=None):
        self.mid += 1
        self.ws.send(json.dumps({"id": self.mid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self.mid:
                return msg.get("result", {})

    def eval(self, expr):
        r = self.call("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
        return r.get("result", {}).get("value")

    def shot(self, name):
        r = self.call("Page.captureScreenshot", {"format": "jpeg", "quality": 82})
        p = SHOTS / name
        p.write_bytes(base64.b64decode(r["data"]))
        print("saved", p)

    def click_selector(self, sel):
        return self.eval(
            "(()=>{const b=document.querySelector(%s);if(!b)return 'MISS';"
            "b.scrollIntoView({block:'center'});b.click();return 'OK'})()" % json.dumps(sel)
        )


def main():
    # 1) 后端 + 前端 preview
    procs.append(subprocess.Popen(
        [str(BACKEND / ".venv" / "Scripts" / "python.exe"), "main.py"],
        cwd=str(BACKEND), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
    procs.append(subprocess.Popen(
        [NODE, str(ROOT / "node_modules" / "vite" / "bin" / "vite.js"), "preview", "--port", "4173", "--strictPort"],
        cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
    assert wait_port("http://127.0.0.1:8765/api/bootstrap", 40), "backend not up"
    assert wait_port("http://127.0.0.1:4173/", 40), "preview not up"
    print("servers up")

    # 2) 无头 Edge
    procs.append(subprocess.Popen([
        EDGE, "--headless=new", "--remote-debugging-port=9222", "--remote-allow-origins=*", "--user-data-dir=" + str(SHOTS / ".edge-profile"),
        "--window-size=1600,950", "--hide-scrollbars", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
    ws_url = None
    for _ in range(40):
        try:
            tabs = requests.get("http://127.0.0.1:9222/json", timeout=2).json()
            page = next(t for t in tabs if t["type"] == "page")
            ws_url = page["webSocketDebuggerUrl"]
            break
        except Exception:
            time.sleep(0.5)
    assert ws_url, "edge cdp not up"
    c = CDP(ws_url)
    c.call("Page.enable")
    c.call("Emulation.setDeviceMetricsOverride",
           {"width": 1600, "height": 950, "deviceScaleFactor": 1, "mobile": False})

    # 3) 首页
    c.call("Page.navigate", {"url": "http://127.0.0.1:4173/"})
    time.sleep(7)  # tailwind CDN + bootstrap
    print("title:", c.eval("document.title"))
    print("tasks on page:", c.eval("document.querySelectorAll('article,[data-testid]').length"))
    c.shot("01-home.png")

    # 4) 工作室：点任务卡上的「去工作室成片」，否则先从侧边栏进
    r = c.click_selector('[title="去工作室成片"]')
    print("studio entry:", r)
    if r == "MISS":
        c.eval("(()=>{const els=[...document.querySelectorAll('button,div')];"
               "const b=els.find(e=>e.textContent.trim()==='工作室');if(b){b.click();return 'OK'}return 'MISS'})()")
    time.sleep(5)
    print("studio open:", c.eval("!!document.querySelector('[data-testid=\"studio-panel\"]')"))
    # 切到剪辑台阶段
    c.click_selector('[data-testid="studio-stage-timeline"]')
    time.sleep(3)
    c.shot("02-studio-timeline.png")
    # 导演台阶段
    c.click_selector('[data-testid="studio-stage-director"]')
    time.sleep(3)
    c.shot("03-studio-director.png")
    # 关闭工作室
    c.click_selector('[data-testid="studio-back"]')
    time.sleep(2)

    # 5) 新建项目弹窗
    c.eval("(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.includes('新建项目'));if(b){b.click();return 'OK'}return 'MISS'})()")
    time.sleep(2)
    c.shot("04-new-project.png")

    # 6) 智能画布（第一个项目）
    c.eval("(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='取消');if(b){b.click();return 'OK'}return 'MISS'})()")
    time.sleep(1)
    r = c.eval("(()=>{const card=document.querySelector('article, .group');if(!card)return 'MISS';card.click();return 'OK'})()")
    print("canvas entry:", r)
    time.sleep(6)
    c.shot("05-canvas.png")


if __name__ == "__main__":
    try:
        main()
    finally:
        for p in procs:
            try:
                p.kill()
            except Exception:
                pass
        print("cleaned up")
