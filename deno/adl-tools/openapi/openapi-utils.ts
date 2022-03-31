import * as AST from "../../adl-gen/runtime/sys/adlast.ts";
import { typeExprToString } from "../../adl-gen/runtime/utils.ts";
import { DeclResolver } from "../../adl-gen/runtime/adl.ts";
import {
  getAnnotation,
  getBooleanAnnotation,
  getStringAnnotation,
  LoadedAdl,
  monomorphicDecl,
  scopedNamesEqual,
  expandTypes,
} from "../utils/adl.ts";
import { yaml } from "../deps.ts";

export interface JsonSchema {}
type JsonSchemaMap = { [key: string]: JsonSchema };

export function yamlFromJsonSchema(schema: JsonSchema): string {
  return yaml.stringify(schema as Record<string, unknown>);
}

export function schemaFromApi(
  apiscopedname: AST.ScopedName,
  loadedAdl: LoadedAdl,
): JsonSchema {
  // Find the api definition
  const api = loadedAdl.resolver(apiscopedname);

  const paths: JsonSchemaMap = {};
  const securitySchemes: JsonSchemaMap = {};
  const components: JsonSchemaMap = {};

  const declSchemas = new DeclSchemaCollector(loadedAdl);

  if (api.decl.type_.kind != "struct_") {
    throw new Error("API declaration must be a struct");
  }

  const commonResponses = getAnnotation(
    api.decl.annotations,
    OPENAPI_OTHER_RESPONSES,
  );

  // Each field in the API struct is a request
  for (const field of api.decl.type_.value.fields) {
    if (getBooleanAnnotation(field.annotations, OPENAPI_EXCLUDE)) {
      continue;
    }
    const otherResponses =
      getAnnotation(field.annotations, OPENAPI_OTHER_RESPONSES) ||
      commonResponses ||
      {};
    const apiRequest = decodeApiRequest(field, otherResponses, loadedAdl.resolver);
    declSchemas.addTypeExpr(apiRequest.paramsType);
    switch (apiRequest.method) {
      case "get":
        declSchemas.addTypeExpr(apiRequest.responseType);
        break;
      case "post":
        declSchemas.addTypeExpr(apiRequest.bodyType);
        declSchemas.addTypeExpr(apiRequest.responseType);
        break;
      case "delete":
        declSchemas.addTypeExpr(apiRequest.responseType);
        break;
    }
    if (paths[apiRequest.path] === undefined) {
      paths[apiRequest.path] = {};
    }
    setprop(
      paths[apiRequest.path],
      apiRequest.method,
      schemaFromRequest(apiRequest, loadedAdl.resolver, declSchemas),
    );
  }

  // Always include a security schema for JWTs
  securitySchemes.TokenAuth = securitySchemeFromAnnotation(
    getAnnotation(api.decl.annotations, SECURITY_SCHEME),
  );

  components["securitySchemes"] = securitySchemes;
  components["schemas"] = declSchemas.schemas;
  const info = getAnnotation(api.decl.annotations, OPENAPI_INFO) || {
    version: "1.0.0",
    title: "API",
  };
  const description = getAnnotation(api.decl.annotations, DOC);
  if (description) {
    setprop(info, "description", description);
  }

  const result: JsonSchema = {
    openapi: "3.0.0",
    info,
    paths,
    components,
  };

  // Include the server list if annotated
  const servers = getAnnotation(api.decl.annotations, OPENAPI_SERVERS);
  if (servers) {
    setprop(result, "servers", servers);
  }

  return result;
}

type Roles = string[];

type Security =
  | { kind: "public" }
  | { kind: "token" };

interface CommonRequest {
  name: string;
  description: string;
  path: string;
  security: Security;
  paramsType: AST.TypeExpr;
  responseType: AST.TypeExpr;
  otherResponses: JsonSchema;
}

interface GetRequest extends CommonRequest {
  method: "get";
}

interface PostRequest extends CommonRequest {
  method: "post";
  bodyType: AST.TypeExpr;
}

interface PutRequest extends CommonRequest {
  method: "put";
  bodyType: AST.TypeExpr;
}

interface DeleteRequest extends CommonRequest {
  method: "delete";
}

type ApiRequest =
  | GetRequest
  | PutRequest
  | PostRequest
  | DeleteRequest;

