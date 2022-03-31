export interface GenJavaParams {
  adlFiles: string[];
  searchPath: string[];
  package: string;
  outputDir: string;

  mergeAdlExts?: string[];
  verbose?: boolean;
  noOverwrite?: boolean;
  manifest?: string;
  generateTransitive?: boolean;
  includeRuntime?: boolean;
  runtimePackage?: string;
  headerComment?: string;
  suppressWarningsAnnotation?: string;
}

export async function genJava(params: GenJavaParams) {
  let cmd: string[] = ["adlc", "java"];
  params.searchPath.forEach((dir) => {
    cmd = cmd.concat(["--searchdir", dir]);
  });
  cmd = cmd.concat(["--package", params.package]);
  cmd = cmd.concat(["--outputdir", params.outputDir]);

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
  if (params.runtimePackage) {
    cmd = cmd.concat(["--rtpackage", params.runtimePackage]);
  }
  if (params.headerComment) {
    cmd = cmd.concat(["--header-comment", params.headerComment]);
  }
  if (params.suppressWarningsAnnotation) {
    cmd = cmd.concat([
      "--suppress-warnings-annotation",
      params.suppressWarningsAnnotation,
    ]);
  }
  cmd = cmd.concat(params.adlFiles);
  if (params.verbose) {
    console.log("Executing", cmd);
  }

  const proc = Deno.run({ cmd });
  const status = await proc.status();
  if (!status.success) {
    throw new Error("Failed to run adl java");
  }
}
