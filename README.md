# PlanterAI（仮称：プランター・ゴッチ）

電気通信大学 **U☆PoC**（ユーザ志向アイディア実証コンテスト）応募作品。

生成AIで人格を持つIoTプランター。土壌湿度・温度・照度・空気湿度のセンサーデータをもとに、植物が擬人化キャラクターとして LINE で自発的に話しかけ、こちらの返信にも応える育成支援システム。単なる数値の可視化ではなく「感情の可視化」を目指す。

- メンバー：中村耕介（代表）、地引宙翔
- 提案書：`PlanterAI.tex` → `PlanterAI.pdf`

## システム構成

```
[土壌湿度/温度/照度/湿度センサー]
            │
        [ESP32] --HTTP POST (x-device-key)--> [Edge Function: ingest-sensor]
                                                       │
                    ┌──────────────────────────────────┼───────────────┐
                    ▼                                   ▼               ▼
             [Supabase DB]                        [Gemini Flash]   状態遷移時のみ
          (センサー/感情/会話ログ)                  (セリフ生成)          │
                                                                        ▼
[LINE] ──ユーザーの返信──> [Edge Function: line-webhook] ──> [LINE Messaging API] ──> ユーザー
                                                       ▲
                                          [Edge Function: weekly-summary]
                                          （pg_cron で週次の関係性サマリー生成）
```

サーバーサイドは **Supabase Edge Functions（Deno / TypeScript）** で完結している。

## 処理パイプライン（3レイヤー構成）

センサー値からセリフ生成までを3層に分け、LLM にはセリフ生成のみを担わせることでハルシネーションを抑える。

1. **Layer 1｜正規化**（`normalize.ts`）— 直近5サンプルの**中央値フィルタ**でノイズを除去し、植物プロファイルの快適レンジに照らして 0〜100 の快適スコアへ変換。
2. **Layer 2｜感情判定**（`emotionEngine.ts` / `emotionTable.ts`）— スコアの緊急度と継続時間から、ルールベースで感情（満足／軽い不満／不満／不安／苛立ち）と主訴を判定。日照不足は瞬時値では誤発火するため、積算光量による**日次判定**（`dailyLight.ts` / `dailyLightJob.ts`、1日最大2回）に分離。
3. **Layer 3｜セリフ生成**（`llm.ts`）— **状態が遷移したときだけ** Gemini Flash でキャラ口調のセリフを生成し LINE 通知。生成失敗時はテンプレ（`fallback.ts`）にフォールバックして通知を落とさない。

**通知の抑制**：境界付近での状態の往復（チャタリング）による LINE 乱発を防ぐため、直近通知から `NOTIFY_COOLDOWN_MINUTES`（既定60分）は原則再通知しない。ただし危険域（urgency=high）はクールダウンを無視して即通知する（`shouldNotify`）。

## ディレクトリ構成

```
supabase/
  functions/
    ingest-sensor/    ESP32のPOSTを受ける本体（3レイヤーを実行）
    line-webhook/     ユーザーのLINEメッセージに返信（署名検証・重複排除つき）
    weekly-summary/   週次の関係性サマリーを生成（要 x-cron-key）
    _shared/          config / normalize / emotionEngine / emotionTable /
                      llm / line / fallback / dailyLight などの共有モジュール
  migrations/         DBスキーマ（devices, sensor_logs, emotion_logs,
                      conversation_logs, relationship_summaries）
  config.toml
test/                 npx tsx で走るロジック検証（logic / notify / dailyLight / llm）
PlanterAI.tex         U☆PoC 提案書のソース
```

## 設定ポイント

- **植物プロファイル**（`_shared/config.ts`）：植物種ごとの快適／注意／危険レンジ。現在は `pothos`（ポトス）と `calathea`（カラテア）を定義。`devices.plant_profile` で切り替える。照度は非対称に扱い、瞬時値 lux で「日照過剰（葉焼け）」を、積算 lux·h で「日照不足」を判定する。
- **キャラクター**（`_shared/llm.ts`）：`amaenbo`（甘えん坊）／`tsundere`（ツンデレ）／`keigo`（執事風）。`devices.character_id` で切り替える。
- **土壌キャリブレーション**（`_shared/config.ts`）：`SOIL_CALIBRATION` に SEN0193 の実測 ADC 値（空気中／水中）を設定。

## 技術スタック

| レイヤー | 技術 |
|----------|------|
| マイコン | ESP32 + 土壌湿度・温度・照度・湿度センサー |
| サーバー | Supabase Edge Functions（Deno / TypeScript） |
| LLM | Gemini Flash |
| 通知 | LINE Messaging API（プッシュ通知 + Webhook双方向チャット） |
| DB | Supabase（PostgreSQL、RLS全拒否 + service_roleでアクセス） |
| バッチ | pg_cron（週次サマリー） |

## セットアップ

