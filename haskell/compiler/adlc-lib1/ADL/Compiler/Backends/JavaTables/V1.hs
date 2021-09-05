{-# LANGUAGE OverloadedStrings #-}

module ADL.Compiler.Backends.JavaTables.V1 where

import qualified Data.Aeson as JS
import qualified Data.HashMap.Strict as HM
import qualified Data.ByteString.Lazy as LBS
import qualified Data.Map as M
import qualified Data.Set as S
import qualified Data.Text as T
import qualified Data.Text.Encoding as T
import qualified Data.Vector as V
import qualified ADL.Compiler.AST as AST
import qualified ADL.Compiler.Backends.Java.Internal as J
import qualified ADL.Compiler.Backends.Java as J
import qualified ADL.Compiler.Backends.JavaTables.SchemaUtils as SC
import qualified ADL.Compiler.Backends.JavaTables.Schema as SC

import ADL.Compiler.EIO
import ADL.Compiler.Primitive
import ADL.Compiler.Processing(AdlFlags(..),ResolvedType(..), RModule,RDecl,defaultAdlFlags,loadAndCheckModule1,removeModuleTypedefs, expandModuleTypedefs, associateCustomTypes, refEnumeration, refNewtype, ResolvedTypeT(..))
import ADL.Compiler.Utils(FileWriter,withManifest)
import ADL.Compiler.Flags(Flags(..),parseArguments,standardOptions, addToMergeFileExtensions)
import ADL.Compiler.Backends.JavaTables.JavaUtils
import ADL.Compiler.Backends.JavaTables.V2
import ADL.Utils.IndentedCode
import ADL.Utils.Format(template,formatText)
import Control.Monad(when, mplus)
import Control.Monad.Trans(liftIO)
import Control.Monad.Trans.State.Strict
import Data.Char(toUpper, isUpper)
import Data.Foldable(for_)
import Data.Traversable(for)
import Data.List(intersperse,find)
import Data.Monoid
import Data.Maybe(mapMaybe)
import System.Directory(createDirectoryIfMissing)
import System.FilePath(takeDirectory,(</>))
import System.Console.GetOpt(OptDescr(..), ArgDescr(..))

decodeVersion:: String -> GenVersion
decodeVersion s = case map toUpper s of
  "V1" -> V1
  "V2" -> V2
  _ -> error "Invalid genversion"


generateJavaModelV1 :: JavaTableFlags -> J.CodeGenProfile -> J.JavaPackageFn -> J.CModule -> DBTable -> J.ClassFile
generateJavaModelV1 jtflags cgp javaPackageFn mod (decl,struct,table,dbTableAnnotation) = execState gen state0
  where
    state0 = J.classFile cgp (AST.m_name mod) javaPackageFn classDecl
    tableClassNameT = tableClassName decl
    tableInstanceNameT = T.toUpper (SC.toSnakeCase (AST.d_name decl))
    classDecl = "@SuppressWarnings(\"all\")\npublic class " <> tableClassNameT <> " extends Table"
    javaClassNameT = javaClassName decl
    dbTableNameT = dbTableName decl
    gen = do
      rtPackage <- J.getRuntimePackage
      J.addImport "au.com.helixta.nofrills.sql.Dsl"
      J.addImport "au.com.helixta.nofrills.sql.Dsl.Table"
      J.addImport "au.com.helixta.nofrills.sql.Dsl.FieldRef"
      J.addImport "au.com.helixta.nofrills.sql.Dsl.TypedField"
      J.addImport "au.com.helixta.nofrills.sql.impl.DbResults"
      J.addImport "au.com.helixta.util.sql.QueryHelper"
      J.addImport (J.javaClass rtPackage "JsonBindings")
      J.addImport "com.google.common.collect.ImmutableMap"
      J.addImport "com.google.common.collect.Maps"
      J.addImport "com.google.gson.JsonElement"
      J.addImport "com.google.gson.JsonPrimitive"
      J.addImport "javax.annotation.Nullable"
      J.addImport "java.util.Map"
      J.addImport "java.util.Optional"
      J.addImport "java.util.function.Function"
      J.addImport "java.util.function.Supplier"
      J.addImport "au.com.helixta.util.common.collect.Mapx"

      J.addMethod (ctemplate "public static final $1 $2 = new $1();" [tableClassNameT, tableInstanceNameT])

      J.addMethod (cblock (template "public $1()" [tableClassNameT]) (
        ctemplate "super(\"$1\");" [dbTableNameT]
        ))

      J.addMethod (cblock (template "public $1(String alias)" [tableClassNameT]) (
        ctemplate "super(\"$1\", alias);" [dbTableNameT]
        ))

      J.addMethod
        (  cline "//exposed to enable postgres views that extend tables"
        <> cblock (template "protected $1(String tablename, @Nullable String alias)" [tableClassNameT]) (
             ctemplate "super(tablename, alias);" [dbTableNameT]
           )
        )

      let withIdPrimaryKey = length (SC.table_columns table) /= length (AST.s_fields struct)
          dbColumns = mkDbColumns withIdPrimaryKey (SC.table_columns table) (AST.s_fields struct)


      for_ dbColumns $ \dbc -> do
        let javaFieldNameT = javaFieldName dbc
            (columnName,javaDbTypeT) = case dbc of
              (IdColumn col) -> (SC.column_name col,"String")
              (DbColumn col field _) -> (SC.column_name col, javaDbType col field)
        J.addMethod
          (  ctemplate "private final TypedField<$2> $1 = f(\"$3\", $2.class);"
                        [javaFieldNameT, javaDbTypeT, columnName]
          <> ctemplate "public TypedField<$2> $1() { return $1; }"
                        [javaFieldNameT, javaDbTypeT]
          )

      J.addMethod
        ( ctemplate "public static final ImmutableMap<String, Function<$1, TypedField<?>>> FIELDS = ImmutableMap.copyOf(Mapx.m("
                     [tableClassNameT]
        <> indent (mconcat [ ctemplate "Mapx.e(\"$1\", t -> t.$1)$2" [javaFieldName dbc,mcomma]
                           | (dbc,mcomma) <- withCommas dbColumns])
        <> cline "));"
        )

      J.addMethod
        ( cblock "public Map<String, TypedField<?>> allFields()"
          (cline "return Maps.transformValues(FIELDS, f -> f.apply(this));")
        )

      let withIdPrimaryKey = case getAnnotationField dbTableAnnotation "withIdPrimaryKey" of
            (Just (JS.Bool True)) -> True
            _ -> False

      if withIdPrimaryKey
        then do
          let fields = [(dbc, col,field) | dbc@(DbColumn col field _) <- dbColumns]
          genFromDbResultsWithIdKey fields
          genDbMappingWithIdKey fields

          when (jt_crudfns jtflags) $ do
            crudHelperFns

        else do
          genFromDbResults dbColumns
          genDbMapping dbColumns

    genFromDbResults dbColumns = do
      ctorargs <- for dbColumns $ \dbc -> case dbc of
        (DbColumn col field _) -> do
          adlFromDbExpr col field (template "res.get($1())" [AST.f_name field])
        (IdColumn col) -> return "res.get(id()"

      J.addMethod
        ( cblock (template "public $1 fromDbResults(DbResults res)" [javaClassNameT])
          (  ctemplate "return new $1(" [javaClassNameT]
          <> indent (mconcat [ cline (ctorarg <> mcomma) | (ctorarg,mcomma) <- withCommas ctorargs] )
          <> cline ");"
          )
        )

    genDbMapping dbColumns = do
      getters <- for dbColumns $ \dbc -> case dbc of
        (DbColumn col field _) -> do
          dbFromAdlExpr col field (template "value.get$1()" [J.javaCapsFieldName field])
        (IdColumn col) -> return ("value.getId()")

      J.addMethod
        ( cblock (template "public Map<FieldRef, Object> dbMapping($1 value)" [javaClassNameT])
          (  cline "return Mapx.m("
          <> indent (mconcat [ctemplate "Mapx.e($1(), $2)$3" [javaFieldName dbc, getter, mcomma] | ((dbc,getter),mcomma) <- withCommas (zip dbColumns getters)])
          <> cline ");"
          )
        )

    genFromDbResultsWithIdKey fields = do
      withDbIdI <- J.genScopedName withDbIdType
      dbKeyI <- J.genScopedName dbKeyType

      ctorargs <- for fields $ \(dbc,col,field) -> do
        adlFromDbExpr col field (template "res.get($1())" [AST.f_name field])

      J.addMethod
        ( cblock (template "public $1<$2> fromDbResults(DbResults res)" [withDbIdI,javaClassNameT])
          (  ctemplate "$1 result = new $1(" [javaClassNameT]
          <> indent (mconcat [ cline (ctorarg <> mcomma) | (ctorarg,mcomma) <- withCommas ctorargs] )
          <> cline ");"
          <> ctemplate "return new $1<$3>(new $2<$3>(res.get(id())), result);" [withDbIdI,dbKeyI,javaClassNameT]
          )
        )

    genDbMappingWithIdKey fields = do
      dbKeyI <- J.genScopedName dbKeyType
      getters <- for fields $ \(dbc,col,field) -> do
          dbFromAdlExpr col field (template "value.get$1()" [J.javaCapsFieldName field])

      J.addMethod
        ( cblock (template "public Map<FieldRef, Object> dbMapping($1<$2> id, $2 value)" [dbKeyI,javaClassNameT])
          (  cline "return Mapx.m("
          <> indent (cline "Mapx.e(id(), id.getValue()),")
          <> indent (mconcat [ctemplate "Mapx.e($1(), $2)$3" [javaFieldName dbc, getter, mcomma] | (((dbc,_,_),getter),mcomma) <- withCommas (zip fields getters)])
          <> cline ");"
          )
        )

    crudHelperFns = do
      dbKeyI <- J.genScopedName dbKeyType

      J.addMethod
        ( cblock (template "public $1<$2> create(Supplier<String> idSupplier, QueryHelper.Context ctx, $2 value)" [dbKeyI, javaClassNameT])
          (  ctemplate "  $1<$2> id = new $1<>(idSupplier.get());" [dbKeyI, javaClassNameT]
          <> cline "  Dsl.Insert insert = Dsl.insert(this).mappings(dbMapping(id, value));"
          <> cline "  ctx.execute(insert);"
          <> cline "  return id;"
          )
        )

      J.addMethod
        ( cblock (template " public Optional<$2> read(QueryHelper.Context ctx, $1<$2> id)" [dbKeyI,javaClassNameT])
          (  cline "  Dsl.Select select ="
          <> cline "          Dsl.select(allFields().values())"
          <> cline "                  .from(this)"
          <> cline "                  .where(id().eq(id.getValue()));"
          <> cline "  DbResults dbResults = ctx.query(select);"
          <> cline "  while (dbResults.next()) {"
          <> cline "    return Optional.of(fromDbResults(dbResults).getValue());"
          <> cline "  }"
          <> cline "  return Optional.empty();"
          )
        )

      J.addMethod
        ( cblock (template "public void update(QueryHelper.Context ctx, $1<$2> id, $2 value)" [dbKeyI,javaClassNameT])
          (  cline "  Dsl.Update update ="
          <> cline "    Dsl.update(this)"
          <> cline "    .set(this.dbMapping(id,value))"
          <> cline "    .where(id().eq(id.getValue()));"
          <> cline "  ctx.execute(update);"
          )
        )

      J.addMethod
        ( cblock (template "public void delete(QueryHelper.Context ctx, $1<$2> id)" [dbKeyI,javaClassNameT])
          (  cline "  Dsl.Delete delete ="
          <> cline "    Dsl.delete(this)"
          <> cline "    .where(id().eq(id.getValue()));"
          <> cline "  ctx.execute(delete);"
          )
        )


javaDbType :: SC.Column -> AST.Field J.CResolvedType -> T.Text
javaDbType col field = case customDbType col field of
  (Just dbType) -> dbType
  _ -> standardDbType
  where
    te = SC.columnTypeFromField SC.postgresDbProfile field

    standardDbType
      | refEnumeration (AST.f_type field) = "String"
      | SC.column_ctype col == "text" = "String"
      | "varchar" `T.isPrefixOf` SC.column_ctype col = "String"
      | "nvarchar" `T.isPrefixOf` SC.column_ctype col = "String"
      | SC.column_ctype col == "boolean" = "Boolean"
      | SC.column_ctype col == "json" = "JsonElement"
      | SC.column_ctype col == "jsonb" = "JsonElement"
      | SC.column_ctype col == "bigint" = "Long"
      | SC.column_ctype col == "integer" = "Integer"
      | SC.typeExprReferences SC.instantType te  = "java.time.Instant"
      | SC.typeExprReferences SC.localDateTimeType te = "java.time.LocalDateTime"
      | SC.typeExprReferences SC.localDateType te = "java.time.LocalDate"
      | SC.column_ctype col == "double precision" = "Double"
      | "float" `T.isPrefixOf` SC.column_ctype col = "Double"
      | otherwise = "unimp:" <> SC.column_ctype col

-- Generate an expression converting a db value into an ADL value
adlFromDbExpr :: SC.Column -> AST.Field J.CResolvedType -> T.Text -> J.CState T.Text
adlFromDbExpr col field expr = do
  let ftype = AST.f_type field
      customHelpers = customDbHelpers col field
  cgp <- fmap J.cf_codeProfile get
  fdetails <- J.genFieldDetails field

  case (SC.column_nullable col,customHelpers) of
    (True,Just chelpers) -> return (template "Optional.ofNullable($1).map(v -> $2.fromDb(v))" [expr,chelpers])
    (False,Just chelpers) -> return (template "$1.fromDb($2)" [chelpers,expr])
    _ ->  case (SC.column_nullable col,SC.column_references col, SC.column_ctype col,ftype) of
      (True, _, "json", AST.TypeExpr _ [te]) -> do
        jbindingExpr <- J.genJsonBindingExpr cgp te
        return (template "Optional.ofNullable($1).map($2::fromJson)" [expr,jbindingExpr])
      (True, _, "jsonb", AST.TypeExpr _ [te]) -> do
        jbindingExpr <- J.genJsonBindingExpr cgp te
        return (template "Optional.ofNullable($1).map($2::fromJson)" [expr,jbindingExpr])
      (True, _, _, AST.TypeExpr _ [te]) -> do
        expr1 <- adlFromDbExpr col{SC.column_nullable=False} field{AST.f_type=te,AST.f_default=Nothing} "v"
        let mapExpr = case expr1 of
              "v" -> ""
              _ -> template ".map(v -> $1)" [expr1]
        return (template "Optional.ofNullable($1)$2" [expr,mapExpr])
      (False,Just _,_,_) -> do
        return (template "new $1($2)" [J.fd_typeExprStr fdetails,expr])
      (False,_,"timestamp",_) -> return expr
      (False,_,"date",_) -> return expr
      (False,_,"json",_) -> do
        jbindingExpr <- J.genJsonBindingExpr cgp ftype
        return (template "$1.fromJson($2)" [jbindingExpr,expr])
      (False,_,"jsonb",_) -> do
        jbindingExpr <- J.genJsonBindingExpr cgp ftype
        return (template "$1.fromJson($2)" [jbindingExpr,expr])
      (False,_,_,_)
              | refEnumeration ftype -> return (template "$1.fromString($2)" [J.fd_typeExprStr fdetails,expr])
              | otherwise -> case refNewtype ftype of
                    (Just n) -> return (template "new $1($2)" [J.fd_typeExprStr fdetails,expr])
                    Nothing -> return expr

-- Generate an expression converting an ADL value into a db value
dbFromAdlExpr :: SC.Column -> AST.Field J.CResolvedType -> T.Text -> J.CState T.Text
dbFromAdlExpr col field expr = do
  let ftype = AST.f_type field
      customHelpers = customDbHelpers col field
  cgp <- fmap J.cf_codeProfile get
  fdetails <- J.genFieldDetails field
  case (SC.column_nullable col,customHelpers) of
    (True,Just chelpers) -> return (template "$1.map(v -> $2.toDb(v)).orElse(null)" [expr,chelpers])
    (False,Just chelpers) -> return (template "$2.toDb($1)" [expr,chelpers])
    _ -> case (SC.column_nullable col,SC.column_references col, SC.column_ctype col,ftype) of
      (True, _, "json", AST.TypeExpr _ [te]) -> do
        jbindingExpr <- J.genJsonBindingExpr cgp te
        return (template "($1.isPresent() ? $2.toJson($1.get()) : null)" [expr, jbindingExpr])
      (True, _, "jsonb", AST.TypeExpr _ [te]) -> do
        jbindingExpr <- J.genJsonBindingExpr cgp te
        return (template "($1.isPresent() ? $2.toJson($1.get()) : null)" [expr, jbindingExpr])
      (True, _, _, AST.TypeExpr _ [te]) -> do
        expr1 <- dbFromAdlExpr col{SC.column_nullable=False} field{AST.f_type=te,AST.f_default=Nothing} "v"
        let mapExpr = case expr1 of
              "v" -> ""
              _ -> template ".map(v -> $1)" [expr1]
        return (template "$1$2.orElse(null)" [expr,mapExpr])
      (False,Just _,_,_) -> do
        return (template "$1.getValue()" [expr])
      (False,_,"timestamp",_) -> return expr
      (False,_,"date",_) -> return expr
      (False,_,"json",_) -> do
        jbindingExpr <- J.genJsonBindingExpr cgp ftype
        return (template "$1.toJson($2)" [jbindingExpr,expr])
      (False,_,"jsonb",_) -> do
        jbindingExpr <- J.genJsonBindingExpr cgp ftype
        return (template "$1.toJson($2)" [jbindingExpr,expr])
      (False,_,_,_)
              | refEnumeration ftype -> return (template "$1.toString()" [expr])
              | otherwise -> case refNewtype ftype of
                    (Just n) -> return (template "$1.getValue()" [expr])
                    Nothing -> return expr


-- match structs that are annotated to be
-- database tables or views
matchDBTable :: SC.Schema -> J.CDecl -> Maybe (J.CDecl,AST.Struct J.CResolvedType,SC.Table,JS.Value, Maybe GenVersion)
matchDBTable schema decl = do
  struct <- declStruct decl
  annotation <- getAnnotation (AST.d_annotations decl) dbTableType `mplus` getAnnotation (AST.d_annotations decl) dbViewType
  table <- find (\t -> SC.table_name t == dbTableName decl) (SC.schema_tables schema) 
  case getAnnotation (AST.d_annotations decl) javaDbTableVersion of
    (Just (JS.String t)) -> return (decl,struct,table,annotation, (Just (decodeVersion (T.unpack t))))
    Nothing -> return (decl,struct,table,annotation, Nothing)
  where
    declStruct decl = case AST.d_type decl of
      (AST.Decl_Struct struct) -> Just struct
      _ -> Nothing
