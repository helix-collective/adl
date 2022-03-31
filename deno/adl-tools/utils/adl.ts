import * as adlast from "../../adl-gen/sys/adlast.ts";
import { ADL as SYSDECLS, RESOLVER } from "../../adl-gen/resolver.ts";
import { createJsonBinding, JsonBinding } from "../../adl-gen/runtime/json.ts";
import * as adl from "../../adl-gen/runtime/adl.ts";
import { typeExprToString } from "../../adl-gen/runtime/utils.ts";

type AdlModuleMap = { [key: string]: adlast.Module };

export interface LoadedAdl {
  allAdlDecls: { [key: string]: adlast.ScopedDecl };
  modules: AdlModuleMap;
  resolver: adl.DeclResolver;
}

export interface ParseAdlOptions {
  verbose?: boolean;
}

/**
 * Load and parse the specified ADL files (and their dependencies) into
 * an adlast map.
 *
 * Runs the adl compiler as a subprocess, using the environment variable ADLC to
 * specify the path.
 */
export async function parseAdl(
  adlFiles: string[],
  adlSearchPath: string[],
  options?: ParseAdlOptions,
): Promise<LoadedAdl> {
  const moduleMapJB = createJsonBinding(
    RESOLVER,
    adl.texprStringMap(adlast.texprModule()),
  );
  const verbose = (options && options.verbose);

  // Work in a temporary directory
  const workdir = await Deno.makeTempDir();

  // run the ADL ast parser, outputing to a temporary file
  const outfile = workdir + "/output.json";
  let cmd = ["adlc", "ast", `--combined-output=${outfile}`];
  for (const dir of adlSearchPath) {
    cmd = cmd.concat(["--searchdir", dir]);
  }
  cmd = cmd.concat(adlFiles);
  if (verbose) {
    console.log("Executing", cmd);
  }
  const proc = Deno.run({ cmd });
  const status = await proc.status();
  if (!status.success) {
    throw new Error("Failed to run adl ast");
  }

  // Parse the module map json
  const text = await Deno.readTextFile(outfile);
  const jv = JSON.parse(text);
  const modules = moduleMapJB.fromJsonE(jv);
  resolveRelativeModuleRefs(modules);

  // Build the resolver
  const allAdlDecls: { [name: string]: adlast.ScopedDecl } = {};
  forEachDecl(modules, (scopedDecl) => {
    allAdlDecls[scopedDecl.moduleName + "." + scopedDecl.decl.name] =
      scopedDecl;
  });
  Object.keys(SYSDECLS).forEach((scopedDeclName) => {
    const scopedDecl = SYSDECLS[scopedDeclName];
    allAdlDecls[scopedDecl.moduleName + "." + scopedDecl.decl.name] =
      scopedDecl;
  });
  const resolver: adl.DeclResolver = adl.declResolver(allAdlDecls);

  // Cleanup
  await Deno.remove(outfile);
  await Deno.remove(workdir, { recursive: true });

  return { allAdlDecls, modules, resolver };
}

/**
 *  Convert module relative scoped names into absolute scoped namees
 */
export function resolveRelativeModuleRefs(moduleMap: AdlModuleMap) {
  forEachDecl(moduleMap, (sdecl: adlast.ScopedDecl) => {
    function resolve(typeExpr: adlast.TypeExpr) {
      if (
        typeExpr.typeRef.kind == "reference" &&
        typeExpr.typeRef.value.moduleName == ""
      ) {
        typeExpr.typeRef.value.moduleName = sdecl.moduleName;
      }
      typeExpr.parameters.forEach((p) => resolve(p));
    }
    const dtype = sdecl.decl.type_;
    switch (dtype.kind) {
      case "newtype_":
        resolve(dtype.value.typeExpr);
        break;
      case "struct_":
        dtype.value.fields.forEach((f) => resolve(f.typeExpr));
        break;
      case "union_":
        dtype.value.fields.forEach((f) => resolve(f.typeExpr));
        break;
      case "type_":
        resolve(dtype.value.typeExpr);
        break;
    }
  });
}

export function substituteTypeVariable(
  typeExpr: adlast.TypeExpr,
  tparam: string,
  tvalue: adlast.TypeExpr,
): adlast.TypeExpr {
  if (
    typeExpr.typeRef.kind == "typeParam" && typeExpr.typeRef.value == tparam &&
    typeExpr.parameters.length == 0
  ) {
    return tvalue;
  }
  return {
    typeRef: typeExpr.typeRef,
    parameters: typeExpr.parameters.map((p) =>
      substituteTypeVariable(p, tparam, tvalue)
    ),
  };
}

export function substituteTypeVariables(
  typeExpr0: adlast.TypeExpr,
  tparams: string[],
  tvalues: adlast.TypeExpr[],
): adlast.TypeExpr {
  let typeExpr = typeExpr0;
  for (let i = 0; i < tparams.length; i++) {
    typeExpr = substituteTypeVariable(typeExpr, tparams[i], tvalues[i]);
  }
  return typeExpr;
}

