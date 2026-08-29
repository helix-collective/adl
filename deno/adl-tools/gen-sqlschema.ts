import { changeCase, mustache } from "./deps.ts";

import * as adlast from "../adl-gen/sys/adlast.ts";
import * as adl from "../adl-gen/runtime/adl.ts";
import { createJsonBinding } from "../adl-gen/runtime/json.ts";
import { isEnum, typeExprToStringUnscoped } from "../adl-gen/runtime/utils.ts";
import {
  decodeTypeExpr,
  expandNewType,
  expandTypeAlias,
  expandTypes,
  forEachDecl,
  getAnnotation,
  LoadedAdl,
  parseAdl,
  scopedName,
  scopedNamesEqual,
} from "./utils/adl.ts";

const snakeCase = changeCase.snakeCase;

export interface GenSqlParams {
  adlFiles: string[];
  searchPath: string[];
  extensions?: string[];
  templates?: Template[];
  viewsFile: string;
  metadataFile?: string;
  dbProfile?: "postgresql" | "postgresql2" | "mssql2";
  verbose?: boolean;
  filter?: (scopedDecl: adlast.ScopedDecl)=>boolean
}

interface GenCreateSqlParams extends GenSqlParams {
  createFile: string;
}

interface GenAlterSqlParams extends GenSqlParams {
  createFile: string;
  constraintsFile: string;
}

export interface Template {
  template: string;
  outfile: string;
}

export interface DbResources {
  tables: DbTable[],
  views: DbView[],
}

export interface DbTable {
  scopedDecl: adlast.ScopedDecl;
  struct: adlast.DeclType_Struct_;
  ann: {} | null;
  name: string;
}

export interface DbView {
  scopedDecl: adlast.ScopedDecl;
  struct: adlast.DeclType_Struct_;
  ann: {} | null;
  name: string;
}

export async function genCreateSqlSchema(
  params: GenCreateSqlParams,
): Promise<void> {
  const { loadedAdl, dbResources } = await loadDbResources(params);
  await generateCreateSqlSchema(params, loadedAdl, dbResources);
  await writeOtherFiles(params, loadedAdl, dbResources);
}

export async function genAlterSqlSchema(
  params: GenAlterSqlParams,
): Promise<void> {
  const { loadedAdl, dbResources } = await loadDbResources(params);
  await generateAlterSqlSchema(params, loadedAdl, dbResources);
  await writeOtherFiles(params, loadedAdl, dbResources);
}

async function loadDbResources(
  params: GenSqlParams,
): Promise<{ loadedAdl: LoadedAdl; dbResources: DbResources }> {
  // Load the ADL based upon command line arguments
  const loadedAdl = await parseAdl(params.adlFiles, params.searchPath, {
    verbose: params.verbose,
  });

  const dbResources: DbResources = {tables:[], views:[]}

  const acceptAll = (_scopedDecl: adlast.ScopedDecl)=>true;
  const filter = params.filter ?? acceptAll;

  // Find all of the struct declarations that have a DbTable annotation
  forEachDecl(loadedAdl.modules, (scopedDecl) => {
    const accepted = filter(scopedDecl);
    if(!accepted) {
      return;
    }

    if (scopedDecl.decl.type_.kind == "struct_") {
      const struct = scopedDecl.decl.type_;
      const ann = getAnnotation(scopedDecl.decl.annotations, DB_TABLE);
      if (ann != undefined) {
        const name = getTableName(scopedDecl);
        dbResources.tables.push({ scopedDecl, struct, ann, name });
      }
    }
  });
  dbResources.tables.sort((t1, t2) => t1.name < t2.name ? -1 : t1.name > t2.name ? 1 : 0);

    // Find all of the struct declarations that have a DbView annotation
    forEachDecl(loadedAdl.modules, (scopedDecl) => {
      if (scopedDecl.decl.type_.kind == "struct_") {
        const struct = scopedDecl.decl.type_;
        const ann = getAnnotation(scopedDecl.decl.annotations, DB_VIEW);
        if (ann != undefined) {
          const name = getTableName(scopedDecl);
          dbResources.views.push({ scopedDecl, struct, ann, name });
        }
      }
    });
    dbResources.views.sort((t1, t2) => t1.name < t2.name ? -1 : t1.name > t2.name ? 1 : 0);

  return { loadedAdl, dbResources };
}

