import { changeCase } from "../deps.ts";
import { ScopedName, TypeExpr } from "../../adl-gen/runtime/sys/adlast.ts";

const pascalCase = changeCase.pascalCase;

export class StringMapSet {
  private readonly map: Map<string, Set<string>>;

  clear(): void {
    this.map.clear();
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  forEach(callbackfn: (value: Set<string>, key: string) => void): void {
    this.map.forEach(callbackfn);
  }

  get(key: string): Set<string> | undefined {
    return this.map.get(key);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  constructor() {
    this.map = new Map<string, Set<string>>();
  }

  add(key: string, val: string) {
    let currentSet = this.get(key);

    if (currentSet === undefined) {
      currentSet = new Set<string>();
      this.map.set(key, currentSet);
    }

    currentSet.add(val);
  }
}

export class ScopedNameBiMapSet {
  scopedNames: ScopedName[] = [];
  forward: StringMapSet = new StringMapSet();
  reverse: StringMapSet = new StringMapSet();

  add(sn: ScopedName) {
    this.scopedNames.push(sn);
    this.forward.add(sn.moduleName, sn.name);
    this.reverse.add(sn.name, sn.moduleName);
  }
}

/** Helper for resolving how to import types from modules
 * esp if there are duplicate types in different modules
 * tuned for how typescript can rename imports via: import { foo as bar } from blah */
export class ImportingHelper {
  modulesTypes = new ScopedNameBiMapSet();

  asImportedNames: Map<ScopedName, string> = new Map<ScopedName, string>();

  modulesImports: StringMapSet = new StringMapSet();

  importSns: Set<ScopedName> = new Set();
  importMakeFns: Set<ScopedName> = new Set();

  addType(
    type: TypeExpr,
    withSn: boolean = false,
    withMakeFn: boolean = false,
  ) {
    if (type.typeRef.kind === "primitive") {
      switch (type.typeRef.value) {
        // primitives that have type params:
        case "Vector":
        case "Nullable":
        case "StringMap":
          // recurse into the type params:
          for (const tp of type.parameters) {
            this.addType(tp);
          }
          break;

        case "String":
        case "Bool":
        case "Int8":
        case "Int16":
        case "Int32":
        case "Int64":
        case "Word8":
        case "Word16":
        case "Word32":
        case "Word64":
        case "Float":
        case "Double":
        case "Json":
          break;

        default:
          throw new Error("Unexpected primitive " + type.typeRef.value);
      }
    }
    if (type.typeRef.kind === "reference") {
      this.modulesTypes.add(type.typeRef.value);

      if (withSn) {
        this.importSns.add(type.typeRef.value);
      }
      if (withMakeFn) {
        this.importMakeFns.add(type.typeRef.value);
      }

      // recurse into the type params:
      for (const tp of type.parameters) {
        this.addType(tp);
      }
    }
    if (type.typeRef.kind === "typeParam") {
      throw new Error("Unexpected type.typeRef.kind === 'typeParam'");
    }
  }

  resolveImports() {
    this.asImportedNames.clear();

    for (const sn of this.modulesTypes.scopedNames) {
      const mods = Array.from(this.modulesTypes.reverse.get(sn.name)!);

      // figure out which scopedNames have ambiguous names (ie in common between several modules)
      if (mods.length === 1) {
        // name is unique across modules: can import and use as-is
        this.asImportedNames.set(sn, sn.name);
        this.modulesImports.add(sn.moduleName, sn.name);

        if (this.importSns.has(sn)) {
          this.modulesImports.add(sn.moduleName, `sn${pascalCase(sn.name)}`);
        }
        if (this.importMakeFns.has(sn)) {
          this.modulesImports.add(sn.moduleName, `make${pascalCase(sn.name)}`);
        }
      } else {
        // name is ambiguous across modules
        // use "import {name as PascalCaseTheModuleWithName} from blah"
        const asImportedName = pascalCase(`${sn.moduleName}${sn.name}`);
        this.asImportedNames.set(sn, asImportedName);
        this.modulesImports.add(
          sn.moduleName,
          `${sn.name} as ${asImportedName}`,
        );

        if (this.importSns.has(sn)) {
          this.modulesImports.add(
            sn.moduleName,
            `sn${pascalCase(sn.name)} as sn${asImportedName}`,
          );
        }
        if (this.importSns.has(sn)) {
          this.modulesImports.add(
            sn.moduleName,
            `make${pascalCase(sn.name)} as make${asImportedName}`,
          );
        }
      }
    }
  }

  /** Get a typeExpr in form as imported (possibly as a different name)
   * also in the form used by typescript
   **/
  asReferencedName(type: TypeExpr): string {
    if (type.typeRef.kind === "primitive") {
      switch (type.typeRef.value) {
        case "Vector":
          if (type.parameters.length !== 1) {
            throw new Error("Expected only 1 tparam");
          }
          return `${this.asReferencedName(type.parameters[0])}[]`;

        case "Nullable":
          if (type.parameters.length !== 1) {
            throw new Error("Expected only 1 tparam");
          }
          return `(${this.asReferencedName(type.parameters[0])}|null)`;

        case "StringMap":
          if (type.parameters.length !== 1) {
            throw new Error("Expected only 1 tparam");
          }
          return `{[key:string]:${this.asReferencedName(type.parameters[0])}}`;

        case "String":
          return "string";

        case "Bool":
          return "boolean";

        case "Int8":
        case "Int16":
        case "Int32":
        case "Int64":
        case "Word8":
        case "Word16":
        case "Word32":
        case "Word64":
        case "Float":
        case "Double":
          return "number";

        case "Json":
          return "{}";

        default:
          throw new Error("Unexpected primitive " + type.typeRef.value);
      }
    }
    if (type.typeRef.kind === "reference") {
      const asImported = this.asImportedNames.get(type.typeRef.value);
      if (asImported === undefined) {
        throw new Error(
          `No asImported name found - ${type.typeRef.value.name}`,
        );
      }

      if (type.parameters.length > 0) {
        // generic type with type parameters:
        const typeParamsNames = type.parameters.map((tp) =>
          this.asReferencedName(tp)
        );
        return `${asImported}<${typeParamsNames.join(",")}>`;
      } else {
        // ordinary ADL referred type
        return asImported;
      }
    }
    if (type.typeRef.kind === "typeParam") {
      throw new Error("Unexpected type.typeRef.kind === 'typeParam'");
    }
    throw new Error("Unhandled type.typeRef.kind");
  }
}
