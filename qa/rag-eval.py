#!/usr/bin/env python3
"""
SISO Live RAG evaluation check.

This intentionally bypasses Redis cache so the result proves whether the live
retrieval and generation path is healthy. It prints metadata only, not answer
text, so the output is safe to share in a client handoff.

Usage:
  SISO_ADMIN_PASSWORD='...' python3 qa/rag-eval.py
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

BACKEND_URL = os.environ.get("SISO_BACKEND_URL", "https://sisolive.vercel.app")
ADMIN_EMAIL = os.environ.get("SISO_ADMIN_EMAIL", "admin@abbvie.com")
ADMIN_PASSWORD = os.environ.get("SISO_ADMIN_PASSWORD")

EVAL_QUESTIONS = [
    {
        "id": "supplier_inclusion",
        "question": "What is supplier inclusion?",
        "expect_sources": True,
    },
    {
        "id": "diverse_supplier",
        "question": "How does AbbVie define a diverse supplier?",
        "expect_sources": True,
    },
    {
        "id": "irrelevant_control",
        "question": "What is the capital city of Mars?",
        "expect_escalation": True,
    },
]


def request(path, method="GET", body=None, token=None, timeout=75):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BACKEND_URL + path, data=data, headers=headers, method=method)
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read().decode("utf-8", "ignore")
            return res.status, round(time.time() - start, 2), json.loads(raw or "{}")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "ignore")
        try:
            parsed = json.loads(raw or "{}")
        except Exception:
            parsed = {"error": raw[:300]}
        return exc.code, round(time.time() - start, 2), parsed
    except Exception as exc:
        return "error", round(time.time() - start, 2), {"error": str(exc)}


def print_result(payload):
    print(json.dumps(payload, sort_keys=True))


def main():
    if not ADMIN_PASSWORD:
        print("Set SISO_ADMIN_PASSWORD before running RAG evaluation.", file=sys.stderr)
        return 2

    status, elapsed, login = request(
        "/api/auth/login",
        method="POST",
        body={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    token = login.get("token")
    print_result({"check": "login", "ok": bool(token), "status": status, "elapsed": elapsed})
    if not token:
        return 1

    failures = 0
    status, elapsed, diagnostics = request("/api/admin/diagnostics", token=token)
    pinecone = diagnostics.get("pinecone", {})
    cohere = diagnostics.get("cohere", {})
    vector_count = pinecone.get("vectorCount") or 0
    diagnostics_ok = (
        status == 200
        and pinecone.get("status") == "connected"
        and int(vector_count) > 0
        and cohere.get("status") == "connected"
    )
    print_result({
        "check": "rag_diagnostics",
        "ok": diagnostics_ok,
        "status": status,
        "elapsed": elapsed,
        "pineconeStatus": pinecone.get("status"),
        "vectorCount": vector_count,
        "cohereStatus": cohere.get("status"),
        "pineconeEnv": pinecone.get("env", {}),
        "pineconeError": pinecone.get("error") or pinecone.get("lastInitError"),
    })
    failures += 0 if diagnostics_ok else 1

    for item in EVAL_QUESTIONS:
        status, elapsed, result = request(
            "/api/chat/query",
            method="POST",
            token=token,
            body={
                "question": item["question"],
                "conversationHistory": [],
                "bypassCache": True,
            },
        )
        sources = result.get("sources") or []
        should_escalate = result.get("shouldEscalate") is True
        has_answer = bool(result.get("answer"))
        if item.get("expect_escalation"):
            ok = status == 200 and should_escalate
        else:
            ok = status == 200 and has_answer and len(sources) > 0 and not should_escalate

        print_result({
            "check": "rag_question",
            "id": item["id"],
            "ok": ok,
            "status": status,
            "elapsed": elapsed,
            "queryId": result.get("queryId"),
            "hasAnswer": has_answer,
            "shouldEscalate": should_escalate,
            "confidencePercent": result.get("confidencePercent"),
            "sourceFiles": sorted({s.get("filename") for s in sources if s.get("filename")}),
            "error": result.get("error"),
        })
        failures += 0 if ok else 1

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
