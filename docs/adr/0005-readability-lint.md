# 0005 AI に出やすい読みにくい書き方を、deno lint のプラグインで止める

- 日付：2026-11-05

## 背景

コードの多くを AI（Claude Code）に書かせている。`CLAUDE.md`
には「コメントは必要な「なぜ」だけを書く」とあるが、Edge Functions
を中心に、コメントを区切り線（`// ====`、`// ---- 見出し ----`）や★・【】で飾った箇所が19ファイル・148か所あった。AI
は周りのコードの書き方をまねるので、一度入ると広がる。

外の調査でも、AI
のコードは整形こそ揃っているが、別の理由で読みにくくなりやすいとされている。

- 読みにくいと判定した LLM
  のコードで最も多かった問題は、必要以上に込み入った処理（48件）で、次がコードを言い直すだけのコメント（24件）だった。返すためだけの変数のような、余計な中間の変数も挙がっている（[arXiv 2605.13280](https://arxiv.org/abs/2605.13280)）
- 何でも try/catch
  で囲む、コードの文法を説明するだけのコメントを付ける、といった癖も挙がっている（[Why AI-Generated Code Feels Weird](https://dev.to/unknown_destroyer_f353870/why-ai-generated-code-feels-weird-1bd2)）

## 決定

`deno lint` のプラグイン `lint/readability.ts` に、次のルールを入れる。

- このリポジトリで AI が何度も書いていたもの（`deno lint --fix` で直る）
  - `planterai/no-separator-comment`：区切り線だけのコメントと、区切り線で挟んだ見出し
  - `planterai/no-emphasis-mark`：コメントの★・☆・【】
- 今は0件だが、LLM に多いと分かっている形
  - `planterai/no-nested-ternary`：三項演算子の入れ子
  - `planterai/no-useless-catch`：受け取ったエラーを投げ直すだけの catch
  - `planterai/no-boolean-return`：条件を if や三項演算子で true / false
    に置き直す書き方
  - `planterai/prefer-direct-return`：返すためだけの変数

ルールのテストは `lint/readability.test.ts` に書き、`npm run test:lint` と CI の
static で流す。

## 理由

- ADR 0001 のとおり deno に統一したまま入れられる。プラグインは deno 2.2
  から使え、`deno lint`・lefthook・エディタ（Deno LSP）にそのまま乗る。API
  はまだ変わることがあるが、`deno test` がプラグインの型も検査するので、deno
  を上げたときに気づける
- ADR 0001 では、独自のルールは「同じ設計違反を AI
  が何度もするようになってから」入れることにしていた。コメントの飾りは148か所あり、この条件に当たる。残りの4つは今は0件なので、既存のコードを直す手間がない。また構文だけで決まるので、誤検知もほとんど無い。そのため先に入れる
- 調べたときに当たった `isBme280Ok`（`normalize.ts`）の最後の `return true`
  は、ガード節を並べた読みやすい書き方だった。そのため、同じ形の if
  が前に並んでいるときは見逃す

## 代替案

- コードを言い直すだけのコメントも止める：論文では2番目に多い問題だが、日本語のコメントとコードを機械的に突き合わせられない。レビューで見る
- 関数の長さや入れ子の深さに上限を付ける：今のコードには60行を超える関数が14個あり（最長は
  `ingest-sensor` の339行）、直すには処理の分け直しが要る。また AI
  のコードは、意味のまとまりが無いまま細かく分かれがちだという報告もある（[arXiv 2605.02741](https://arxiv.org/abs/2605.02741)）。行数の上限はその方向に押すので、機能凍結のあとで考える
- `=== true` のような比較を止める：null
  を含む値では意味があり、型が分からないと見分けられない
- ESLint のプラグイン（eslint-plugin-deslop など）を使う：ADR 0001 のとおり
  ESLint は入れない