function decodeApiRequest(
  reqfield: AST.Field,
  otherResponses: JsonSchema,
  resolver: DeclResolver,
): ApiRequest {
  const rtype = expandTypes(resolver, reqfield.typeExpr, {expandTypeAliases:true});

  if (rtype.typeRef.kind != "reference") {
    throw new Error("API field types must be references");
  }
  const defv = reqfield.default;
  if (defv.kind != "just" || defv.value == null) {
    throw new Error("Request details not provided as the field value");
  }
  const value = defv.value;
  const description: string = getStringAnnotation(reqfield.annotations, DOC) ||
    "";

  if (scopedNamesEqual(rtype.typeRef.value, HTTP_GET)) {
    return {
      method: "get",
      name: reqfield.name,
      description,
      path: pathFromFieldValue(value),
      security: securityFromFieldValue(value),
      paramsType: UNIT_TYPEEXPR,
      responseType: rtype.parameters[0],
      otherResponses: otherResponses || {},
    };
  } else if (scopedNamesEqual(rtype.typeRef.value, HTTP_GET2)) {
    return {
      method: "get",
      name: reqfield.name,
      description,
      path: pathFromFieldValue(value),
      security: securityFromFieldValue(value),
      paramsType: rtype.parameters[0],
      responseType: rtype.parameters[1],
      otherResponses,
    };
  } else if (scopedNamesEqual(rtype.typeRef.value, HTTP_POST)) {
    return {
      method: "post",
      name: reqfield.name,
      description,
      path: pathFromFieldValue(value),
      security: securityFromFieldValue(value),
      paramsType: UNIT_TYPEEXPR,
      bodyType: rtype.parameters[0],
      responseType: rtype.parameters[1],
      otherResponses,
    };
  } else if (scopedNamesEqual(rtype.typeRef.value, HTTP_POST2)) {
    return {
      method: "post",
      name: reqfield.name,
      description,
      path: pathFromFieldValue(value),
      security: securityFromFieldValue(value),
      paramsType: rtype.parameters[0],
      bodyType: rtype.parameters[1],
      responseType: rtype.parameters[2],
      otherResponses,
    };
  } else if (scopedNamesEqual(rtype.typeRef.value, HTTP_PUT)) {
    return {
      method: "put",
      name: reqfield.name,
      description,
      path: pathFromFieldValue(value),
      security: securityFromFieldValue(value),
      paramsType: UNIT_TYPEEXPR,
      bodyType: rtype.parameters[0],
      responseType: rtype.parameters[1],
      otherResponses,
    };
  } else if (scopedNamesEqual(rtype.typeRef.value, HTTP_PUT2)) {
    return {
      method: "put",
      name: reqfield.name,
      description,
      path: pathFromFieldValue(value),
      security: securityFromFieldValue(value),
      paramsType: rtype.parameters[0],
      bodyType: rtype.parameters[1],
      responseType: rtype.parameters[2],
      otherResponses,
    };
  } else if (scopedNamesEqual(rtype.typeRef.value, HTTP_DELETE)) {
    return {
      method: "delete",
      name: reqfield.name,
      description,
      path: pathFromFieldValue(value),
      security: securityFromFieldValue(value),
      paramsType: rtype.parameters[0],
      responseType: rtype.parameters[1],
      otherResponses,
    };
  }
  throw new Error("Unable to decode API field " + reqfield.name);
}

function pathFromFieldValue(value: {}): string {
  return prop(value, "path") as string;
}

function securityFromFieldValue(value: {}): Security {
  const v: {} = prop(value, "security") as {};
  if (typeof v == "string" && v == "public") {
    return { kind: "public" };
  }
  return { kind: "token" };
}

function securitySchemeFromAnnotation(
  annotation: {} | null | undefined,
): JsonSchema {
  const headerName = annotation &&
    prop(prop(annotation, "apiKey"), "headerName");
  if (typeof (headerName) == "string") {
    return {
      type: "apiKey",
      "in": "header",
      name: headerName,
    };
  }

  // Else assume http bearer
  return {
    type: "http",
    scheme: "bearer",
  };
}

interface RequestParam {
  name: string;
  typeExpr: AST.TypeExpr;
  hasDefault: boolean;
  description: string;
}

