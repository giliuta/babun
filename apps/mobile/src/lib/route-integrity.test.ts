import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, test } from "node:test";
import ts from "typescript";

const MOBILE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const APP_ROOT = path.join(MOBILE_ROOT, "app");

interface RouteTarget {
  file: string;
  line: number;
  path: string;
  dynamicParams: readonly string[];
  providedParams: ReadonlySet<string> | null;
}

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.[jt]sx?$/.test(entry.name) ? [absolute] : [];
  });
}

function appRoutes(): string[] {
  return sourceFiles(APP_ROOT)
    .filter((file) => !file.endsWith("/_layout.tsx"))
    .map((file) => {
      const relative = path.relative(APP_ROOT, file).replace(/\.[jt]sx?$/, "");
      const segments = relative
        .split(path.sep)
        .filter((segment) => !/^\(.+\)$/.test(segment));
      if (segments.at(-1) === "index") segments.pop();
      return `/${segments.join("/")}`.replace(/\/$/, "") || "/";
    });
}

function unwrap(expression: ts.Expression): ts.Expression {
  if (
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isParenthesizedExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return unwrap(expression.expression);
  }
  return expression;
}

function staticPaths(expression: ts.Expression): string[] {
  const node = unwrap(expression);
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    return [
      node.head.text +
        node.templateSpans
          .map((span) => `__value__${span.literal.text}`)
          .join(""),
    ];
  }
  if (ts.isConditionalExpression(node)) {
    return [
      ...staticPaths(node.whenTrue),
      ...staticPaths(node.whenFalse),
    ];
  }
  return [];
}

function propertyName(node: ts.PropertyName): string | null {
  return ts.isIdentifier(node) || ts.isStringLiteralLike(node)
    ? node.text
    : null;
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | null {
  const property = object.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) &&
      propertyName(candidate.name) === name,
  );
  return property?.initializer ?? null;
}

function objectParamNames(object: ts.ObjectLiteralExpression): Set<string> {
  const names = new Set<string>();
  for (const property of object.properties) {
    if (
      ts.isPropertyAssignment(property) ||
      ts.isShorthandPropertyAssignment(property) ||
      ts.isMethodDeclaration(property)
    ) {
      const name = propertyName(property.name);
      if (name) names.add(name);
    }
  }
  return names;
}

function targetFromExpression(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): RouteTarget[] {
  const node = unwrap(expression);
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const base = {
    file: path.relative(MOBILE_ROOT, sourceFile.fileName),
    line: location.line + 1,
  };

  if (ts.isObjectLiteralExpression(node)) {
    const pathname = objectProperty(node, "pathname");
    if (!pathname) return [];
    const params = objectProperty(node, "params");
    const paramObject = params && unwrap(params);
    const providedParams =
      paramObject && ts.isObjectLiteralExpression(paramObject)
        ? objectParamNames(paramObject)
        : null;
    return staticPaths(pathname).map((routePath) => ({
      ...base,
      path: routePath,
      dynamicParams: [...routePath.matchAll(/\[([^.[\]]+)\]/g)].map(
        (match) => match[1],
      ),
      providedParams,
    }));
  }

  return staticPaths(node).map((routePath) => ({
    ...base,
    path: routePath,
    dynamicParams: [],
    providedParams: null,
  }));
}

function navigationTargets(): RouteTarget[] {
  const targets: RouteTarget[] = [];
  for (const file of [
    ...sourceFiles(APP_ROOT),
    ...sourceFiles(path.join(MOBILE_ROOT, "src")),
  ]) {
    if (file.endsWith("route-integrity.test.ts")) continue;
    const sourceText = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ["push", "replace", "navigate"].includes(node.expression.name.text) &&
        node.arguments[0]
      ) {
        targets.push(...targetFromExpression(node.arguments[0], sourceFile));
      }

      if (
        ts.isJsxAttribute(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "href" &&
        node.initializer
      ) {
        if (ts.isStringLiteral(node.initializer)) {
          targets.push(...targetFromExpression(node.initializer, sourceFile));
        } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          targets.push(
            ...targetFromExpression(node.initializer.expression, sourceFile),
          );
        }
      }

      // Expo Tabs keeps link targets inside options={{ href: ... }} rather
      // than a JSX href attribute, so include those destinations as well.
      if (
        ts.isPropertyAssignment(node) &&
        propertyName(node.name) === "href"
      ) {
        targets.push(...targetFromExpression(node.initializer, sourceFile));
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return targets.filter((target) => target.path.startsWith("/"));
}

function publicPath(value: string): string {
  const withoutQuery = value.split(/[?#]/, 1)[0] ?? value;
  const segments = withoutQuery
    .split("/")
    .filter((segment) => segment && !/^\(.+\)$/.test(segment));
  return `/${segments.join("/")}` || "/";
}

function routeMatcher(route: string): RegExp {
  const escaped = route
    .split("/")
    .map((segment) => {
      if (/^\[\[\.\.\..+\]\]$/.test(segment)) return "(?:.+)?";
      if (/^\[\.\.\..+\]$/.test(segment)) return ".+";
      if (/^\[.+\]$/.test(segment)) return "[^/]+";
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${escaped}$`);
}

describe("Expo Router navigation integrity", () => {
  test("every static navigation destination resolves to an app route", () => {
    const routes = appRoutes();
    const staticRoutes = new Set(routes.filter((route) => !route.includes("[")));
    const dynamicMatchers = routes
      .filter((route) => route.includes("["))
      .map(routeMatcher);
    // The create-client screen intentionally reuses /clients/[id] with id=new.
    const intentionalDynamicAliases = new Set(["/clients/new"]);

    const missing = navigationTargets().filter((target) => {
      const destination = publicPath(target.path);
      const isDynamicTarget =
        target.path.includes("__value__") || target.path.includes("[");
      if (staticRoutes.has(destination)) return false;
      if (!isDynamicTarget && !intentionalDynamicAliases.has(destination)) {
        return true;
      }
      return !dynamicMatchers.some((matcher) => matcher.test(destination));
    });

    assert.deepEqual(
      missing.map(({ file, line, path: routePath }) => `${file}:${line} -> ${routePath}`),
      [],
    );
  });

  test("object-form dynamic routes provide every required segment", () => {
    const invalid = navigationTargets().flatMap((target) => {
      if (target.dynamicParams.length === 0) return [];
      const missing = target.dynamicParams.filter(
        (name) => !target.providedParams?.has(name),
      );
      return missing.length > 0
        ? [`${target.file}:${target.line} -> ${target.path}: ${missing.join(", ")}`]
        : [];
    });

    assert.deepEqual(invalid, []);
  });
});
