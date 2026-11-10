-- ------------------------------------------------------------
-- 日照の判定で使う、その日の天気（Open-Meteo の予報）を覚えておく。
-- 10分ごとに取りに行くと、1回取りそこねただけで晴れ扱いになり、
-- 雨の日に予告が出てしまったため（11/10）。
-- 0時と12時の枠ごとに1回取り直して上書きし、取りそこねたら前の枠の予報を使う。
-- 場所は関数の環境変数で決まるので、日付と場所で1行にする。
-- ------------------------------------------------------------
create table daily_weather (
  local_date      date not null,
  latitude        double precision not null,
  longitude       double precision not null,
  sunshine_hours  double precision not null,
  daylight_hours  double precision not null,
  weather_code    integer not null,
  fetched_at      timestamptz not null default now(),
  primary key (local_date, latitude, longitude)
);

-- 読み書きは Edge Functions（service_role）だけ
alter table daily_weather enable row level security;
