#!/usr/bin/env python3
"""Разовая дочистка Storage удалённой компании (аккаунта).

Удаление аккаунта до правки `account-delete` уносило строки компании, а её
файлы оставались: фото записей, чеки, файлы клиентов и логотипы (бакет
`tenant-logos` публичный — логотип открывался по прямой ссылке). Ночной
`storage-janitor` подбирает такие файлы сам; этот скрипт — для одной компании
руками, пока уборщик не выложен.

Запуск (ключ — сервисный, из панели Supabase, в историю shell не класть):

    SUPABASE_URL=https://rdtokosbqvgemicqeqwz.supabase.co \\
    SUPABASE_SERVICE_ROLE_KEY=... \\
    python3 -I scripts/purge-deleted-tenant-storage.py 2bc7907e-b149-44a9-92ff-a5e73403031c

Без `--apply` только печатает найденное. Компания жива — отказ: стереть файлы
живой компании значит стереть фото её записей.
"""

import json
import os
import re
import sys
import urllib.request

BUCKETS = ["appointment-photos", "client-attachments", "partner-files", "receipts", "tenant-logos"]
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def call(method, url, key, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


def list_all(base, key, bucket, prefix):
    paths, offset = [], 0
    while True:
        rows = call("POST", f"{base}/storage/v1/object/list/{bucket}", key,
                    {"prefix": prefix, "limit": 1000, "offset": offset}) or []
        for row in rows:
            path = f"{prefix}/{row['name']}"
            if row.get("id"):
                paths.append(path)
            else:
                paths.extend(list_all(base, key, bucket, path))
        if len(rows) < 1000:
            return paths
        offset += 1000


def main():
    args = [a for a in sys.argv[1:] if a != "--apply"]
    apply = "--apply" in sys.argv[1:]
    if len(args) != 1 or not UUID.match(args[0]):
        sys.exit("нужен один id компании (uuid)")
    tenant = args[0]
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key:
        sys.exit("нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY")

    alive = call("GET", f"{base}/rest/v1/tenants?id=eq.{tenant}&select=id", key)
    if alive:
        sys.exit(f"компания {tenant} жива — её файлы не трогаю")

    total = 0
    for bucket in BUCKETS:
        paths = list_all(base, key, bucket, tenant)
        total += len(paths)
        for p in paths:
            print(f"{bucket}\t{p}")
        if apply and paths:
            for i in range(0, len(paths), 100):
                removed = call("DELETE", f"{base}/storage/v1/object/{bucket}", key,
                               {"prefixes": paths[i:i + 100]}) or []
                print(f"  удалено в {bucket}: {len(removed)}")
    print(f"всего файлов: {total}" + ("" if apply else " (ничего не удалено: нет --apply)"))


if __name__ == "__main__":
    main()
