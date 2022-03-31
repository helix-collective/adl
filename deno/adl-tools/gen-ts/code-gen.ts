export class CodeGen {
  contents: (string | CodeGen)[] = [];

  constructor(public prefix: string = "") {}

  add(line: string): CodeGen {
    this.contents.push(line);
    return this;
  }

  inner(prefix: string = "  "): CodeGen {
    const cg = new CodeGen(prefix);
    this.contents.push(cg);
    return cg;
  }

  write(): string[] {
    let lines: string[] = [];

    for (const i of this.contents) {
      if (i instanceof CodeGen) {
        lines = lines.concat(i.write());
      } else {
        lines.push(i);
      }
    }

    return lines
      .map((l) => this.prefix + l)
      .map((l) => {
        // convert whitespace lines (after prefixing indents) to empty lines:
        if (l.trim().length === 0) {
          return "";
        }
        return l;
      });
  }
}
