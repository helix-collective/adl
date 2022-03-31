export interface GenTypescriptParams {
  adlFiles: string[];
  searchPath: string[];
  outputDir: string;
  runtimeDir: string;

  mergeAdlExts?: string[];
  verbose?: boolean;
  noOverwrite?: boolean;
  manifest?: string;
  generateTransitive?: boolean;
  includeRuntime?: boolean;
  tsStyle?: "tsc" | "deno";
  includeResolver?: boolean;
  excludeAst?: boolean;
  excludeAstAnnotations?: [];
}

export async function genTypescript(params: GenTypescriptParams) {
  let cmd: string[] = ["adlc", "typescript"];
  params.searchPath.forEach((dir) => {
    cmd = cmd.concat(["--searchdir", dir]);
  });
  cmd = cmd.concat(["--outputdir", params.outputDir]);
  cmd = cmd.concat(["--runtime-dir", params.runtimeDir]);

  const mergeAdlExts = params.mergeAdlExts || [];
  mergeAdlExts.forEach((ext) => {
    cmd = cmd.concat(["--merge-adlext", ext]);
  });

  if (params.verbose) {
    cmd.push("--verbose");
  }
  if (params.noOverwrite) {
    cmd.push("--no-overwrite");
  }
  if (params.manifest) {
    cmd = cmd.concat(["--manifest", params.manifest]);
  }
  if (params.generateTransitive) {
    cmd.push("--generate-transitive");
  }
  if (params.includeRuntime) {
    cmd.push("--include-rt");
  }
  if (params.tsStyle) {
    cmd = cmd.concat(["--ts-style", params.tsStyle]);
  }
  if (params.includeResolver === undefined || params.includeResolver) {
    cmd.push("--include-resolver");
  }
  if (params.excludeAst) {
    cmd.push("--exclude-ast");
  }
  if (params.excludeAstAnnotations != undefined) {
    cmd = cmd.concat([
      "--excluded-ast-annotations",
      params.excludeAstAnnotations.join(","),
    ]);
  }
  cmd = cmd.concat(params.adlFiles);
  if (params.verbose) {
    console.log("Executing", cmd);
  }

  const proc = Deno.run({ cmd });
  const status = await proc.status();
  if (!status.success) {
    throw new Error("Failed to run adl typescript");
  }
}