async function writeOtherFiles(
  params: GenSqlParams,
  loadedAdl: LoadedAdl,
  dbResources: DbResources,
): Promise<void> {
  await generateViews(params.viewsFile, params, loadedAdl, dbResources);
  if (params.metadataFile) {
    await generateMetadata(params.metadataFile, params, loadedAdl, dbResources);
  }
  if (params.templates) {
    for (const t of params.templates) {
      await generateTemplate(t, dbResources);
    }
  }
}

async function generateCreateSqlSchema(
  params: GenCreateSqlParams,
  loadedAdl: LoadedAdl,
  dbResources: DbResources,
): Promise<void> {
  const dbTables = dbResources.tables;
  // Now generate the SQL file
  const writer = new FileWriter(params.createFile, !!params.verbose);
  const moduleNames: Set<string> = new Set(
    dbTables.map((dbt) => dbt.scopedDecl.moduleName),
  );
  writer.write(
    `-- Schema auto-generated from adl modules: ${
      Array.from(moduleNames.keys()).join(", ")
    }\n`,
  );
  writer.write(`--\n`);
  writer.write(`-- column comments show original ADL types\n`);

  if (params.extensions && params.extensions.length > 0) {
    writer.write("\n");
    params.extensions.forEach((e) => {
      writer.write(`create extension ${e};\n`);
    });
  }

  const constraints: string[] = [];
  let allExtraSql: string[] = [];
  const dbProfile = getDbProfile(params.dbProfile);

  // Output the tables
  for (const t of dbTables) {
    const ann: null | { [key: string]: any } = t.ann;
    const withIdPrimaryKey: boolean = ann && ann["withIdPrimaryKey"] || false;
    const withPrimaryKey: string[] = ann && ann["withPrimaryKey"] || [];
    const indexes: string[][] = ann && ann["indexes"] || [];
    const uniquenessConstraints: string[][] =
      ann && ann["uniquenessConstraints"] || [];
    const extraSql: string[] = ann && ann["extraSql"] || [];

    const lines: { code: string; comment?: string }[] = [];
    const dbProfile = getDbProfile(params.dbProfile);
    if (withIdPrimaryKey) {
      lines.push({ code: `id ${dbProfile.idColumnType} not null` });
    }
    for (const f of t.struct.value.fields) {
      const columnName = getColumnName(f);
      // check length(tableName + "." + columnName) < 64, if not throw error
      const columnType = getColumnType(loadedAdl.resolver, f, dbProfile);
      lines.push({
        code: `${columnName} ${columnType.sqltype}${
          columnType.notNullable ? " not null" : ""
        }`,
        comment: typeExprToStringUnscoped(f.typeExpr),
      });
      if (columnType.fkey) {
        constraints.push(
          `alter table ${
            quoteReservedName(t.name)
          } add constraint ${t.name}_${columnName}_fk foreign key (${columnName}) references ${
            quoteReservedName(columnType.fkey.table)
          }(${columnType.fkey.column});`,
        );
      }
    }

    function findColName(s: string): string {
      for (const f of t.struct.value.fields) {
        if (f.name == s) {
          return getColumnName(f);
        }
      }
      return s;
    }

    for (let i = 0; i < indexes.length; i++) {
      const cols = indexes[i].map(findColName);
      constraints.push(
        `create index ${t.name}_${i + 1}_idx on ${quoteReservedName(t.name)}(${
          cols.join(", ")
        });`,
      );
    }
    for (let i = 0; i < uniquenessConstraints.length; i++) {
      const cols = uniquenessConstraints[i].map(findColName);
      constraints.push(
        `alter table ${quoteReservedName(t.name)} add constraint ${t.name}_${i +
          1}_con unique (${cols.join(", ")});`,
      );
    }
    if (withIdPrimaryKey) {
      lines.push({ code: "primary key(id)" });
    } else if (withPrimaryKey.length > 0) {
      const cols = withPrimaryKey.map(findColName);
      lines.push({ code: `primary key(${cols.join(",")})` });
    }

    writer.write("\n");
    writer.write(`create table ${quoteReservedName(t.name)}(\n`);
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].code;
      if (i < lines.length - 1) {
        line += ",";
      }
      if (lines[i].comment) {
        line = line.padEnd(36, " ");
        line = line + " -- " + lines[i].comment;
      }
      writer.write("  " + line + "\n");
    }
    writer.write(`);\n`);
    allExtraSql = allExtraSql.concat(extraSql);
  }

  if (constraints.length > 0) {
    writer.write("\n");
  }

  for (const constraint of constraints) {
    writer.write(constraint + "\n");
  }

  if (allExtraSql.length > 0) {
    writer.write("\n");
  }

  // And any sql
  for (const sql of allExtraSql) {
    writer.write(sql + "\n");
  }

  writer.close();
}

