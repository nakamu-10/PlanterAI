# 引き継ぎメモ

セッションをまたいで作業を続けるためのメモ。人も AI
も、作業の初めにこれを読み、終わりに更新する。 決めたことは
`docs/adr/`、急がないタスクや相談は GitHub Issues
に書き、ここには「今どこまで進んでいて、次に何をするか」だけを残す。

最終更新：2026-11-03

## 今の状態

- 本番の Supabase は main からデプロイ済み（migration 7件、Edge Functions 5つ）
- LINE の返答は Gemini が生成している（直近7日の `conversation_logs` は
  source=llm、finish_reason=STOP）
- ファームウェアは `hardware/firmware/planterai_firmware_oled/` が正。Wi-Fi
  とデバイスキーは、git の管理外の `secrets.h` に置く

## 次にすること

- [ ] LINE で植物に話しかけ、新しいデプロイで `conversation_logs` に source=llm
      の行が入るかを確かめる
- [ ] 2026-11-04 ごろ、フォールバック率（source=fallback の割合）を見る
- [ ] ファームウェアを書き込み直したら、`sensor_logs`
      に新しい行が入るかを確かめる
- [ ] PR #9（ガードレール）をマージする。時期は地引さんと相談中

## 相談中・あとでやること（GitHub Issues）

- #10 /app/（カラ美）の認証方式を決める（担当：地引さん）
- #11 validation.ts の変更のレビュー（担当：地引さん）
- #12 main の保護と CodeRabbit の導入（担当：地引さん）
- #13 poster_ver3_gen.js が読む line_ver2.jpg が見つからない
- #14 Supabase のデプロイを GitHub Actions で自動化する

## 注意

- 本番の状態は推測しない。`--read-only` で確かめてから話す
- このリポジトリは公開されている。キー、URL
  のトークン、個人の連絡先はここに書かない