前提：[Supabase CLI](https://supabase.com/docs/guides/cli)、Node.js（テスト用）、LINE公式アカウント、Gemini API キー。

```sh
# 1. DBスキーマを反映
supabase db push

# 2. Edge Functions をデプロイ
#    ingest-sensor は ESP32 が JWT を持たないため --no-verify-jwt で公開し、
#    x-device-key による自前認証を使う
supabase functions deploy ingest-sensor  --no-verify-jwt
supabase functions deploy line-webhook   --no-verify-jwt
supabase functions deploy weekly-summary --no-verify-jwt

# 3. シークレットを登録
supabase secrets set \
  GEMINI_API_KEY=... \
  LINE_CHANNEL_ACCESS_TOKEN=... \
  LINE_CHANNEL_SECRET=... \
  CRON_SECRET=...
# （SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY は自動で注入される）
```

> **`_shared` を変更したら、それを import している function を全部再デプロイする。**
> Supabase は `_shared` を function ごとにバンドルするため、共有ライブラリのように自動追随しない。
> 片方だけ古い `_shared` を抱えたままになり、同じコードのはずなのに挙動が割れる
> （実例は「PlanterAI 定型文フォールバック多発 修正記録（2026-09-02）」）。

### デバイス登録

Supabase ダッシュボードの SQL Editor で実行する（値は書き換える）。

```sql
insert into devices (device_key, plant_name, character_id, line_user_id)
values ('ここに長いランダム文字列', 'ポト助', 'amaenbo', 'あなたのLINE User ID');
```

LINE User ID は LINE Developers の「チャネル基本設定」→「あなたのユーザーID」（`U` で始まる文字列）。
**LINE公式アカウントを自分の LINE で友だち追加しておかないと通知が届かない。**

## ローカルで動かす

```sh
supabase start   # ローカル Supabase（Docker 必要）

cat > supabase/functions/.env << 'ENVEOF'
GEMINI_API_KEY=xxxx
LINE_CHANNEL_ACCESS_TOKEN=xxxx
LINE_CHANNEL_SECRET=xxxx
CRON_SECRET=test-secret
ENVEOF

supabase functions serve ingest-sensor --no-verify-jwt --env-file supabase/functions/.env
```

別ターミナルから ESP32 のふりをして POST する。

```sh
# 快適 → 「満足」。初回の満足は通知されない仕様
curl -X POST http://127.0.0.1:54321/functions/v1/ingest-sensor \
  -H "Content-Type: application/json" \
  -H "x-device-key: 登録した device_key" \
  -d '{"soil_adc":1900,"temp":24,"humidity":55,"pressure":1012,"lux":2000}'

# 乾燥（soil_adc が大きい＝乾燥）→ 状態遷移して LINE が届く
curl -X POST http://127.0.0.1:54321/functions/v1/ingest-sensor \
  -H "Content-Type: application/json" \
  -H "x-device-key: 登録した device_key" \
  -d '{"soil_adc":2700,"temp":24,"humidity":40,"pressure":1012,"lux":2000}'
```

中央値フィルタ（直近5件）があるため、**乾燥値は3回以上連続で POST しないと反映されない**。
瞬間的なバグ値を無視する仕様どおりの動き。

本番 URL でも同じ POST で確認できる。

```sh
curl -X POST https://<プロジェクトID>.supabase.co/functions/v1/ingest-sensor \
  -H "Content-Type: application/json" \
  -H "x-device-key: xxxx" \
  -d '{"soil_adc":2700,"temp":24,"humidity":40,"pressure":1012,"lux":2000}'
```

ESP32 側はこの URL に `HTTPClient` で POST するだけ（`x-device-key` ヘッダーを忘れずに）。

## 週次サマリーの自動実行（pg_cron）

手動実行：

```sh
curl -X POST https://<プロジェクトID>.supabase.co/functions/v1/weekly-summary \
  -H "x-cron-key: CRON_SECRETの値"
```

自動実行は SQL Editor で登録する（毎週日曜21時 JST = 12:00 UTC）。

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'weekly-relationship-summary',
  '0 12 * * 0',
  $$
  select net.http_post(
    url := 'https://<プロジェクトID>.supabase.co/functions/v1/weekly-summary',
    headers := '{"x-cron-key": "CRON_SECRETの値"}'::jsonb
  );
  $$
);
```

## テスト

APIキー不要。閾値やエスカレーション表を書き換えたら、まずこれを流す。

```sh
npx tsx test/logic.test.ts      # Layer 1/2 のスコア化・感情判定
npx tsx test/notify.test.ts     # 通知クールダウン（チャタリング対策）
npx tsx test/dailyLight.test.ts # 積算光量による日照不足の日次判定
npx tsx test/llm.test.ts        # LLMプロファイル・エラー分類・フォールバック文面
```

Windows の cmd では `npx --yes tsx ...` にする（初回のインストール確認で止まるため）。

## トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| 401 デバイスが登録されていません | `devices` に insert したか、`device_key` のタイプミスを確認 |
| LINEが届かない | 公式アカウントを友だち追加したか／`line_user_id` が正しいか（`U` で始まる） |
| 同じセリフばかり届く | LLM生成が失敗してテンプレに落ちている。下の SQL でフォールバック率を確認する |
| Geminiエラー | `supabase secrets list` でキー登録を確認。ログは Dashboard → Edge Functions → Logs（無料プランは保持1日） |
| 乾燥させたのに満足のまま | 中央値フィルタの仕様。同じ値を3回以上 POST する |
| 通知が来ない（2回目以降） | 同じ状態が続く間は通知しない仕様。クールダウンは既定60分（危険域は無視して即通知） |
| 直したのに挙動が変わらない | `_shared` を使う function を全部再デプロイしたか確認（バンドルされるため） |

```sql
-- 直近1日の生成経路。('fallback', ...) が並んでいたらLLM生成が失敗している
select source, finish_reason, count(*)
  from conversation_logs
 where created_at > now() - interval '1 day'
 group by 1, 2
 order by 3 desc;
```

## コスト見積もり

- ESP32 送信間隔10分 → 関数実行 144回/日（Gemini 呼び出しは状態遷移時のみ）
- 状態遷移 1〜3回/日 → **Gemini Flash 月30〜90回**（無料枠内）
- **LINE 月30〜90通** → 無料プラン（月200通）内。双方向チャットの返信もここに乗る
- Supabase 無料プランの Edge Functions 実行数（月50万回）にも余裕

## 提案書ビルド

```sh
platex PlanterAI.tex
dvipdfmx PlanterAI.dvi
# → PlanterAI.pdf
```

詳細な設計方針・フォーマット要件は [CLAUDE.md](CLAUDE.md) を参照。
