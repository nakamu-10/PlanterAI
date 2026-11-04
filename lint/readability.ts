// AI に書かせたコードに出やすい、読みにくい書き方を止める（docs/adr/0004-readability-lint.md）

// 区切り線だけのコメント（// ======）と、区切り線で挟んだ見出し（// ---- 見出し ----）。
// 表の罫線（----|----）は、間に空白が無いので見出しとはみなさない
const SEPARATOR = /^[-=*#_~]{4,}$/;
const DECORATED_HEADING = /^[-=]{2,}\s+(.+?)\s+[-=]{2,}$/;
// g を付けた正規表現の test() は前回の位置を覚えてしまうので、置き換え用と分ける
const EMPHASIS = /[★☆【】]/;
const EMPHASIS_ALL = /[★☆【】]/g;

type Comment = Deno.lint.LineComment | Deno.lint.BlockComment;

// コメントの前後がその行の空白だけなら、行ごと消す範囲を返す
function wholeLineRange(
  text: string,
  comment: Comment,
): Deno.lint.Range | null {
  const [start, end] = comment.range;
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const newline = text.indexOf("\n", end);
  const lineEnd = newline === -1 ? text.length : newline + 1;
  const before = text.slice(lineStart, start);
  const after = text.slice(end, newline === -1 ? text.length : newline);
  if (before.trim() !== "" || after.trim() !== "") return null;
  return [lineStart, lineEnd];
}

const isBooleanLiteral = (node: Deno.lint.Node | null | undefined) =>
  node?.type === "Literal" && typeof node.value === "boolean";

// return true; だけの文か、それだけを囲んだブロックか
function returnsBooleanLiteral(
  node: Deno.lint.Node | null | undefined,
): boolean {
  if (node?.type === "ReturnStatement") return isBooleanLiteral(node.argument);
  if (node?.type === "BlockStatement" && node.body.length === 1) {
    return returnsBooleanLiteral(node.body[0]);
  }
  return false;
}

const plugin: Deno.lint.Plugin = {
  name: "planterai",
  rules: {
    "no-separator-comment": {
      create(context) {
        return {
          Program() {
            const text = context.sourceCode.text;
            for (const comment of context.sourceCode.getAllComments()) {
              if (comment.type !== "Line") continue;
              const value = comment.value.trim();
              const heading = value.match(DECORATED_HEADING)?.[1];
              if (SEPARATOR.test(value)) {
                const line = wholeLineRange(text, comment);
                context.report({
                  range: comment.range,
                  message:
                    "コメントを区切り線で飾らない。読む量が増えるだけで、意味は足されない",
                  hint: "区切り線の行を消す",
                  fix: line ? (fixer) => fixer.removeRange(line) : undefined,
                });
              } else if (
                heading && !SEPARATOR.test(heading.replaceAll("|", ""))
              ) {
                context.report({
                  range: comment.range,
                  message:
                    "見出しを区切り線で飾らない。見出しは1行のコメントで足りる",
                  hint: `// ${heading} にする`,
                  fix: (fixer) =>
                    fixer.replaceTextRange(comment.range, `// ${heading}`),
                });
              }
            }
          },
        };
      },
    },
    "no-emphasis-mark": {
      create(context) {
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              if (!EMPHASIS.test(comment.value)) continue;
              const value = comment.value.replace(EMPHASIS_ALL, "");
              const replaced = comment.type === "Line"
                ? `//${value}`
                : `/*${value}*/`;
              context.report({
                range: comment.range,
                message:
                  "★ や【】で強調しない。あちこちに付くと、どれが大事か分からなくなる",
                hint: "大事なら、その理由を文で書く",
                fix: (fixer) => fixer.replaceTextRange(comment.range, replaced),
              });
            }
          },
        };
      },
    },
    "no-nested-ternary": {
      create(context) {
        return {
          ConditionalExpression(node) {
            if (
              node.consequent.type === "ConditionalExpression" ||
              node.alternate.type === "ConditionalExpression"
            ) {
              context.report({
                node,
                message:
                  "三項演算子を入れ子にしない。条件の組み合わせを頭の中で追うことになる",
                hint: "if 文にするか、途中の結果に名前を付けて分ける",
              });
            }
          },
        };
      },
    },
    "no-useless-catch": {
      create(context) {
        return {
          CatchClause(node) {
            const [only] = node.body.body;
            if (
              node.body.body.length === 1 &&
              only.type === "ThrowStatement" &&
              only.argument.type === "Identifier" &&
              node.param?.type === "Identifier" &&
              only.argument.name === node.param.name
            ) {
              context.report({
                node,
                message: "受け取ったエラーを投げ直すだけの catch は要らない",
                hint:
                  "catch を外す。ログを残す・別のエラーに包むときだけ catch する",
              });
            }
          },
        };
      },
    },
    "no-boolean-return": {
      create(context) {
        const report = (node: Deno.lint.Node) =>
          context.report({
            node,
            message: "条件を if や三項演算子で true / false に置き直さない",
            hint:
              "条件式をそのまま返す（真偽値でなければ Boolean(...) で包む）",
          });
        const isGuard = (node: Deno.lint.Node | undefined) =>
          node?.type === "IfStatement" &&
          !node.alternate &&
          returnsBooleanLiteral(node.consequent);
        const checkStatements = (statements: Deno.lint.Statement[]) => {
          // if (条件) return true; return false;
          // 同じ形の if が前にも並んでいるなら、ガード節の続きとして読めるので見逃す
          statements.forEach((statement, i) => {
            if (
              isGuard(statement) &&
              !isGuard(statements[i - 1]) &&
              returnsBooleanLiteral(statements[i + 1])
            ) report(statement);
          });
        };
        return {
          IfStatement(node) {
            if (
              returnsBooleanLiteral(node.consequent) &&
              returnsBooleanLiteral(node.alternate)
            ) report(node);
          },
          ConditionalExpression(node) {
            if (
              isBooleanLiteral(node.consequent) &&
              isBooleanLiteral(node.alternate)
            ) {
              report(node);
            }
          },
          BlockStatement: (node) => checkStatements(node.body),
          SwitchCase: (node) => checkStatements(node.consequent),
        };
      },
    },
    "prefer-direct-return": {
      create(context) {
        const checkStatements = (statements: Deno.lint.Statement[]) => {
          statements.forEach((statement, i) => {
            const next = statements[i + 1];
            if (
              statement.type !== "VariableDeclaration" ||
              statement.declarations.length !== 1 ||
              (statement.kind !== "const" && statement.kind !== "let") ||
              next?.type !== "ReturnStatement" ||
              next.argument?.type !== "Identifier"
            ) return;
            const { id } = statement.declarations[0];
            // 型注釈は、式の型を絞る役目があるので残す
            if (
              id.type === "Identifier" && !id.typeAnnotation &&
              id.name === next.argument.name
            ) {
              context.report({
                node: next,
                message: "返すためだけの変数を作らない",
                hint: "式をそのまま return する",
              });
            }
          });
        };
        return {
          BlockStatement: (node) => checkStatements(node.body),
          SwitchCase: (node) => checkStatements(node.consequent),
        };
      },
    },
  },
};

export default plugin;
