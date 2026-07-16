import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../..");
const EXPECTED_WORKTREE_GIT_CALLS = [
  "rev-parse --show-superproject-working-tree",
  "rev-parse --show-toplevel",
  "remote get-url origin",
  "rev-parse --path-format=absolute --git-common-dir",
  "rev-parse --git-common-dir",
  "rev-parse --show-toplevel",
  "rev-parse --path-format=absolute --git-common-dir",
] as const;

type GitCall = {
  args: string;
  windowsHide: boolean;
};

function stringLiteralValue(node: ts.Node | undefined): string | null {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null;
}

function propertyName(node: ts.ObjectLiteralElementLike): string | null {
  if (!("name" in node) || !node.name) return null;
  return ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : null;
}

function booleanProperty(object: ts.Expression | undefined, name: string): boolean {
  if (!object || !ts.isObjectLiteralExpression(object)) return false;
  return object.properties.some(
    (property) =>
      ts.isPropertyAssignment(property) &&
      propertyName(property) === name &&
      property.initializer.kind === ts.SyntaxKind.TrueKeyword,
  );
}

function arrayLiteralStrings(node: ts.Node | undefined): string[] | null {
  if (!node || !ts.isArrayLiteralExpression(node)) return null;
  const values = node.elements.map(stringLiteralValue);
  return values.every((value): value is string => value !== null) ? values : null;
}

function extractGitCalls(path: string): GitCall[] {
  const source = readFileSync(join(REPO_ROOT, path), "utf8");
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );
  const calls: GitCall[] = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "execFileSync") {
      const command = stringLiteralValue(node.arguments[0]);
      const args = arrayLiteralStrings(node.arguments[1]);
      if (command === "git" && args) {
        calls.push({
          args: args.join(" "),
          windowsHide: booleanProperty(node.arguments[2], "windowsHide"),
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return calls;
}

describe("worktree-paths shipped source/dist parity", () => {
  it("keeps every Git subprocess in source and committed package dist hidden on Windows", () => {
    const sourceCalls = extractGitCalls("src/lib/worktree-paths.ts");
    const distCalls = extractGitCalls("dist/lib/worktree-paths.js");

    expect(sourceCalls.map((call) => call.args)).toEqual(EXPECTED_WORKTREE_GIT_CALLS);
    expect(distCalls.map((call) => call.args)).toEqual(EXPECTED_WORKTREE_GIT_CALLS);
    expect(sourceCalls.every((call) => call.windowsHide)).toBe(true);
    expect(distCalls.every((call) => call.windowsHide)).toBe(true);
  });
});
