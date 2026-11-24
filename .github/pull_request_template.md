## 何を変えたか

## なぜ

## どう確かめたか

- [ ] `npm run check` が通る
- [ ] 画面や API を手で触って確かめた

## レビュー（CLAUDE.md の「レビュー」）

- [ ] CI が全部通った
- [ ] PR を作った会話の記憶を持たない Claude で
      `/code-review <PR番号> --comment` を実行し、指摘に答えた
- [ ] 差分全体を、他人が書いたつもりで読んだ
- [ ] 本番のデータ・鍵・認証・マイグレーションに関わるなら、一晩おいて読み直した

## デプロイ（ADR 0011）

- [ ] `supabase/` の変更あり（マージすると `supabase-deploy` が動く。Summary
      を読んでから `production` を承認する）
- [ ] pg_cron
      の登録か、関数の環境変数（`supabase secrets set`）の変更あり（自動デプロイに含まれないので、手で入れる）
