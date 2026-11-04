# 0001 ガードレールを入れる

- 日付：2026-11-03

## 背景

AI（Claude
Code）にコードを書かせることが増えたが、整形・lint・秘密の混入・本番への反映を止める仕組みがなかった。実際に、ファームウェアに
Wi-Fi パスワードとデバイスキーが直接書かれたまま commit
されかけた。また、本番の状態をコードから推測して、事実と違う説明をしたことがあった。

## 決定

次の4段で止める。

1. 書いて伝える：`CLAUDE.md`
   に、コマンド・開発ルール・本番の扱い・してはいけないことを書く
2. AI のコマンドを止める：`.claude/settings.json` で、`.env` と `secrets.h`
   を読めなくし、force push と `--no-verify`
   を禁止する。依存の追加・`git push`・Supabase
   の本番を変えるコマンドは、毎回確認を挟む
3. commit で止める：lefthook で gitleaks → `deno fmt` → `deno lint` を流す
4. push で止める：GitHub Actions
   で、整形・lint・型（static）、テスト、ビルド、gitleaks を並列に流す

あわせて、`.gitattributes` で改行コードを LF に固定する。

## 理由

- 整形と lint は **deno に統一**した。Supabase の Edge Functions はもともと
  `deno fmt` と `deno check` を使っており、deno は
  JavaScript・JSON・Markdown・CSS・HTML
  も扱える。道具を1つにすれば、ルールが2種類並ぶことも、追加の npm
  依存（Prettier・ESLint 一式）も要らない
- `deno lint` のうち、次のルールは外した
  - `no-import-prefix`：Supabase の Edge Functions は `jsr:` を直接 import
    するのが公式の書き方
  - `no-window`・`no-window-prefix`：`site/`・`app/` はブラウザで動くので
    `window` を使う
- 改行コードを LF に固定したのは、Windows の git が CRLF
  でチェックアウトし、`deno fmt --check` が手元でだけ落ちるため
- Supabase
  の本番を変えるコマンドを「禁止」ではなく「確認」にしたのは、デプロイを AI
  に任せる場面があるため。毎回中身を見てから許可する

## 入れなかったもの

- Prettier・ESLint・typescript-eslint：上の理由で deno に統一した
- knip（使っていないコードの検出）：Deno の `jsr:` import と Vite
  のマルチページ構成で誤検知が多い
- ruff（Python）：Python は `hardware/tools/`
  の開発用ツールだけなので、増えてから入れる
- PR の行数やテストの有無の警告、textlint、issue
  テンプレート：人やツールが増えてから（textlint は
  [0003](0003-textlint-code-spacing.md) で入れた）
- ESLint の独自ルール：同じ設計違反を AI が何度もするようになってから
- Supabase
  の自動デプロイ：マイグレーションがマージと同時に本番に入るので、先に手動の手順を固める