export function schemaFromRequest(
  apiRequest: ApiRequest,
  resolver: DeclResolver,
  declSchemas: DeclSchemaCollector,
): JsonSchema {
  const schema: JsonSchemaMap = {};
  const properties: JsonSchemaMap = {};
  properties.operationId = apiRequest.name;
  if (apiRequest.description != undefined) {
    properties.description = apiRequest.description;
  }

  // Parameters
  properties.parameters = paramsFromType(apiRequest.paramsType, resolver, declSchemas).map(
    (p) => {
      const isPathParam = apiRequest.path.includes("{" + p.name + "}");
      const result = {
        "in": isPathParam ? "path" : "query",
        name: p.name,
        required: isPathParam || !p.hasDefault,
        schema: schemaFromTypeExpr(p.typeExpr, declSchemas),
      };
      if (p.description) {
        setprop(result, "description", p.description);
      }
      return result;
    },
  );

  // Request body schema
  switch (apiRequest.method) {
    case "post":
    case "put":
      properties.requestBody = {
        content: {
          "application/json": {
            schema: schemaFromTypeExpr(apiRequest.bodyType, declSchemas),
          },
        },
      };
      break;
  }

  // Responses
  switch (apiRequest.method) {
    case "put":
    case "post":
    case "get":
    case "delete":
      properties.responses = {
        ...apiRequest.otherResponses,
        200: {
          description: "success",
          content: {
            "application/json": {
              schema: schemaFromTypeExpr(apiRequest.responseType, declSchemas),
            },
          },
        },
      };
      break;
  }

  // security
  const publicEndpoint = apiRequest.security.kind == "public";
  if (!publicEndpoint) {
    properties.security = [{ TokenAuth: [] }];
  }

  return properties;
}

function paramsFromType(
  typeExpr: AST.TypeExpr,
  resolver: DeclResolver,
  declSchemas: DeclSchemaCollector,
): RequestParam[] {
  if (typeExpr.typeRef.kind != "reference") {
    throw new Error("request parameters must be a reference to a struct");
  }
  const decl = monomorphicDecl(
    typeExpr,
    typeExpr.typeRef.value,
    (d,p) => monomorphicName(d,p,declSchemas),
    resolver,
  );
  if (decl.decl.type_.kind != "struct_") {
    throw new Error("request parameters must be a reference to a struct");
  }

  const result: RequestParam[] = [];
  for (const field of decl.decl.type_.value.fields) {
    if (!getBooleanAnnotation(field.annotations, OPENAPI_EXCLUDE)) {
      result.push({
        name: field.name,
        typeExpr: field.typeExpr,
        description: getStringAnnotation(field.annotations, DOC) || "",
        hasDefault: field.default.kind != "nothing",
      });
    }
  }

  return result;
}

/**
 * Builds up a map of json schema objects from ADL declarations
 * and their recursive references.
 */
class DeclSchemaCollector {
  schemas: Record<string, JsonSchema>  = {};
  abbreviations: Record<string, string> = {};

  constructor(private readonly loadedAdl: LoadedAdl) {
  }

  addDecl(decl: AST.ScopedDecl) {
    const key = this.schemaKeyFromScopedName({
      moduleName: decl.moduleName,
      name: decl.decl.name,
    });

    // Avoid infinite recursion by returning if this decl
    // is already present
    if (this.schemas[key] != undefined) {
      return;
    }

    if (getBooleanAnnotation(decl.decl.annotations, OPENAPI_EXCLUDE)) {
      return;
    }

    const dtype = decl.decl.type_;
    switch (dtype.kind) {
      case "struct_":
        this.schemas[key] = schemaFromStruct(decl, dtype.value, this);
        dtype.value.fields.forEach((f) => {
          if (!getBooleanAnnotation(f.annotations, OPENAPI_EXCLUDE)) {
            this.addTypeExpr(f.typeExpr);
          }        
        });
        break;
      case "union_":
        this.schemas[key] = schemaFromUnion(decl, dtype.value, this);
        dtype.value.fields.forEach((f) => {
          if (!getBooleanAnnotation(f.annotations, OPENAPI_EXCLUDE)) {
            this.addTypeExpr(f.typeExpr);
          }        
        });
        break;
      case "newtype_":
        this.schemas[key] = schemaFromNewType(decl, dtype.value, this);
        this.addTypeExpr(dtype.value.typeExpr);
        break;
      case "type_":
        this.schemas[key] = schemaFromTypeAlias(decl, dtype.value, this);
        this.addTypeExpr(dtype.value.typeExpr);
    }
  }

  addTypeExpr(typeExpr: AST.TypeExpr) {
    typeExpr.parameters.forEach((p) => {
      this.addTypeExpr(p);
    });
    switch (typeExpr.typeRef.kind) {
      case "primitive":
      case "typeParam":
        break;
      case "reference":
        const decl = monomorphicDecl(
          typeExpr,
          typeExpr.typeRef.value,
          (d,p) => monomorphicName(d,p,this),
          this.loadedAdl.resolver,
        );
        this.addDecl(decl);
    }
  }

