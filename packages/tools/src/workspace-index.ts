/// Workspace file enumeration shared by grep and glob, ported from the Rust
/// runtime's `workspace::index`, plus the natural-ordering comparator.

import * as fs from "node:fs";
import * as path from "node:path";

const SKIPPED_DIRECTORIES = [
  ".git",
  ".build",
  ".swiftpm",
  "DerivedData",
  "node_modules",
  "Pods",
];

/// Recursively lists workspace-relative file paths, skipping hidden entries
/// and common generated/dependency directories. Throws raw fs errors; callers
/// wrap them into model-facing ToolErrors.
export function indexWorkspace(workspace: string): string[] {
  const files: string[] = [];
  collectFiles(workspace, "", files);
  files.sort(naturalCompare);
  return files;
}

function collectFiles(directory: string, relative: string, files: string[]) {
  for (const child of fs.readdirSync(directory, { withFileTypes: true })) {
    const name = child.name;
    if (name.startsWith(".")) continue;
    const relativePath = relative === "" ? name : `${relative}/${name}`;
    if (child.isDirectory()) {
      if (SKIPPED_DIRECTORIES.includes(name)) continue;
      collectFiles(path.join(directory, name), relativePath, files);
    } else if (child.isFile()) {
      files.push(relativePath);
    }
  }
}

function compareCodePoints(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const l = left[index].codePointAt(0) ?? 0;
    const r = right[index].codePointAt(0) ?? 0;
    if (l !== r) return l < r ? -1 : 1;
  }
  if (left.length === right.length) return 0;
  return left.length < right.length ? -1 : 1;
}

const isAsciiDigit = (ch: string) => ch >= "0" && ch <= "9";

/// Case-insensitive comparison with numeric runs compared by value, close to
/// Foundation's localizedStandardCompare so orderings stay stable.
export function naturalCompare(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  let i = 0;
  let j = 0;
  for (;;) {
    const l = left[i];
    const r = right[j];
    if (l === undefined && r === undefined) return 0;
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (isAsciiDigit(l) && isAsciiDigit(r)) {
      let leftNumber = "";
      while (i < left.length && isAsciiDigit(left[i])) {
        leftNumber += left[i];
        i += 1;
      }
      let rightNumber = "";
      while (j < right.length && isAsciiDigit(right[j])) {
        rightNumber += right[j];
        j += 1;
      }
      const leftStripped = leftNumber.replace(/^0+/, "");
      const rightStripped = rightNumber.replace(/^0+/, "");
      const ordering =
        Math.sign(leftStripped.length - rightStripped.length) ||
        compareCodePoints(leftStripped, rightStripped) ||
        compareCodePoints(leftNumber, rightNumber);
      if (ordering !== 0) return ordering;
    } else {
      const ordering =
        compareCodePoints(l.toLowerCase(), r.toLowerCase()) ||
        compareCodePoints(l, r);
      if (ordering !== 0) return ordering;
      i += 1;
      j += 1;
    }
  }
}