export function expandTypeAlias(
  resolver: adl.DeclResolver,
  typeExpr: adlast.TypeExpr,
): adlast.TypeExpr | null {
  if (typeExpr.typeRef.kind == "reference") {
    const sdecl = resolver(typeExpr.typeRef.value);
    const dtype = sdecl.decl.type_;
    if (dtype.kind == "type_") {
      const tparams = dtype.value.typeParams;
      const tvalues = typeExpr.parameters;
      return substituteTypeVariables(dtype.value.typeExpr, tparams, tvalues);
    }
  }
  return null;
}

export function expandNewType(
  resolver: adl.DeclResolver,
  typeExpr: adlast.TypeExpr,
): adlast.TypeExpr | null {
  if (typeExpr.typeRef.kind == "reference") {
    const sdecl = resolver(typeExpr.typeRef.value);
    const dtype = sdecl.decl.type_;
    if (dtype.kind == "newtype_") {
      const tparams = dtype.value.typeParams;
      const tvalues = typeExpr.parameters;
      return substituteTypeVariables(dtype.value.typeExpr, tparams, tvalues);
    }
  }
  return null;
}

/**
 * Recursively xpand type aliases and/or newtypes by substitution
 */
export function expandTypes(
  resolver: adl.DeclResolver,
  typeExpr: adlast.TypeExpr,
  options: ExpandTypeOptions,
): adlast.TypeExpr {
  switch (typeExpr.typeRef.kind) {
    case "primitive":
      break;
    case "reference":
      let texpr2 = null;
      if (options.expandTypeAliases) {
        texpr2 = texpr2 || expandTypeAlias(resolver, typeExpr);
      }
      if (options.expandNewType) {
        texpr2 = texpr2 || expandNewType(resolver, typeExpr);
      }
      if (texpr2) {
        return expandTypes(resolver, texpr2, options);
      }
      break;
    case "typeParam":
      break;
  }
  return typeExpr;
}

interface ExpandTypeOptions {
  expandTypeAliases?: boolean;
  expandNewType?: boolean;
}

/**
 * Execute the given function for each ADL declaration
 */
export function forEachDecl(
  moduleMap: AdlModuleMap,
  fn: (sdecl: adlast.ScopedDecl) => void,
): void {
  for (const moduleName of Object.keys(moduleMap)) {
    const module: adlast.Module = moduleMap[moduleName];
    for (const declName of Object.keys(module.decls)) {
      const decl = module.decls[declName];
      fn({ moduleName, decl });
    }
  }
}

/**
 * Ensure that the given declaration is monomorphic.
 *
 * If it already is, just return it. Otherwise construct a new ScopedDecl
 * that has all type parameters substituted.
 */
export function monomorphicDecl(
  typeExpr: adlast.TypeExpr,
  declName: adlast.ScopedName,
  namer: MonomorphicNamer,
  resolver: adl.DeclResolver,
): adlast.ScopedDecl {
  const decl = resolver(declName);
  // If the type is already monomorphic, just return it
  if (typeExpr.parameters.length == 0) {
    return decl;
  }
  // Otherwise build a monomorphised decl
  const type_: adlast.DeclType = (() => {
    switch (decl.decl.type_.kind) {
      case "type_":
        return {
          kind: decl.decl.type_.kind,
          value: {
            typeParams: [],
            typeExpr: substituteTypeVariables(
              decl.decl.type_.value.typeExpr,
              decl.decl.type_.value.typeParams,
              typeExpr.parameters,
            ),
          },
        };
      case "newtype_":
        return {
          kind: decl.decl.type_.kind,
          value: {
            typeParams: [],
            typeExpr: substituteTypeVariables(
              decl.decl.type_.value.typeExpr,
              decl.decl.type_.value.typeParams,
              typeExpr.parameters,
            ),
            default: decl.decl.type_.value.default,
          },
        };
      case "struct_":
        return {
          kind: decl.decl.type_.kind,
          value: {
            typeParams: [],
            fields: decl.decl.type_.value.fields.map((f) => ({
              name: f.name,
              serializedName: f.serializedName,
              typeExpr: substituteTypeVariables(
                f.typeExpr,
                decl.decl.type_.value.typeParams,
                typeExpr.parameters,
              ),
              default: f.default,
              annotations: f.annotations,
            })),
          },
        };
      case "union_":
        return {
          kind: decl.decl.type_.kind,
          value: {
            typeParams: [],
            fields: decl.decl.type_.value.fields.map((f) => ({
              name: f.name,
              serializedName: f.serializedName,
              typeExpr: substituteTypeVariables(
                f.typeExpr,
                decl.decl.type_.value.typeParams,
                typeExpr.parameters,
              ),
              default: f.default,
              annotations: f.annotations,
            })),
          },
        };
    }
  })();
  return {
    moduleName: decl.moduleName,
    decl: {
      name: namer(decl.decl.name, typeExpr.parameters),
      version: decl.decl.version,
      annotations: decl.decl.annotations,
      type_,
    },
  };
}

