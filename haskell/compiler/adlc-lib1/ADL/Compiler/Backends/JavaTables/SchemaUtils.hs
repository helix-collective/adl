{-# LANGUAGE OverloadedStrings, ScopedTypeVariables #-}
module ADL.Compiler.Backends.JavaTables.SchemaUtils
  ( schemaFromAdl
  , sqlFromSchema
  , dbKeyType
  , columnFromField
  , columnTypeFromField
  , typeExprReferences
  , instantType
  , localDateType
  , localTimeType
  , localDateTimeType
  , postgresDbProfile
  , postgresDbProfileV2
  , mssqlDbProfile
  , toSnakeCase
  , DbProfile
  ) where

import qualified Data.Aeson as JS
import qualified Data.HashMap.Strict as HM
import qualified Data.Map as M
import qualified Data.Text as T
import qualified Data.Text.Lazy as TL
import qualified Data.Vector as V
import qualified Data.Semigroup as S

import ADL.Compiler.Primitive
import ADL.Compiler.AST
import ADL.Compiler.Processing
import ADL.Utils.IndentedCode
import ADL.Utils.Format
import ADL.Compiler.Backends.JavaTables.Schema hiding (PrimitiveType)
import Data.List(intersperse, sort)
import Data.Monoid
import Data.Maybe(mapMaybe)
import Data.Char(isUpper)

type RTypeExpr = TypeExpr ResolvedType
type RField = Field ResolvedType
type RAnnotations = Annotations ResolvedType
type DBTable = (RDecl,Struct ResolvedType,JS.Value)

data DbProfile = DbProfile {
  dbp_idColumnType :: T.Text,
  dbp_enumColumnType :: T.Text,
  dbp_primColumnType :: PrimitiveType -> T.Text
}

postgresDbProfile = DbProfile {
  dbp_idColumnType="text",
  dbp_enumColumnType="text",
  dbp_primColumnType= \p -> case p of
    P_String -> "text"
    P_Int8 -> "smalllint"
    P_Int16 -> "smalllint"
    P_Int32 -> "integer"
    P_Int64 -> "bigint"
    P_Word8 -> "smalllint"
    P_Word16 -> "smalllint"
    P_Word32 -> "integer"
    P_Word64 -> "bigint"
    P_Float -> "real"
    P_Double -> "double precision"
    P_Bool -> "boolean"
    _ -> "json"
}

postgresDbProfileV2 = DbProfile {
  dbp_idColumnType="text",
  dbp_enumColumnType="text",
  dbp_primColumnType= \p -> case p of
    P_String -> "text"
    P_Int8 -> "smalllint"
    P_Int16 -> "smalllint"
    P_Int32 -> "integer"
    P_Int64 -> "bigint"
    P_Word8 -> "smalllint"
    P_Word16 -> "smalllint"
    P_Word32 -> "integer"
    P_Word64 -> "bigint"
    P_Float -> "real"
    P_Double -> "double precision"
    P_Bool -> "boolean"
    _ -> "jsonb"
}

mssqlDbProfile = DbProfile {
  dbp_idColumnType="nvarchar(64)",
  dbp_enumColumnType="nvarchar(64)",
  dbp_primColumnType= \p -> case p of
    P_String -> "nvarchar(max)"
    P_Int8 -> "smalllint"
    P_Int16 -> "smalllint"
    P_Int32 -> "int"
    P_Int64 -> "bigint"
    P_Word8 -> "smalllint"
    P_Word16 -> "smalllint"
    P_Word32 -> "integer"
    P_Word64 -> "bigint"
    P_Float -> "float(24)"
    P_Double -> "float(53)"
    P_Bool -> "bit"
    _ -> "nvarchar(max)"
}

-- Build an abstract db schema from an ADL module
schemaFromAdl :: DbProfile -> RModule -> Schema
schemaFromAdl dbp mod = Schema
  { schema_adlModules = [formatText (m_name mod)]
  , schema_tables = tables
  }
  where
    tables = map (mkTable dbp) (mapMaybe matchDBTable (M.elems (m_decls mod)))

instance S.Semigroup Schema where
  (Schema m1 t1) <> (Schema m2 t2) = Schema ((S.<>) m1 m2) ((S.<>) t1 t2)
  
instance Monoid Schema where
  mempty = Schema [] []
  mappend = (S.<>)

-- Produce the SQL corresponding to the schema
sqlFromSchema :: DbProfile -> Schema -> Code
sqlFromSchema dbp schema =  sql
  where
    sql
      =  ctemplate "-- Schema auto-generated from adl modules: $1" [T.intercalate ", " (sort (schema_adlModules schema))]
      <> cline "--"
      <> cline "-- column comments show original ADL types"
      <> cline ""
      <> mconcat (intersperse (cline "") (map tableDefSql (schema_tables schema)))
      <> cline ""
      <> mconcat (map tableConstraintsSql (schema_tables schema))

tableDefSql :: Table -> Code
tableDefSql table
  =  ctemplate "create table $1(" [table_name table]
  <> indent (mconcat
       [ linefn mcomma | (linefn,mcomma) <- withCommas linefns]
     )
  <> cline ");"
  where
    linefns
      =  map sqlFromColumn (table_columns table)
      <> mkPrimaryKey

    sqlFromColumn col mcomma = cline (column_name col <> " " <> sqltype <> mcomma <> comment)
      where
        sqltype = column_ctype col <> nullable
        nullable | column_nullable col = ""
                 | otherwise = " not null"
        comment | column_comment col == "" = ""
                | otherwise                = template "$1-- $2" [pad,column_comment col]
        pad = T.replicate (max 1 (35 - T.length (column_name col <> sqltype))) " "

    mkPrimaryKey = case table_primaryKey table of
       [] -> []
       pk -> [\mcomma -> cline (template "primary key($1)" [T.intercalate ", " pk])]

tableConstraintsSql :: Table -> Code
tableConstraintsSql table = rconstraints <> uconstraints <> indexes
  where
    rconstraints = mconcat [ ctemplate "alter table $1 add constraint $1_$2_fk foreign key ($2) references $3($4);"
                             [table_name table, column_name col,ftable,fname]
                           | col@Column{column_references=(Just (ForeignKeyRef ftable fname))} <- table_columns table]
    uconstraints = mconcat [ ctemplate "alter table $1 add constraint $1_$2_con unique ($3);"
                             [table_name table, T.pack (show i), T.intercalate ", " (map dbName uc)]
                           | (UniqueConstraint uc,i) <- zip (table_uniqueConstraints table) [1,2..]]
    indexes      = mconcat [ ctemplate "create index $1_$2_idx on $1($3);"
                             [table_name table, T.pack (show i), T.intercalate ", " (map dbName ti)]
                           | (TableIndex ti,i) <- zip (table_indexes table) [1,2..]]


mkTable :: DbProfile -> DBTable -> Table
mkTable dbp (decl,struct,ann) = Table
  { table_name = tableName
  , table_columns = idColumn <> map (columnFromField dbp) (s_fields struct)
  , table_uniqueConstraints = map UniqueConstraint uconstraints
  , table_indexes = map TableIndex indexes
  , table_primaryKey = primaryKey
  , table_annotation = ann
  }
  where
    tableName = case getLiteralField ann "tableName" of
      (Just lit) | lit /= "" -> fromLitString lit
      _ -> dbName (d_name decl)

    uconstraints :: [[T.Text]]
    uconstraints = case getLiteralField ann "uniquenessConstraints" of
      Nothing -> []
      Just lit ->  fromLitArray (fromLitArray fromLitString) lit

    indexes :: [[T.Text]]
    indexes = case getLiteralField ann "indexes" of
      Nothing -> []
      Just lit ->  fromLitArray (fromLitArray fromLitString) lit

    idColumn :: [Column]
    idColumn = case getLiteralField ann "withIdPrimaryKey" of
      Just (JS.Bool True) ->  [Column "id" (dbp_idColumnType dbp) "" False Nothing]
      _ -> []

    primaryKey :: [T.Text]
    primaryKey = case getLiteralField ann "withPrimaryKey" of
      Just (JS.String k) ->  [k]
      Just lit@(JS.Array _) -> fromLitArray fromLitString lit
      Nothing -> case getLiteralField ann "withIdPrimaryKey" of
        Just (JS.Bool True) -> ["id":: T.Text]
        _ -> []

    fromLitArray f (JS.Array a) = map f (V.toList a)
    fromLitString (JS.String s) = s
    fromLitBool (JS.Bool b) = b

type BoundTypeVariables c = M.Map Ident (TypeExpr (ResolvedTypeT c))

data RawColumn c = RawColumn {
  -- The schema column details
  rc_column:: Column,

  -- The ADL type of the column after resolving type parameters, type aliases, nullability etc
  rc_adltype :: TypeExpr (ResolvedTypeT c)
}

columnFromField :: DbProfile -> Field (ResolvedTypeT c) -> Column
columnFromField dbp field = rc_column (rawColumnFromField dbp field)

columnTypeFromField :: DbProfile -> Field (ResolvedTypeT c) -> TypeExpr (ResolvedTypeT c)
columnTypeFromField dbp field = rc_adltype (rawColumnFromField dbp field)


rawColumnFromField :: forall c . DbProfile -> Field (ResolvedTypeT c) -> RawColumn c
rawColumnFromField dbp field = mkColumn M.empty False (f_type field)
  where
    mkColumn :: BoundTypeVariables c -> Bool -> TypeExpr (ResolvedTypeT c) -> RawColumn c

    -- First consider Maybe<> and Nullable<> as they will switch the column
    -- to support nulls
    mkColumn btv False (TypeExpr (RT_Named (sn,_)) [te]) | sn == maybeType = mkColumn btv True te
    mkColumn btv False (TypeExpr (RT_Primitive P_Nullable) [te]) = mkColumn btv True te

    -- Now consider the special cases for DbKey<>, Instant, LocalDate, and enumerations
    mkColumn _ nullable te@(TypeExpr (RT_Named (sn1,_)) [TypeExpr (RT_Named (sn2,_)) []]) | sn1 ==  dbKeyType =
      mkIdColumn sn2 nullable te
    mkColumn _ nullable te
      | typeExprReferences instantType te = mkRawColumn nullable "timestamp" te
      | typeExprReferences localDateType te = mkRawColumn nullable "date" te
      | typeExprReferences localDateTimeType te = mkRawColumn nullable "timestamp" te
    mkColumn _ nullable te@(TypeExpr ref [])  | isEnumeration2 ref =
      mkRawColumn nullable (dbp_enumColumnType dbp) te

    -- typedefs and newtypes are expanded, doing the right thing with type parameters
    mkColumn btv nullable (TypeExpr (RT_Named (_,Decl{d_type=Decl_Typedef t})) tes) =
      let btv' = createBoundTypeVariables btv (t_typeParams t) (tes)
      in mkColumn btv' nullable (t_typeExpr t)
    mkColumn btv nullable (TypeExpr (RT_Named (_,Decl{d_type=Decl_Newtype n})) tes) =
      let btv' = createBoundTypeVariables btv (n_typeParams n) (tes)
      in mkColumn btv' nullable (n_typeExpr n)
    mkColumn btv nullable (TypeExpr (RT_Param p) []) =
      let te = case M.lookup p btv of
             Nothing -> error ("BUG: unknown type variable " <> (T.unpack p))
             Just te -> te
      in mkColumn btv nullable te

    -- Primitives
    mkColumn _ nullable te@(TypeExpr (RT_Primitive p) _) =
      mkRawColumn nullable (mkColumnType p) te

    -- For any other types, just store as jsonb
    mkColumn _ nullable te =
      mkRawColumn nullable (mkColumnType P_Json) te

    mkColumnType :: PrimitiveType -> T.Text
    mkColumnType ptype = case getAnnotation (f_annotations field) dbColumnTypeType of
      Just (JS.String ctype) -> ctype
      Nothing -> (dbp_primColumnType dbp ptype)

    columnName = case getAnnotation (f_annotations field) dbColumnNameType of
      Just (JS.String columnName) -> columnName
      Nothing -> dbName (f_name field)

    mkIdColumn :: ScopedName -> Bool ->  TypeExpr (ResolvedTypeT c) -> RawColumn c
    mkIdColumn sn nullable te = RawColumn col te
      where
        col = Column
          { column_name = columnName
          , column_ctype = dbp_idColumnType dbp
          , column_comment = typeExprText (f_type field)
          , column_nullable = nullable
          , column_references = Just (ForeignKeyRef (dbName (sn_name sn)) "id")
          }

    mkRawColumn :: Bool -> T.Text -> TypeExpr (ResolvedTypeT c) -> RawColumn c
    mkRawColumn nullable ctype te = RawColumn col te
      where
        col = Column
          { column_name = columnName
          , column_ctype = ctype
          , column_comment = typeExprText (f_type field)
          , column_nullable = nullable
          , column_references = Nothing
          }


createBoundTypeVariables :: BoundTypeVariables c -> [Ident] -> [TypeExpr (ResolvedTypeT c)] -> BoundTypeVariables c
createBoundTypeVariables btv names types = M.union btv (M.fromList (zip names types))

-- match structs that are annotated to be
-- database tables
matchDBTable :: RDecl -> Maybe DBTable
matchDBTable decl = case d_type decl of
  (Decl_Struct struct) ->
    case getAnnotation (d_annotations decl) dbTableType of
      (Just annotation) -> Just (decl,struct,annotation)
      Nothing -> case getAnnotation (d_annotations decl) dbViewType of
        (Just annotation) -> Just (decl,struct,annotation)
        Nothing -> Nothing
  _ -> Nothing

getAnnotation :: Annotations (ResolvedTypeT c)-> ScopedName -> Maybe JS.Value
getAnnotation annotations annotationName = snd <$> (M.lookup annotationName annotations)

typeExprText :: TypeExpr (ResolvedTypeT c) -> T.Text
typeExprText (TypeExpr tr [])  = typeRefText tr
typeExprText (TypeExpr tr tes)  = typeRefText tr <> "<" <>  T.intercalate "," (map typeExprText tes) <> ">"

typeRefText :: ResolvedTypeT c -> T.Text
typeRefText (RT_Primitive p) = formatText p
typeRefText (RT_Param p) = p
typeRefText (RT_Named (ScopedName (ModuleName mname) name,_))
   | null mname = name
   | otherwise   = T.intercalate "." mname <> "." <> name
-- | A type is an enumeration if it's a union with all void fields.

isEnumeration2 :: ResolvedTypeT c -> Bool
isEnumeration2 (RT_Named (ScopedName mname name,Decl{d_type=Decl_Union u})) = isEnumeration u
isEnumeration2 _ = False

----------------------------------------------------------------------
dbName :: T.Text -> T.Text
dbName = toSnakeCase

getLiteralField :: JS.Value -> T.Text -> Maybe JS.Value
getLiteralField (JS.Object map) field = HM.lookup field map
getLiteralField _ _ = Nothing

withCommas :: [a] -> [(a,T.Text)]
withCommas [] = []
withCommas [l] = [(l," ")]
withCommas (l:ls) = (l,","):withCommas ls

typeExprReferences :: ScopedName -> TypeExpr (ResolvedTypeT c) -> Bool
typeExprReferences scopedName (TypeExpr (RT_Named (sn,_)) _) | sn == scopedName = True
typeExprReferences _ _ = False

toSnakeCase :: T.Text -> T.Text
toSnakeCase = useLazy (TL.intercalate "_" . words)
  where
  useLazy :: (TL.Text -> TL.Text) -> T.Text -> T.Text
  useLazy f = TL.toStrict .  f . TL.fromStrict

  words :: TL.Text -> [TL.Text]
  words t | TL.null t = []
          | otherwise =
    let (w,t1) = word t
    in w:words t1

  word :: TL.Text -> (TL.Text,TL.Text)
  word t =
    let (uc,t1) = TL.span isUpper t
        (nuc,t2) = TL.span (not . isUpper) t1
    in (TL.toLower (uc <> nuc), t2)

dbTableType = ScopedName (ModuleName ["common","db"]) "DbTable"
dbViewType = ScopedName (ModuleName ["common","db"]) "DbView"
dbColumnNameType = ScopedName (ModuleName ["common","db"]) "DbColumnName"
dbColumnTypeType = ScopedName (ModuleName ["common","db"]) "DbColumnType"
dbKeyType = ScopedName (ModuleName ["common","db"]) "DbKey"
pkType = ScopedName (ModuleName ["common","db"]) "PK"
instantType = ScopedName (ModuleName ["common"]) "Instant"
localDateType = ScopedName (ModuleName ["common"]) "LocalDate"
localTimeType = ScopedName (ModuleName ["common"]) "LocalTime"
localDateTimeType = ScopedName (ModuleName ["common"]) "LocalDateTime"
geographyType = ScopedName (ModuleName ["common"]) "Geography"
geographyGeoJsonType = ScopedName (ModuleName ["common"]) "GeographyGeoJson"
geometryWKTType = ScopedName (ModuleName ["common"]) "GeometryWKT"
maybeType = ScopedName (ModuleName ["sys","types"]) "Maybe"
