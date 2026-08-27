# PlanterAI（仮称：プランター・ゴッチ）

電気通信大学 **U☆PoC**（ユーザ志向アイディア実証コンテスト）応募作品。

生成AIで人格を持つIoTプランター。土壌湿度・温度・照度・空気湿度のセンサーデータをもとに、植物が擬人化キャラクターとして LINE で自発的に話しかけ、こちらの返信にも応える育成支援システム。単なる数値の可視化ではなく「感情の可視化」を目指す。

- メンバー：中村耕介（代表）、地引宙翔
- 提案書：`docs/proposal/PlanterAI.tex` → `PlanterAI.pdf`

## Webサイト

6ページ構成の公式サイトは `site/` にある。Viteでローカル起動と静的ビルドを行い、ルートの `vercel.json` からVercelへデプロイする。

公開URL：[https://planter-ai-zeta.vercel.app/](https://planter-ai-zeta.vercel.app/)

```sh
cd site
npm ci
npm run dev
```

本番用の静的ファイルは `npm run build` で `site/dist/` に生成される。`node_modules/` と `dist/` は生成物のためGitでは管理しない。

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
site/                   Vite製の公式Webサイト
  public/images/        Webサイトで使う画像
  src/                  JavaScriptとCSS
  *.html                6ページのHTMLエントリ
supabase/               Edge FunctionsとDBマイグレーション
  functions/_shared/    状態判定・LLM・LINEなどの共有処理
  functions/*/          ingest-sensor、line-webhook、weekly-summary
  migrations/           PostgreSQLスキーマ
tests/                  状態判定・通知・日照判定のテスト
docs/
  proposal/             U☆PoC提案書と図版
  slides/               ポスターとプレゼン資料
  qr/                   公開サイトのQRコード
hardware/models/        3Dプリント用モデル
archive/legacy-site/    旧シングルページLP
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

`devices` テーブルに自分の `device_key` と `line_user_id` を登録すると稼働する（サンプル INSERT は `migrations/20260706000000_init.sql` 末尾を参照）。`weekly-summary` は pg_cron から `x-cron-key: <CRON_SECRET>` を付けて定期呼び出しする。

## テスト

```sh
npm ci
npm run check
```

`npm run check`はテスト、Edge Functionsの型検査、Webサイトの本番ビルド、Denoのフォーマット確認をまとめて実行する。テストだけを行う場合は`npm test`を使う。

## 提案書ビルド

```sh
cd docs/proposal
platex PlanterAI.tex
dvipdfmx PlanterAI.dvi
# → PlanterAI.pdf
```

詳細な設計方針・フォーマット要件は [CLAUDE.md](CLAUDE.md) を参照。
