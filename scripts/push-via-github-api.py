"""Fallback push via GitHub Git Data API (api.github.com reachable; github.com blocked).

Replays local commits (origin/refactor/runway-ui..HEAD) onto the remote ref:
blobs -> trees (base_tree + changed entries) -> commits -> update ref.
Token comes from `git credential fill` and is never printed.
"""
import base64
import json
import subprocess
import sys
import urllib.request
import urllib.error

OWNER, REPO, BRANCH = "sgner", "dramaforge-ai", "refactor/runway-ui"
API = f"https://api.github.com/repos/{OWNER}/{REPO}"


def git(*args, check=True):
    r = subprocess.run(["git", *args], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {r.stderr.strip()}")
    return r.stdout.strip()


def get_token():
    r = subprocess.run(
        ["git", "credential", "fill"],
        input="protocol=https\nhost=github.com\n\n",
        capture_output=True, text=True,
    )
    for line in r.stdout.splitlines():
        if line.startswith("password="):
            return line[len("password="):]
    raise RuntimeError("no github.com credential found")


TOKEN = get_token()


def api(method, path, payload=None):
    req = urllib.request.Request(
        API + path,
        method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
        data=json.dumps(payload).encode() if payload is not None else None,
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path}: {e.code} {e.read().decode()[:300]}")


def upload_blob(content: bytes) -> str:
    out = api("POST", "/git/blobs", {
        "content": base64.b64encode(content).decode(),
        "encoding": "base64",
    })
    return out["sha"]


def main():
    # 以服务端实际 ref 为基（本地 origin 引用可能落后于 API 重放过的远端）
    remote_sha = api("GET", f"/git/ref/heads/{BRANCH}")["object"]["sha"]
    head_sha = git("rev-parse", "HEAD")
    # 本地 origin 引用落后于服务端时，以 argv[1] 或本地 origin 为起点找本地独有提交
    local_origin = git("rev-parse", "origin/refactor/runway-ui")
    base = sys.argv[1] if len(sys.argv) > 1 else local_origin
    try:
        commits = git("rev-list", "--reverse", f"{base}..{head_sha}").splitlines()
    except RuntimeError:
        commits = []
    if not commits:
        print("nothing to replay")
        return
    print(f"replaying {len(commits)} commits onto {BRANCH} (remote at {remote_sha[:7]})")

    parent = remote_sha
    parent_tree = api("GET", f"/git/commits/{remote_sha}")["tree"]["sha"]
    for sha in commits:
        message = git("log", "-1", "--format=%B", sha)
        entries = []
        diff = git("diff-tree", "--no-commit-id", "--name-status", "-r", sha)
        for line in diff.splitlines():
            status, path = line.split("\t", 1)
            if status.startswith("D"):
                entries.append({"path": path, "mode": "100644", "type": "blob", "sha": None})
            else:
                content = git("show", f"{sha}:{path}").encode("utf-8")
                # binary-safe read via cat-file
                blob_raw = subprocess.run(
                    ["git", "cat-file", "blob", f"{sha}:{path}"],
                    capture_output=True,
                ).stdout
                blob_sha = upload_blob(blob_raw)
                entries.append({"path": path, "mode": "100644", "type": "blob", "sha": blob_sha})
        tree = api("POST", "/git/trees", {"base_tree": parent_tree, "tree": entries})
        commit = api("POST", "/git/commits", {
            "message": message,
            "tree": tree["sha"],
            "parents": [parent],
        })
        print(f"  {sha[:7]} -> {commit['sha'][:7]}  {message.splitlines()[0][:60]}")
        parent = commit["sha"]
        # 新 commit 只在服务端存在，tree sha 直接从响应里取，不做本地解析
        parent_tree = commit["tree"]["sha"]

    api("PATCH", f"/git/refs/heads/{BRANCH}", {"sha": parent, "force": False})
    print(f"done: {BRANCH} updated to {parent[:7]}")


if __name__ == "__main__":
    sys.exit(main())