async function generateAlterSqlSchema(
  params: GenAlterSqlParams,
  loadedAdl: LoadedAdl,
  dbResources: DbResources,
): Promise<void> {
  const dbTables = dbResources.tables;
  // Now generate the SQL file
  let writer = new FileWriter(params.createFile, !!params.verbose);
  const moduleNames: Set<string> = new Set(
    dbTables.map((dbt) => dbt.scopedDecl.moduleName),
  );
  writer.write(
    `-- Schema auto-generated from adl modules: ${
      Array.from(moduleNames.keys()).join(", ")
    }\n`,
  );
  writer.write(`--\n`);

  if (params.extensions && params.extensions.length > 0) {
    params.extensions.forEach((e) => {
      writer.write(`create extension ${e};\n`);
    });
    writer.write("\n");
  }

  const collectSetNotNullLines: { table: string; cols: string[] }[] = [];
  const constraints: string[] = [];
  let allExtraSql: string[] = [];

  // Output the tables
  for (const t of dbTables) {
    const ann: null | { [key: string]: any } = t.ann;
    const withIdPrimaryKey: boolean = ann && ann["withIdPrimaryKey"] || false;
    const withPrimaryKey: string[] = ann && ann["withPrimaryKey"] || [];
    const indexes: string[][] = ann && ann["indexes"] || [];
    const uniquenessConstraints: string[][] =
      ann && ann["uniquenessConstraints"] || [];
    const extraSql: string[] = ann && ann["extraSql"] || [];
    const dbProfile = getDbProfile(params.dbProfile);
  
    const lines: { code: string; comment?: string }[] = [];
    // collect columns from tables that need to be set as the primary key
    const pkLines: string[] = [];

    const notNullCols: string[] = [];
    collectSetNotNullLines.push({ table: t.name, cols: notNullCols });

    if (withIdPrimaryKey) {
      lines.push({ code: `id ${dbProfile.idColumnType}` });
      pkLines.push(
        `alter table ${quoteReservedName(t.name)} add primary key(id)`,
      );
      notNullCols.push("id");
    } else if (withPrimaryKey.length > 0) {
      const cols = withPrimaryKey.map(findColName);
      pkLines.push(
        `alter table ${quoteReservedName(t.name)} add primary key(${
          cols.join(",")
        })`,
      );
    }
    for (const f of t.struct.value.fields) {
      const columnName = getColumnName(f);
      // check length(tableName + "." + columnName) < 64, if not throw error
      const columnType = getColumnType(loadedAdl.resolver, f, dbProfile);
      lines.push({
        code: `${columnName} ${columnType.sqltype}`,
        comment: typeExprToStringUnscoped(f.typeExpr),
      });
      if (columnType.notNullable) {
        notNullCols.push(columnName);
      }
      if (columnType.fkey) {
        constraints.push(
          `alter table ${
            quoteReservedName(t.name)
          } add constraint ${t.name}_${columnName}_fk foreign key (${columnName}) references ${
            quoteReservedName(columnType.fkey.table)
          }(${columnType.fkey.column});`,
        );
      }
    }

    function findColName(s: string): string {
      for (const f of t.struct.value.fields) {
        if (f.name == s) {
          return getColumnName(f);
        }
      }
      return s;
    }

    for (let i = 0; i < indexes.length; i++) {
      const cols = indexes[i].map(findColName);
      constraints.push(
        `create index if not exists ${t.name}_${i + 1}_idx on ${
          quoteReservedName(t.name)
        }(${cols.join(", ")});`,
      );
    }
    for (let i = 0; i < uniquenessConstraints.length; i++) {
      const cols = uniquenessConstraints[i].map(findColName);
      constraints.push(
        `alter table ${quoteReservedName(t.name)} add constraint ${t.name}_${i +
          1}_con unique (${cols.join(", ")});`,
      );
    }
    if (withIdPrimaryKey) {
      lines.push({
        code: `alter table ${quoteReservedName(t.name)} add primary key(id);`,
      });
    } else if (withPrimaryKey.length > 0) {
      const cols = withPrimaryKey.map(findColName);
      lines.push({
        code: `alter table ${quoteReservedName(t.name)} add primary key(${
          cols.join(",")
        });`,
      });
    }

    writer.write("\n");
    writer.write(
      `create table if not exists ${quoteReservedName(t.name)} ();` + "\n",
    );

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].code;
      // there is an off by one error when no primary key(s)
      if ((withPrimaryKey.length === 0 && !withIdPrimaryKey) || i < lines.length - 1) {
        line = `alter table ${
          quoteReservedName(t.name)
        } add column if not exists ${line};`;
        writer.write(line + "\n");
      }
    }

    for (let i = 0; i < pkLines.length; i++) {
      let line = pkLines[i];
      line = `${line};`;
      writer.write(line + "\n");
    }

    allExtraSql = allExtraSql.concat(extraSql);
  }
  writer.close();

  writer = new FileWriter(params.constraintsFile, !!params.verbose);
  writer.write(
    `-- Schema auto-generated from adl modules: ${
      Array.from(moduleNames.keys()).join(", ")
    }\n`,
  );
  writer.write(`--\n`);
  writer.write(
    `-- Note postgres requires add column and alter column to be in separate transactions\n`,
  );
  writer.write(`--\n`);
  writer.write("-- vv update columns for set null value");
  for (const table of collectSetNotNullLines) {
    writer.write("\n");
    for (const col of table.cols) {
      writer.write(
        `alter table ${
          quoteReservedName(table.table)
        } alter column ${col} set not null;\n`,
      );
    }
  }
  writer.write("-- ^^ update columns for set null value" + "\n\n");
  writer.write("-- vv constraints from annotations \n");
  for (const constraint of constraints) {
    writer.write(constraint + "\n");
  }
  writer.write("-- ^^ constraints from annotations \n\n");
  writer.write("-- vv extra sql from annotations \n");
  // And any sql
  for (const sql of allExtraSql) {
    writer.write(sql + "\n");
  }
  writer.write("-- ^^ extra sql from annotations \n");
  writer.close();
}