  schemaKeyFromScopedName(scopedName: AST.ScopedName): string {
    const abbrev = this.abbreviations[scopedName.name];
    if (abbrev === undefined) {
      this.abbreviations[scopedName.name] = scopedName.moduleName;
      return scopedName.name;
    }
    if (abbrev == scopedName.moduleName) {
      return scopedName.name;
    }
    return (scopedName.moduleName + "." + scopedName.name).replace(/[.]/g, "_");
  }
  
  componentFromScopedName(
    scopedName: AST.ScopedName,
  ): JsonSchema {
    return "#/components/schemas/" + this.schemaKeyFromScopedName(scopedName);
  }
}

function descriptionField(decl: AST.Decl): JsonSchema {
  const description =
    (getAnnotation(decl.annotations, DOC) as string | null | undefined) ??
    undefined;
  if (description) {
    return {description: description.trim()};
  }
  return {};
}

export function schemaFromStruct(
  decl: AST.ScopedDecl,
  struct: AST.Struct,
  declSchemas: DeclSchemaCollector,
): JsonSchema {
  const properties: { [key: string]: JsonSchema } = {};
  const required: string[] = [];
  struct.fields.forEach((f) => {
    if (!getBooleanAnnotation(f.annotations, OPENAPI_EXCLUDE)) {
      properties[f.name] = schemaFromTypeExpr(f.typeExpr, declSchemas);
      if (f.default.kind == "nothing") {
        required.push(f.name);
      }
    }
  });
  const result: { [key: string]: JsonSchema } = {
    type: "object",
    ...descriptionField(decl.decl),
    properties,
  };
  if (required.length > 0) {
    result.required = required;
  }
  return result;
}

export function schemaFromUnion(
  decl: AST.ScopedDecl,
  union: AST.Union,
  declSchemas: DeclSchemaCollector,
): JsonSchema {
  const voidFields: string[] = [];
  const otherFields: AST.Field[] = [];
  union.fields.forEach((f) => {
    if (
      f.typeExpr.typeRef.kind == "primitive" &&
      f.typeExpr.typeRef.value == "Void"
    ) {
      voidFields.push(f.name);
    } else {
      otherFields.push(f);
    }
  });

  if (otherFields.length == 0) {
    // We have an enum
    return {
      type: "string",
      enum: voidFields,
    };
  } else {
    // We have a union
    const alternatives: JsonSchema[] = [];
    if (voidFields.length) {
      alternatives.push({
        type: "string",
        enum: voidFields,
      });
    }
    otherFields.forEach((f) => {
      const properties: { [key: string]: JsonSchema } = {};
      properties[f.name] = schemaFromTypeExpr(f.typeExpr, declSchemas);
      alternatives.push({
        type: "object",
        properties,
        required: [f.name],
      });
    });
    return {
      ...descriptionField(decl.decl),
      oneOf: alternatives,
    };
  }
}

export function schemaFromNewType(
  decl: AST.ScopedDecl,
  newtype: AST.NewType,
  declSchemas: DeclSchemaCollector
): JsonSchema {
  return {
    ...schemaFromTypeExpr(newtype.typeExpr, declSchemas),
    ...descriptionField(decl.decl),
  }
}

export function schemaFromTypeAlias(
  decl: AST.ScopedDecl,
  typealias: AST.TypeDef,
  declSchemas: DeclSchemaCollector,
): JsonSchema {
  return {
    ...schemaFromTypeExpr(typealias.typeExpr, declSchemas),
    ...descriptionField(decl.decl),
  }
}

export function schemaFromTypeExpr(typeExpr: AST.TypeExpr,   declSchemas: DeclSchemaCollector ): JsonSchema {
  if (
    typeExpr.typeRef.kind === "primitive" &&
    typeExpr.typeRef.value == "Nullable"
  ) {
    return schemaFromTypeExpr1(typeExpr.parameters[0], true, declSchemas);
  } else {
    return schemaFromTypeExpr1(typeExpr, false, declSchemas);
  }
}

