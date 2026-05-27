# PlanterAI（仮称：プランター・ゴッチ）

電気通信大学 U☆PoC 応募作品。

生成AIで人格を持つIoTプランター。土壌湿度センサーのリアルタイムデータをもとに、植物が擬人化キャラクターとしてLINEで自発的に話しかけてくる育成支援システム。

## システム構成

```
[土壌湿度センサー] → [ESP32] --HTTP POST--> [Next.js API (Vercel)]
                                                    ↓              ↓
                                            [Supabase DB]   [Gemini Flash]
                                                                   ↓
                                            [LINE Messaging API] → ユーザー
```

## 技術スタック

| レイヤー | 技術 |
|----------|------|
| マイコン | ESP32 + 土壌湿度センサー |
| サーバー | Next.js API Route (Vercel) |
| LLM | Gemini Flash |
| 通知 | LINE Messaging API |
| DB | Supabase |

## 提案書ビルド

```sh
platex PlanterAI.tex
dvipdfmx PlanterAI.dvi
# → PlanterAI.pdf
```

詳細は [CLAUDE.md](CLAUDE.md) を参照。
