#!/usr/bin/env python3
"""Tidy: a tiny Python linter that explains each warning.

This is the example tool behind the "Tidy" playground demo. Replace it with your own
tool: anything that reads input (stdin or a file) and prints to stdout works.

Usage: tidylint.py [--strict] [--format text|json] FILE   (use - for stdin)
"""
import argparse
import ast
import json
import sys

RULES = {
    "T001": "Unused import",
    "T002": "Mutable default argument",
    "T003": "Bare except",
    "T004": "Comparison to None with ==",
    "T005": "Line too long",
    "T006": "TODO comment",
    "T000": "Syntax error",
}

WHY = {
    "T001": "Unused imports slow startup and mislead readers about dependencies. Remove it.",
    "T002": "The default list is created once and shared by every call. Use None and create it inside.",
    "T003": "A bare except also catches KeyboardInterrupt and SystemExit. Catch Exception or something narrower.",
    "T004": "== can be overridden; identity is what you mean. Write `is None`.",
    "T005": "Long lines are hard to review side by side. Break it up.",
    "T006": "TODOs tend to outlive their authors. Open an issue and link it.",
    "T000": "Python could not parse this file.",
}


def check(source, strict=False):
    findings = []
    max_len = 79 if strict else 100

    def add(code, line, col, detail=""):
        findings.append({"code": code, "line": line, "col": col + 1, "rule": RULES[code], "detail": detail, "why": WHY[code]})

    for n, text in enumerate(source.splitlines(), 1):
        if len(text) > max_len:
            add("T005", n, max_len, f"{len(text)} > {max_len} characters")
        if "TODO" in text and "#" in text:
            add("T006", n, text.index("#"))

    try:
        tree = ast.parse(source)
    except SyntaxError as e:
        add("T000", e.lineno or 1, (e.offset or 1) - 1, e.msg)
        return sorted(findings, key=lambda f: (f["line"], f["col"]))

    imported = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                name = (alias.asname or alias.name).split(".")[0]
                imported[name] = node
    used = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
    used |= {n.value.id for n in ast.walk(tree) if isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name)}
    for name, node in imported.items():
        if name not in used and name != "*":
            add("T001", node.lineno, node.col_offset, f"'{name}' is never used")

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for default in node.args.defaults + node.args.kw_defaults:
                if isinstance(default, (ast.List, ast.Dict, ast.Set)):
                    add("T002", default.lineno, default.col_offset, f"in {node.name}()")
        elif isinstance(node, ast.ExceptHandler) and node.type is None:
            add("T003", node.lineno, node.col_offset)
        elif isinstance(node, ast.Compare):
            for op, right in zip(node.ops, node.comparators):
                if isinstance(op, (ast.Eq, ast.NotEq)) and isinstance(right, ast.Constant) and right.value is None:
                    add("T004", node.lineno, node.col_offset)

    return sorted(findings, key=lambda f: (f["line"], f["col"]))


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("file", nargs="?", default="-")
    parser.add_argument("--strict", action="store_true", help="79-column lines")
    parser.add_argument("--format", choices=["text", "json"], default="text")
    args = parser.parse_args()

    source = sys.stdin.read() if args.file == "-" else open(args.file, encoding="utf-8").read()
    name = "snippet.py" if args.file == "-" else args.file
    findings = check(source, args.strict)

    if args.format == "json":
        print(json.dumps(findings, indent=2))
    elif not findings:
        print(f"{name}: no problems found. Tidy!")
    else:
        for f in findings:
            detail = f" ({f['detail']})" if f["detail"] else ""
            print(f"{name}:{f['line']}:{f['col']}  {f['code']}  {f['rule']}{detail}")
            print(f"    {f['why']}\n")
        print(f"{len(findings)} problem{'s' if len(findings) != 1 else ''} found.")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
