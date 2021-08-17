{-# LANGUAGE OverloadedStrings #-}
module ADL.Compiler.Backends.JavaTables.V2 where

import qualified ADL.Compiler.AST as AST
import qualified ADL.Compiler.Backends.Java as J
import qualified ADL.Compiler.Backends.Java.Internal as J
import qualified ADL.Compiler.Backends.JavaTables.Schema as SC
import qualified ADL.Compiler.Backends.JavaTables.SchemaUtils as SC
import qualified Data.Aeson as JS
import qualified Data.Text as T

import ADL.Compiler.AST(DeclType(..), Decl(..))
import ADL.Compiler.Primitive
import ADL.Compiler.Processing(AdlFlags(..),ResolvedType(..), RModule,RDecl,defaultAdlFlags,loadAndCheckModule1,removeModuleTypedefs, expandModuleTypedefs, associateCustomTypes, refEnumeration, refNewtype, expNewtype, ResolvedTypeT(..))
import ADL.Compiler.Backends.JavaTables.JavaUtils
import ADL.Utils.Format(template,formatText)
import ADL.Utils.IndentedCode
import Control.Monad.Trans.State.Strict
import Data.Foldable(for_)
import Data.Traversable(for)

generateJavaModelV2 :: JavaTableFlags -> J.CodeGenProfile -> J.JavaPackageFn -> J.CModule -> DBTable -> J.ClassFile
generateJavaModelV2 jtflags cgp javaPackageFn mod dbtable  =
  if hasIdPrimaryKey dbtable
     then generateClassWithIdPrimaryKey jtflags cgp javaPackageFn mod dbtable
     else generateClass jtflags cgp javaPackageFn mod dbtable

generateClassWithIdPrimaryKey :: JavaTableFlags -> J.CodeGenProfile -> J.JavaPackageFn -> J.CModule -> DBTable -> J.ClassFile
generateClassWithIdPrimaryKey jtflags cgp javaPackageFn mod dbtable = execState gen state0
  where
    (tableClassNameT,tableInstanceNameT,javaClassNameT,dbTableNameT) = mkNames dbtable
    (decl,struct,table,dbTableAnnotation) = dbtable
    state0 = J.classFile cgp (AST.m_name mod) javaPackageFn classDecl
    classDecl = template "@SuppressWarnings(\"all\")\npublic class $1 extends AdlTableWithId<$2>" [tableClassNameT,javaClassNameT]
    gen = do
      generateClassCommon dbtable

      J.addImport "au.com.helixta.adl.util.AdlTableWithId"

      adlColumns <- mkAdlColumns cgp dbtable (SC.table_columns table) (AST.s_fields struct)

      J.addMethod
        (  ctemplate "private final AdlField<DbKey<$1>> id = f(\"id\", DbConversions.dbKey(), DbKey.jsonBinding($1.jsonBinding()));"
                       [javaClassNameT]
        <> cline "@Override"
        <> ctemplate "public AdlField<DbKey<$1>> id() { return id; }" [javaClassNameT]
        )
      for_ adlColumns $ \dbc -> case dbc of
        (col,fd,jb,dbconv) -> do
          J.addMethod
            (  ctemplate "private final AdlField<$1> $2 = f(\"$3\", $4, $5);"
                         [J.fd_boxedTypeExprStr fd, J.fd_varName fd, SC.column_name col, dbconv, jb]
            <> ctemplate "public AdlField<$1> $2() { return $2; }"
                         [J.fd_boxedTypeExprStr fd, J.fd_varName fd]
            )

      J.addMethod
        (  cline "@Override"
        <> cblock "public List<AdlField<?>> allFields()"
           (  cline "List<AdlField<?>> result = new ArrayList<>();"
           <> cline "result.add(id);"
           <> mconcat [ ctemplate "result.add($1);" [J.fd_varName fd] | (_,fd,_,_) <- adlColumns]
           <> cline "return result;"
           )
        )

      J.addMethod
        (  cline "@Override"
        <> cblock (template "public WithDbId<$1> fromDbResults(DbResults res) throws SQLException" [javaClassNameT])
           (  ctemplate "$1 result = new $1(" [javaClassNameT]
           <> indent (mconcat [ctemplate "$1().fromDb(res)$2" [J.fd_varName fd,mcomma]
                              | ((_,fd,_,_),mcomma) <- withCommas adlColumns])
           <> cline ");"
           <> ctemplate "return new WithDbId<$1>(id().fromDb(res), result);" [javaClassNameT]
           )
        )

      J.addMethod
        (  cline "@Override"
        <> cblock (template "public Map<Dsl.FieldRef, Object> dbMapping(DbKey<$1> id, $1 value)" [javaClassNameT])
           (  cline "Map<Dsl.FieldRef, Object> result = new HashMap<>();"
           <> cline "result.put( id(), id().toDb(id));"
           <> mconcat [ctemplate "result.put($1(), $1().toDb(value.$2()));" [J.fd_varName fd, J.fd_accessorName fd]
                      | (_,fd,_,_) <- adlColumns]
           <> cline "return result;"
           )
        )

      J.addMethod
        (  cline "@Override"
        <> cblock (template "public Map<String, JsonElement> jsonDbMapping($1 value)" [javaClassNameT])
           (  cline "HashMap<String, JsonElement> result = new HashMap<>();"
           <> mconcat [ctemplate "result.put($1().field, $1().jsonBinding().toJson(value.$2()));" [J.fd_varName fd, J.fd_accessorName fd]
                      | (_,fd,_,_) <- adlColumns]
           <> cline "return result;"
           )
        )

generateClass :: JavaTableFlags -> J.CodeGenProfile -> J.JavaPackageFn -> J.CModule -> DBTable -> J.ClassFile
generateClass jtflags cgp javaPackageFn mod dbtable = execState gen state0
  where
    (tableClassNameT,tableInstanceNameT,javaClassNameT,dbTableNameT) = mkNames dbtable
    (decl,struct,table,dbTableAnnotation) = dbtable
    state0 = J.classFile cgp (AST.m_name mod) javaPackageFn classDecl
    classDecl = template "@SuppressWarnings(\"all\")\npublic class $1 extends AdlTable<$2>" [tableClassNameT,javaClassNameT]
    gen = do
      generateClassCommon dbtable

      J.addImport "au.com.helixta.adl.util.AdlTable"

      adlColumns <- mkAdlColumns cgp dbtable (SC.table_columns table) (AST.s_fields struct)

      for_ adlColumns $ \dbc -> case dbc of
        (col,fd,jb,dbconv) -> do
          J.addMethod
            (  ctemplate "private final AdlField<$1> $2 = f(\"$3\", $4, $5);"
                         [J.fd_boxedTypeExprStr fd, J.fd_varName fd, SC.column_name col, dbconv, jb]
            <> ctemplate "public AdlField<$1> $2() { return $2; }"
                         [J.fd_boxedTypeExprStr fd, J.fd_varName fd]
            )

      J.addMethod
        (  cline "@Override"
        <> cblock "public List<AdlField<?>> allFields()"
           (  cline "List<AdlField<?>> result = new ArrayList<>();"
           <> mconcat [ ctemplate "result.add($1);" [J.fd_varName fd] | (_,fd,_,_) <- adlColumns]
           <> cline "return result;"
           )
        )

      J.addMethod
        (  cline "@Override"
        <> cblock (template "public $1 fromDbResults(DbResults res) throws SQLException" [javaClassNameT])
           (  ctemplate "$1 result = new $1(" [javaClassNameT]
           <> indent (mconcat [ctemplate "$1().fromDb(res)$2" [J.fd_varName fd,mcomma]
                              | ((_,fd,_,_),mcomma) <- withCommas adlColumns])
           <> cline ");"
           <> ctemplate "return result;" [javaClassNameT]
           )
        )

      J.addMethod
        (  cline "@Override"
        <> cblock (template "public Map<Dsl.FieldRef, Object> dbMapping($1 value)" [javaClassNameT])
           (  cline "Map<Dsl.FieldRef, Object> result = new HashMap<>();"
           <> mconcat [ctemplate "result.put($1(), $1().toDb(value.$2()));" [J.fd_varName fd, J.fd_accessorName fd]
                      | (_,fd,_,_) <- adlColumns]
           <> cline "return result;"
           )
        )

      J.addMethod
        (  cline "@Override"
        <> cblock (template "public Map<String, JsonElement> jsonDbMapping($1 value)" [javaClassNameT])
           (  cline "Map<String, JsonElement> result = new HashMap<>();"
           <> mconcat [ctemplate "result.put($1().field, $1().jsonBinding().toJson(value.$2()));" [J.fd_varName fd, J.fd_accessorName fd]
                      | (_,fd,_,_) <- adlColumns]
           <> cline "return result;"
           )
        )

mkNames :: DBTable -> (T.Text,T.Text,T.Text,T.Text)
mkNames (decl,struct,table,dbTableAnnotation) = (tableClassNameT,tableInstanceNameT,javaClassNameT,dbTableNameT)
  where
    tableClassNameT = tableClassName decl
    tableInstanceNameT = T.toUpper (SC.toSnakeCase (AST.d_name decl))
    javaClassNameT = javaClassName decl
    dbTableNameT = dbTableName decl

generateClassCommon :: DBTable -> J.CState ()
generateClassCommon dbtable  = do
  let (tableClassNameT,tableInstanceNameT,javaClassNameT,dbTableNameT) = mkNames dbtable

  rtPackage <- J.getRuntimePackage
  J.addImport "au.com.helixta.adl.common.db.DbKey"
  J.addImport "au.com.helixta.adl.common.db.WithDbId"
  J.addImport "au.com.helixta.adl.util.AdlField"
  J.addImport "au.com.helixta.adl.util.DbConversions"
  J.addImport "au.com.helixta.nofrills.sql.Dsl"
  J.addImport "au.com.helixta.nofrills.sql.impl.DbResults"
  J.addImport (J.javaClass rtPackage "JsonBindings")
  J.addImport (J.javaClass rtPackage "JsonBinding")
  J.addImport "javax.annotation.Nullable"
  J.addImport "java.sql.SQLException"
  J.addImport "java.util.ArrayList"
  J.addImport "java.util.List"
  J.addImport "java.util.HashMap"
  J.addImport "java.util.Map"
  J.addImport "com.google.gson.JsonElement"

  J.addMethod (ctemplate "public static final $1 $2 = new $1();" [tableClassNameT, tableInstanceNameT])

  J.addMethod (cblock (template "public $1()" [tableClassNameT]) (
    ctemplate "super(\"$1\");" [dbTableNameT]
    ))

  J.addMethod (cblock (template "public $1(String alias)" [tableClassNameT]) (
    ctemplate "super(\"$1\", alias);" [dbTableNameT]
    ))

  J.addMethod (cblock (template "public $1(String tablename, @Nullable String alias)" [tableClassNameT]) (
    cline "super(tablename, alias);"
        ))

  J.addMethod
    (  cline "@Override"
    <> cblock (template "public JsonBinding<$1> jsonBinding()" [javaClassNameT])
       ( ctemplate "return $1.jsonBinding();" [javaClassNameT])
    )



genDbConversionExpr:: J.CodeGenProfile -> SC.Column -> AST.TypeExpr J.CResolvedType -> J.FieldDetails -> J.CState T.Text
genDbConversionExpr cgp col texpr@(AST.TypeExpr _ tparams) fd =  case SC.column_nullable col of
  False -> genDbConversionExpr1 cgp texpr fd
  True -> do
    fdinner <- J.genFieldDetails (J.fd_field fd){AST.f_type=(head tparams), AST.f_default=Nothing}
    dbconv <- genDbConversionExpr1 cgp (head tparams) fdinner
    return (template "DbConversions.nullable($1)" [dbconv])

genDbConversionExpr1:: J.CodeGenProfile -> AST.TypeExpr J.CResolvedType -> J.FieldDetails -> J.CState T.Text
genDbConversionExpr1 cgp texpr@(AST.TypeExpr (RT_Primitive p) tparams) fd =
  case p of
    P_Bool -> return "DbConversions.BOOLEAN"
    P_Int8 -> return "DbConversions.BYTE"
    P_Int16 -> return "DbConversions.SHORT"
    P_Int32 -> return "DbConversions.INTEGER"
    P_Int64 -> return "DbConversions.LONG"
    P_Word8 -> return "DbConversions.BYTE"
    P_Word16 -> return "DbConversions.SHORT"
    P_Word32 -> return "DbConversions.INTEGER"
    P_Word64 -> return "DbConversions.LONG"
    P_Float -> return "DbConversions.FLOAT"
    P_Double -> return "DbConversions.DOUBLE"
    P_String -> return "DbConversions.STRING"
    _ -> do
      jb <- J.genJsonBindingExpr cgp texpr
      return (template "DbConversions.json($1)" [jb])
genDbConversionExpr1 cgp texpr fd
  | refEnumeration texpr = do
    typeExprStr <- J.genTypeExprB J.TypeBoxed texpr
    return (template "DbConversions.dbEnum(s -> $1.fromString(s), e -> e.toString())" [typeExprStr])
  | SC.typeExprReferences SC.instantType texpr = return "DbConversions.INSTANT"
  | SC.typeExprReferences SC.localDateTimeType texpr = return "DbConversions.LOCAL_DATE_TIME"
  | SC.typeExprReferences SC.localTimeType texpr = return "DbConversions.LOCAL_TIME"
  | SC.typeExprReferences SC.localDateType texpr = return "DbConversions.LOCAL_DATE"
  | SC.typeExprReferences SC.dbKeyType texpr = return "DbConversions.dbKey()"
  | otherwise = case expNewtype texpr of

      (Just (scopedname, innertype, tparams)) -> do
        dbConvInnerType <- genDbConversionExpr1 cgp (AST.n_typeExpr innertype) fd
        return (template "DbConversions.newtype($2::getValue, $2::new, $1)" [dbConvInnerType, J.fd_boxedTypeExprStr fd])

      Nothing -> do
        jb <- J.genJsonBindingExpr cgp texpr
        return (template "DbConversions.json($1)" [jb])

type AdlColumn = (SC.Column,J.FieldDetails,T.Text,T.Text)

mkAdlColumns :: J.CodeGenProfile -> DBTable -> [SC.Column] -> [AST.Field J.CResolvedType] -> J.CState [AdlColumn]
mkAdlColumns cgp dbtable columns fields = for (zip explicitColumns fields) $ \(col, field) -> do
  fd <- J.genFieldDetails field
  jb <- J.genJsonBindingExpr cgp (AST.f_type (J.fd_field fd))
  dbconv <- case customDbHelpers col field of
    Nothing -> genDbConversionExpr cgp col (AST.f_type (J.fd_field fd)) fd
    (Just helperClass) -> do
      case SC.column_nullable col of
         False -> return (template "$1.dbConversion()" [helperClass])
         True -> return (template "DbConversions.nullable($1.dbConversion())" [helperClass])
  return (col,fd,jb,dbconv)
  where
    explicitColumns = if hasIdPrimaryKey dbtable
      then filter (\col -> SC.column_name col /= "id") columns
      else columns

hasIdPrimaryKey :: DBTable -> Bool
hasIdPrimaryKey (_,_,_,dbTableAnnotation) =
  case getAnnotationField dbTableAnnotation "withIdPrimaryKey" of
    (Just (JS.Bool True)) -> True
    _ -> False