class FileWriter {
  content: string[] = [];

  constructor(readonly path: string, readonly verbose: boolean) {
    if (verbose) {
      console.log(`Writing ${path}...`);
    }
    this.content = [];
  }

  write(s: string) {
    this.content.push(s);
  }

  close() {
    Deno.writeTextFileSync(this.path, this.content.join(""));
  }
}

/**
 *  Returns the SQL name for the table
 */
function getTableName(scopedDecl: adlast.ScopedDecl): string {
  const ann = getAnnotation(scopedDecl.decl.annotations, DB_TABLE);
  const tableName = assumeField<string>(ann, "tableName");
  return tableName || snakeCase(scopedDecl.decl.name);
}

/**
 *  Returns the SQL name for the view
 */
 function getViewName(scopedDecl: adlast.ScopedDecl): string {
  const ann = getAnnotation(scopedDecl.decl.annotations, DB_VIEW);
  const viewName = assumeField<string>(ann, "viewName");
  return viewName || snakeCase(scopedDecl.decl.name);
}

/**
 *  Returns the singular primary key for the table
 */
function getPrimaryKey(scopedDecl: adlast.ScopedDecl): string {
  const ann = getAnnotation(scopedDecl.decl.annotations, DB_TABLE);
  const withIdPrimaryKey = assumeField<boolean>(ann, "withIdPrimaryKey");
  if (withIdPrimaryKey) {
    return "id";
  }
  const withPrimaryKey = assumeField<string[]>(ann, "withPrimaryKey");

  if (withPrimaryKey && withPrimaryKey.length == 1) {
    return withPrimaryKey[0];
  }
  throw new Error(`No singular primary key for ${scopedDecl.decl.name}`);
  return "??";
}

function assumeField<T>(
  obj: {} | null | undefined,
  key: string,
): T | undefined {
  if (obj == undefined) {
    return undefined;
  }
  return (obj as { [key: string]: any })[key] as T;
}