type MonomorphicNamer = (
  declName: string,
  typeParams: adlast.TypeExpr[],
) => string;

/**
 * A default monomorphic namer that is just the type expression converted to a string
 */
export function monomorphicName(
  declName: string,
  typeParams: adlast.TypeExpr[],
): string {
  if (typeParams.length == 0) {
    return declName;
  }
  return declName + "<" + typeParams.map((te) =>
    typeExprToString(te)
  ).join(",") + ">";
}

/**
 * Return the json value for the given annotation type for the given decl. Return undefined if the
 * decl doesn't have that annotation
 */
export function getAnnotation(
  annotations: adlast.Annotations,
  annotationType: adlast.ScopedName,
): {} | null | undefined {
  for (const ann of annotations) {
    if (scopedNamesEqual(ann.key, annotationType)) {
      return ann.value;
    }
  }
  return undefined;
}

export function getStringAnnotation(
  annotations: adlast.Annotations,
  atype: adlast.ScopedName,
): string | undefined {
  const ann = getAnnotation(annotations, atype);
  return ann && typeof ann === "string" ? ann : undefined;
}

export function getNumberAnnotation(
  annotations: adlast.Annotations,
  atype: adlast.ScopedName,
): number | undefined {
  const ann = getAnnotation(annotations, atype);
  return ann && typeof ann === "number" ? ann : undefined;
}

export function getBooleanAnnotation(
  annotations: adlast.Annotations,
  atype: adlast.ScopedName,
): boolean | undefined {
  const ann = getAnnotation(annotations, atype);
  return ann && typeof ann === "boolean" ? ann : undefined;
}

export function hasAnnotation(
  annotations: adlast.Annotations,
  atype: adlast.ScopedName,
): boolean {
  return getAnnotation(annotations, atype) != undefined;
}

export type DecodedTypeExpr =
  | { kind: "Void" }
  | { kind: "String" }
  | { kind: "Bool" }
  | { kind: "Json" }
  | { kind: "Int8" }
  | { kind: "Int16" }
  | { kind: "Int32" }
  | { kind: "Int64" }
  | { kind: "Word8" }
  | { kind: "Word16" }
  | { kind: "Word32" }
  | { kind: "Word64" }
  | { kind: "Float" }
  | { kind: "Double" }
  | { kind: "Vector"; elemType: DecodedTypeExpr }
  | { kind: "StringMap"; elemType: DecodedTypeExpr }
  | { kind: "Nullable"; elemType: DecodedTypeExpr }
  | {
    kind: "Reference";
    refScopedName: adlast.ScopedName;
    parameters: DecodedTypeExpr[];
  }
  | { kind: "Other"; typeExpr: adlast.TypeExpr };

export function decodeTypeExpr(typeExpr: adlast.TypeExpr): DecodedTypeExpr {
  switch (typeExpr.typeRef.kind) {
    case "primitive":
      const primitive = typeExpr.typeRef.value;
      switch (primitive) {
        case "Void":
          return { kind: primitive };
        case "String":
          return { kind: primitive };
        case "Bool":
          return { kind: primitive };
        case "Json":
          return { kind: primitive };
        case "Int8":
          return { kind: primitive };
        case "Int16":
          return { kind: primitive };
        case "Int32":
          return { kind: primitive };
        case "Int64":
          return { kind: primitive };
        case "Word8":
          return { kind: primitive };
        case "Word16":
          return { kind: primitive };
        case "Word32":
          return { kind: primitive };
        case "Word64":
          return { kind: primitive };
        case "Float":
          return { kind: primitive };
        case "Double":
          return { kind: primitive };
        case "Vector":
          return {
            kind: "Vector",
            elemType: decodeTypeExpr(typeExpr.parameters[0]),
          };
        case "StringMap":
          return {
            kind: "StringMap",
            elemType: decodeTypeExpr(typeExpr.parameters[0]),
          };
        case "Nullable":
          return {
            kind: "Nullable",
            elemType: decodeTypeExpr(typeExpr.parameters[0]),
          };
      }
      break;
    case "reference":
      return {
        kind: "Reference",
        refScopedName: typeExpr.typeRef.value,
        parameters: typeExpr.parameters.map(decodeTypeExpr),
      };
  }
  return { kind: "Other", typeExpr };
}

export function scopedNameFromString(s: string): adlast.ScopedName {
  const ss = s.split(/\./);
  return {
    moduleName: ss.slice(0, ss.length - 1).join("."),
    name: ss[ss.length - 1],
  };
}

export function scopedName(
  moduleName: string,
  name: string,
): adlast.ScopedName {
  return { moduleName, name };
}

export function scopedNamesEqual(
  n1: adlast.ScopedName,
  n2: adlast.ScopedName,
): boolean {
  return n1.moduleName == n2.moduleName && n1.name == n2.name;
}

/**
 * Helper for command line processing
 */
export function collect(val: string, memo: string[]): string[] {
  memo.push(val);
  return memo;
}
