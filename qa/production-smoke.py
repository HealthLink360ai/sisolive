#!/usr/bin/env python3
"""
SISO Live production smoke check.

Runs the minimum client-demo flow against production:
- frontend reachable
- backend health reachable
- admin login works
- admin dashboard/users/documents/diagnostics work
- chat returns a saved queryId
- feedback attaches to that queryId

Usage:
  SISO_ADMIN_EMAIL=admin@abbvie.com SISO_ADMIN_PASSWORD='...' python3 qa/production-smoke.py
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

FRONTEND_URL = os.environ.get("SISO_FRONTEND_URL", "https://sisolive.lspdedge.com")
BACKEND_URL = os.environ.get("SISO_BACKEND_URL", "https://sisolive.vercel.app")
ADMIN_EMAIL = os.environ.get("SISO_ADMIN_EMAIL", "admin@abbvie.com")
ADMIN_PASSWORD = os.environ.get("SISO_ADMIN_PASSWORD")


def request(path_or_url, method="GET", body=None, token=None, timeout=45):
    url = path_or_url if path_or_url.startswith("http") else BACKEND_URL + path_or_url
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read().decode("utf-8", "ignore")
            return {
                "ok": 200 <= res.status < 300,
                "status": res.status,
                "elapsed": round(time.time() - start, 2),
                "body": raw,
            }
    except urllib.error.HTTPError as exc:
        return {
            "ok": False,
            "status": exc.code,
            "elapsed": round(time.time() - start, 2),
            "body": exc.read().decode("utf-8", "ignore"),
        }
    except Exception as exc:
        return {"ok": False, "status": "error", "elapsed": round(time.time() - start, 2), "body": str(exc)}


def as_json(result):
    try:
        return json.loads(result["body"])
    except Exception:
        return {}


def check(name, result, predicate=lambda data: True):
    data = as_json(result)
    ok = result["ok"] and predicate(data)
    print(json.dumps({
        "check": name,
        "ok": ok,
        "status": result["status"],
        "elapsed": result["elapsed"],
    }))
    return ok, data


def main():
    if not ADMIN_PASSWORD:
        print("Set SISO_ADMIN_PASSWORD before running smoke checks.", file=sys.stderr)
        return 2

    failures = 0

    frontend = request(FRONTEND_URL, timeout=20)
    print(json.dumps({
        "check": "frontend",
        "ok": frontend["ok"] and "/api/chat/query" in frontend["body"],
        "status": frontend["status"],
        "elapsed": frontend["elapsed"],
    }))
    if not (frontend["ok"] and "/api/chat/query" in frontend["body"]):
        failures += 1

    ok, _ = check("backend_health", request("/health"), lambda data: data.get("status") == "ok")
    failures += 0 if ok else 1

    ok, login = check(
        "admin_login",
        request("/api/auth/login", method="POST", body={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}),
        lambda data: bool(data.get("token")) and data.get("user", {}).get("role") == "admin",
    )
    failures += 0 if ok else 1
    token = login.get("token")
    if not token:
        return 1

    for path in ["/api/admin/dashboard", "/api/admin/users", "/api/admin/documents", "/api/admin/diagnostics"]:
        ok, _ = check(path, request(path, token=token))
        failures += 0 if ok else 1

    ok, chat = check(
        "chat_query",
        request(
            "/api/chat/query",
            method="POST",
            token=token,
            body={"question": "What is supplier inclusion?", "conversationHistory": []},
            timeout=70,
        ),
        lambda data: bool(data.get("queryId")) and (bool(data.get("answer")) or data.get("shouldEscalate") is True),
    )
    failures += 0 if ok else 1

    query_id = chat.get("queryId")
    if query_id:
        ok, _ = check(
            "feedback",
            request(
                "/api/chat/feedback",
                method="POST",
                token=token,
                body={"queryId": query_id, "rating": "up", "comment": ""},
            ),
        )
        failures += 0 if ok else 1

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