/**
 * Returns the SQL name for a column corresponding to a field
 */
function getColumnName(field: adlast.Field): string {
  const ann = getAnnotation(field.annotations, DB_COLUMN_NAME);
  if (typeof ann === "string") {
    return ann;
  }
  return snakeCase(field.name);
}

const RESERVED_NAMES: { [name: string]: boolean } = {};
[
  // TODO: Add other names here
  "user",
].forEach((n) => {
  RESERVED_NAMES[n] = true;
});

function quoteReservedName(s: string) {
  if (RESERVED_NAMES[s]) {
    return `"${s}"`;
  } else {
    return s;
  }
}

interface ColumnType {
  sqltype: string;
  fkey?: {
    table: string;
    column: string;
  };
  notNullable: boolean;
}

function getColumnType(
  resolver: adl.DeclResolver,
  field: adlast.Field,
  dbProfile: DbProfile,
): ColumnType {
  const ann = getAnnotation(field.annotations, DB_COLUMN_TYPE);
  const annctype: string | undefined = typeof ann === "string"
    ? ann
    : undefined;

  const typeExpr = field.typeExpr;

  // For Maybe<T> and Nullable<T> the sql column will allow nulls
  const dtype = decodeTypeExpr(typeExpr);
  if (
    dtype.kind == "Nullable" ||
    dtype.kind == "Reference" && scopedNamesEqual(dtype.refScopedName, MAYBE)
  ) {
    return {
      sqltype: annctype ||
        getColumnType1(resolver, typeExpr.parameters[0], dbProfile),
      fkey: getForeignKeyRef(resolver, typeExpr.parameters[0]),
      notNullable: false,
    };
  }

  // For all other types, the column will not allow nulls
  return {
    sqltype: (annctype || getColumnType1(resolver, typeExpr, dbProfile)),
    fkey: getForeignKeyRef(resolver, typeExpr),
    notNullable: true,
  };
}

function getColumnType1(
  resolver: adl.DeclResolver,
  typeExpr: adlast.TypeExpr,
  dbProfile: DbProfile,
): string {
  const dtype = decodeTypeExpr(typeExpr);
  switch (dtype.kind) {
    case "Reference":
      const sdecl = resolver(dtype.refScopedName);

      const ann = getAnnotation(sdecl.decl.annotations, DB_COLUMN_TYPE);
      if (typeof (ann) === "string") {
        return ann;
      }

      if (scopedNamesEqual(dtype.refScopedName, INSTANT)) {
        return "timestamp";
      } else if (scopedNamesEqual(dtype.refScopedName, LOCAL_DATE)) {
        return "date";
      } else if (scopedNamesEqual(dtype.refScopedName, LOCAL_TIME)) {
        return "time";
      } else if (scopedNamesEqual(dtype.refScopedName, LOCAL_DATETIME)) {
        return "timestamp";
      } else if (
        sdecl.decl.type_.kind == "union_" && isEnum(sdecl.decl.type_.value)
      ) {
        return dbProfile.enumColumnType;
      }
      // If we have a reference to a newtype or type alias, resolve
      // to the underlying type
      let texpr2 = null;
      texpr2 = texpr2 || expandTypeAlias(resolver, typeExpr);
      texpr2 = texpr2 || expandNewType(resolver, typeExpr);
      if (texpr2) {
        return getColumnType1(resolver, texpr2, dbProfile);
      }
    default:
      return dbProfile.primColumnType(dtype.kind);
  }
}

function getForeignKeyRef(
  resolver: adl.DeclResolver,
  typeExpr0: adlast.TypeExpr,
): { table: string; column: string } | undefined {
  const typeExpr = expandTypes(resolver, typeExpr0, {
    expandTypeAliases: true,
  });
  const dtype = decodeTypeExpr(typeExpr);
  if (
    dtype.kind == "Reference" && scopedNamesEqual(dtype.refScopedName, DB_KEY)
  ) {
    const param0 = dtype.parameters[0];
    if (param0.kind == "Reference") {
      const decl = resolver(param0.refScopedName);
      return { table: getTableName(decl), column: getPrimaryKey(decl) };
    }
  }
  return undefined;
}

// Contains customizations for the db mapping
interface DbProfile {
  idColumnType: string;
  enumColumnType: string;
  primColumnType(ptype: string): string;
}

