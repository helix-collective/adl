/* @generated from adl */
import { declResolver, ScopedDecl } from "./runtime/adl.ts";
import { _AST_MAP as sys_adlast } from "./sys/adlast.ts";
import { _AST_MAP as sys_annotations } from "./sys/annotations.ts";
import { _AST_MAP as sys_dynamic } from "./sys/dynamic.ts";
import { _AST_MAP as sys_types } from "./sys/types.ts";

export const ADL: { [key: string]: ScopedDecl } = {
  ...sys_adlast,
  ...sys_annotations,
  ...sys_dynamic,
  ...sys_types,
};

export const RESOLVER = declResolver(ADL);