function schemaFromTypeExpr1(
  typeExpr: AST.TypeExpr,
  nullable: boolean,
  declSchemas: DeclSchemaCollector,
): JsonSchema {
  switch (typeExpr.typeRef.kind) {
    case "primitive":
      const schema = (() => {
        if (typeExpr.typeRef.value == "Vector") {
          return {
            type: "array",
            items: schemaFromTypeExpr(typeExpr.parameters[0], declSchemas),
          };
        } else if (typeExpr.typeRef.value == "StringMap") {
          return {
            type: "object",
            additionalProperties: schemaFromTypeExpr(typeExpr.parameters[0], declSchemas),
          };
        } else {
          return schemaFromPrimitive(typeExpr.typeRef.value);
        }
      })();
      if (nullable) {
        /* tslint:disable:no-string-literal */
        setprop(schema, "nullable", true);
        /* tslint:enable:no-string-literal */
      }
      return schema;
    case "reference":
      const scopedName = {
        moduleName: typeExpr.typeRef.value.moduleName,
        name: monomorphicName(typeExpr.typeRef.value.name, typeExpr.parameters, declSchemas),
      };
      if (nullable) {
        return {
          // see https://github.com/OAI/OpenAPI-Specification/issues/1368
          nullable: true,
          allOf: [
            { $ref: declSchemas.componentFromScopedName(scopedName) },
          ],
        };
      } else {
        return { $ref: declSchemas.componentFromScopedName(scopedName) };
      }
    case "typeParam":
      return {
        type: "Unimplemented: Type parameter: " + typeExprToString(typeExpr),
      };
  }
}

function schemaFromPrimitive(adlptype: string): JsonSchema {
  if (ADL_NUMERIC_TYPES.find((el) => el === adlptype)) {
    return { type: "number" };
  } else if (adlptype === "Bool") {
    return { type: "boolean" };
  } else if (adlptype === "Json") {
    return { type: "object" };
  } else {
    return { type: adlptype.toLowerCase() };
  }
}

function prop(obj: {} | undefined, key: string): {} | undefined {
  if (obj == undefined) {
    return undefined;
  }
  return (obj as any)[key];
}

function setprop(obj: {}, key: string, value: {}) {
  (obj as any)[key] = value;
}

const ADL_NUMERIC_TYPES: string[] = [
  "Int8",
  "Int16",
  "Int32",
  "Int64",
  "Word8",
  "Word16",
  "Word32",
  "Word64",
  "Float",
  "Double",
];


function monomorphicName(declName: string, typeParams: AST.TypeExpr[], declSchemas: DeclSchemaCollector): string {
  if (typeParams.length == 0) {
    return declName;
  }
  const paramSchemas = typeParams.map( (te) => {
    switch(te.typeRef.kind) {
      case 'reference':
        return declSchemas.schemaKeyFromScopedName(te.typeRef.value);
      default:
        return typeExprToString(te);
    }
  } );
  return declName + "_" + paramSchemas.join("_");
}

export const UNIT: AST.ScopedName = { moduleName: "common", name: "Unit" };
export const DOC: AST.ScopedName = {
  moduleName: "sys.annotations",
  name: "Doc",
};
export const HTTP_GET: AST.ScopedName = {
  moduleName: "common.http",
  name: "HttpGet",
};
export const HTTP_GET2: AST.ScopedName = {
  moduleName: "common.http",
  name: "HttpGet2",
};
export const HTTP_POST: AST.ScopedName = {
  moduleName: "common.http",
  name: "HttpPost",
};
export const HTTP_POST2: AST.ScopedName = {
  moduleName: "common.http",
  name: "HttpPost2",
};
export const HTTP_PUT: AST.ScopedName = {
  moduleName: "common.http",
  name: "HttpPut",
};
export const HTTP_PUT2: AST.ScopedName = {
  moduleName: "common.http",
  name: "HttpPut2",
};
export const HTTP_DELETE: AST.ScopedName = {
  moduleName: "common.http",
  name: "HttpDelete",
};
export const SECURITY_SCHEME: AST.ScopedName = {
  moduleName: "common.http",
  name: "SecurityScheme",
};
export const OPENAPI_OTHER_RESPONSES: AST.ScopedName = {
  moduleName: "common.http",
  name: "OpenApiOtherResponses",
};
export const OPENAPI_EXCLUDE: AST.ScopedName = {
  moduleName: "common.http",
  name: "OpenApiExclude",
};
export const OPENAPI_SERVERS: AST.ScopedName = {
  moduleName: "common.http",
  name: "OpenApiServers",
};
export const OPENAPI_INFO: AST.ScopedName = {
  moduleName: "common.http",
  name: "OpenApiInfo",
};
export const UNIT_TYPEEXPR: AST.TypeExpr = {
  typeRef: { kind: "reference", value: UNIT },
  parameters: [],
};
