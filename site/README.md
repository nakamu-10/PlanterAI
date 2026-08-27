# Webサイト

PlanterAIの公式サイト。Viteで6つのHTMLページをまとめてビルドする。

## ページ

| ファイル | 内容 |
|---|---|
| `index.html` | TOP |
| `software.html` | ソフトウェア |
| `hardware.html` | ハードウェア |
| `karami.html` | カラ美について |
| `team.html` | 製作者情報 |
| `roadmap.html` | 今後の展望 |

共通のスタイルと動作は `src/`、画像は `public/images/` で管理する。

## 開発

```sh
npm ci
npm run dev
```

## ビルド

```sh
npm run build
```

生成先は `dist/`。このディレクトリはGitでは管理しない。