const postgresDbProfile: DbProfile = {
  idColumnType: "text",
  enumColumnType: "text",
  primColumnType(ptype: string): string {
    switch (ptype) {
      case "String":
        return "text";
      case "Bool":
        return "boolean";
      case "Json":
        return "json";
      case "Int8":
        return "smallint";
      case "Int16":
        return "smallint";
      case "Int32":
        return "integer";
      case "Int64":
        return "bigint";
      case "Word8":
        return "smallint";
      case "Word16":
        return "smallint";
      case "Word32":
        return "integer";
      case "Word64":
        return "bigint";
      case "Float":
        return "real";
      case "Double":
        return "double precision";
    }
    return "json";
  },
};

const postgres2DbProfile: DbProfile = {
  idColumnType: "text",
  enumColumnType: "text",
  primColumnType(ptype: string): string {
    switch (ptype) {
      case "String":
        return "text";
      case "Bool":
        return "boolean";
      case "Json":
        return "jsonb";
      case "Int8":
        return "smallint";
      case "Int16":
        return "smallint";
      case "Int32":
        return "integer";
      case "Int64":
        return "bigint";
      case "Word8":
        return "smallint";
      case "Word16":
        return "smallint";
      case "Word32":
        return "integer";
      case "Word64":
        return "bigint";
      case "Float":
        return "real";
      case "Double":
        return "double precision";
    }
    return "jsonb";
  },
};

const mssql2DbProfile: DbProfile = {
  idColumnType: "nvarchar(64)",
  enumColumnType: "nvarchar(64)",
  primColumnType(ptype: string): string {
    switch (ptype) {
      case "String":
        return "nvarchar(max)";
      case "Int8":
        return "smallint";
      case "Int16":
        return "smallint";
      case "Int32":
        return "int";
      case "Int64":
        return "bigint";
      case "Word8":
        return "smallint";
      case "Word16":
        return "smallint";
      case "Word32":
        return "int";
      case "Word64":
        return "bigint";
      case "Float":
        return "float(24)";
      case "Double":
        return "float(53)";
      case "Bool":
        return "bit";
    }
    return "nvarchar(max)";
  },
};

function getDbProfile(
  dbProfile?: "postgresql" | "postgresql2" | "mssql2",
): DbProfile {
  if (dbProfile == undefined) {
    return postgres2DbProfile;
  }
  switch (dbProfile) {
    case "postgresql2":
      return postgres2DbProfile;
    case "postgresql":
      return postgresDbProfile;
    case "mssql2":
      return mssql2DbProfile;
  }
}

export async function generateMetadata(
  outmetadata: string,
  params: GenSqlParams,
  loadedAdl: LoadedAdl,
  dbResources: DbResources,
): Promise<void> {
  const jbDecl = createJsonBinding(loadedAdl.resolver, adlast.texprDecl());
  const writer = new FileWriter(outmetadata, !!params.verbose);

  // Exclude metadata for the metadata tables
  const dbTables = dbResources.tables.filter((dbt) =>
    dbt.name != "meta_table" && dbt.name !== "meta_adl_decl"
  );

  writer.write("delete from meta_table;\n");
  for (const dbTable of dbTables) {
    const docAnn = getAnnotation(dbTable.scopedDecl.decl.annotations, DOC);
    const description = typeof docAnn === "string" ? docAnn : "";
    writer.write(
      `insert into meta_table(name,description,decl_module_name, decl_name) values (${
        dbstr(dbTable.name)
      },${dbstr(description)},${dbstr(dbTable.scopedDecl.moduleName)},${
        dbstr(dbTable.scopedDecl.decl.name)
      });\n`,
    );
  }
  for (const dbView of dbResources.views) {
    const docAnn = getAnnotation(dbView.scopedDecl.decl.annotations, DOC);
    const description = typeof docAnn === "string" ? docAnn : "";
    writer.write(
      `insert into meta_table(name,description,decl_module_name, decl_name) values (${
        dbstr(dbView.name)
      },${dbstr(description)},${dbstr(dbView.scopedDecl.moduleName)},${
        dbstr(dbView.scopedDecl.decl.name)
      });\n`,
    );
  }

  writer.write("\n");

  writer.write("delete from meta_adl_decl;\n");
  insertDecls(
    loadedAdl.resolver,
    writer,
    [
      ...dbTables.map((dbt) => dbt.scopedDecl),
      ...dbResources.views.map((dbv) => dbv.scopedDecl)

    ],
  );
  writer.close();
}

