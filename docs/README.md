# ドキュメント

- `proposal/`：U☆PoC応募提案書のLaTeXソースと図版
- `slides/poster/`：展示ポスター
- `slides/presentation/`：発表用スライド
- `qr/`：公開サイトへ誘導するQRコード

提案書は次の手順でビルドする。

```sh
cd proposal
platex PlanterAI.tex
dvipdfmx PlanterAI.dvi
```
