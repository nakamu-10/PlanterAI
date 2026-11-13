# Webサイト

PlanterAIの公式サイト。Viteで6つのHTMLページをまとめてビルドする。

## ページ

| ファイル        | 内容           |
| --------------- | -------------- |
| `index.html`    | TOP            |
| `software.html` | ソフトウェア   |
| `hardware.html` | ハードウェア   |
| `karami.html`   | カラ美について |
| `team.html`     | 製作者情報     |
| `roadmap.html`  | 今後の展望     |

共通のスタイルと動作は `src/`、画像は `public/images/` で管理する。

## 展示中の鉢を選ぶ欄

トップの「展示中の植物の、いまの様子を見る」は、カラ美・サボテン・エバーフレッシュの3つから選んで
`/app/?pot=…`
を開く。どのページの上のバーにも、ここへ飛ぶ「植物の様子を見る」がある。

まだ公開していない鉢（`devices.public_slug`
が無い鉢）を開くと、アプリが「見つからない」になる。そのため、開いたときに公開中の鉢を
`app-public` に聞き、無い鉢は「準備中」にする。本番で `public_slug`
を入れれば、サイトを作り直さなくても選べるようになる。

聞く先は `VITE_SUPABASE_FUNCTIONS_URL`（`.env.example`）。本番は Vercel
の環境変数をアプリと共有する。入れていなければ聞かず、カラ美だけを開く。

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
