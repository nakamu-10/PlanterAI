-- 展示用の /app/ で、鍵なしで鉢を選ぶための名前（/app/?pot=karami など。ADR 0006）。
-- app-public は、この列が入っている鉢だけを返す。null のままの鉢は鍵なしでは見えない。
alter table devices
  add column if not exists public_slug text unique
    check (public_slug ~ '^[a-z0-9-]{1,32}$');
