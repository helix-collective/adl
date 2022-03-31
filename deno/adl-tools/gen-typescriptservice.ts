import { changeCase } from "./deps.ts";
import {
  Annotations,
  ScopedDecl, 
  Struct,
  TypeExpr,
} from "./../adl-gen/runtime/sys/adlast.ts";
import { LoadedAdl, parseAdl, expandTypes} from "./utils/adl.ts";
import { CodeGen } from "./gen-ts/code-gen.ts";
import { ImportingHelper } from "./gen-ts/import-helper.ts";

const camelCase = changeCase.camelCase;

interface Annotable {
  annotations: Annotations;
}

function getComment(item: Annotable): string | null {
  let comment: string | null = null;
  for (const anno of item.annotations) {
    if (anno.key.name === "Doc") {
      comment = anno.value as string;
      comment = comment.replace(/\n/g, " ");
      comment = comment.trim();
    }
  }
  return comment;
}

type CodeGenType = "collect" | "decl" | "ctor" | "impl";

function addCode(
  importingHelper: ImportingHelper,
  loadedAdl: LoadedAdl,
  codeGenType: CodeGenType,
  codeGen: CodeGen,
  typeExpr: TypeExpr,
  name: string,
  comment: string | null,
) {
  if (typeExpr.typeRef.kind !== "reference") {
    throw new Error("Unexpected - typeExpr.typeRef.kind !== reference");
  }
  if (typeExpr.typeRef.value.name === "HttpPost") {
    if (typeExpr.parameters.length !== 2) {
      throw new Error("Unexpected - typeExpr.parameters.length != 2");
    }
    const requestType = typeExpr.parameters[0];
    const responseType = typeExpr.parameters[1];
    switch (codeGenType) {
      case "collect": {
        importingHelper.addType(requestType);
        importingHelper.addType(responseType);
        return;
      }
      case "decl": {
        if (comment) {
          codeGen.add(`/** ${comment} */`);
        }
        codeGen.add(
          `${camelCase("post " + name)}: PostFn<${
            importingHelper.asReferencedName(
              requestType,
            )
          }, ${importingHelper.asReferencedName(responseType)}>;`,
        );
        codeGen.add("");
        return;
      }
      case "ctor": {
        codeGen.add(
          `this.${camelCase("post " + name)} = this.mkPostFn(api.${name});`,
        );
        return;
      }
      case "impl": {
        codeGen.add("");
        if (comment) {
          codeGen.add(`/** ${comment} */`);
        }

        codeGen.add(
          `async ${name}(req: ${
            importingHelper.asReferencedName(
              requestType,
            )
          }): Promise<${importingHelper.asReferencedName(responseType)}> {`,
        );
        codeGen.add(`  return this.${camelCase("post " + name)}.call(req);`);
        codeGen.add(`}`);
        return;
      }
    }
  }
  if (typeExpr.typeRef.value.name === "HttpGet") {
    if (typeExpr.parameters.length !== 1) {
      throw new Error("Unexpected - typeExpr.parameters.length != 1");
    }
    const responseType = typeExpr.parameters[0];
    switch (codeGenType) {
      case "collect": {
        importingHelper.addType(responseType);
        return;
      }
      case "decl": {
        if (comment) {
          codeGen.add(`/** ${comment} */`);
        }
        codeGen.add(
          `${camelCase("get " + name)}: GetFn<${
            importingHelper.asReferencedName(responseType)
          }>;`,
        );
        codeGen.add("");
        return;
      }
      case "ctor": {
        codeGen.add(
          `this.${camelCase("get " + name)} = this.mkGetFn(api.${name});`,
        );
        return;
      }
      case "impl": {
        codeGen.add("");
        if (comment) {
          codeGen.add(`/** ${comment} */`);
        }
        codeGen.add(
          `async ${name}(): Promise<${
            importingHelper.asReferencedName(responseType)
          }> {`,
        );
        codeGen.add(`  return this.${camelCase("get " + name)}.call();`);
        codeGen.add(`}`);
        return;
      }
    }
  }
  if (typeExpr.typeRef.value.name === "HttpGetStream") {
    if (typeExpr.parameters.length !== 1) {
      throw new Error("Unexpected - typeExpr.parameters.length != 1");
    }
    const responseType = typeExpr.parameters[0];
    switch (codeGenType) {
      case "collect": {
        importingHelper.addType(responseType);
        return;
      }
      case "decl": {
        if (comment) {
          codeGen.add(`/** ${comment} */`);
        }
        codeGen.add(
          `${camelCase("get " + name)}: GetStreamFn<${
            importingHelper.asReferencedName(responseType)
          }>;`,
        );
        codeGen.add("");
        return;
      }
      case "ctor": {
        codeGen.add(
          `this.${camelCase("get " + name)} = this.mkGetStreamFn(api.${name});`,
        );
        return;
      }
      case "impl": {
        codeGen.add("");
        if (comment) {
          codeGen.add(`/** ${comment} */`);
        }

        codeGen.add(
          `async ${name}(): Promise<${
            importingHelper.asReferencedName(responseType)
          }[]> {`,
        );
        codeGen.add(`  return this.${camelCase("get " + name)}.call();`);
        codeGen.add(`}`);
        return;
      }
    }
  }
  const adlType = loadedAdl
    .allAdlDecls[
      `${typeExpr.typeRef.value.moduleName}.${typeExpr.typeRef.value.name}`
    ];
  if (adlType) {
    if (adlType.decl.type_.kind === "type_") {
      throw new Error(
        "BUG: type aliases should already have been expanded",
      );
    } else if (adlType.decl.type_.kind === "newtype_") {
      throw new Error(
        "ERROR: newtypes not implemented",
      );
    }
    return;
  }
  if (codeGenType === "collect") {
    console.warn(
      `typescript-services: unrecognized field ${typeExpr.typeRef.value.name}`,
    );
  }
}

