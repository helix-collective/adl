import * as OAPI from "./openapi/openapi-utils.ts";
import { fs, path } from "./deps.ts";

import { parseAdl } from "./utils/adl.ts";
import * as adlast from "../adl-gen/runtime/sys/adlast.ts";

export interface Params {
  adlFiles: string[];
  searchPath: string[];
  apiModule: string;
  apiName: string;
  outputFile: string;
  verbose?: boolean;
}

export async function genOpenApi(params: Params): Promise<void> {
  const loadedAdl = await parseAdl(params.adlFiles, params.searchPath, {
    verbose: params.verbose,
  });
  const schema = OAPI.schemaFromApi({
    moduleName: params.apiModule,
    name: params.apiName,
  }, loadedAdl);
  const text = params.outputFile.endsWith(".json")
    ? JSON.stringify(schema, null, 2)
    : OAPI.yamlFromJsonSchema(schema);
  await fs.ensureDir(path.dirname(params.outputFile));
  if (params.verbose) {
    console.log(`writing ${params.outputFile}...`);
  }
  await Deno.writeTextFile(params.outputFile, text);
}
