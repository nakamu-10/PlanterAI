# 0004 textlint で、インラインコードの前後の空白を揃える

- 日付：2026-11-05

## 背景

Markdown
のインラインコードの前後に空白を入れるかどうかが、ファイルによってばらついていた。リポジトリの
Markdown
はほとんどが入れる書き方だったが、入れていない箇所が3か所あった。`deno fmt`
は表や折り返しを整えるが、文中の空白は直さない。

ADR 0001 では、textlint は「人やツールが増えてから」入れることにしていた。

## 決定

- textlint と
  [ja-space-around-code](https://www.npmjs.com/package/textlint-rule-ja-space-around-code)
  を入れ、インラインコードの前後に空白を入れる形に揃える
- commit 前（lefthook）に自動で直し、CI で調べる。`npm run format` でも直す

## 理由

- 別のプロジェクト（Pitari、jphacks/tka_2617）の textlint
  の設定を参考にした。ただし向きは逆にした。Pitari
  は空白を入れない形だが、PlanterAI は入れる形でほぼ揃っており、Pitari
  と同じ向きにすると64行が変わる
- lefthook では `deno fmt`
  より先に流す。表の中で空白が増えると列の幅が変わり、整形し直す必要があるため。空白を足したあとに
  `deno fmt` が折り返しても、textlint
  は改行を空白とみなすので、両者はぶつからない
- textlint をまだ入れていない人の commit は止めず、CI で調べる（gitleaks
  と同じ扱い）

## 代替案

- 半角と全角の間の空白も揃える（ja-space-between-half-and-full-width）：今の
  Markdown
  は入れる・入れないが混ざっていて、どちらに揃えても70〜90行が変わる。どちらの書き方にするかを2人で決めてから入れる
- `deno fmt` だけで済ませる：文中の空白は直せない
