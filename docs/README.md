# ドキュメント

- `proposal/`：U☆PoC応募提案書のLaTeXソースと図版
- `slides/poster/`：展示ポスター
- `slides/presentation/`：発表用スライド
- `qr/`：公開サイトのTOPへ誘導するQRコード

QRコードはリポジトリのルートから次のコマンドで再生成できる。

```sh
npm run generate:qr
```

提案書は次の手順でビルドする。

```sh
cd proposal
platex PlanterAI.tex
dvipdfmx PlanterAI.dvi
```
