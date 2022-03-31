import { fs, path } from "../deps.ts";

export async function globFiles(
  root: string,
  pattern: string,
): Promise<string[]> {
  const paths: string[] = [];
  for await (const f of fs.expandGlob(pattern, { root })) {
    paths.push(f.path);
  }
  return paths;
}

export function getHelixCore(): string {
  const modulepath = new URL(import.meta.url).pathname;
  return path.dirname(path.dirname(path.dirname(path.dirname(modulepath))));
}

export async function getAdlStdLibDir(): Promise<string> {
  const proc = Deno.run({
    cmd: ["adlc", "show", "--adlstdlib"],
    stdout: "piped",
  });
  const output = await proc.output();
  return new TextDecoder().decode(output).trim();
}
