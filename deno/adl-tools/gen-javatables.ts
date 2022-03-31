import { getAdlStdLibDir } from "./utils/fs.ts";

export interface GenJavaTablesParams {
  adlFiles: string[];
  searchPath: string[];
  package: string;
  outputDir: string;

  mergeAdlExts?: string[];
  verbose?: boolean;
  noOverwrite?: boolean;
  manifest?: string;
  runtimePackage?: string;
  crudfns?: boolean;
  genversion?: string;
}

export async function genJavaTables(params: GenJavaTablesParams) {
  let cmd: string[] = ["adlc", "java-tables"];

  params.searchPath.forEach((dir) => {
    cmd = cmd.concat(["--searchdir", dir]);
  });
  cmd = cmd.concat(["--searchdir", await getAdlStdLibDir()]);

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
  if (params.crudfns === undefined || params.crudfns) {
    cmd.push("--crudfns");
  }
  if (params.manifest) {
    cmd = cmd.concat(["--manifest", params.manifest]);
  }
  if (params.runtimePackage) {
    cmd = cmd.concat(["--rtpackage", params.runtimePackage]);
  }
  const genversion = params.genversion === undefined ? "v2" : params.genversion;
  cmd = cmd.concat(["--genversion", genversion]);
  cmd = cmd.concat(params.adlFiles);

  if (params.verbose) {
    console.log("Executing", cmd);
  }

  const proc = Deno.run({ cmd });
  const status = await proc.status();
  if (!status.success) {
    throw new Error("Failed to run adl javatables");
  }
}