export async function generateViews(
  outviews: string,
  params: GenSqlParams,
  loadedAdl: LoadedAdl,
  dbResources: DbResources,
): Promise<void> {
  const writer = new FileWriter(outviews, !!params.verbose);
  writer.write("\n");
  for (const dbView of dbResources.views) {
    const ann0 = getAnnotation(dbView.scopedDecl.decl.annotations, DB_VIEW);
    const ann = ann0 as Record<string,string[] | undefined>;
    const viewSql: string[] = ann["viewSql"] || [];
    if (viewSql.length > 0) {
      writer.write(`drop view if exists ${getViewName(dbView.scopedDecl)};\n`)
      writer.write("\n");
      for(const sql of viewSql) {
        writer.write(sql + "\n");
      }
      writer.write("\n");
    }
  }
  writer.close();
}

function insertDecls(
  resolver: adl.DeclResolver,
  writer: FileWriter,
  sdecls: adlast.ScopedDecl[],
) {
  const done: { [name: string]: boolean } = {};
  const jbDecl = createJsonBinding(resolver, adlast.texprDecl());

  function insertDecl(sdecl: adlast.ScopedDecl) {
    const name = sdecl.moduleName + "." + sdecl.decl.name;
    if (done[name] === undefined) {
      const jsdecl = JSON.stringify(jbDecl.toJson(sdecl.decl));
      writer.write(
        `insert into meta_adl_decl(module_name,name,decl) values (${
          dbstr(sdecl.moduleName)
        },${dbstr(sdecl.decl.name)}, ${dbstr(jsdecl)});\n`,
      );
      done[name] = true;
      switch (sdecl.decl.type_.kind) {
        case "struct_":
        case "union_":
          for (const field of sdecl.decl.type_.value.fields) {
            insertTypeExpr(field.typeExpr);
          }
          break;
        case "newtype_":
        case "type_":
          insertTypeExpr(sdecl.decl.type_.value.typeExpr);
          break;
      }
    }
  }

  function insertTypeExpr(texpr: adlast.TypeExpr) {
    switch (texpr.typeRef.kind) {
      case "reference":
        const sname = texpr.typeRef.value;
        const decl = resolver(sname);
        insertDecl(decl);
        break;
      case "primitive":
      case "typeParam":
        break;
    }
    texpr.parameters.forEach((te) => insertTypeExpr(te));
  }

  sdecls.forEach(insertDecl);
}

function generateTemplate(template: Template, dbResources: DbResources) {
  const templateStr: string = Deno.readTextFileSync(template.template);
  const view: {} = {
    tables: dbResources.tables.map((dbtable) => {
      const attributes: { [key: string]: {} | null } = {};
      attributes["tablename"] = dbtable.name;
      for (const annotation of dbtable.scopedDecl.decl.annotations) {
        attributes[annotation.key.name] = annotation.value;
      }
      return attributes;
    }),
  };
  const outStr: string = mustache.render(templateStr, view);
  Deno.writeTextFileSync(template.outfile, outStr);
}

function dbstr(s: string) {
  return "'" + s.replace(/'/g, "''") + "'";
}

function parseTemplates(ss: string[]): Template[] {
  return ss.map((s) => {
    const paths = s.split(":");
    if (paths.length != 2) {
      throw new Error(
        "outtemplatesql parameter must be a pair of paths, separated by :",
      );
    }
    return { template: paths[0], outfile: paths[1] };
  });
}

const DOC = scopedName("sys.annotations", "Doc");
const MAYBE = scopedName("sys.types", "Maybe");
const DB_TABLE = scopedName("common.db", "DbTable");
const DB_VIEW = scopedName("common.db", "DbView");
const DB_COLUMN_NAME = scopedName("common.db", "DbColumnName");
const DB_COLUMN_TYPE = scopedName("common.db", "DbColumnType");
const DB_KEY = scopedName("common.db", "DbKey");
const INSTANT = scopedName("common", "Instant");
const LOCAL_DATE = scopedName("common", "LocalDate");
const LOCAL_TIME = scopedName("common", "LocalTime");
const LOCAL_DATETIME = scopedName("common", "LocalDateTime");