export interface GenTypescriptServiceParams {
  adlFiles: string[];
  searchPath: string[];
  outputFile: string;
  apiModule: string;
  apiName: string;
  adlGenDirRel: string;
  verbose?: boolean;
  serviceClass?: string;
  adlToolsRef?: string;
  hxRef?: string;
}


export async function genTypescriptService(params: GenTypescriptServiceParams) {
  const { searchPath, outputFile, apiModule, apiName, adlFiles, adlGenDirRel } =
    params;
  const serviceClass: string = params.serviceClass || "AppService";
  const adlToolsRef: string = params.adlToolsRef || "@adltools";
  const hxRef: string = params.hxRef || "@hx";

  // Load the ADL based upon command line arguments
  const loadedAdl = await parseAdl(adlFiles, searchPath, {
    verbose: params.verbose,
  });

  const apistructSn = `${apiModule}.${apiName}`;

  const apiRequests: ScopedDecl | undefined =
    loadedAdl.allAdlDecls[apistructSn];
  if (apiRequests === undefined) {
    throw new Error(`Scoped name not found: ${apistructSn}`);
  }
  if (
    apiRequests.decl.type_.kind !== "struct_" ||
    apiRequests.decl.type_.value.typeParams.length !== 0
  ) {
    throw new Error("Unexpected - apiRequests is not a monomorphic struct");
  }

  // The generator logic is hard coded to match the HttpGet<>, HttpPost<> (and similar) request structs.
  // So expand any type aliases in the API structure fields in order to expose the request structs
  // to the generator.
  const apiRequestsStruct: Struct = {
    typeParams: [],
    fields: apiRequests.decl.type_.value.fields.map((f) => ({
      ...f,
      typeExpr: expandTypes(loadedAdl.resolver, f.typeExpr, {expandTypeAliases:true}),
    })),
  };

  const apiReqsTypeExpr: TypeExpr = {
    typeRef: {
      kind: "reference",
      value: {
        moduleName: apiModule,
        name: apiName,
      },
    },
    parameters: [],
  };

  const importingHelper = new ImportingHelper();

  importingHelper.addType(apiReqsTypeExpr, true, true);

  // start rendering code:
  const code = new CodeGen();
  code.add("// tslint:disable: no-unused-variable");
  code.add("// tslint:disable: ordered-imports");

  // load all apiEntry referenced types into importingHelper to disambiguate imports:
  // it also recurses into all the type params of those types.
  for (const apiEntry of apiRequestsStruct.fields) {
    addCode(
      importingHelper,
      loadedAdl,
      "collect",
      code,
      apiEntry.typeExpr,
      apiEntry.name,
      getComment(apiEntry),
    );
  }

  // all required imports are now known.
  // resolve the duplicates.

  importingHelper.resolveImports();

  // get the as-referenced name of the struct that holds the runtime definition of the API:
  const apiReqAsRefd = importingHelper.asReferencedName(apiReqsTypeExpr);
  const apiReqSn = `sn${apiReqAsRefd}`;
  const apiReqMaker = `make${apiReqAsRefd}`;

  // typescript: import {foo as bar} from "blah"
  importingHelper.modulesImports.forEach(
    (imports_: Set<string>, module: string) => {
      const importedModuleFrom = `${adlGenDirRel}/${
        module.replace(/\./g, "/")
      }`;

      const modImports: string[] = [];
      for (const imp_ of Array.from(imports_)) {
        modImports.push(imp_);
      }

      code.add(
        `import { ${modImports.join(", ")} } from "${importedModuleFrom}";`,
      );
    },
  );

  // hardcoded common imports
  code.add(
    `import { HttpServiceBase } from "${adlToolsRef}/service/http-service-base";`,
  );
  code.add(
    `import { HttpServiceError } from "${adlToolsRef}/service/http-service-error";`,
  );
  code.add(`import { GetFn, PostFn } from "${adlToolsRef}/service/types";`);
  code.add(`import { HttpFetch } from "${hxRef}/hx/service/http";`);
  code.add("");
  code.add(`import { DeclResolver } from "${adlGenDirRel}/runtime/adl";`);
  code.add("");

  // generating the service class:
  const comment = getComment(apiRequests.decl);
  if (comment) {
    code.add(`/** ${comment} */`);
  }
  code.add(`export class ${serviceClass} extends HttpServiceBase {`);
  const classBody = code.inner();
  code.add("};");

  // api endpoints metadata class members:
  // eg:/** Login a user */
  //    postLogin: PostFn<LoginReq, LoginResp>;
  for (const apiEntry of apiRequestsStruct.fields) {
    addCode(
      importingHelper,
      loadedAdl,
      "decl",
      classBody,
      apiEntry.typeExpr,
      apiEntry.name,
      getComment(apiEntry),
    );
  }

  // generate constructor
  classBody.add("constructor(");
  const ctorArgs = classBody.inner();
  ctorArgs
    .add("/** Fetcher over HTTP */")
    .add("http: HttpFetch,")
    .add("/** Base URL of the API endpoints */")
    .add("baseUrl: string,")
    .add("/** Resolver for ADL types */")
    .add("resolver: DeclResolver,")
    .add("/** The authentication token (if any) */")
    .add("authToken: string | undefined,")
    .add(
      "/** Error handler to allow for cross cutting concerns, e.g. authorization errors */",
    )
    .add("handleError: (error: HttpServiceError) => void");

  classBody.add(") {");

  const ctorBody = classBody.inner();

  ctorBody.add("super(http, baseUrl, resolver, authToken, handleError);");
  ctorBody.add(
    `const api = this.annotatedApi(${apiReqSn}, ${apiReqMaker}({}));`,
  );

  // constructor body, initialisers for api endpoints metadata class members
  for (const apiEntry of apiRequestsStruct.fields) {
    addCode(
      importingHelper,
      loadedAdl,
      "ctor",
      ctorBody,
      apiEntry.typeExpr,
      apiEntry.name,
      getComment(apiEntry),
    );
  }
  classBody.add("}");

  // member functions: The main async functions used to operate the API from the app:
  // eg:/** Login a user */
  //    async login(req: LoginReq): Promise<LoginResp> {
  //      return this.postLogin.call(req);
  //    }
  for (const apiEntry of apiRequestsStruct.fields) {
    addCode(
      importingHelper,
      loadedAdl,
      "impl",
      classBody,
      apiEntry.typeExpr,
      apiEntry.name,
      getComment(apiEntry),
    );
  }
  code.add("");

  if (params.verbose) {
    console.log(`writing ${outputFile}...`);
  }
  await Deno.writeFile(
    outputFile,
    new TextEncoder().encode(code.write().join("\n")),
  );
}
