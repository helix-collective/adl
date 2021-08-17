{-# LANGUAGE OverloadedStrings #-}
module ADL.Compiler.Backends.JavaTables.Schema(
    Column(..),
    ForeignKeyRef(..),
    PrimitiveType,
    Schema(..),
    Table(..),
    TableIndex(..),
    UniqueConstraint(..),
) where

import ADL.Core
import Control.Applicative( (<$>), (<*>), (<|>) )
import qualified ADL.Sys.Types
import qualified Data.Aeson as JS
import qualified Data.HashMap.Strict as HM
import qualified Data.Proxy
import qualified Data.Text as T
import qualified Prelude

data Column = Column
    { column_name :: T.Text
    , column_ctype :: PrimitiveType
    , column_comment :: T.Text
    , column_nullable :: Prelude.Bool
    , column_references :: (ADL.Sys.Types.Maybe ForeignKeyRef)
    }
    deriving (Prelude.Eq,Prelude.Ord,Prelude.Show)

mkColumn :: T.Text -> PrimitiveType -> T.Text -> Prelude.Bool -> (ADL.Sys.Types.Maybe ForeignKeyRef) -> Column
mkColumn name ctype comment nullable references = Column name ctype comment nullable references

instance AdlValue Column where
    atype _ = "sql.schema.Column"
    
    jsonGen = genObject
        [ genField "name" column_name
        , genField "ctype" column_ctype
        , genField "comment" column_comment
        , genField "nullable" column_nullable
        , genField "references" column_references
        ]
    
    jsonParser = Column
        <$> parseField "name"
        <*> parseField "ctype"
        <*> parseField "comment"
        <*> parseField "nullable"
        <*> parseField "references"

data ForeignKeyRef = ForeignKeyRef
    { foreignKeyRef_table :: T.Text
    , foreignKeyRef_column :: T.Text
    }
    deriving (Prelude.Eq,Prelude.Ord,Prelude.Show)

mkForeignKeyRef :: T.Text -> T.Text -> ForeignKeyRef
mkForeignKeyRef table column = ForeignKeyRef table column

instance AdlValue ForeignKeyRef where
    atype _ = "sql.schema.ForeignKeyRef"
    
    jsonGen = genObject
        [ genField "table" foreignKeyRef_table
        , genField "column" foreignKeyRef_column
        ]
    
    jsonParser = ForeignKeyRef
        <$> parseField "table"
        <*> parseField "column"

type PrimitiveType = T.Text

data Schema = Schema
    { schema_adlModules :: [T.Text]
    , schema_tables :: [Table]
    }
    deriving (Prelude.Eq,Prelude.Show)

mkSchema :: [T.Text] -> [Table] -> Schema
mkSchema adlModules tables = Schema adlModules tables

instance AdlValue Schema where
    atype _ = "sql.schema.Schema"
    
    jsonGen = genObject
        [ genField "adlModules" schema_adlModules
        , genField "tables" schema_tables
        ]
    
    jsonParser = Schema
        <$> parseField "adlModules"
        <*> parseField "tables"

data Table = Table
    { table_name :: T.Text
    , table_columns :: [Column]
    , table_primaryKey :: [T.Text]
    , table_uniqueConstraints :: [UniqueConstraint]
    , table_indexes :: [TableIndex]
    , table_annotation :: JS.Value
    }
    deriving (Prelude.Eq,Prelude.Show)

mkTable :: T.Text -> [Column] -> [T.Text] -> [UniqueConstraint] -> [TableIndex] -> JS.Value -> Table
mkTable name columns primaryKey uniqueConstraints indexes annotation = Table name columns primaryKey uniqueConstraints indexes annotation

instance AdlValue Table where
    atype _ = "sql.schema.Table"
    
    jsonGen = genObject
        [ genField "name" table_name
        , genField "columns" table_columns
        , genField "primaryKey" table_primaryKey
        , genField "uniqueConstraints" table_uniqueConstraints
        , genField "indexes" table_indexes
        , genField "annotation" table_annotation
        ]
    
    jsonParser = Table
        <$> parseField "name"
        <*> parseField "columns"
        <*> parseField "primaryKey"
        <*> parseField "uniqueConstraints"
        <*> parseField "indexes"
        <*> parseField "annotation"

data TableIndex = TableIndex
    { tableIndex_columns :: [T.Text]
    }
    deriving (Prelude.Eq,Prelude.Ord,Prelude.Show)

mkTableIndex :: [T.Text] -> TableIndex
mkTableIndex columns = TableIndex columns

instance AdlValue TableIndex where
    atype _ = "sql.schema.TableIndex"
    
    jsonGen = genObject
        [ genField "columns" tableIndex_columns
        ]
    
    jsonParser = TableIndex
        <$> parseField "columns"

data UniqueConstraint = UniqueConstraint
    { uniqueConstraint_columns :: [T.Text]
    }
    deriving (Prelude.Eq,Prelude.Ord,Prelude.Show)

mkUniqueConstraint :: [T.Text] -> UniqueConstraint
mkUniqueConstraint columns = UniqueConstraint columns

instance AdlValue UniqueConstraint where
    atype _ = "sql.schema.UniqueConstraint"
    
    jsonGen = genObject
        [ genField "columns" uniqueConstraint_columns
        ]
    
    jsonParser = UniqueConstraint
        <$> parseField "columns"